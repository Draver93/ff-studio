use crate::ffmpeg::version::get_mediainfo;
use crate::utils::filesystem::get_data_dir;
use crate::workflow::types::MIResponse;

use std::fs;

#[tauri::command]
pub fn get_mediainfo_request(path: String, ffmpeg: String, env: String) -> MIResponse {
    let mi_result = get_mediainfo(&path, &ffmpeg, &env);
    match mi_result {
        Ok(array) => MIResponse {
            message: "OK".to_string(),
            info_arr: array,
        },
        Err(_) => MIResponse {
            message: "Faild to get media info".to_string(),
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
