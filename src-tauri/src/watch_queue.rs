use crate::ffmpeg::executor::TranscodeQueue;
use crate::utils;
use glob::Pattern;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum WatchStatus {
    Watching,
    Paused,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WatchFolderInfo {
    pub id: u64,
    pub watch_dir: String,
    pub pattern: String,
    pub output_dir: String,
    pub output_name: String,
    pub status: WatchStatus,
    pub files_queued: u64,
    pub workflow: String,
}

pub struct WatchFolderEntry {
    pub id: u64,
    pub watch_dir: PathBuf,
    pub pattern: Pattern,
    pub output_dir: PathBuf,
    pub output_name: String,
    pub ffmpeg_template: String,
    pub ffmpeg_bin: String,
    pub envs: String,
    pub workflow: String,
    pub status: WatchStatus,
    pub seen_files: HashSet<PathBuf>,
    pub files_queued: u64,
}

#[derive(Clone)]
pub struct WatchFolderQueue {
    pub entries: Arc<Mutex<Vec<WatchFolderEntry>>>,
    pub counter: Arc<Mutex<u64>>,
}

impl Default for WatchFolderQueue {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
            counter: Arc::new(Mutex::new(0)),
        }
    }
}

impl WatchFolderQueue {
    fn next_id(&self) -> u64 {
        let mut c = self.counter.lock().unwrap();
        *c += 1;
        *c
    }

    pub fn add_entry(
        &self,
        watch_dir: PathBuf,
        pattern_str: String,
        output_dir: PathBuf,
        output_name: String,
        ffmpeg_template: String,
        ffmpeg_bin: String,
        envs: String,
        workflow: String,
    ) -> Result<u64, String> {
        let pattern = Pattern::new(&pattern_str).map_err(|e| format!("Invalid pattern: {e}"))?;

        if !watch_dir.is_dir() {
            return Err("Watch directory does not exist".to_string());
        }

        let id = self.next_id();
        let entry = WatchFolderEntry {
            id,
            watch_dir,
            pattern,
            output_dir,
            output_name,
            ffmpeg_template,
            ffmpeg_bin,
            envs,
            workflow,
            status: WatchStatus::Watching,
            seen_files: HashSet::new(),
            files_queued: 0,
        };

        let mut entries = self.entries.lock().unwrap();
        entries.push(entry);
        Ok(id)
    }

    pub fn remove_entry(&self, id: u64) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let len = entries.len();
        entries.retain(|e| e.id != id);
        entries.len() < len
    }

    pub fn get_info_list(&self) -> Vec<WatchFolderInfo> {
        let entries = self.entries.lock().unwrap();
        entries.iter().map(|e| e.clone_info()).collect()
    }
}

impl WatchFolderEntry {
    fn clone_info(&self) -> WatchFolderInfo {
        WatchFolderInfo {
            id: self.id,
            watch_dir: self.watch_dir.to_string_lossy().to_string(),
            pattern: self.pattern.to_string(),
            output_dir: self.output_dir.to_string_lossy().to_string(),
            output_name: self.output_name.clone(),
            status: self.status.clone(),
            files_queued: self.files_queued,
            workflow: self.workflow.clone(),
        }
    }
}

fn resolve_placeholders(template: &str, input_file: &str, output_path: &str) -> String {
    template
        .replace("{input}", &format!("\"{}\"", input_file))
        .replace("{output}", &format!("\"{}\"", output_path))
}

fn build_output_path(
    output_dir: &PathBuf,
    output_name: &str,
    input_file: &PathBuf,
) -> PathBuf {
    let stem = input_file
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let hash = utils::hash::short_hash(&input_file.to_string_lossy());

    let name = output_name
        .replace("{name}", &stem)
        .replace("{hash}", &hash);

    output_dir.join(name)
}

