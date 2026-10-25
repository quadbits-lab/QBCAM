//! FFmpeg-backed capture: real cameras (per-OS input) and file sources, both
//! piped as raw BGRA frames on stdout (spec §4.2 qb-camio).
//!
//! Real cameras are fragile: pixel formats, sizes, frame rates and TCC
//! permissions differ per machine. We therefore probe a short list of input
//! profiles, keep stderr for diagnostics, and only hand back a capture that
//! actually produced a frame.

use std::collections::VecDeque;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const STDERR_LINES: usize = 40;
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(4);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(6);
const SNAPSHOT_W: u32 = 960;
const SNAPSHOT_H: u32 = 540;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    /// camera | screen | audio | fake | file
    pub kind: String,
}

#[derive(Debug)]
pub struct CaptureError {
    pub code: &'static str,
    pub message: String,
    pub detail: String,
}

impl CaptureError {
    fn new(code: &'static str, message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { code, message: message.into(), detail: detail.into() }
    }

    pub fn json(&self) -> String {
        serde_json::json!({
            "code": self.code,
            "message": self.message,
            "detail": self.detail,
        })
        .to_string()
    }
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {} ({})", self.code, self.message, self.detail)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile {
    ExplicitPixFmt,
    Explicit,
    Scaled,
}

impl Profile {
    pub fn label(self) -> &'static str {
        match self {
            Profile::ExplicitPixFmt => "explicit+uyvy422",
            Profile::Explicit => "explicit",
            Profile::Scaled => "scaled",
        }
    }
}

fn profiles() -> &'static [Profile] {
    // `-pixel_format` makes some AVFoundation cameras hang instead of
    // negotiating; try the plain and scaled variants first and keep the
    // explicit pixel format as a last resort.
    &[Profile::Explicit, Profile::Scaled, Profile::ExplicitPixFmt]
}

pub struct FfmpegCapture {
    child: Child,
    frames: Receiver<Vec<u8>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    pub profile: String,
    stop: Arc<AtomicBool>,
}

impl FfmpegCapture {
    /// Spawn ffmpeg and wait for a first frame, trying progressively safer
    /// input profiles. Returns a capture whose frame reader is already running.
    pub fn start(
        device_id: &str,
        width: u32,
        height: u32,
        fps: f64,
    ) -> Result<(Self, Vec<u8>, u64), CaptureError> {
        let frame_bytes = width as usize * height as usize * 4;
        let mut details: Vec<String> = Vec::new();

        for profile in profiles() {
            match Self::try_profile(device_id, width, height, fps, frame_bytes, *profile) {
                Ok((capture, first, ts)) => return Ok((capture, first, ts)),
                Err(err) => {
                    if err.code == "FFMPEG_MISSING" || err.code == "UNSUPPORTED" {
                        return Err(err);
                    }
                    details.push(format!(
                        "{}: {} — {}",
                        profile.label(),
                        err.message,
                        err.detail
                    ));
                    // Give the OS a moment to release the device between attempts.
                    std::thread::sleep(Duration::from_millis(350));
                }
            }
        }

        let detail = details.join(" || ");
        Err(classify_failure(
            &detail,
            "camera did not produce a frame with any supported profile",
        ))
    }

