#![allow(dead_code)]

mod commands;
mod error;
mod ffmpeg;
mod utils;
mod workflow;

pub use error::{log_error, to_user_message, ErrorContext, FFStudioError, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    // Initialize working directories
    if let Err(e) = utils::filesystem::init_workdir() {
        log_error(&e, "initializing working directories");
        eprintln!("Failed to initialize working directories: {}", e);
    }

    tauri::Builder::default()
        .manage(ffmpeg::executor::TranscodeQueue::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_ops::pick_file,
            commands::file_ops::file_exists,
            commands::file_ops::get_file_info,
            ffmpeg::executor::queue_transcode,
            ffmpeg::executor::set_max_concurrent,
            ffmpeg::executor::get_max_concurrent,
            ffmpeg::executor::get_queue_status,
            ffmpeg::executor::cancel_job,
            ffmpeg::executor::render_preview_request,
            ffmpeg::executor::render_preview_request,
            commands::workflow_ops::save_graph,
            commands::workflow_ops::get_workflow,
            commands::workflow_ops::edit_workflow,
            commands::workflow_ops::create_workflow,
            commands::workflow_ops::delete_workflow,
            commands::workflow_ops::get_nodes_request,
            commands::media_ops::get_mediainfo_request,
            commands::media_ops::delete_cache_request,
            workflow::manager::get_workflow_list,
            utils::version::app_version,
            utils::filesystem::expand_wildcard_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
