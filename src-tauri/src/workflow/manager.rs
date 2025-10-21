use super::types::WorkflowStructure;
use crate::utils::filesystem::get_data_dir;

#[tauri::command]
pub fn get_workflow_list() -> Vec<WorkflowStructure> {
    let data_path = get_data_dir().unwrap();
    let wf_path = data_path.join("workflows");
    let wf_exists = std::fs::exists(&wf_path).unwrap();
    if !wf_exists {
        std::fs::create_dir_all(&wf_path).unwrap();
    }

    let mut result: Vec<WorkflowStructure> = vec![];

    let dir_iter = std::fs::read_dir(wf_path).unwrap();
    for dir in dir_iter {
        let path = dir.unwrap().path();
        if std::fs::exists(&path).unwrap() {
            let data = std::fs::read_to_string(path).unwrap();
            let workflow: WorkflowStructure = serde_json::from_str(&data).unwrap();
            result.push(workflow);
        };
    }

    result
}