    fn try_profile(
        device_id: &str,
        width: u32,
        height: u32,
        fps: f64,
        frame_bytes: usize,
        profile: Profile,
    ) -> Result<(Self, Vec<u8>, u64), CaptureError> {
        let mut cmd = Command::new("ffmpeg");
        cmd.args(["-hide_banner", "-loglevel", "warning", "-nostdin"]);
        cmd.args(input_args(device_id, width, height, fps, profile)?);
        cmd.args([
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-s",
            &format!("{width}x{height}"),
            "pipe:1",
        ]);

        tracing::info!(device = device_id, profile = profile.label(), "starting ffmpeg capture");
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                CaptureError::new("FFMPEG_MISSING", "ffmpeg could not be started", e.to_string())
            })?;

        let stderr = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_LINES)));
        if let Some(err) = child.stderr.take() {
            spawn_stderr_reader(err, stderr.clone());
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CaptureError::new("CAPTURE_FAILED", "ffmpeg stdout unavailable", ""))?;
        let (tx, rx) = sync_channel::<Vec<u8>>(2);
        spawn_frame_reader(stdout, frame_bytes, tx);

        let started = Instant::now();
        let first = match rx.recv_timeout(FIRST_FRAME_TIMEOUT) {
            Ok(frame) => frame,
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                let _ = child.wait();
                let detail = stderr_tail(&stderr);
                let message = if started.elapsed() >= FIRST_FRAME_TIMEOUT {
                    "camera produced no frame within 3s"
                } else {
                    "camera capture ended before the first frame"
                };
                return Err(classify_failure(&detail, message));
            }
        };

        let ts = 0;
        Ok((
            Self {
                child,
                frames: rx,
                stderr,
                profile: profile.label().to_string(),
                stop: Arc::new(AtomicBool::new(false)),
            },
            first,
            ts,
        ))
    }

    pub fn next_frame(&self, timeout: Duration) -> Option<Vec<u8>> {
        match self.frames.recv_timeout(timeout) {
            Ok(frame) => Some(frame),
            Err(_) => None,
        }
    }

    pub fn stderr_tail(&self) -> String {
        stderr_tail(&self.stderr)
    }

    pub fn exited(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)))
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_stderr_reader(mut err: impl Read + Send + 'static, sink: Arc<Mutex<VecDeque<String>>>) {
    thread::spawn(move || {
        let mut buf = [0u8; 2048];
        let mut pending = String::new();
        loop {
            match err.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                    while let Some(pos) = pending.find('\n') {
                        let line = pending[..pos].trim().to_string();
                        pending.drain(..=pos);
                        if line.is_empty() {
                            continue;
                        }
                        tracing::debug!(target: "ffmpeg", "{line}");
                        let mut sink = sink.lock().unwrap();
                        if sink.len() == STDERR_LINES {
                            sink.pop_front();
                        }
                        sink.push_back(line);
                    }
                }
            }
        }
    });
}

