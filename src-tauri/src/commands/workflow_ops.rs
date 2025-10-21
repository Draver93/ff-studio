use tauri::{Emitter, Window};

use serde_json::json;
use std::path::PathBuf;

use crate::ffmpeg::parser::parse_ffmpeg;
use crate::ffmpeg::version::get_ffmpeg_version;

use crate::utils::filesystem::{get_data_dir, load_nodes, save_nodes};
use crate::workflow::manager::get_workflow_list;
use crate::workflow::types::{Node, Response, WorkflowStructure};
use crate::{log_error, to_user_message, FFStudioError, Result};

pub fn add_workflow(
    name: String,
    path: String,
    env: String,
    desc: String,
    nodes: &Vec<Node>,
    version_data: &Vec<String>,
) -> Result<()> {
    if name.trim().is_empty() {
        return Err(FFStudioError::workflow("Workflow name cannot be empty"));
    }

    let data_path = get_data_dir()
        .map_err(|e| FFStudioError::file_system(format!("Failed to get data directory: {e}")))?;

    let wf_path: PathBuf = data_path.join("workflows");
    let wf_full_path = wf_path.join(name.clone() + ".json");

    // Check if workflow already exists
    if wf_full_path.exists() {
        log::warn!("Workflow '{name}' already exists, overwriting");
    }

    // Save nodes to cache
    let _ = save_nodes(&path, nodes);

    let data_struct = WorkflowStructure {
        name: name.clone(),
        path,
        env,
        desc,
        version: version_data.clone(),
        graph: "".to_string(),
    };

    let json_data = json!(data_struct).to_string();
    std::fs::write(&wf_full_path, json_data).map_err(|e| {
        FFStudioError::file_system(format!("Failed to save workflow '{name}': {e}"))
    })?;

    log::info!("Workflow '{name}' saved successfully");
    Ok(())
}

