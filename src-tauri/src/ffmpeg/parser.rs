use crate::workflow::types::{Node, OptionEntry};
use anyhow::Result;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn apply_env<'a>(cmd: &'a mut Command, env_map: &HashMap<String, String>) -> &'a mut Command {
    cmd.env_clear();
    cmd.envs(env_map.iter());
    cmd
}
pub fn parse_env_map(env_str: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for line in env_str.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            m.insert(k.to_string(), v.to_string());
        }
    }
    m
}

pub fn parse_ffmpeg(ffmpeg: &str, env_str: &str) -> Result<Vec<Node>> {
    let env_map = parse_env_map(env_str);
    let acc: Arc<Mutex<Vec<Node>>> = Arc::new(Mutex::new(Vec::new()));

    let jobs: Vec<_> = vec![
        ("filter", 8),
        ("encoder", 10),
        ("decoder", 10),
        ("muxer", 4),
        ("demuxer", 4),
        //("bsf", 3),
    ];

    let mut handles = Vec::new();

    for (name, header) in jobs {
        let ff = ffmpeg.to_string();
        let envc = env_map.clone();
        let accc = Arc::clone(&acc);
        let h = thread::spawn(move || {
            if let Ok(nodes) = parse_general(&ff, name, header, &envc) {
                accc.lock().unwrap().extend(nodes);
            }
        });
        handles.push(h);
    }

    // sample_fmts
    {
        let ff = ffmpeg.to_string();
        let envc = env_map.clone();
        let accc = Arc::clone(&acc);
        let h = thread::spawn(move || {
            if let Ok(node) = parse_sample_fmts(&ff, &envc) {
                accc.lock().unwrap().push(node);
            }
        });
        handles.push(h);
    }

    // pix_fmts
    {
        let ff = ffmpeg.to_string();
        let envc = env_map.clone();
        let accc = Arc::clone(&acc);
        let h = thread::spawn(move || {
            if let Ok(node) = parse_pix_fmts(&ff, &envc) {
                accc.lock().unwrap().push(node);
            }
        });
        handles.push(h);
    }

    // globals
    {
        let ff = ffmpeg.to_string();
        let envc = env_map.clone();
        let accc = Arc::clone(&acc);
        let h = thread::spawn(move || {
            if let Ok(nodes) = parse_globals(&ff, &envc) {
                accc.lock().unwrap().extend(nodes);
            }
        });
        handles.push(h);
    }

    // contexts
    {
        let ff = ffmpeg.to_string();
        let envc = env_map.clone();
        let accc = Arc::clone(&acc);
        let h = thread::spawn(move || {
            if let Ok(nodes) = parse_contexts(&ff, &envc) {
                accc.lock().unwrap().extend(nodes);
            }
        });
        handles.push(h);
    }

    for h in handles {
        let _ = h.join();
    }

    let out = Arc::try_unwrap(acc).unwrap().into_inner().unwrap();
    Ok(out)
}