fn spawn_frame_reader(mut stdout: impl Read + Send + 'static, frame_bytes: usize, tx: SyncSender<Vec<u8>>) {
    thread::spawn(move || {
        let mut buf = vec![0u8; frame_bytes];
        loop {
            match stdout.read_exact(&mut buf) {
                Ok(()) => {
                    if tx.send(buf.clone()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn stderr_tail(sink: &Arc<Mutex<VecDeque<String>>>) -> String {
    let guard = sink.lock().unwrap();
    guard.iter().rev().take(6).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | ")
}

fn classify_failure(detail: &str, fallback: &str) -> CaptureError {
    let lower = detail.to_lowercase();
    if lower.contains("not authorized")
        || lower.contains("permission")
        || lower.contains("operation not permitted")
        || lower.contains("denied")
        || lower.contains("cannot use")
        || lower.contains("failed to create av capture")
    {
        let device = if lower.contains("audio") || lower.contains("microphone") {
            "microphone"
        } else {
            "camera"
        };
        return CaptureError::new(
            "PERMISSION_DENIED",
            format!("{device} access is denied"),
            if detail.is_empty() { fallback.to_string() } else { detail.to_string() },
        );
    }
    if lower.contains("in use")
        || lower.contains("busy")
        || lower.contains("resource temporarily unavailable")
    {
        return CaptureError::new(
            "DEVICE_BUSY",
            "the device is already in use by another app",
            if detail.is_empty() { fallback.to_string() } else { detail.to_string() },
        );
    }
    if lower.contains("invalid audio device index") || lower.contains("invalid device index") {
        return CaptureError::new(
            "DEVICE_NOT_FOUND",
            "the selected audio device index is not valid",
            if detail.is_empty() { fallback.to_string() } else { detail.to_string() },
        );
    }
    if lower.contains("no such file or directory") || lower.contains("not found") {
        return CaptureError::new(
            "DEVICE_NOT_FOUND",
            "the selected device is not available",
            if detail.is_empty() { fallback.to_string() } else { detail.to_string() },
        );
    }
    CaptureError::new(
        "CAPTURE_FAILED",
        fallback,
        if detail.is_empty() { "no ffmpeg output".to_string() } else { detail.to_string() },
    )
}

fn input_args(
    device_id: &str,
    width: u32,
    height: u32,
    fps: f64,
    profile: Profile,
) -> Result<Vec<String>, CaptureError> {
    let mut args: Vec<String> = Vec::new();
    match device_id {
        id if id.starts_with("fake") => {
            return Err(CaptureError::new("UNSUPPORTED", "fake camera is generated in-process", ""));
        }
        id if id.starts_with("file:") => {
            let path = &id[5..];
            args.extend(["-re", "-stream_loop", "-1", "-i", path].map(String::from));
            return Ok(args);
        }
        id => match std::env::consts::OS {
            "macos" => {
                args.extend(["-f", "avfoundation"].map(String::from));
                match profile {
                    Profile::ExplicitPixFmt => {
                        args.extend(
                            [
                                "-framerate",
                                &format!("{fps}"),
                                "-video_size",
                                &format!("{width}x{height}"),
                                "-pixel_format",
                                "uyvy422",
                                "-i",
                                id,
                            ]
                            .map(String::from),
                        );
                    }
                    Profile::Explicit => {
                        args.extend(
                            [
                                "-framerate",
                                &format!("{fps}"),
                                "-video_size",
                                &format!("{width}x{height}"),
                                "-i",
                                id,
                            ]
                            .map(String::from),
                        );
                    }
                    Profile::Scaled => {
                        args.extend(["-framerate", &format!("{fps}"), "-i", id].map(String::from));
                        args.extend(
                            [
                                "-vf",
                                &format!(
                                    "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps}"
                                ),
                            ]
                            .map(String::from),
                        );
                    }
                }
            }
            "linux" => {
                args.extend(["-f", "v4l2"].map(String::from));
                match profile {
                    Profile::ExplicitPixFmt | Profile::Explicit => {
                        args.extend(
                            [
                                "-framerate",
                                &format!("{fps}"),
                                "-video_size",
                                &format!("{width}x{height}"),
                                "-i",
                                id,
                            ]
                            .map(String::from),
                        );
                    }
                    Profile::Scaled => {
                        args.extend(["-i", id].map(String::from));
                        args.extend(
                            [
                                "-vf",
                                &format!(
                                    "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps}"
                                ),
                            ]
                            .map(String::from),
                        );
                    }
                }
            }
            "windows" => {
                args.extend(["-f", "dshow", "-i", &format!("video={id}")].map(String::from));
            }
            other => {
                return Err(CaptureError::new(
                    "UNSUPPORTED",
                    format!("unsupported platform: {other}"),
                    "",
                ));
            }
        },
    }
    Ok(args)
}

// ---------------------------------------------------------------------------
// Snapshot (onboarding camera test, same capture path as the live pipeline)
// ---------------------------------------------------------------------------

pub struct Snapshot {
    pub jpeg: Vec<u8>,
    pub profile: String,
}

pub fn snapshot(device_id: &str, width: u32, height: u32, fps: f64) -> Result<Snapshot, CaptureError> {
    if device_id.starts_with("fake") {
        return Err(CaptureError::new("UNSUPPORTED", "synthetic camera has no snapshot", ""));
    }
    let mut last_detail = String::new();

    for profile in profiles() {
        let mut args = snapshot_input_args(device_id, width, height, fps, *profile)?;
        args.extend(
            [
                "-frames:v",
                "1",
                "-vf",
                &format!(
                    "scale={SNAPSHOT_W}:{SNAPSHOT_H}:force_original_aspect_ratio=decrease,pad={SNAPSHOT_W}:{SNAPSHOT_H}:(ow-iw)/2:(oh-ih)/2"
                ),
                "-f",
                "mjpeg",
                "pipe:1",
            ]
            .map(String::from),
        );

        match run_ffmpeg_capture(&args, SNAPSHOT_TIMEOUT) {
            Ok((out, err)) => {
                if out.len() > 2 && out[0] == 0xFF && out[1] == 0xD8 {
                    return Ok(Snapshot { jpeg: out, profile: profile.label().to_string() });
                }
                last_detail = if err.is_empty() {
                    "ffmpeg produced no JPEG output".to_string()
                } else {
                    err
                };
            }
            Err(err) => {
                if err.code == "FFMPEG_MISSING" || err.code == "UNSUPPORTED" {
                    return Err(err);
                }
                last_detail = err.detail;
            }
        }
    }
    Err(classify_failure(&last_detail, "camera snapshot failed"))
}

/// Input arguments without an output filter, so the snapshot path can add its
/// own single `-vf` chain.
fn snapshot_input_args(
    device_id: &str,
    width: u32,
    height: u32,
    fps: f64,
    profile: Profile,
) -> Result<Vec<String>, CaptureError> {
    let mut args = input_args(device_id, width, height, fps, profile)?;
    if profile == Profile::Scaled {
        // input_args added a `-vf ...` pair; strip it for the snapshot filter.
        if let Some(pos) = args.iter().position(|a| a == "-vf") {
            args.drain(pos..=pos + 1);
        }
    }
    Ok(args)
}

fn run_ffmpeg_capture(
    args: &[String],
    timeout: Duration,
) -> Result<(Vec<u8>, String), CaptureError> {
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-hide_banner", "-loglevel", "warning", "-nostdin"]);
    cmd.args(args);
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| {
        CaptureError::new("FFMPEG_MISSING", "ffmpeg could not be started", e.to_string())
    })?;

    let mut stdout = child.stdout.take().ok_or_else(|| {
        CaptureError::new("CAPTURE_FAILED", "ffmpeg stdout unavailable", "")
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        CaptureError::new("CAPTURE_FAILED", "ffmpeg stderr unavailable", "")
    })?;

    let out_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();
    let err = err.trim().replace('\n', " | ");
    Ok((out, err))
}

// ---------------------------------------------------------------------------
// Microphone probe (test + permission only; recording audio is out of scope)
// ---------------------------------------------------------------------------

pub fn audio_level(device_id: &str, ms: u64) -> Result<(f32, f32), CaptureError> {
    if std::env::consts::OS != "macos" {
        return Err(CaptureError::new(
            "UNSUPPORTED",
            "microphone probing is implemented for macOS avfoundation only",
            "",
        ));
    }
    let index = device_id
        .strip_prefix("audio:")
        .or_else(|| device_id.strip_prefix("name:"))
        .unwrap_or(device_id);
    let seconds = (ms.clamp(100, 3000) as f64) / 1000.0;
    let args = vec![
        "-f".to_string(),
        "avfoundation".to_string(),
        "-i".to_string(),
        format!(":{index}"),
        "-t".to_string(),
        format!("{seconds:.2}"),
        "-f".to_string(),
        "s16le".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "pipe:1".to_string(),
    ];
    let (out, err) = run_ffmpeg_capture(&args, Duration::from_secs(5))?;
    if out.len() < 2 {
        return Err(classify_failure(&err, "microphone produced no audio"));
    }
    let mut sum_sq = 0.0f64;
    let mut peak = 0.0f32;
    let mut count = 0usize;
    for chunk in out.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0;
        sum_sq += (sample as f64) * (sample as f64);
        peak = peak.max(sample.abs());
        count += 1;
    }
    if count == 0 {
        return Err(classify_failure(&err, "microphone produced no samples"));
    }
    let rms = (sum_sq / count as f64).sqrt() as f32;
    Ok((rms, peak))
}

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

/// Real cameras first (including screen capture devices), synthetic camera last.
pub fn list_cameras() -> Vec<DeviceInfo> {
    let mut out: Vec<DeviceInfo> = list_platform_devices()
        .into_iter()
        .filter(|d| d.kind == "camera" || d.kind == "screen")
        .collect();
    out.push(DeviceInfo {
        id: "fake".into(),
        name: "QBCAM Synthetic Camera".into(),
        kind: "fake".into(),
    });
    out
}

pub fn list_audio_devices() -> Vec<DeviceInfo> {
    list_platform_devices().into_iter().filter(|d| d.kind == "audio").collect()
}

pub fn resolve_device_id(device_id: &str) -> String {
    if let Some(name) = device_id.strip_prefix("name:") {
        if let Some(found) = list_platform_devices()
            .into_iter()
            .find(|d| d.name.eq_ignore_ascii_case(name))
        {
            return match found.kind.as_str() {
                "audio" => format!("audio:{}", found.id),
                _ => found.id,
            };
        }
    }
    device_id.to_string()
}

fn list_platform_devices() -> Vec<DeviceInfo> {
    let cmd_args: Vec<&str> = match std::env::consts::OS {
        "macos" => vec!["-f", "avfoundation", "-list_devices", "true", "-i", ""],
        "linux" => vec!["-f", "v4l2", "-list_devices", "true", "-i", ""],
        "windows" => vec!["-f", "dshow", "-list_devices", "true", "-i", "dummy"],
        _ => return Vec::new(),
    };
    let output = Command::new("ffmpeg")
        .args(["-hide_banner"])
        .args(&cmd_args)
        .stderr(Stdio::piped())
        .output();
    let Ok(output) = output else { return Vec::new() };
    let stderr = String::from_utf8_lossy(&output.stderr);
    match std::env::consts::OS {
        "macos" => parse_avfoundation_devices(&stderr),
        _ => Vec::new(),
    }
}

pub fn parse_avfoundation_devices(stderr: &str) -> Vec<DeviceInfo> {
    let mut out = Vec::new();
    let mut section = "video";
    for line in stderr.lines() {
        if line.contains("AVFoundation video devices") {
            section = "video";
            continue;
        }
        if line.contains("AVFoundation audio devices") {
            section = "audio";
            continue;
        }
        if !line.contains("[AVFoundation indev") {
            continue;
        }
        let Some((idx, name)) = parse_avfoundation_entry(line) else { continue };
        let kind = if section == "audio" {
            "audio"
        } else if name.to_lowercase().starts_with("capture screen") {
            "screen"
        } else {
            "camera"
        };
        out.push(DeviceInfo { id: idx, name, kind: kind.to_string() });
    }
    out
}

fn parse_avfoundation_entry(line: &str) -> Option<(String, String)> {
    let start = line.find("[AVFoundation indev")?;
    let rest = &line[start + "[AVFoundation indev".len()..];
    let rest = rest.trim_start_matches([' ', '@']);
    let bracket_end = rest.find(']')?;
    let rest = rest[bracket_end + 1..].trim();
    let (idx, name) = rest.split_once(' ')?;
    Some((idx.trim_matches(|c| c == '[' || c == ']').to_string(), name.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_video_and_audio_devices() {
        let sample = "\
[AVFoundation indev @ 0x12] AVFoundation video devices:
[AVFoundation indev @ 0x12] [0] FaceTime HD Camera
[AVFoundation indev @ 0x12] [1] Capture screen 0
[AVFoundation indev @ 0x12] AVFoundation audio devices:
[AVFoundation indev @ 0x12] [0] MacBook Pro Microphone
";
        let devices = parse_avfoundation_devices(sample);
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].kind, "camera");
        assert_eq!(devices[0].name, "FaceTime HD Camera");
        assert_eq!(devices[1].kind, "screen");
        assert_eq!(devices[2].kind, "audio");
        assert_eq!(devices[2].name, "MacBook Pro Microphone");
    }

    #[test]
    fn classifies_permission_errors() {
        let err = classify_failure("Camera access is not authorized", "no frame");
        assert_eq!(err.code, "PERMISSION_DENIED");
    }

    #[test]
    fn classifies_busy_errors() {
        let err = classify_failure("Device is already in use", "no frame");
        assert_eq!(err.code, "DEVICE_BUSY");
    }

    #[test]
    fn builds_scaled_profile() {
        let args = input_args("0", 1280, 720, 30.0, Profile::Scaled).unwrap();
        assert!(args.iter().any(|a| a.contains("force_original_aspect_ratio")));
    }
}