#[tauri::command]
pub async fn get_nodes_request(window: Window, ffmpeg_path: String) -> Result<()> {
    if ffmpeg_path.trim().is_empty() {
        let error_msg = "FFmpeg path cannot be empty";
        log_error(&FFStudioError::workflow(error_msg), "get_nodes_request");
        let _ = window.emit("get_nodes_listener", FFStudioError::workflow(error_msg));
        return Err(FFStudioError::workflow(error_msg));
    }

    match load_nodes(&ffmpeg_path) {
        Ok(nodes) => {
            log::info!(
                "Successfully loaded {} nodes for FFmpeg path: {}",
                nodes.len(),
                ffmpeg_path
            );
            let _ = window.emit("get_nodes_listener", nodes);
            Ok(())
        }
        Err(e) => {
            let error = e;
            log_error(&error, "loading nodes");
            let _ = window.emit("get_nodes_listener", error.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn get_workflow(window: Window, name: String) -> Result<()> {
    if name.trim().is_empty() {
        let error_msg = "Workflow name cannot be empty";
        log_error(&FFStudioError::workflow(error_msg), "get_workflow");
        let _ = window.emit(
            "get_workflow_listener",
            Response {
                message: error_msg.to_string(),
                build: "".to_string(),
                version: "".to_string(),
                nodes: Vec::new(),
                env: "".to_string(),
                path: "".to_string(),
                desc: "".to_string(),
                graph: "".to_string(),
            },
        );
        return Err(FFStudioError::workflow(error_msg));
    }

    let workflows = get_workflow_list();
    let workflow_opt = workflows.iter().find(|x| x.name == name);

    let workflow = match workflow_opt {
        Some(wf) => wf,
        None => {
            let error_msg = format!("Workflow '{name}' not found");
            log_error(&FFStudioError::workflow(&error_msg), "get_workflow");
            let _ = window.emit(
                "get_workflow_listener",
                Response {
                    message: error_msg.clone(),
                    build: "".to_string(),
                    version: "".to_string(),
                    nodes: Vec::new(),
                    env: "".to_string(),
                    path: "".to_string(),
                    desc: "".to_string(),
                    graph: "".to_string(),
                },
            );
            return Err(FFStudioError::workflow(error_msg));
        }
    };

    // Try to load cached nodes first
    let nodes = match load_nodes(&workflow.path) {
        Ok(nodes) => {
            log::info!(
                "Loaded {} cached nodes for workflow '{}'",
                nodes.len(),
                name
            );
            nodes
        }
        Err(_) => {
            log::info!("Cache miss for workflow '{name}', parsing FFmpeg");
            match parse_ffmpeg(&workflow.path, &workflow.env) {
                Ok(nodes) => {
                    let _ = save_nodes(&workflow.path, &nodes);
                    log::info!(
                        "Parsed and cached {} nodes for workflow '{}'",
                        nodes.len(),
                        name
                    );
                    nodes
                }
                Err(e) => {
                    let error = FFStudioError::from(e);
                    log_error(&error, "parsing FFmpeg for workflow");
                    let _ = window.emit(
                        "get_workflow_listener",
                        Response {
                            message: format!("Failed to parse FFmpeg: {}", to_user_message(&error)),
                            build: "".to_string(),
                            version: "".to_string(),
                            nodes: Vec::new(),
                            env: "".to_string(),
                            path: "".to_string(),
                            desc: "".to_string(),
                            graph: "".to_string(),
                        },
                    );
                    return Err(error);
                }
            }
        }
    };

    let response_message = if nodes.is_empty() {
        "No FFmpeg nodes found. Try a different FFmpeg path."
    } else {
        "OK"
    };

    let _ = window.emit(
        "get_workflow_listener",
        Response {
            message: response_message.to_string(),
            build: workflow.version.get(1).cloned().unwrap_or_default(),
            version: workflow.version.first().cloned().unwrap_or_default(),
            nodes,
            graph: workflow.graph.clone(),
            env: workflow.env.clone(),
            path: workflow.path.clone(),
            desc: workflow.desc.clone(),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn create_workflow(
    window: Window,
    name: String,
    path: String,
    env: String,
    desc: String,
) -> Result<()> {
    // Validate inputs
    if name.trim().is_empty() {
        let error_msg = "Workflow name cannot be empty";
        log_error(&FFStudioError::workflow(error_msg), "create_workflow");
        let _ = window.emit(
            "create_workflow_listener",
            Response {
                message: error_msg.to_string(),
                build: "".to_string(),
                version: "".to_string(),
                nodes: Vec::new(),
                path,
                desc,
                graph: "".to_string(),
                env,
            },
        );
        return Err(FFStudioError::workflow(error_msg));
    }

    if path.trim().is_empty() {
        let error_msg = "FFmpeg path cannot be empty";
        log_error(&FFStudioError::workflow(error_msg), "create_workflow");
        let _ = window.emit(
            "create_workflow_listener",
            Response {
                message: error_msg.to_string(),
                build: "".to_string(),
                version: "".to_string(),
                nodes: Vec::new(),
                path,
                desc,
                graph: "".to_string(),
                env,
            },
        );
        return Err(FFStudioError::workflow(error_msg));
    }

    // Get FFmpeg version
    let version_data = match get_ffmpeg_version(&path, &env) {
        Ok(version) => {
            log::info!("Successfully got FFmpeg version for workflow '{name}'");
            version
        }
        Err(e) => {
            let error = FFStudioError::from(e);
            log_error(&error, "getting FFmpeg version");
            let _ = window.emit(
                "create_workflow_listener",
                Response {
                    message: format!("Failed to get FFmpeg version: {}", to_user_message(&error)),
                    build: "".to_string(),
                    version: "".to_string(),
                    nodes: Vec::new(),
                    path,
                    desc,
                    graph: "".to_string(),
                    env,
                },
            );
            return Err(error);
        }
    };

    // Try to load cached nodes first
    let nodes = match load_nodes(&path) {
        Ok(nodes) => {
            log::info!(
                "Loaded {} cached nodes for workflow '{}'",
                nodes.len(),
                name
            );
            nodes
        }
        Err(_) => {
            log::info!("Cache miss for workflow '{name}', parsing FFmpeg");
            match parse_ffmpeg(&path, &env) {
                Ok(nodes) => {
                    let _ = save_nodes(&path, &nodes);
                    log::info!(
                        "Parsed and cached {} nodes for workflow '{}'",
                        nodes.len(),
                        name
                    );
                    nodes
                }
                Err(e) => {
                    let error = FFStudioError::from(e);
                    log_error(&error, "parsing FFmpeg");
                    let _ = window.emit(
                        "create_workflow_listener",
                        Response {
                            message: format!("Failed to parse FFmpeg: {}", to_user_message(&error)),
                            build: "".to_string(),
                            version: "".to_string(),
                            nodes: Vec::new(),
                            path,
                            desc,
                            graph: "".to_string(),
                            env,
                        },
                    );
                    return Err(error);
                }
            }
        }
    };

    // Save the workflow
    if let Err(e) = add_workflow(
        name.clone(),
        path.clone(),
        env.clone(),
        desc.clone(),
        &nodes,
        &version_data,
    ) {
        log_error(&e, "saving workflow");
        let _ = window.emit(
            "create_workflow_listener",
            Response {
                message: format!("Failed to save workflow: {}", to_user_message(&e)),
                build: "".to_string(),
                version: "".to_string(),
                nodes: Vec::new(),
                path,
                desc,
                graph: "".to_string(),
                env,
            },
        );
        return Err(e);
    }

    let response_message = if nodes.is_empty() {
        "Workflow created but no FFmpeg nodes found. Try a different FFmpeg path."
    } else {
        "Workflow created successfully"
    };

    let _ = window.emit(
        "create_workflow_listener",
        Response {
            message: response_message.to_string(),
            build: version_data.get(1).cloned().unwrap_or_default(),
            version: version_data.first().cloned().unwrap_or_default(),
            nodes,
            path,
            desc,
            graph: "".to_string(),
            env,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn delete_workflow(name: String) -> Result<()> {
    if name.trim().is_empty() {
        return Err(FFStudioError::workflow("Workflow name cannot be empty"));
    }

    let data_path = get_data_dir()
        .map_err(|e| FFStudioError::file_system(format!("Failed to get data directory: {e}")))?;

    let wf_path = data_path.join("workflows");
    let wf_full_path = wf_path.join(name.clone() + ".json");

    if !wf_full_path.exists() {
        log::warn!("Attempted to delete non-existent workflow: {name}");
        return Ok(()); // Not an error if it doesn't exist
    }

    std::fs::remove_file(&wf_full_path).map_err(|e| {
        FFStudioError::file_system(format!("Failed to delete workflow '{name}': {e}"))
    })?;

    log::info!("Successfully deleted workflow: {name}");
    Ok(())
}

#[tauri::command]
pub async fn edit_workflow(
    _window: Window,
    name: String,
    path: String,
    env: String,
    desc: String,
) -> Result<()> {
    if name.trim().is_empty() {
        return Err(FFStudioError::workflow("Workflow name cannot be empty"));
    }

    let data_path = get_data_dir()
        .map_err(|e| FFStudioError::file_system(format!("Failed to get data directory: {e}")))?;

    let wf_path = data_path.join("workflows");
    let wf_full_path = wf_path.join(name.clone() + ".json");

    if !wf_full_path.exists() {
        return Err(FFStudioError::workflow(format!(
            "Workflow '{name}' not found"
        )));
    }

    let data = std::fs::read_to_string(&wf_full_path).map_err(|e| {
        FFStudioError::file_system(format!("Failed to read workflow '{name}': {e}"))
    })?;

    let mut workflow: WorkflowStructure = serde_json::from_str(&data)
        .map_err(|e| FFStudioError::json(format!("Failed to parse workflow '{name}': {e}")))?;

    workflow.path = path;
    workflow.env = env;
    workflow.desc = desc;

    let json_data = json!(workflow).to_string();
    std::fs::write(&wf_full_path, json_data).map_err(|e| {
        FFStudioError::file_system(format!("Failed to save workflow '{name}': {e}"))
    })?;

    log::info!("Successfully updated workflow: {name}");
    Ok(())
}

#[tauri::command]
pub async fn save_graph(window: Window, name: String, graph: String) -> Result<()> {
    if name.trim().is_empty() {
        return Err(FFStudioError::workflow("Workflow name cannot be empty"));
    }

    let data_path = get_data_dir()
        .map_err(|e| FFStudioError::file_system(format!("Failed to get data directory: {e}")))?;

    let wf_path = data_path.join("workflows");
    let wf_full_path = wf_path.join(name.clone() + ".json");

    if !wf_full_path.exists() {
        return Err(FFStudioError::workflow(format!(
            "Workflow '{name}' not found"
        )));
    }

    let data = std::fs::read_to_string(&wf_full_path).map_err(|e| {
        FFStudioError::file_system(format!("Failed to read workflow '{name}': {e}"))
    })?;

    let mut workflow: WorkflowStructure = serde_json::from_str(&data)
        .map_err(|e| FFStudioError::json(format!("Failed to parse workflow '{name}': {e}")))?;

    workflow.graph = graph;

    let json_data = json!(workflow).to_string();
    std::fs::write(&wf_full_path, json_data).map_err(|e| {
        FFStudioError::file_system(format!("Failed to save workflow '{name}': {e}"))
    })?;

    let _ = window.emit("save_graph_listener", "OK");
    log::info!("Successfully saved graph for workflow: {name}");
    Ok(())
}
