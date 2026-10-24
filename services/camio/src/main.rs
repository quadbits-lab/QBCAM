//! qb-camio — capture sidecar: camera/audio enumeration + capture to a ring.
//! Hot path: FFmpeg/rawvideo → shared-memory ring (spec §4, §10.2).

mod fake;
mod ffmpeg;
mod uds;

use base64::Engine as _;
use qbcam_shm::{create_ring, unlink_ring, PixelFormat, RingWriter, SLOT_HEADER_BYTES};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use uds::Sidecar;

struct CaptureHandle {
    ring_name: String,
    stop: Arc<AtomicBool>,
    seq: Arc<AtomicU64>,
    join: Option<std::thread::JoinHandle<()>>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()))
        .with_writer(std::io::stderr)
        .json()
        .init();

    let socket = std::env::var("QB_SOCKET").expect("QB_SOCKET");
    let token = std::env::var("QB_TOKEN").expect("QB_TOKEN");
    let sidecar = Sidecar::new(socket, token);

    let captures: Arc<std::sync::Mutex<HashMap<String, CaptureHandle>>> =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let mut handlers: HashMap<String, uds::Handler> = HashMap::new();

    handlers.insert(
        "capture.list".into(),
        Arc::new(move |_params| {
            let cameras = ffmpeg::list_cameras();
            let audio = ffmpeg::list_audio_devices();
            Ok(json!({
                "devices": cameras,
                "cameras": cameras,
                "audio": audio,
                "ffmpeg": ffmpeg_available(),
            }))
        }),
    );

    let caps2 = captures.clone();
    handlers.insert(
        "capture.open".into(),
        Arc::new(move |params| {
            let requested = params["deviceId"].as_str().unwrap_or("fake").to_string();
            let device_id = ffmpeg::resolve_device_id(&requested);
            let width = params["width"].as_u64().unwrap_or(1280) as u32;
            let height = params["height"].as_u64().unwrap_or(720) as u32;
            let fps = params["fps"].as_f64().unwrap_or(30.0);
            let ring_name = params["ringIn"].as_str().unwrap_or("").to_string();
            if ring_name.is_empty() {
                return Err("ringIn required".into());
            }
            let frame_bytes = width as usize * height as usize * 4;
            let _ = unlink_ring(&ring_name);
            create_ring(
                &ring_name,
                4,
                (SLOT_HEADER_BYTES + frame_bytes) as u32,
                width,
                height,
                PixelFormat::Bgra,
            )
            .map_err(|e| format!("create ring: {e}"))?;

            // A device can only be open once; replace any previous handle.
            if let Some(mut old) = caps2.lock().unwrap().remove(&requested) {
                close_handle(&mut old);
            }
            if let Some(mut old) = caps2.lock().unwrap().remove(&device_id) {
                close_handle(&mut old);
            }

            let stop = Arc::new(AtomicBool::new(false));
            let seq = Arc::new(AtomicU64::new(0));

            if device_id.starts_with("fake") {
                let stop2 = stop.clone();
                let seq2 = seq.clone();
                let ring = ring_name.clone();
                let join = std::thread::spawn(move || {
                    run_fake(width, height, fps, &ring, &stop2, &seq2);
                });
                caps2.lock().unwrap().insert(
                    requested.clone(),
                    CaptureHandle { ring_name, stop, seq, join: Some(join) },
                );
                return Ok(json!({
                    "ok": true,
                    "deviceId": device_id,
                    "synthetic": true,
                }));
            }

            match ffmpeg::FfmpegCapture::start(&device_id, width, height, fps) {
                Ok((capture, first, first_ts)) => {
                    let profile = capture.profile.clone();
                    let stop2 = stop.clone();
                    let seq2 = seq.clone();
                    let ring = ring_name.clone();
                    let join = std::thread::spawn(move || {
                        run_ffmpeg(capture, first, first_ts, &ring, &stop2, &seq2);
                    });
                    caps2.lock().unwrap().insert(
                        requested,
                        CaptureHandle { ring_name, stop, seq, join: Some(join) },
                    );
                    Ok(json!({
                        "ok": true,
                        "deviceId": device_id,
                        "synthetic": false,
                        "profile": profile,
                        "firstFrame": true,
                    }))
                }
                Err(err) => {
                    let _ = unlink_ring(&ring_name);
                    Err(err.json())
                }
            }
        }),
    );

    let caps3 = captures.clone();
    handlers.insert(
        "capture.close".into(),
        Arc::new(move |params| {
            let device_id = params["deviceId"].as_str().unwrap_or("fake").to_string();
            let resolved = ffmpeg::resolve_device_id(&device_id);
            let mut caps = caps3.lock().unwrap();
            if let Some(mut h) = caps.remove(&device_id) {
                close_handle(&mut h);
            }
            if let Some(mut h) = caps.remove(&resolved) {
                close_handle(&mut h);
            }
            Ok(json!({ "ok": true }))
        }),
    );

    handlers.insert(
        "capture.snapshot".into(),
        Arc::new(move |params| {
            let requested = params["deviceId"].as_str().unwrap_or("fake");
            let device_id = ffmpeg::resolve_device_id(requested);
            if device_id.starts_with("fake") {
                return Ok(json!({ "ok": true, "synthetic": true }));
            }
            let width = params["width"].as_u64().unwrap_or(1280) as u32;
            let height = params["height"].as_u64().unwrap_or(720) as u32;
            let fps = params["fps"].as_f64().unwrap_or(30.0);
            match ffmpeg::snapshot(&device_id, width, height, fps) {
                Ok(snap) => {
                    let jpeg = base64::engine::general_purpose::STANDARD.encode(&snap.jpeg);
                    Ok(json!({
                        "ok": true,
                        "synthetic": false,
                        "deviceId": device_id,
                        "profile": snap.profile,
                        "mime": "image/jpeg",
                        "jpegBase64": jpeg,
                    }))
                }
                Err(err) => Err(err.json()),
            }
        }),
    );

    handlers.insert(
        "audio.list".into(),
        Arc::new(move |_params| Ok(json!({ "devices": ffmpeg::list_audio_devices() }))),
    );

    handlers.insert(
        "audio.level".into(),
        Arc::new(move |params| {
            let requested = params["deviceId"].as_str().unwrap_or("audio:0");
            let device_id = ffmpeg::resolve_device_id(requested);
            let ms = params["ms"].as_u64().unwrap_or(300);
            match ffmpeg::audio_level(&device_id, ms) {
                Ok((level, peak)) => Ok(json!({
                    "ok": true,
                    "deviceId": device_id,
                    "level": level,
                    "peak": peak,
                })),
                Err(err) => Err(err.json()),
            }
        }),
    );

    let stats = captures.clone();
    handlers.insert(
        "capture.stats".into(),
        Arc::new(move |_params| {
            let caps = stats.lock().unwrap();
            let per_device: serde_json::Map<String, Value> = caps
                .iter()
                .map(|(k, v)| (k.clone(), json!({ "seq": v.seq.load(Ordering::Relaxed) })))
                .collect();
            Ok(json!({ "devices": per_device }))
        }),
    );

    sidecar.serve(handlers);
    // cleanup on shutdown
    for (_, mut h) in captures.lock().unwrap().drain() {
        close_handle(&mut h);
    }
}

