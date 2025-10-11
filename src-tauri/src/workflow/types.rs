use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OptionEntry {
    pub flag: String,
    pub r#type: Option<String>,
    pub category: Option<String>,
    pub desc: Option<String>,
    pub enum_vals: Vec<String>,
    pub no_args: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Node {
    pub name: String,
    pub is_av_option: bool,
    pub category: String,
    pub pcategory: String,
    pub desc: String,
    pub full_desc: Vec<String>,
    pub options: Vec<OptionEntry>,
}
#[derive(Serialize, Deserialize)]
pub struct MIResponse {
    pub message: String,
    pub info_arr: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ExecResponse {
    pub message: String,
    pub logs: String,
    pub end: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Response {
    pub message: String,
    pub path: String,
    pub env: String,
    pub desc: String,
    pub graph: String,
    pub build: String,
    pub version: String,
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct WorkflowStructure {
    pub name: String,
    pub path: String,
    pub graph: String,
    pub env: String,
    pub desc: String,
    pub version: Vec<String>,
}
