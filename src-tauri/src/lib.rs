#![allow(dead_code)]

mod commands;
mod error;
mod ffmpeg;
mod tray_manager;
mod utils;
mod watch_queue;
mod workflow;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

use crate::tray_manager::TrayState;

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
        eprintln!("Failed to initialize working directories: {e}");
    }

    tauri::Builder::default()
        .manage(ffmpeg::executor::TranscodeQueue::default())
        .manage(watch_queue::WatchFolderQueue::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let queue_status = MenuItem::with_id(app, "queue_status", "Queue: idle", false, None::<&str>)?;
            let wf_status = MenuItem::with_id(app, "wf_status", "Watchfolder: idle", false, None::<&str>)?;
            let cancel_all = MenuItem::with_id(app, "cancel_all", "Cancel All Jobs", true, None::<&str>)?;
            let stop_wf = MenuItem::with_id(app, "stop_wf", "Stop All Watch Folders", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;

            let menu = Menu::new(app)?;
            menu.append(&show)?;
            menu.append(&sep1)?;
            menu.append(&queue_status)?;
            menu.append(&wf_status)?;
            menu.append(&cancel_all)?;
            menu.append(&stop_wf)?;
            menu.append(&sep2)?;
            menu.append(&quit)?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "cancel_all" => {
                        let _ = app.emit("tray_cancel_all", ());
                    }
                    "stop_wf" => {
                        if let Some(wq) = app.try_state::<watch_queue::WatchFolderQueue>() {
                            let ids: Vec<u64> = wq.get_info_list().iter().map(|w| w.id).collect();
                            for id in ids {
                                wq.remove_entry(id);
                            }
                            let _ = app.emit("watch_status_changed", wq.get_info_list());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            app.manage(TrayState { tray, queue_status, wf_status });

            Ok(())
        })
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
            ffmpeg::executor::cancel_all_jobs,
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
            set_tray_status,
            update_tray_menu,
            watch_queue::start_watchfolder,
            watch_queue::stop_watchfolder,
            watch_queue::get_watchfolders,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn set_tray_status(state: tauri::State<TrayState>, color: String) {
    state.set_status(&color);
}

#[tauri::command]
fn update_tray_menu(state: tauri::State<TrayState>, queue_text: String, wf_text: String) {
    state.set_menu_texts(&queue_text, &wf_text);
}