fn parse_general(
    ffmpeg: &str,
    name: &str,
    header_size: usize,
    env_map: &HashMap<String, String>,
) -> Result<Vec<Node>> {
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg(format!("-{name}s"))
        .arg("-hide_banner")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut cmd, env_map);
    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > header_size {
        lines.drain(..header_size);
    } else {
        lines.clear();
    }

    let section_re = Regex::new(r"^(.+?)\s+AVOptions:\s*$").unwrap();
    let header_re: Regex = Regex::new(r"\s<[^>]+>\s").unwrap();
    let timeline_re: Regex = Regex::new(r"(?i)(timeline.*support|enable.*option)").unwrap();
    let re = Regex::new(r"^\s*-?[\w\d_][\w\d_-]*\s*(<\w+>|\d+)?\s+[A-Z.]*\s+.*$").unwrap();

    let mut nodes = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.is_empty() {
            continue;
        }

        let global_name = if words.len() == 1 {
            words.first().unwrap_or(&"").to_string()
        } else {
            words.get(1).unwrap_or(&"").to_string()
        };
        let global_desc = if words.len() == 1 {
            "No description".to_string()
        } else {
            words.iter().skip(3).cloned().collect::<Vec<_>>().join(" ")
        };

        // Obtain per-item help
        let mut help_cmd = Command::new(ffmpeg);
        apply_env(&mut help_cmd, env_map);

        #[cfg(windows)]
        {
            // Prevent a new terminal from appearing
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            help_cmd.creation_flags(CREATE_NO_WINDOW);
        }

        help_cmd
            .args(["-h", &format!("{name}={global_name}"), "-hide_banner"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let help = help_cmd.output().unwrap();
        let help_text = if help.stdout.is_empty() {
            &help.stderr
        } else {
            &help.stdout
        };
        let full_desc: Vec<String> = String::from_utf8_lossy(help_text)
            .lines()
            .map(|s| s.to_string())
            .collect();

        let filtered: Vec<&str> = full_desc
            .iter()
            .skip_while(|s| !section_re.is_match(s))
            .map(|s| s.as_str())
            .collect();

        let mut is_main_node = true;
        let mut is_dup_fields = false;
        let mut current_node: Option<Node> = None;
        let mut current_opt: Option<OptionEntry> = None;
        let mut repeated_opt: HashSet<String> = HashSet::new();

        for opt_line in filtered.iter() {
            if section_re.is_match(opt_line) {
                if let Some(mut prev) = current_node.take() {
                    if let Some(opt) = current_opt.take() {
                        prev.options.push(opt);
                    }

                    // --- Add "enable" option if timeline support is mentioned ---
                    if timeline_re.is_match(&String::from_utf8_lossy(help_text)) {
                        let opt = OptionEntry {
                            flag: "enable".to_string(),
                            no_args: false,
                            desc: Some("Enable timeline support for this filter".to_string()),
                            ..OptionEntry::default()
                        };
                        prev.options.push(opt);
                    }
                    nodes.push(prev);
                }

                let node = Node {
                    name: if is_main_node {
                        global_name.clone()
                    } else {
                        opt_line.split_whitespace().take(1).collect()
                    },
                    is_av_option: is_main_node,
                    desc: global_desc.clone(),
                    category: String::new(),
                    pcategory: format!("{name}s"),
                    full_desc: full_desc.clone(),
                    options: Vec::new(),
                };

                current_node = Some(node);
                repeated_opt.clear();
                is_main_node = false;
            } else if re.is_match(opt_line) {
                if let Some(n) = &mut current_node {
                    if header_re.is_match(opt_line) {
                        // New flag line: "-flag <type> category ..."
                        let parts: Vec<&str> = opt_line.split_whitespace().collect();
                        if parts.len() > 2 {
                            is_dup_fields = false;
                            // Not all args have description
                            if parts.len() > 3 {
                                let desc: String =
                                    parts.iter().skip(3).fold(String::new(), |acc, s| acc + s);
                                if repeated_opt.contains(&desc) {
                                    is_dup_fields = true;
                                    continue;
                                } else {
                                    repeated_opt.insert(desc);
                                }
                            }

                            if let Some(prev) = current_opt.take() {
                                n.options.push(prev);
                            }
                            let opt = OptionEntry {
                                flag: parts[0].to_string(),
                                r#type: Some(parts[1].to_string()),
                                category: Some(parts[2].to_string()),
                                enum_vals: Vec::new(),
                                ..OptionEntry::default()
                            };

                            n.category = if n.category.is_empty() {
                                parts[2].to_string()
                            } else if n.category != parts[2] {
                                "~".to_string()
                            } else {
                                n.category.to_string()
                            };

                            current_opt = Some(opt);
                        }
                    } else if !is_dup_fields {
                        if let Some(ref mut opt) = current_opt {
                            if opt.r#type.as_deref() == Some("<flags>") {
                                opt.desc = Some(line.to_string());
                            } else if let Some(enum_val) = line.split_whitespace().next() {
                                opt.enum_vals.push(enum_val.to_string());
                                opt.r#type = Some("<enum>".to_string());
                                opt.no_args = true;
                            }
                        }
                    }
                }
            }
        }
        if let Some(mut n) = current_node.take() {
            if let Some(opt) = current_opt.take() {
                n.options.push(opt);
            }
            // --- Add "enable" option if timeline support is mentioned ---
            if timeline_re.is_match(&String::from_utf8_lossy(help_text)) {
                let opt = OptionEntry {
                    flag: "enable".to_string(),
                    no_args: false,
                    desc: Some("Enable timeline support for this filter".to_string()),
                    ..OptionEntry::default()
                };

                n.options.push(opt);
            }

            nodes.push(n);
        }

        if is_main_node {
            //means no info about this node is exists.
            let node = Node {
                name: global_name.clone(),
                desc: global_desc.clone(),
                is_av_option: is_main_node,
                category: String::new(),
                pcategory: format!("{name}s"),
                full_desc: full_desc.clone(),
                options: Vec::new(),
            };
            nodes.push(node);
        }
    }
    Ok(nodes)
}

