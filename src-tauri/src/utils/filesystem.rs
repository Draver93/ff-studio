use glob::glob;
use std::fs;
use std::path::PathBuf;

use super::hash::short_hash;
use crate::workflow::types::Node;
use crate::{FFStudioError, Result};
use directories::ProjectDirs;

pub fn get_data_dir() -> Result<PathBuf> {
    if let Some(proj_dirs) = ProjectDirs::from("com", "FAI", "FFStudio") {
        let dir = proj_dirs.data_dir().to_path_buf();
        fs::create_dir_all(&dir).map_err(|e| {
            FFStudioError::file_system(format!("Failed to create data directory: {e}"))
        })?;
        Ok(dir)
    } else {
        Err(FFStudioError::file_system(
            "Could not determine application data directory",
        ))
    }
}

pub fn init_workdir() -> Result<()> {
    let data_path = get_data_dir()?;

    let workflow_path = data_path.join("workflows");
    let cache_path = data_path.join("cache");
    let tmp_path = data_path.join("tmp");

    // Create directories if they don't exist
    if !workflow_path.exists() {
        fs::create_dir_all(&workflow_path).map_err(|e| {
            FFStudioError::file_system(format!("Failed to create workflows directory: {e}"))
        })?;
        log::info!("Created workflows directory: {workflow_path:?}");
    }

    if !cache_path.exists() {
        fs::create_dir_all(&cache_path).map_err(|e| {
            FFStudioError::file_system(format!("Failed to create cache directory: {e}"))
        })?;
        log::info!("Created cache directory: {cache_path:?}");
    }

    if !tmp_path.exists() {
        fs::create_dir_all(&tmp_path).map_err(|e| {
            FFStudioError::file_system(format!("Failed to create tmp directory: {e}"))
        })?;
        log::info!("Created tmp directory: {tmp_path:?}");
    }

    log::info!("Initialized working directories successfully");
    Ok(())
}

pub fn load_nodes(ffmpeg_path: &str) -> Result<Vec<Node>> {
    if ffmpeg_path.trim().is_empty() {
        return Err(FFStudioError::file_system("FFmpeg path cannot be empty"));
    }

    let filename = short_hash(ffmpeg_path);
    let data_path = get_data_dir()?;
    let cache_path = data_path.join("cache");
    let full_path = cache_path.join(filename + ".json");

    if !full_path.exists() {
        return Err(FFStudioError::file_system(format!(
            "Cache file not found for FFmpeg path: {ffmpeg_path}"
        )));
    }

    let data = std::fs::read_to_string(&full_path)
        .map_err(|e| FFStudioError::file_system(format!("Failed to read cache file: {e}")))?;

    let nodes: Vec<Node> = serde_json::from_str(&data)
        .map_err(|e| FFStudioError::json(format!("Failed to parse cached nodes: {e}")))?;

    log::debug!(
        "Loaded {} nodes from cache for FFmpeg path: {}",
        nodes.len(),
        ffmpeg_path
    );
    Ok(nodes)
}

pub fn save_nodes(ffmpeg_path: &str, nodes: &Vec<Node>) -> Result<()> {
    if ffmpeg_path.trim().is_empty() {
        return Err(FFStudioError::file_system("FFmpeg path cannot be empty"));
    }

    let filename = short_hash(ffmpeg_path);
    let data_path = get_data_dir()?;
    let cache_path = data_path.join("cache");
    let full_path = cache_path.join(filename + ".json");

    let data = serde_json::to_string_pretty(nodes)
        .map_err(|e| FFStudioError::json(format!("Failed to serialize nodes: {e}")))?;

    std::fs::write(&full_path, data)
        .map_err(|e| FFStudioError::file_system(format!("Failed to write cache file: {e}")))?;

    log::debug!(
        "Saved {} nodes to cache for FFmpeg path: {}",
        nodes.len(),
        ffmpeg_path
    );
    Ok(())
}

#[tauri::command]
pub fn expand_wildcard_path(pattern: String) -> Result<Vec<String>> {
    let matches: Vec<String> = glob(&pattern)?
        .filter_map(|entry| {
            entry.ok().and_then(|path| {
                if path.is_file() {
                    Some(path.to_string_lossy().to_string())
                } else {
                    None
                }
            })
        })
        .collect();
    Ok(matches)
}
