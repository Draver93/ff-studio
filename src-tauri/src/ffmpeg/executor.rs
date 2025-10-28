use super::parser;
use crate::utils::{self, filesystem};
use serde::{Deserialize, Serialize};

use regex::Regex;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Window};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TranscodeJob {
    pub id: String,
    pub desc: String,
    pub cmds: Vec<String>,
    pub envs: Vec<String>,
    pub status: JobStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

pub struct RunningJob {
    pub id: String,
    pub desc: String,
    pub pipeline: Vec<Child>,
}

#[derive(Clone)]
pub struct TranscodeQueue {
    pub queue: Arc<Mutex<VecDeque<TranscodeJob>>>,
    pub running: Arc<Mutex<Vec<RunningJob>>>,
    pub max_concurrent: Arc<Mutex<usize>>,
    pub job_counter: Arc<Mutex<u64>>,
}

impl Default for TranscodeQueue {
    fn default() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            running: Arc::new(Mutex::new(Vec::new())),
            max_concurrent: Arc::new(Mutex::new(1)),
            job_counter: Arc::new(Mutex::new(0)),
        }
    }
}

impl TranscodeQueue {
    fn generate_job_id(&self) -> String {
        let mut counter = self.job_counter.lock().unwrap();
        *counter += 1;
        format!("job_{}", *counter)
    }

    pub fn add_job(&self, cmds: Vec<String>, envs: Vec<String>, desc: String) -> String {
        let job_id = self.generate_job_id();
        let job = TranscodeJob {
            id: job_id.clone(),
            desc,
            cmds,
            envs,
            status: JobStatus::Queued,
        };

        let mut queue = self.queue.lock().unwrap();
        queue.push_back(job);

        job_id
    }

    pub fn get_queue_status(&self) -> Vec<TranscodeJob> {
        let mut all_jobs = Vec::new();

        {
            let running = self.running.lock().unwrap();
            for rj in running.iter() {
                all_jobs.push(TranscodeJob {
                    id: rj.id.clone(),
                    desc: rj.desc.clone(),
                    cmds: vec![],
                    envs: vec![],
                    status: JobStatus::Running,
                });
            }
        }

        {
            let queue = self.queue.lock().unwrap();
            for job in queue.iter() {
                all_jobs.push(job.clone());
            }
        }

        all_jobs
    }

    pub fn cancel_job(&self, job_id: &str) -> bool {
        // Try to remove from queue first
        {
            let mut queue = self.queue.lock().unwrap();
            if let Some(pos) = queue.iter().position(|j| j.id == job_id) {
                queue.remove(pos);
                return true;
            }
        }

        // Try to kill running job
        {
            let mut running = self.running.lock().unwrap();
            if let Some(pos) = running.iter().position(|j| j.id == job_id) {
                let job = &mut running[pos];
                for child in job.pipeline.iter_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                running.remove(pos);
                return true;
            }
        }

        false
    }

