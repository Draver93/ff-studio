use crate::ffmpeg::version::get_mediainfo;
use crate::utils::filesystem::get_data_dir;
use crate::workflow::types::MIResponse;

use std::fs;

#[tauri::command]
pub async fn get_mediainfo_request(path: String, ffmpeg: String, env: String) -> MIResponse {
    // get_mediainfo can block for a while on slow/live sources (it has an
    // internal timeout), so run it on the blocking thread pool to avoid holding
    // up the async runtime / UI.
    let result = tokio::task::spawn_blocking(move || get_mediainfo(&path, &ffmpeg, &env)).await;

    match result {
        Ok(mi) => {
            let message = if mi.timed_out {
                "Media probe timed out (showing partial info)".to_string()
            } else if mi.error.is_some() {
                "Failed to get media info".to_string()
            } else {
                "OK".to_string()
            };
            MIResponse {
                message,
                timed_out: mi.timed_out,
                // Keep whatever output ffmpeg produced, even on timeout.
                info_arr: mi.lines,
            }
        }
        Err(_) => MIResponse {
            message: "Failed to get media info".to_string(),
            timed_out: false,
            info_arr: Vec::new(),
        },
    }
}

#[tauri::command]
pub async fn delete_cache_request() {
    let data_path = get_data_dir().unwrap();
    let tmp_path = data_path.join("tmp");
    if tmp_path.exists() {
        for entry in fs::read_dir(tmp_path).unwrap() {
            let entry = entry.unwrap();
            let entry_path = entry.path();
            if entry_path.is_dir() {
                fs::remove_dir_all(entry_path).unwrap();
            } else {
                fs::remove_file(entry_path).unwrap();
            }
        }
    }
}
