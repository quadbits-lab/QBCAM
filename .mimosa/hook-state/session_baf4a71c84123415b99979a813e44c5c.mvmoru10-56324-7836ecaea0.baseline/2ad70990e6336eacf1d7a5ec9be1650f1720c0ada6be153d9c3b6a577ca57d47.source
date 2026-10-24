//! qb-camio — capture sidecar: camera enumeration/capture + ring writer.
//! Hot path: FFmpeg/rawvideo → shared-memory ring (spec §4, §10.2).

mod fake;
mod ffmpeg;
mod uds;

use qbcam_shm::{create_ring, unlink_ring, PixelFormat, RingWriter, SLOT_HEADER_BYTES};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
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

    let caps = captures.clone();
    handlers.insert(
        "capture.list".into(),
        Arc::new(move |_params| {
            let devices = ffmpeg::list_devices();
            Ok(json!({ "devices": devices }))
        }),
    );

    let caps2 = captures.clone();
    handlers.insert(
        "capture.open".into(),
        Arc::new(move |params| {
            let device_id = params["deviceId"].as_str().unwrap_or("fake").to_string();
            let width = params["width"].as_u64().unwrap_or(1280) as u32;
            let height = params["height"].as_u64().unwrap_or(720) as u32;
            let fps = params["fps"].as_f64().unwrap_or(30.0);
            let ring_name = params["ringIn"].as_str().unwrap_or("").to_string();
            if ring_name.is_empty() {
                return Err("ringIn required".into());
            }
            // BGRA throughout v0
            let frame_bytes = width as usize * height as usize * 4;
            let info = create_ring(
                &ring_name,
                4,
                (SLOT_HEADER_BYTES + frame_bytes) as u32,
                width,
                height,
                PixelFormat::Bgra,
            )
            .map_err(|e| format!("create ring: {e}"))?;
            let _ = info;

            let stop = Arc::new(AtomicBool::new(false));
            let seq = Arc::new(AtomicU64::new(0));
            let stop2 = stop.clone();
            let seq2 = seq.clone();
            let device = device_id.clone();
            let ring = ring_name.clone();
            let join = std::thread::spawn(move || {
                run_capture(&device, width, height, fps, &ring, &stop2, &seq2);
            });
            caps2.lock().unwrap().insert(
                device_id.clone(),
                CaptureHandle { ring_name, stop, seq, join: Some(join) },
            );
            Ok(json!({ "ok": true }))
        }),
    );

    let caps3 = captures.clone();
    handlers.insert(
        "capture.close".into(),
        Arc::new(move |params| {
            let device_id = params["deviceId"].as_str().unwrap_or("fake").to_string();
            let mut caps = caps3.lock().unwrap();
            if let Some(mut h) = caps.remove(&device_id) {
                h.stop.store(true, Ordering::SeqCst);
                if let Some(j) = h.join.take() {
                    let _ = j.join();
                }
                let _ = unlink_ring(&h.ring_name);
            }
            Ok(json!({ "ok": true }))
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
        h.stop.store(true, Ordering::SeqCst);
        if let Some(j) = h.join.take() {
            let _ = j.join();
        }
    }
}

fn run_capture(
    device_id: &str,
    width: u32,
    height: u32,
    fps: f64,
    ring_name: &str,
    stop: &Arc<AtomicBool>,
    seq: &Arc<AtomicU64>,
) {
    let frame_bytes = width as usize * height as usize * 4;
    match device_id {
        id if id.starts_with("fake") => {
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
                let start = Instant::now();
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
        _ => {
            let mut cap = match ffmpeg::FfmpegCapture::spawn(device_id, width, height, fps) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("ffmpeg spawn failed: {e}");
                    return;
                }
            };
            let mut writer = match RingWriter::attach(ring_name) {
                Ok(w) => w,
                Err(e) => {
                    tracing::error!("attach ring: {e}");
                    let _ = cap;
                    return;
                }
            };
            let mut buf = vec![0u8; frame_bytes];
            let start_ns = Instant::now();
            if let Some(stream) = cap.stdout() {
                let mut stream = stream;
                loop {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    match stream.read_exact(&mut buf) {
                        Ok(()) => {
                            let ts = start_ns.elapsed().as_nanos() as u64;
                            if writer.write_frame(&buf, ts, 0, 0).is_ok() {
                                seq.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        Err(e) => {
                            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                                tracing::warn!("capture ended (eof)");
                            } else {
                                tracing::error!("capture read error: {e}");
                            }
                            break;
                        }
                    }
                }
            }
            cap.stop();
        }
    }
}
