use serde::{Deserialize, Serialize};
use std::fmt;
use std::io;

/// Custom error type for FFStudio application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FFStudioError {
    /// File system related errors
    FileSystem(String),
    /// FFmpeg execution errors
    FFmpeg(String),
    /// Workflow related errors
    Workflow(String),
    /// Network/server errors
    Network(String),
    /// JSON serialization/deserialization errors
    Json(String),
    /// Command parsing errors
    Parse(String),
    /// General application errors
    Application(String),
    /// IO errors
    Io(String),

    Glob(String),

    Pattern(String),
}

impl fmt::Display for FFStudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FFStudioError::FileSystem(msg) => write!(f, "File system error: {}", msg),
            FFStudioError::FFmpeg(msg) => write!(f, "FFmpeg error: {}", msg),
            FFStudioError::Workflow(msg) => write!(f, "Workflow error: {}", msg),
            FFStudioError::Network(msg) => write!(f, "Network error: {}", msg),
            FFStudioError::Json(msg) => write!(f, "JSON error: {}", msg),
            FFStudioError::Parse(msg) => write!(f, "Parse error: {}", msg),
            FFStudioError::Application(msg) => write!(f, "Application error: {}", msg),
            FFStudioError::Io(msg) => write!(f, "IO error: {}", msg),
            FFStudioError::Glob(msg) => write!(f, "Glob error: {}", msg),
            FFStudioError::Pattern(msg) => write!(f, "Pattern error: {}", msg),
        }
    }
}

impl std::error::Error for FFStudioError {}

/// Result type alias for FFStudio operations
pub type Result<T> = std::result::Result<T, FFStudioError>;

// Conversion implementations for common error types

impl From<io::Error> for FFStudioError {
    fn from(err: io::Error) -> Self {
        FFStudioError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for FFStudioError {
    fn from(err: serde_json::Error) -> Self {
        FFStudioError::Json(err.to_string())
    }
}

impl From<anyhow::Error> for FFStudioError {
    fn from(err: anyhow::Error) -> Self {
        FFStudioError::Application(err.to_string())
    }
}

impl From<std::process::ExitStatus> for FFStudioError {
    fn from(status: std::process::ExitStatus) -> Self {
        FFStudioError::FFmpeg(format!("Process exited with status: {}", status))
    }
}

impl From<glob::GlobError> for FFStudioError {
    fn from(err: glob::GlobError) -> Self {
        FFStudioError::Io(err.to_string())
    }
}

impl From<glob::PatternError> for FFStudioError {
    fn from(err: glob::PatternError) -> Self {
        FFStudioError::Io(err.to_string())
    }
}

// Convenience constructors
impl FFStudioError {
    pub fn file_system(msg: impl Into<String>) -> Self {
        FFStudioError::FileSystem(msg.into())
    }

    pub fn ffmpeg(msg: impl Into<String>) -> Self {
        FFStudioError::FFmpeg(msg.into())
    }

    pub fn workflow(msg: impl Into<String>) -> Self {
        FFStudioError::Workflow(msg.into())
    }

    pub fn network(msg: impl Into<String>) -> Self {
        FFStudioError::Network(msg.into())
    }

    pub fn json(msg: impl Into<String>) -> Self {
        FFStudioError::Json(msg.into())
    }

    pub fn parse(msg: impl Into<String>) -> Self {
        FFStudioError::Parse(msg.into())
    }

    pub fn application(msg: impl Into<String>) -> Self {
        FFStudioError::Application(msg.into())
    }

    pub fn io(msg: impl Into<String>) -> Self {
        FFStudioError::Io(msg.into())
    }

    pub fn glob(msg: impl Into<String>) -> Self {
        FFStudioError::Glob(msg.into())
    }
    pub fn pattern(msg: impl Into<String>) -> Self {
        FFStudioError::Pattern(msg.into())
    }
    
}

/// Error context trait for adding context to errors
pub trait ErrorContext<T> {
    fn with_context<F>(self, f: F) -> Result<T>
    where
        F: FnOnce() -> String;
}

impl<T, E> ErrorContext<T> for std::result::Result<T, E>
where
    E: Into<FFStudioError>,
{
    fn with_context<F>(self, f: F) -> Result<T>
    where
        F: FnOnce() -> String,
    {
        self.map_err(|e| {
            let mut error = e.into();
            let context = f();

            // Add context to the error message
            match &mut error {
                FFStudioError::FileSystem(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::FFmpeg(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Workflow(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Network(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Json(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Parse(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Application(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Io(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Glob(msg) => *msg = format!("{}: {}", context, msg),
                FFStudioError::Pattern(msg) => *msg = format!("{}: {}", context, msg),
            }
            error
        })
    }
}

/// Logging utilities for errors
pub fn log_error(error: &FFStudioError, context: &str) {
    eprintln!("[ERROR] {}: {}", context, error);

    // In a real application, you might want to use a proper logging crate
    // like `log` or `tracing` instead of eprintln!
}

/// Convert error to user-friendly message for frontend
pub fn to_user_message(error: &FFStudioError) -> String {
    match error {
        FFStudioError::FileSystem(msg) => {
            if msg.contains("Permission denied") {
                "Permission denied. Please check file permissions.".to_string()
            } else if msg.contains("No such file") {
                "File not found. Please check the file path.".to_string()
            } else {
                format!("File system error: {}", msg)
            }
        }
        FFStudioError::FFmpeg(msg) => {
            if msg.contains("not found") {
                "FFmpeg not found. Please install FFmpeg or check the path.".to_string()
            } else if msg.contains("Permission denied") {
                "Permission denied when running FFmpeg.".to_string()
            } else {
                format!("FFmpeg error: {}", msg)
            }
        }
        FFStudioError::Workflow(msg) => {
            format!("Workflow error: {}", msg)
        }
        FFStudioError::Network(msg) => {
            format!("Network error: {}", msg)
        }
        FFStudioError::Json(_msg) => "Invalid data format. Please try again.".to_string(),
        FFStudioError::Parse(msg) => {
            format!("Parse error: {}", msg)
        }
        FFStudioError::Application(msg) => {
            format!("Application error: {}", msg)
        }
        FFStudioError::Io(msg) => {
            if msg.contains("Permission denied") {
                "Permission denied. Please check file permissions.".to_string()
            } else {
                format!("IO error: {}", msg)
            }
        }   
        FFStudioError::Glob(msg) => {
            format!("Glob error: {}", msg)
        }
        FFStudioError::Pattern(msg) => {
            format!("Pattern error: {}", msg)
        }
    }
}
