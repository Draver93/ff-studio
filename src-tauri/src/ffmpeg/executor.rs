use crate::utils::{self, filesystem};
use super::parser;

use std::str::FromStr;
use regex::Regex;
use std::path::{ Path, PathBuf };
use tauri::{ Emitter, Window, Listener };
use std::sync::{ Arc, Mutex };
use std::process::{ Child };

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone)]
pub struct FfmpegHandle {
    pub pipeline: Arc<Mutex<Option<Vec<Child>>>>,
}

impl Default for FfmpegHandle {
    fn default() -> Self {
        Self {
            pipeline: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn make_preview_cmd( cmd: &str, cache_dir: PathBuf, start: &str, end: Option<&str>) -> Result<(String, String), String> {

    let seg_name: String = {
        let mut unique_str = String::from_str(cmd).unwrap();
        unique_str.push_str(start);
        if let Some(end_str) = end { unique_str.push_str(end_str); } 
        unique_str
    };
    let seg_name: String = utils::hash::short_hash(&seg_name );

    // Regex to split by spaces but keep quoted tokens
    let re = Regex::new(r#"(?:[^\s"]+|"[^"]*")+"#).unwrap();
    let tokens: Vec<String> = re
        .find_iter(cmd)
        .map(|m| m.as_str().trim_matches('"').to_string())
        .collect();

    // Find input file
    let i_idx = tokens
        .iter()
        .position(|t| t == "-i")
        .ok_or_else(|| "No input file found in ffmpeg command".to_string())?;
    if i_idx + 1 >= tokens.len() {
        return Err("No input file after -i".to_string());
    }

    // Build input options (before -i)
    let mut input_opts = Vec::new();
    input_opts.push("-ss".to_string());
    input_opts.push(start.to_string());

    // Insert input options before -i
    let mut new_tokens = Vec::new();
    new_tokens.extend_from_slice(&tokens[..i_idx]);
    new_tokens.extend(input_opts);
    new_tokens.extend_from_slice(&tokens[i_idx..]);

    // Output path


    let orig_output = PathBuf::from(tokens.last().unwrap());
    let filename = orig_output
        .file_name()
        .ok_or_else(|| "Invalid output file".to_string())?
        .to_string_lossy()
        .to_string();

    let mut new_output_file = PathBuf::from(cache_dir);
    new_output_file.push(seg_name);
    if end == None { new_output_file.set_extension("png"); }
    else { new_output_file.set_extension("mp4"); }
    
    if let Some(e) = end {
        // Range preview → keep original extension
        new_tokens.splice(i_idx + 2..i_idx + 2, ["-to".to_string(), e.to_string()]);
        orig_output.clone()
    } else {
        // Single frame → output as PNG
        let base_name = Path::new(&filename)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let out = orig_output.with_file_name(format!("{}.png", base_name));
        // Insert `-frames:v 1`
        new_tokens.splice(i_idx + 4..i_idx + 4, ["-frames:v".to_string(), "1".to_string()]);
        out
    };

    // Replace last token with new output path
    if let Some(last) = new_tokens.last_mut() {
        *last = new_output_file.to_string_lossy().into_owned();
    }

    // Quote tokens with spaces
    let final_cmd = new_tokens
        .into_iter()
        .map(|t| if t.contains(' ') { format!("\"{}\"", t) } else { t })
        .collect::<Vec<_>>()
        .join(" ");

    Ok((final_cmd, new_output_file.to_string_lossy().into_owned()))
}


#[tauri::command]
pub fn start_transcode(
    cmds: Vec<String>,    // multiple commands (pipeline)
    envs: Vec<String>,    // one env per command
    window: tauri::Window,
    handle: tauri::State<FfmpegHandle>,
) {
    use std::process::Stdio;
    use std::io::Read;
    use std::time::Duration;

    assert_eq!(cmds.len(), envs.len(), "Each command must have an env");

    // Kill existing pipeline if running
    {
        let mut slot = handle.pipeline.lock().unwrap();
        if let Some(children) = slot.take() {
            for mut child in children {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    // prev_stdin is a Stdio we pass into the next Command::stdin(...)
    let mut prev_stdin: Option<Stdio> = None;
    let mut pipeline: Vec<std::process::Child> = Vec::new();

    for (cmd, env_str) in cmds.into_iter().zip(envs) {
        let env_map = parser::parse_env_map(&env_str);

        let safe_cmd = cmd.replace("\\", "%5C");
        let parts = match shellwords::split(&safe_cmd) {
            Ok(data) => data,
            Err(e) => {
                let _ = window.emit("start_transcode_listener", format!("Parse failed: {}", e));
                let _ = window.emit("start_transcode_listener", "EOT".to_string());
                return;
            }
        };

        let mut parts_iter = parts.into_iter().map(|s| s.replace("%5C", "\\"));

        let program = parts_iter.next().expect("empty command");

        let mut c = std::process::Command::new(program);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            c.creation_flags(CREATE_NO_WINDOW);
        }

        c.args(parts_iter);
        c.arg("-progress").arg("pipe:2").arg("-hide_banner");

        // If we have a previous stdout, make it this command's stdin (as Stdio)
        if let Some(stdin) = prev_stdin.take() {
            c.stdin(stdin);
        } else {
            // first command: no stdin (or explicitly null)
            c.stdin(Stdio::null());
        }

        c.stdout(Stdio::piped());
        c.stderr(Stdio::piped());

        parser::apply_env(&mut c, &env_map);

        let mut child = match c.spawn() {
            Ok(ch) => ch,
            Err(e) => {
                let _ = window.emit("start_transcode_listener", format!("Spawn failed: {}", e));
                let _ = window.emit("start_transcode_listener", "EOT".to_string());
                return;
            }
        };

        // Convert the newly spawned child's stdout into a Stdio to feed the *next* command.
        prev_stdin = child.stdout.take().map(Stdio::from);

        // Spawn stderr reader thread; DO NOT clear the shared pipeline here.
        if let Some(mut stderr) = child.stderr.take() {
            let win = window.clone();
            std::thread::spawn(move || {
                let mut buf = [0; 1024];
                let mut leftover = String::new();
                loop {
                    let n = stderr.read(&mut buf).unwrap_or(0);
                    if n == 0 { break; }

                    leftover.push_str(&String::from_utf8_lossy(&buf[..n]));

                    while let Some(pos) = leftover.find('\n') {
                        let line = leftover.drain(..=pos).collect::<String>();
                        let clean = line.trim_matches(&['\n', '\r'][..]);
                        if !clean.is_empty() {
                            let _ = win.emit("start_transcode_listener", clean.to_string());
                        }
                    }
                }

                if !leftover.is_empty() {
                    let _ = win.emit("start_transcode_listener", leftover);
                }
            });
        }

        pipeline.push(child);
    }

    {
        let mut slot = handle.pipeline.lock().unwrap();
        *slot = Some(pipeline);
    }

    let _ = window.emit("start_transcode_listener", "Pipeline started");

    // Spawn a watcher thread that polls the children with try_wait().
    // When all children have exited we clear handle.pipeline and emit final EOT.
    {
        let pipeline_clone = handle.pipeline.clone();
        let win = window.clone();
        std::thread::spawn(move || {
            loop {
                let all_done = {
                    let mut guard = pipeline_clone.lock().unwrap();
                    if let Some(children) = guard.as_mut() {
                        let mut everything_exited = true;
                        for child in children.iter_mut() {
                            match child.try_wait() {
                                Ok(Some(_status)) => { /* exited */ }
                                Ok(None) => { everything_exited = false; break; } // still running
                                Err(_) => { everything_exited = false; break; }
                            }
                        }
                        everything_exited
                    } else { break; }
                };

                if all_done {
                    // clear the pipeline and notify
                    let mut guard = pipeline_clone.lock().unwrap();
                    *guard = None;
                    let _ = win.emit("start_transcode_listener", "EOT".to_string());
                    break;
                }

                std::thread::sleep(Duration::from_millis(200));
            }
        });
    }
}

#[tauri::command]
pub fn stop_transcode(handle: tauri::State<FfmpegHandle>) {
    let mut slot = handle.pipeline.lock().unwrap();
    if let Some(children) = slot.take() {
        for mut child in children {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub fn render_preview_request(window: Window, cmd: String, env: String, start: String, end: String, handle: tauri::State<FfmpegHandle>) {
    let data_path = filesystem::get_data_dir().unwrap();
    let tmp_path = data_path.join("tmp");
    let (final_cmd, target_file_path) = if start != end {
        make_preview_cmd(&cmd, tmp_path, &start, Some(&end)).unwrap()
    } else {
        make_preview_cmd(&cmd, tmp_path, &start, None).unwrap()
    };
    
    let window_clone = window.clone();
    let target_path_clone = target_file_path.clone();
    window.listen("start_transcode_listener", move |event| {
        let payload = event.payload();
        if payload == "\"EOT\"" {
            window_clone.unlisten(event.id());
            let _ = window_clone.emit("render_preview_listener", &target_path_clone);
        }
    });
    
    start_transcode(
        vec![final_cmd],  // cmds
        vec![env],        // envs
        window,
        handle,
    );
}