    pub fn cancel_all_jobs(&self) -> usize {
        let mut cancelled_count = 0;

        // Cancel all queued jobs
        {
            let mut queue = self.queue.lock().unwrap();
            cancelled_count += queue.len();
            queue.clear();
        }

        // Kill all running jobs
        {
            let mut running = self.running.lock().unwrap();
            for job in running.iter_mut() {
                for child in job.pipeline.iter_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            cancelled_count += running.len();
            running.clear();
        }

        cancelled_count
    }

    pub fn process_queue(&self, window: Window) {
        let (max_concurrent, running_count) = {
            let max = *self.max_concurrent.lock().unwrap();
            let count = self.running.lock().unwrap().len();
            (max, count)
        };

        if running_count >= max_concurrent {
            return;
        }

        let slots_available = max_concurrent - running_count;

        for _ in 0..slots_available {
            let job = {
                let mut queue = self.queue.lock().unwrap();
                queue.pop_front()
            };

            if let Some(mut job) = job {
                job.status = JobStatus::Running;

                let _ = window.emit("queue_status_changed", self.get_queue_status());

                self.execute_job(job, window.clone());
            } else {
                break;
            }
        }
    }

    fn execute_job(&self, job: TranscodeJob, window: Window) {
        use std::io::Read;
        use std::process::Stdio;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::Duration;

        let job_id = job.id.clone();
        let job_desc = job.desc.clone();
        let cmds = job.cmds;
        let envs = job.envs;

        let mut prev_stdin: Option<Stdio> = None;
        let mut pipeline: Vec<Child> = Vec::new();

        // Track if any errors occurred during execution
        let had_error = Arc::new(AtomicBool::new(false));

        for (cmd, env_str) in cmds.into_iter().zip(envs) {
            let env_map = parser::parse_env_map(&env_str);

            let safe_cmd = cmd.replace("\\", "%5C");
            let parts = match shellwords::split(&safe_cmd) {
                Ok(data) => data,
                Err(e) => {
                    let _ =
                        window.emit(&format!("transcode_{job_id}"), format!("Parse failed: {e}"));
                    let _ = window.emit(&format!("transcode_{job_id}"), "EOT_FAILED".to_string());
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

            if let Some(stdin) = prev_stdin.take() {
                c.stdin(stdin);
            } else {
                c.stdin(Stdio::null());
            }

            c.stdout(Stdio::piped());
            c.stderr(Stdio::piped());

            parser::apply_env(&mut c, &env_map);

            let mut child = match c.spawn() {
                Ok(ch) => ch,
                Err(e) => {
                    let _ =
                        window.emit(&format!("transcode_{job_id}"), format!("Spawn failed: {e}"));
                    let _ = window.emit(&format!("transcode_{job_id}"), "EOT_FAILED".to_string());
                    return;
                }
            };

            prev_stdin = child.stdout.take().map(Stdio::from);

            if let Some(mut stderr) = child.stderr.take() {
                let win = window.clone();
                let jid = job_id.clone();
                let error_flag = had_error.clone();

                std::thread::spawn(move || {
                    let mut buf = [0; 1024];
                    let mut leftover = String::new();

                    // Simple error detection regex patterns
                    let is_error = |s: &str| {
                        let lower = s.to_lowercase();
                        lower.contains("error")
                            || lower.contains("failed")
                            || lower.contains("invalid argument")
                            || lower.contains("cannot")
                            || lower.contains("matches no streams")
                            || lower.contains("no such file or directory")
                            || lower.contains("already exists")
                    };

                    loop {
                        let n = stderr.read(&mut buf).unwrap_or(0);
                        if n == 0 {
                            break;
                        }

                        leftover.push_str(&String::from_utf8_lossy(&buf[..n]));

                        while let Some(pos) = leftover.find('\n') {
                            let line = leftover.drain(..=pos).collect::<String>();
                            let clean = line.trim_matches(&['\n', '\r'][..]);
                            if !clean.is_empty() {
                                // Check if this line contains an error
                                if is_error(clean) {
                                    error_flag.store(true, Ordering::Relaxed);
                                }
                                let _ = win.emit(&format!("transcode_{jid}"), clean.to_string());
                            }
                        }
                    }

                    if !leftover.is_empty() {
                        if is_error(&leftover) {
                            error_flag.store(true, Ordering::Relaxed);
                        }
                        let _ = win.emit(&format!("transcode_{jid}"), leftover);
                    }
                });
            }

            pipeline.push(child);
        }

        // Add to running jobs
        {
            let mut running = self.running.lock().unwrap();
            running.push(RunningJob {
                id: job_id.clone(),
                desc: job_desc,
                pipeline,
            });
        }

        let _ = window.emit(&format!("transcode_{job_id}"), "Pipeline started");

        // Spawn watcher thread
        {
            let running_clone = self.running.clone();
            let queue_clone = self.clone();
            let win = window.clone();
            let jid = job_id.clone();
            let error_flag = had_error.clone();

            std::thread::spawn(move || {
                loop {
                    let all_done = {
                        let mut guard = running_clone.lock().unwrap();
                        if let Some(pos) = guard.iter().position(|j| j.id == jid) {
                            let job = &mut guard[pos];
                            let mut everything_exited = true;

                            for child in job.pipeline.iter_mut() {
                                match child.try_wait() {
                                    Ok(Some(status)) => {
                                        // Check if process failed with non-zero exit code
                                        if !status.success() {
                                            error_flag.store(true, Ordering::Relaxed);
                                        }
                                    }
                                    Ok(None) => {
                                        everything_exited = false;
                                        break;
                                    }
                                    Err(_) => {
                                        error_flag.store(true, Ordering::Relaxed);
                                        everything_exited = false;
                                        break;
                                    }
                                }
                            }
                            everything_exited
                        } else {
                            break;
                        }
                    };

                    if all_done {
                        let mut guard = running_clone.lock().unwrap();
                        if let Some(pos) = guard.iter().position(|j| j.id == jid) {
                            guard.remove(pos);
                        }
                        drop(guard); // Explicitly drop lock before other operations

                        // Emit appropriate completion event based on error flag
                        if error_flag.load(Ordering::Relaxed) {
                            let _ = win.emit(&format!("transcode_{jid}"), "EOT_FAILED".to_string());
                        } else {
                            let _ = win.emit(&format!("transcode_{jid}"), "EOT".to_string());
                        }

                        // Process next job in queue
                        queue_clone.process_queue(win.clone());
                        let _ = win.emit("queue_status_changed", queue_clone.get_queue_status());
                        break;
                    }

                    std::thread::sleep(Duration::from_millis(200));
                }
            });
        }
    }
}

pub fn make_preview_cmd(
    cmd: &str,
    cache_dir: PathBuf,
    start: &str,
    end: Option<&str>,
) -> Result<(String, String), String> {
    let seg_name: String = {
        let mut unique_str = String::from_str(cmd).unwrap();
        unique_str.push_str(start);
        if let Some(end_str) = end {
            unique_str.push_str(end_str);
        }
        unique_str
    };
    let seg_name: String = utils::hash::short_hash(&seg_name);

    let re = Regex::new(r#"(?:[^\s"]+|"[^"]*")+"#).unwrap();
    let tokens: Vec<String> = re
        .find_iter(cmd)
        .map(|m| m.as_str().trim_matches('"').to_string())
        .collect();

    let i_idx = tokens
        .iter()
        .position(|t| t == "-i")
        .ok_or_else(|| "No input file found in ffmpeg command".to_string())?;
    if i_idx + 1 >= tokens.len() {
        return Err("No input file after -i".to_string());
    }

    let input_opts = vec!["-y".to_string(), "-ss".to_string(), start.to_string()];

    let mut new_tokens = Vec::new();
    new_tokens.extend_from_slice(&tokens[..i_idx]);
    new_tokens.extend(input_opts);
    new_tokens.extend_from_slice(&tokens[i_idx..]);

    let orig_output = PathBuf::from(tokens.last().unwrap());
    let filename = orig_output
        .file_name()
        .ok_or_else(|| "Invalid output file".to_string())?
        .to_string_lossy()
        .to_string();

    let mut new_output_file = cache_dir;
    new_output_file.push(seg_name);
    if end.is_none() {
        new_output_file.set_extension("png");
    } else {
        new_output_file.set_extension("mp4");
    }

    if let Some(e) = end {
        new_tokens.splice(i_idx + 3..i_idx + 3, ["-to".to_string(), e.to_string()]);
        orig_output.clone()
    } else {
        let base_name = Path::new(&filename)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let out = orig_output.with_file_name(format!("{base_name}.png"));
        new_tokens.splice(
            i_idx + 5..i_idx + 5,
            ["-frames:v".to_string(), "1".to_string()],
        );
        out
    };

    if let Some(last) = new_tokens.last_mut() {
        *last = new_output_file.to_string_lossy().into_owned();
    }

    let final_cmd = new_tokens
        .into_iter()
        .map(|t| {
            if t.contains(' ') {
                format!("\"{t}\"")
            } else {
                t
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    Ok((final_cmd, new_output_file.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn queue_transcode(
    cmds: Vec<String>,
    envs: Vec<String>,
    desc: String,
    window: Window,
    queue: tauri::State<TranscodeQueue>,
) -> String {
    assert_eq!(cmds.len(), envs.len(), "Each command must have an env");

    let job_id = queue.add_job(cmds, envs, desc);

    // Try to process queue
    queue.process_queue(window.clone());

    let _ = window.emit("queue_status_changed", queue.get_queue_status());

    job_id
}

#[tauri::command]
pub fn set_max_concurrent(max: usize, window: Window, queue: tauri::State<TranscodeQueue>) {
    {
        let mut max_concurrent = queue.max_concurrent.lock().unwrap();
        *max_concurrent = max.max(1); // At least 1
    }

    // Try to start more jobs if we increased concurrency
    queue.process_queue(window.clone());
    let _ = window.emit("queue_status_changed", queue.get_queue_status());
}

#[tauri::command]
pub fn get_max_concurrent(queue: tauri::State<TranscodeQueue>) -> usize {
    *queue.max_concurrent.lock().unwrap()
}

#[tauri::command]
pub fn get_queue_status(queue: tauri::State<TranscodeQueue>) -> Vec<TranscodeJob> {
    queue.get_queue_status()
}

#[tauri::command]
pub fn cancel_job(job_id: String, window: Window, queue: tauri::State<TranscodeQueue>) -> bool {
    let result = queue.cancel_job(&job_id);

    if result {
        // Try to start next job
        queue.process_queue(window.clone());
        let _ = window.emit("queue_status_changed", queue.get_queue_status());
    }

    result
}

#[tauri::command]
pub fn cancel_all_jobs(window: Window, queue: tauri::State<TranscodeQueue>) -> usize {
    let count = queue.cancel_all_jobs();

    if count > 0 {
        let _ = window.emit("queue_status_changed", queue.get_queue_status());
    }

    count
}

#[tauri::command]
pub fn render_preview_request(
    window: Window,
    cmd: String,
    env: String,
    desc: String,
    start: String,
    end: String,
    queue: tauri::State<TranscodeQueue>,
) -> String {
    let data_path = filesystem::get_data_dir().unwrap();
    let tmp_path = data_path.join("tmp");
    let (final_cmd, target_file_path) = if start != end {
        make_preview_cmd(&cmd, tmp_path, &start, Some(&end)).unwrap()
    } else {
        make_preview_cmd(&cmd, tmp_path, &start, None).unwrap()
    };

    let job_id = queue.add_job(vec![final_cmd], vec![env], desc);

    let window_clone = window.clone();
    let target_path_clone = target_file_path.clone();

    window.listen(format!("transcode_{job_id}"), move |event| {
        let payload = event.payload();
        if payload == "\"EOT\"" || payload == "\"EOT_FAILED\"" {
            window_clone.unlisten(event.id());
            let _ = window_clone.emit("render_preview_listener", &target_path_clone);
        }
    });

    queue.process_queue(window.clone());
    let _ = window.emit("queue_status_changed", queue.get_queue_status());

    job_id
}