fn parse_globals(ffmpeg: &str, env_map: &HashMap<String, String>) -> Result<Vec<Node>> {
    let mut cmd = Command::new(ffmpeg);
    let re = Regex::new(r" {2,}").unwrap(); // 2 or more literal spaces

    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.args(["-h", "long", "-hide_banner"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut cmd, env_map);
    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);

    let mut nodes: Vec<Node> = Vec::new();
    let mut lines = text.lines();

    // find first line that contains 'options' and ends with ':'
    let mut found = false;
    let mut collected: Vec<String> = Vec::new();
    for l in lines.by_ref() {
        if !l.trim().is_empty() && l.contains("options") && l.trim_end().ends_with(':') {
            found = true;
            collected.push(l.to_string());
            break;
        }
    }
    if !found {
        return Ok(nodes);
    }

    // collect the rest of the lines
    for l in lines {
        collected.push(l.to_string());
    }

    let mut current: Option<Node> = None;
    for line in collected {
        if line.trim().is_empty() {
            continue;
        }
        if line.contains("options") && line.trim_end().ends_with(':') {
            if let Some(n) = current.take() {
                nodes.push(n);
            }
            let node = Node {
                is_av_option: false,
                name: line.clone(),
                ..Node::default()
            };

            current = Some(node);
        } else {
            let mut opt = OptionEntry::default();
            let parts: Vec<&str> = re.splitn(&line, 2).collect();
            if let Some(first_part) = parts.first() {
                let parts: Vec<&str> = first_part.split_whitespace().collect();
                if let Some(first_part) = parts.first() {
                    opt.flag = first_part.to_string();

                    // Special case for stream specifier options: -*[:<stream_spec>]
                    if first_part.contains("[:<") && first_part.ends_with(">]") {
                        // Extract the base flag name (remove the [:<>] part)
                        if let Some(base_flag_end) = first_part.find("[:<") {
                            opt.flag = first_part[..base_flag_end].to_string();
                        }
                    }

                    opt.enum_vals = Vec::new();

                    // Regular argument detection
                    opt.no_args = parts.len() == 1;
                }
            }

            opt.desc = Some(line.clone());
            if let Some(ref mut n) = current {
                n.options.push(opt);
            }
        }
    }
    if let Some(n) = current.take() {
        nodes.push(n);
    }

    Ok(nodes)
}

