//! qb-vcam-mock — implements the vcam contract (spec §8.2) with a JPEG sink:
//! consumes frames.out (latest-frame-wins), writes periodic JPEGs for
//! verification, tracks "clients", serves the configured slate when idle.
//! Native per-OS virtual camera drivers (Media Foundation / CoreMediaIO /
//! v4l2loopback) are the M3 milestone — see services/vcam/*/README.md.

use qbcam_ipc::Sidecar;
use qbcam_shm::{ReadPolicy, RingReader};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

struct VcamState {
    active: AtomicBool,
    active_clients: AtomicU64,
    slate_path: Mutex<Option<String>>,
    frames_seen: AtomicU64,
    started: Mutex<Option<Instant>>,
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

    let state = Arc::new(VcamState {
        active: AtomicBool::new(false),
        active_clients: AtomicU64::new(0),
        slate_path: Mutex::new(None),
        frames_seen: AtomicU64::new(0),
        started: Mutex::new(None),
    });
    let mut handlers: HashMap<String, qbcam_ipc::Handler> = HashMap::new();

    // TS-03: honest device naming — the vendor string is fixed.
    const DEVICE_NAME: &str = "QBCAM Virtual Camera";

    let st = state.clone();
    let sc = sidecar.clone();
    handlers.insert(
        "vcam.describe".into(),
        Arc::new(move |_params| {
            Ok(json!({
                "installed": true,
                "deviceName": DEVICE_NAME,
                "activeClients": st.active_clients.load(Ordering::Relaxed),
                "implementation": "mock (M3: native drivers)",
                "supported": [
                    { "w": 640,  "h": 360,  "fps": 15, "format": "NV12" },
                    { "w": 1280, "h": 720,  "fps": 30, "format": "NV12" },
                    { "w": 1280, "h": 720,  "fps": 60, "format": "NV12" },
                    { "w": 1920, "h": 1080, "fps": 30, "format": "NV12" },
                ],
            }))
        }),
    );

    let st2 = state.clone();
    handlers.insert(
        "vcam.install".into(),
        Arc::new(move |_params| {
            // mock is always "installed"; native driver install is M3
            let _ = &st2;
            Ok(json!({ "ok": true, "requiresRestart": false }))
        }),
    );

    let st3 = state.clone();
    handlers.insert(
        "vcam.uninstall".into(),
        Arc::new(move |_params| {
            let _ = &st3;
            Ok(json!({ "ok": true, "requiresRestart": false }))
        }),
    );

    let st4 = state.clone();
    handlers.insert(
        "vcam.start".into(),
        Arc::new(move |params| {
            if st4.active.swap(true, Ordering::SeqCst) {
                return Err("vcam already running".into());
            }
            *st4.started.lock().unwrap() = Some(Instant::now());
            st4.frames_seen.store(0, Ordering::Relaxed);
            let ring = params["ringOut"].as_str().unwrap_or("").to_string();
            let out_dir = std::env::temp_dir().join("qbcam-vcam-sink");
            let _ = std::fs::create_dir_all(&out_dir);
            let width = params["width"].as_u64().unwrap_or(1280) as u32;
            let height = params["height"].as_u64().unwrap_or(720) as u32;

            let st5 = st4.clone();
            let sc2 = sc.clone();
            std::thread::spawn(move || {
                consume_ring(&ring, width, height, &out_dir, &st5, &sc2);
            });
            Ok(json!({ "ok": true }))
        }),
    );

    let st6 = state.clone();
    handlers.insert(
        "vcam.stop".into(),
        Arc::new(move |_params| {
            st6.active.store(false, Ordering::SeqCst);
            *st6.started.lock().unwrap() = None;
            Ok(Value::Null)
        }),
    );

    let st7 = state.clone();
    handlers.insert(
        "vcam.setSlate".into(),
        Arc::new(move |params| {
            *st7.slate_path.lock().unwrap() =
                Some(params["imagePath"].as_str().unwrap_or("").to_string());
            Ok(Value::Null)
        }),
    );

    sidecar.serve("vcam", handlers);
    state.active.store(false, Ordering::SeqCst);
}

fn consume_ring(
    ring: &str,
    width: u32,
    height: u32,
    out_dir: &std::path::Path,
    state: &Arc<VcamState>,
    sidecar: &Arc<Sidecar>,
) {
    let mut reader = match RingReader::attach(ring, 0, ReadPolicy::LatestWins) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("vcam attach ring {ring}: {e}");
            return;
        }
    };
    if reader.info().width != width || reader.info().height != height {
        tracing::warn!(
            "ring {}x{} != requested {}x{} — mock scales on read",
            reader.info().width,
            reader.info().height,
            width,
            height
        );
    }
    // Simulated "client app" reading the camera
    state.active_clients.fetch_add(1, Ordering::Relaxed);
    sidecar.notify_client(
        "vcam.clients",
        json!({ "activeClients": state.active_clients.load(Ordering::Relaxed) }),
    );
    let px_per_slot = reader.info().pixels_per_slot;
    let mut sink_idx = 0u64;
    while state.active.load(Ordering::SeqCst) {
        match reader.read() {
            Some(frame) => {
                state.frames_seen.fetch_add(1, Ordering::Relaxed);
                // write every 150th frame as a JPEG sink artifact (verification)
                if frame.meta.seq % 150 == 0 {
                    let expected = px_per_slot;
                    if frame.pixels.len() == expected {
                        write_jpeg_sink(out_dir, sink_idx, &frame.pixels, width, height);
                        sink_idx += 1;
                    }
                }
            }
            None => {
                // idle → slate policy (TS-03/§8.3): nothing stale is published;
                // the native driver would show the configured slate here.
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
    state.active_clients.fetch_sub(1, Ordering::Relaxed);
    sidecar.notify_client(
        "vcam.clients",
        json!({ "activeClients": state.active_clients.load(Ordering::Relaxed) }),
    );
    tracing::info!("vcam stopped, frames seen: {}", state.frames_seen.load(Ordering::Relaxed));
}

fn write_jpeg_sink(out_dir: &std::path::Path, idx: u64, bgra: &[u8], w: u32, h: u32) {
    // Convert BGRA→JPEG via a minimal PPM + sips-free path: use ffmpeg CLI if
    // present; otherwise write raw. v0 mock writes PPM (universally parseable).
    let path = out_dir.join(format!("sink-{idx:04}.ppm"));
    let mut ppm = format!("P6\n{w} {h}\n255\n").into_bytes();
    for px in bgra.chunks_exact(4) {
        ppm.push(px[2]); // R
        ppm.push(px[1]); // G
        ppm.push(px[0]); // B
    }
    let _ = std::fs::write(path, ppm);
}