fn close_handle(handle: &mut CaptureHandle) {
    handle.stop.store(true, Ordering::SeqCst);
    if let Some(j) = handle.join.take() {
        let _ = j.join();
    }
    let _ = unlink_ring(&handle.ring_name);
}

fn ffmpeg_available() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn run_fake(
    width: u32,
    height: u32,
    fps: f64,
    ring_name: &str,
    stop: &Arc<AtomicBool>,
    seq: &Arc<AtomicU64>,
) {
    let frame_bytes = width as usize * height as usize * 4;
    let mut cam = fake::FakeCamera::new(width, height, fps);
    let mut buf = vec![0u8; frame_bytes];
    let frame_dur = Duration::from_secs_f64(1.0 / fps.max(1.0));
    let mut writer = match RingWriter::attach(ring_name) {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("attach ring: {e}");
            return;
        }
    };
    while !stop.load(Ordering::SeqCst) {
        let start = std::time::Instant::now();
        let ts = cam.next_frame(&mut buf);
        if writer.write_frame(&buf, ts, 0, 0).is_ok() {
            seq.fetch_add(1, Ordering::Relaxed);
        }
        let elapsed = start.elapsed();
        if elapsed < frame_dur {
            std::thread::sleep(frame_dur - elapsed);
        }
    }
}

fn run_ffmpeg(
    mut capture: ffmpeg::FfmpegCapture,
    first: Vec<u8>,
    first_ts: u64,
    ring_name: &str,
    stop: &Arc<AtomicBool>,
    seq: &Arc<AtomicU64>,
) {
    let mut writer = match RingWriter::attach(ring_name) {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("attach ring: {e}");
            capture.stop();
            return;
        }
    };
    let started = std::time::Instant::now();
    if writer.write_frame(&first, first_ts, 0, 0).is_ok() {
        seq.fetch_add(1, Ordering::Relaxed);
    }
    while !stop.load(Ordering::SeqCst) {
        match capture.next_frame(Duration::from_millis(500)) {
            Some(frame) => {
                let ts = started.elapsed().as_nanos() as u64;
                if writer.write_frame(&frame, ts, 0, 0).is_ok() {
                    seq.fetch_add(1, Ordering::Relaxed);
                }
            }
            None => {
                if capture.exited() {
                    let tail = capture.stderr_tail();
                    tracing::warn!(detail = %tail, "camera capture ended");
                    break;
                }
            }
        }
    }
    capture.stop();
}