fn parse_contexts(ffmpeg: &str, env_map: &HashMap<String, String>) -> Result<Vec<Node>> {
    // Execute ffmpeg command to get help output
    let mut cmd = Command::new(ffmpeg);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.args(["-h", "full", "-hide_banner"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut cmd, env_map);

    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);

    // Parse the output into nodes
    let mut nodes: Vec<Node> = Vec::new();
    let mut lines = text.lines().peekable();

    let target_sections = [
        "AVCodecContext AVOptions:",
        "AVFormatContext AVOptions:",
        "AVIOContext AVOptions:",
        "URLContext AVOptions:",
    ];

    while let Some(line) = lines.next() {
        // Check if this line matches a target section header
        if !target_sections.contains(&line.trim()) {
            continue;
        }

        // Create node for this section
        let mut node = Node {
            is_av_option: false,
            name: line
                .split_whitespace()
                .next()
                .unwrap_or("undefined")
                .to_string(),
            pcategory: "contexts".to_string(),
            full_desc: vec![line.to_string()],
            ..Node::default()
        };

        let mut current_opt: Option<OptionEntry> = None;

        // Parse options within this section
        while let Some(&next_line) = lines.peek() {
            let next_trimmed = next_line.trim();

            // Stop if we hit another section header (ends with ':' and not indented)
            if !next_trimmed.is_empty()
                && next_trimmed.ends_with(':')
                && !next_line.starts_with(' ')
            {
                break;
            }

            let line = lines.next().unwrap();

            // Skip empty lines
            if line.trim().is_empty() {
                continue;
            }

            node.full_desc.push(line.to_string());

            // Main option line (starts with "  -")
            if line.starts_with("  -") {
                // Save previous option if exists
                if let Some(opt) = current_opt.take() {
                    node.options.push(opt);
                }

                // Parse the option line inline
                // Format: "  -flag <type> <scope> description"
                let mut opt = OptionEntry {
                    enum_vals: Vec::new(),
                    ..OptionEntry::default()
                };

                let trimmed = line.trim_start();

                // Extract flag name (everything before first whitespace)
                if let Some(flag_end) = trimmed.find(char::is_whitespace) {
                    opt.flag = trimmed[..flag_end].to_string();
                    let rest = trimmed[flag_end..].trim_start();

                    // Extract type (e.g., <int64>, <flags>, <float>)
                    if let Some(type_start) = rest.find('<') {
                        if let Some(type_end) = rest.find('>') {
                            let type_str = &rest[type_start + 1..type_end];
                            opt.r#type = Some(format!("<{}>", type_str));
                            opt.no_args = matches!(type_str, "boolean");

                            // Extract category (scope markers like E..V.., ED.VA..)
                            let after_type = rest[type_end + 1..].trim_start();
                            if let Some(category_end) = after_type.find(char::is_whitespace) {
                                let category = &after_type[..category_end];
                                if !category.is_empty() {
                                    opt.category = Some(category.to_string());
                                }

                                // Extract description
                                let desc = after_type[category_end..].trim();
                                if !desc.is_empty() {
                                    opt.desc = Some(desc.to_string());
                                }
                            }
                        }
                    }
                }

                // Fallback: use full line as description if parsing failed
                if opt.desc.is_none() {
                    opt.desc = Some(line.to_string());
                }

                current_opt = Some(opt);
            }
            // Enum value line (indented further, no dash prefix)
            else if line.starts_with("     ") && !line.trim_start().starts_with('-') {
                if let Some(ref mut opt) = current_opt {
                    if opt.r#type.as_deref() == Some("<flags>") {
                        match &mut opt.desc {
                            Some(desc) => desc.push_str(&format!("<br>{line}")),
                            None => opt.desc = Some(line.to_string()),
                        };
                    } else if let Some(enum_val) = line.split_whitespace().next() {
                        opt.enum_vals.push(enum_val.to_string());

                        // Mark as enum type if not already
                        if opt.r#type.as_deref() != Some("<enum>") {
                            opt.r#type = Some("<enum>".to_string());
                            opt.no_args = true;
                        }
                    }
                }
            }
        }

        // Push the last option if exists
        if let Some(opt) = current_opt {
            node.options.push(opt);
        }

        nodes.push(node);
    }

    Ok(nodes)
}

fn parse_bsfs(ffmpeg: &str, env_map: &HashMap<String, String>) -> Result<Vec<Node>> {
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.args(["-bsfs", "-hide_banner"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut cmd, env_map);
    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);

    let mut nodes = Vec::new();
    for line in text.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.is_empty() {
            continue;
        }
        let node = Node {
            is_av_option: false,
            name: words[0].to_string(),
            desc: "No info".to_string(),
            ..Node::default()
        };

        nodes.push(node);
    }
    Ok(nodes)
}

fn parse_pix_fmts(ffmpeg: &str, env_map: &HashMap<String, String>) -> Result<Node> {
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.args(["-pix_fmts", "-hide_banner"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut cmd, env_map);
    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);

    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > 8 {
        lines.drain(..8);
    } else {
        lines.clear();
    }

    let mut node = Node {
        name: "pixel format".to_string(),
        desc: "No info".to_string(),
        is_av_option: false,
        ..Node::default()
    };

    let mut option = OptionEntry {
        category: Some(String::new()),
        flag: "-pix_fmt".to_string(),
        no_args: true,
        ..OptionEntry::default()
    };

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            option.enum_vals.push(parts[1].to_string());
        }
    }
    node.options.push(option);
    Ok(node)
}

fn parse_sample_fmts(ffmpeg: &str, env_map: &HashMap<String, String>) -> Result<Node> {
    let mut cmd = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.args(["-sample_fmts", "-hide_banner"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_env(&mut cmd, env_map);
    let out = cmd.output()?;
    let text = String::from_utf8_lossy(&out.stdout);

    let mut node = Node {
        name: "sample format".to_string(),
        desc: "No info".to_string(),
        is_av_option: false,
        ..Node::default()
    };

    let mut option = OptionEntry {
        category: Some(String::new()),
        flag: "-sample_fmt".to_string(),
        no_args: true,
        ..OptionEntry::default()
    };

    for line in text.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(fmt) = parts.first() {
            option.enum_vals.push((*fmt).to_string());
        }
    }
    node.options.push(option);
    Ok(node)
}
