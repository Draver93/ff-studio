use crate::{log_error, FFStudioError, Result};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn pick_file(app: AppHandle) -> Result<Option<String>> {
    match app.dialog().file().blocking_pick_file() {
        Some(pathbuf) => {
            let path_str = pathbuf.to_string();
            log::info!("File selected: {path_str}");
            Ok(Some(path_str))
        }
        None => {
            log::info!("No file selected");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn file_exists(path: String) -> Result<bool> {
    if path.is_empty() {
        return Err(FFStudioError::file_system("Empty path provided"));
    }

    let path = Path::new(&path);
    match path.try_exists() {
        Ok(exists) => Ok(exists),
        Err(e) => {
            log_error(&FFStudioError::from(e), "checking file existence");
            Err(FFStudioError::file_system(format!(
                "Failed to check if file exists: {}",
                path.display()
            )))
        }
    }
}

#[tauri::command]
pub fn get_file_info(path: String) -> Result<serde_json::Value> {
    if path.is_empty() {
        return Err(FFStudioError::file_system("Empty path provided"));
    }

    let path = Path::new(&path);

    if !path.exists() {
        return Err(FFStudioError::file_system(format!(
            "File does not exist: {}",
            path.display()
        )));
    }

    let metadata = std::fs::metadata(path).map_err(|e| {
        FFStudioError::file_system(format!(
            "Failed to read metadata for {}: {}",
            path.display(),
            e
        ))
    })?;

    let file_info = serde_json::json!({
        "path": path.to_string_lossy(),
        "exists": true,
        "is_file": metadata.is_file(),
        "is_dir": metadata.is_dir(),
        "size": metadata.len(),
        "modified": metadata.modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs()),
        "extension": path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or(""),
        "filename": path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
    });

    Ok(file_info)
}
