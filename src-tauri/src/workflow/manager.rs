use super::types::WorkflowStructure;
use crate::utils::filesystem::get_data_dir;
use crate::{FFStudioError, Result};

#[tauri::command]
pub fn get_workflow_list() -> Result<Vec<WorkflowStructure>> {
    let data_path = get_data_dir()?;
    let wf_path = data_path.join("workflows");
    let wf_exists = std::fs::exists(&wf_path).map_err(|e| {
        FFStudioError::file_system(format!("Failed to check workflows directory: {e}"))
    })?;
    if !wf_exists {
        std::fs::create_dir_all(&wf_path).map_err(|e| {
            FFStudioError::file_system(format!("Failed to create workflows directory: {e}"))
        })?;
    }

    let mut result: Vec<WorkflowStructure> = vec![];

    let dir_iter = std::fs::read_dir(wf_path).map_err(|e| {
        FFStudioError::file_system(format!("Failed to read workflows directory: {e}"))
    })?;
    for dir in dir_iter {
        let dir = dir.map_err(|e| {
            FFStudioError::file_system(format!("Failed to read workflow entry: {e}"))
        })?;
        let path = dir.path();
        if path.is_file() {
            let data = std::fs::read_to_string(&path).map_err(|e| {
                FFStudioError::file_system(format!("Failed to read workflow file: {e}"))
            })?;
            let workflow: WorkflowStructure = serde_json::from_str(&data)
                .map_err(|e| FFStudioError::json(format!("Failed to parse workflow file: {e}")))?;
            result.push(workflow);
        }
    }

    Ok(result)
}
