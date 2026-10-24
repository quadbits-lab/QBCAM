//! FFmpeg-backed capture: real cameras (per-OS input) and file sources, both
//! piped as raw BGRA frames on stdout (spec §4.2 qb-camio).

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct FfmpegCapture {
    child: Child,
    stop: Arc<AtomicBool>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // camera | file | fake
}

impl FfmpegCapture {
    /// Spawn ffmpeg producing raw BGRA on stdout at the requested size/fps.
    /// `device_id` is "fake", "file:<path>", or a platform camera index/name.
    pub fn spawn(device_id: &str, width: u32, height: u32, fps: f64) -> Result<Self, String> {
        let mut cmd = Command::new("ffmpeg");
        cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
        match device_id {
            id if id.starts_with("fake") => return Err("fake camera is generated in-process".into()),
            id if id.starts_with("file:") => {
                let path = &id[5..];
                cmd.args(["-re", "-stream_loop", "-1", "-i", path]);
            }
            id => {
                match std::env::consts::OS {
                    "macos" => {
                        cmd.args([
                            "-f", "avfoundation",
                            "-framerate", &format!("{fps}"),
                            "-video_size", &format!("{width}x{height}"),
                            "-pixel_format", "uyvy422",
                            "-i", id,
                        ]);
                    }
                    "linux" => {
                        cmd.args([
                            "-f", "v4l2",
                            "-framerate", &format!("{fps}"),
                            "-video_size", &format!("{width}x{height}"),
                            "-i", id,
                        ]);
                    }
                    "windows" => {
                        cmd.args([
                            "-f", "dshow",
                            "-framerate", &format!("{fps}"),
                            "-video_size", &format!("{width}x{height}"),
                            "-i", &format!("video={id}"),
                        ]);
                    }
                    other => return Err(format!("unsupported platform: {other}")),
                }
            }
        }
        cmd.args([
            "-f", "rawvideo",
            "-pix_fmt", "bgra",
            "-s", &format!("{width}x{height}"),
            "pipe:1",
        ]);
        tracing::info!("spawning ffmpeg: {:?}", cmd);
        let child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("cannot spawn ffmpeg: {e}"))?;
        Ok(Self { child, stop: Arc::new(AtomicBool::new(false)) })
    }

    pub fn stdout(&mut self) -> Option<impl Read + '_> {
        self.child.stdout.take()
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Enumerate devices by parsing `ffmpeg -list_devices` (platform-specific).
pub fn list_devices() -> Vec<DeviceInfo> {
    let mut out = vec![
        DeviceInfo { id: "fake".into(), name: "QBCAM Fake Camera (synthetic)".into(), kind: "fake".into() },
    ];
    let cmd_args: Vec<&str> = match std::env::consts::OS {
        "macos" => vec!["-f", "avfoundation", "-list_devices", "true", "-i", ""],
        "linux" => vec!["-f", "v4l2", "-list_devices", "true", "-i", ""],
        "windows" => vec!["-f", "dshow", "-list_devices", "true", "-i", "dummy"],
        _ => return out,
    };
    let output = Command::new("ffmpeg")
        .args(["-hide_banner"])
        .args(&cmd_args)
        .stderr(Stdio::piped())
        .output();
    let Ok(output) = output else { return out };
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines() {
        // macOS: [AVFoundation indev @ ...] [0] FaceTime HD Camera
        if let Some(rest) = line.strip_prefix("[AVFoundation indev") {
            if let Some((idx, name)) = parse_avfoundation_entry(rest) {
                out.push(DeviceInfo {
                    id: idx,
                    name,
                    kind: "camera".into(),
                });
            }
        }
    }
    out
}

fn parse_avfoundation_entry(rest: &str) -> Option<(String, String)> {
    let rest = rest.trim_start_matches(" @").to_string();
    let bracket_end = rest.find(']')?;
    let rest = &rest[bracket_end + 1..];
    let rest = rest.trim();
    let (idx, name) = rest.split_once(' ')?;
    Some((idx.trim_matches(|c| c == '[' || c == ']').to_string(), name.trim().to_string()))
}