fn poll_folder(
    entry: &mut WatchFolderEntry,
) -> Vec<(String, String, String)> {
    let pattern_str = format!(
        "{}/{}",
        entry.watch_dir.to_string_lossy(),
        entry.pattern.as_str()
    );

    let mut results = Vec::new();

    let glob_paths: Vec<PathBuf> = match glob::glob(&pattern_str) {
        Ok(entries) => entries.flatten().collect(),
        Err(_) => return results,
    };

    for path in glob_paths {
        if entry.seen_files.contains(&path) {
            continue;
        }

        if !path.is_file() {
            entry.seen_files.insert(path);
            continue;
        }

        let output_path = build_output_path(&entry.output_dir, &entry.output_name, &path);
        if output_path.exists() {
            entry.seen_files.insert(path);
            continue;
        }

        let input_str = path.to_string_lossy();
        let output_str = output_path.to_string_lossy();

        let cmd = resolve_placeholders(
            &entry.ffmpeg_template,
            &input_str,
            &output_str,
        );

        let full_cmd = format!("{} {}", entry.ffmpeg_bin, cmd);

        entry.seen_files.insert(path.clone());
        results.push((
            input_str.to_string(),
            output_str.to_string(),
            full_cmd,
        ));
    }

    results
}

fn start_watchdog_thread(
    entries: Arc<Mutex<Vec<WatchFolderEntry>>>,
    queue: TranscodeQueue,
    window: tauri::Window,
) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));

        let watch_ids: Vec<u64> = {
            let e = entries.lock().unwrap();
            e.iter()
                .filter(|entry| entry.status == WatchStatus::Watching)
                .map(|entry| entry.id)
                .collect()
        };

        for id in watch_ids {
            let (matched, workflow) = {
                let mut e = entries.lock().unwrap();
                let entry = e.iter_mut().find(|e| e.id == id);
                match entry {
                    Some(entry) => {
                        let matched = poll_folder(entry);
                        entry.files_queued += matched.len() as u64;
                        (Some(matched), entry.workflow.clone())
                    }
                    None => (None, String::new()),
                }
            };

            if let Some(matched) = matched {
                for (input_file, output_file, cmd) in matched {
                    let wf_tag = format!("W-{}", id);
                    let desc = serde_json::json!({
                        "tags": ["single transcode", wf_tag],
                        "cmd": cmd,
                        "workflow": workflow,
                        "source": input_file,
                        "output": output_file,
                    })
                    .to_string();
                    queue.add_job(vec![cmd], vec![String::new()], desc);
                    queue.process_queue(window.clone());
                    let _ = window.emit("queue_status_changed", queue.get_queue_status());
                }
            }
        }

        let info_list: Vec<WatchFolderInfo> = {
            let e = entries.lock().unwrap();
            e.iter().map(|e| e.clone_info()).collect()
        };
        if !info_list.is_empty() {
            let _ = window.emit("watch_status_changed", info_list);
        }
    });
}

#[tauri::command]
pub fn start_watchfolder(
    watch_dir: String,
    pattern: String,
    output_dir: String,
    output_name: String,
    ffmpeg_template: String,
    ffmpeg_bin: String,
    envs: String,
    workflow: String,
    window: tauri::Window,
    watch_queue: tauri::State<WatchFolderQueue>,
    queue: tauri::State<TranscodeQueue>,
) -> Result<u64, String> {
    let wd = PathBuf::from(&watch_dir);
    let od = PathBuf::from(&output_dir);

    let id = watch_queue.add_entry(
        wd, pattern, od, output_name,
        ffmpeg_template, ffmpeg_bin, envs, workflow,
    )?;

    // Start watchdog on first entry
    {
        let entries = watch_queue.entries.lock().unwrap();
        if entries.len() == 1 {
            drop(entries);
            let queue_clone = (*queue).clone();
            let entries_clone = watch_queue.entries.clone();
            start_watchdog_thread(entries_clone, queue_clone, window.clone());
        }
    }

    let _ = window.emit("watch_status_changed", watch_queue.get_info_list());

    Ok(id)
}

#[tauri::command]
pub fn stop_watchfolder(
    id: u64,
    window: tauri::Window,
    watch_queue: tauri::State<WatchFolderQueue>,
) -> bool {
    let result = watch_queue.remove_entry(id);
    if result {
        let _ = window.emit("watch_status_changed", watch_queue.get_info_list());
    }
    result
}

#[tauri::command]
pub fn get_watchfolders(
    watch_queue: tauri::State<WatchFolderQueue>,
) -> Vec<WatchFolderInfo> {
    watch_queue.get_info_list()
}
