use super::parser::{apply_env, parse_env_map};
use anyhow::{anyhow, Context, Result};
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn get_mediainfo(name: &str, ffmpeg: &str, env_str: &str) -> Result<Vec<String>> {
    let env_map = parse_env_map(env_str);
    let mut cmd = Command::new(ffmpeg);

    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.args(["-i", name, "-hide_banner"]) // ffmpeg primarily logs to stderr
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_env(&mut cmd, &env_map);
    let out = cmd
        .output()
        .with_context(|| format!("spawning {ffmpeg}"))?;

    let mut lines = Vec::new();
    if !out.stdout.is_empty() {
        lines.extend(
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|s| s.to_string()),
        );
    }
    if !out.stderr.is_empty() {
        lines.extend(
            String::from_utf8_lossy(&out.stderr)
                .lines()
                .map(|s| s.to_string()),
        );
    }
    Ok(lines)
}

pub fn get_ffmpeg_version(name: &str, env_str: &str) -> Result<Vec<String>> {
    let env_map = parse_env_map(env_str);
    let mut cmd = Command::new(name);
    #[cfg(windows)]
    {
        // Prevent a new terminal from appearing
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_env(&mut cmd, &env_map);
    let out = cmd
        .output()
        .with_context(|| format!("spawning {name} -version"))?;
    let text = String::from_utf8_lossy(if out.stdout.is_empty() {
        &out.stderr
    } else {
        &out.stdout
    });

    let lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    if lines.len() <= 1 {
        return Err(anyhow!("Unexpected ffmpeg output: {lines:?}"));
    }

    Ok(lines)
}
