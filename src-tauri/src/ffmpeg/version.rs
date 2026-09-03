use super::parser::{apply_env, parse_env_map};
use anyhow::{anyhow, Context, Result};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Maximum time we allow a media probe to run before killing ffmpeg. Some
/// sources (live streams, HLS variant playlists) can take a long time to
/// enumerate; without a hard bound the GUI would appear to hang.
pub const MEDIAINFO_TIMEOUT: Duration = Duration::from_secs(20);

/// Result of probing a media source. Even on a timeout we keep the partial
/// output that ffmpeg already produced (often the full `Input #0` stream dump
/// printed before it hung on a live source), so the user still sees what we
/// managed to gather.
pub struct MediaInfo {
    pub lines: Vec<String>,
    pub timed_out: bool,
    pub error: Option<String>,
}

/// Probe media source `name` with the given ffmpeg binary.
///
/// ffmpeg is launched as a child process and its stdout/stderr are drained on
/// background threads. If it has not finished within [`MEDIAINFO_TIMEOUT`], the
/// child is killed and any output captured so far is returned with
/// [`MediaInfo::timed_out`] set. This keeps the caller (and therefore the UI)
/// responsive while still surfacing partial stream information.
pub fn get_mediainfo(name: &str, ffmpeg: &str, env_str: &str) -> MediaInfo {
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

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return MediaInfo {
                lines: Vec::new(),
                timed_out: false,
                error: Some(format!("Failed to spawn {ffmpeg}: {e}")),
            };
        }
    };

    // Collect output on background threads so ffmpeg never blocks on a full pipe
    // while we wait on the channel below. stdout and stderr are drained in
    // parallel and merged in arrival order.
    let captured: std::sync::Arc<std::sync::Mutex<String>> =
        std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let mut readers = Vec::new();

    for stream in [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        readers.push(spawn_reader(stream, std::sync::Arc::clone(&captured)));
    }

    // Wait for the child to finish, killing it if it takes too long. Polling
    // with `try_wait` keeps `child` owned by this thread so we can always kill
    // it on timeout, while the reader threads above keep draining the pipes.
    let mut timed_out = false;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if start.elapsed() >= MEDIAINFO_TIMEOUT {
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }

    if timed_out {
        // Kill the child and drain whatever output was already produced. ffmpeg
        // often prints the full `Input #0` stream dump before hanging on a live
        // source, so we keep that partial info and return it.
        let _ = child.kill();
        let _ = child.wait();
    }

    // Ensure all output has been drained before snapshotting.
    for r in readers {
        let _ = r.join();
    }

    let output = captured.lock().unwrap().clone();
    MediaInfo {
        lines: output.lines().map(|s| s.to_string()).collect(),
        timed_out,
        error: None,
    }
}

/// Spawn a thread that drains `reader` into a shared string sink so the ffmpeg
/// child never blocks on a full pipe while we wait for completion.
fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    sink: std::sync::Arc<std::sync::Mutex<String>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    sink.lock()
                        .unwrap()
                        .push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            }
        }
    })
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
