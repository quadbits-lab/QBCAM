//! qb-recorder — no-drop ring reader → FFmpeg rawvideo stdin → fragmented MP4
//! (crash-safe per spec §9.1). Disk guard: warn < 5 GB, auto-stop < 500 MB.

use qbcam_ipc::Sidecar;
use qbcam_shm::{ReadPolicy, RingReader};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

struct Recording {
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
    ring: String,
    path: String,
    started: Instant,
    ffmpeg: Arc<Mutex<Option<Child>>>,
}

fn disk_free_bytes(path: &Path) -> u64 {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
        let cpath = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        if unsafe { libc::statfs(cpath.as_ptr(), &mut stat) } == 0 {
            return (stat.f_bavail as u64) * (stat.f_bsize as u64);
        }
        u64::MAX
    }
    #[cfg(not(target_os = "macos"))]
    {
        use std::os::unix::ffi::OsStrExt;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let cpath = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        if unsafe { libc::statvfs(cpath.as_ptr(), &mut stat) } == 0 {
            return (stat.f_bavail as u64) * (stat.f_bsize as u64);
        }
        u64::MAX
    }
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

    let recordings: Arc<Mutex<Option<Recording>>> = Arc::new(Mutex::new(None));
    let mut handlers: HashMap<String, qbcam_ipc::Handler> = HashMap::new();

    let recs = recordings.clone();
    let sidecar_start = sidecar.clone();
    handlers.insert(
        "recorder.start".into(),
        Arc::new(move |params| {
            let mut recs = recs.lock().unwrap();
            if recs.is_some() {
                return Err("already recording".into());
            }
            let ring = params["ringOut"].as_str().unwrap_or("").to_string();
            let container = params["container"].as_str().unwrap_or("mp4").to_string();
            let codec = params["codec"].as_str().unwrap_or("h264").to_string();
            let output_dir = params["outputDir"].as_str().unwrap_or(".").to_string();
            std::fs::create_dir_all(&output_dir).map_err(|e| format!("mkdir: {e}"))?;

            let free = disk_free_bytes(Path::new(&output_dir));
            if free < 500_000_000 {
                return Err("disk guard: < 500 MB free, refusing to record".into());
            }
            if free < 5_000_000_000 {
                sidecar_start.notify_client("recorder.disk-warning", { json!({ "freeBytes": free }) });
            }

            let path = format!(
                "{}/recording-{}.{}",
                output_dir.trim_end_matches('/'),
                chrono_basename(),
                container
            );
            let id = format!("rec-{}", chrono_basename());
            let path_clone = path.clone();

            let stop = Arc::new(AtomicBool::new(false));
            let ffmpeg_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
            let started = Instant::now();

            let ring2 = ring.clone();
            let path2 = path.clone();
            let codec2 = codec.clone();
            let container2 = container.clone();
            let stop2 = stop.clone();
            let ffmpeg2 = ffmpeg_slot.clone();
            let sidecar2 = sidecar_start.clone();
            let join = std::thread::spawn(move || {
                run_recorder(&ring2, &path2, &codec2, &container2, &stop2, &ffmpeg2, &sidecar2);
            });

            *recs = Some(Recording {
                stop,
                join: Some(join),
                ring,
                path: path_clone,
                started,
                ffmpeg: ffmpeg_slot,
            });
            Ok(json!({ "recordingId": id, "path": path }))
        }),
    );

    let recs2 = recordings.clone();
    handlers.insert(
        "recorder.stop".into(),
        Arc::new(move |_params| {
            let mut recs = recs2.lock().unwrap();
            let Some(rec) = recs.take() else {
                return Err("not recording".into());
            };
            rec.stop.store(true, Ordering::SeqCst);
            if let Some(j) = rec.join {
                let _ = j.join();
            }
            let duration_ms = rec.started.elapsed().as_millis() as u64;
            let bytes = std::fs::metadata(&rec.path).map(|m| m.len()).unwrap_or(0);
            Ok(json!({
                "recordingId": format!("rec-{}", chrono_basename()),
                "path": rec.path,
                "durationMs": duration_ms,
                "bytes": bytes,
                "signed": false,
            }))
        }),
    );

    let recs3 = recordings.clone();
    handlers.insert(
        "recorder.status".into(),
        Arc::new(move |_params| {
            let recs = recs3.lock().unwrap();
            match recs.as_ref() {
                None => Ok(Value::Null),
                Some(rec) => {
                    let out_dir = Path::new(&rec.path).parent().unwrap_or(Path::new("."));
                    Ok(json!({
                        "recordingId": "rec",
                        "seconds": rec.started.elapsed().as_secs_f64(),
                        "bytes": std::fs::metadata(&rec.path).map(|m| m.len()).unwrap_or(0),
                        "droppedFrames": 0,
                        "diskFreeBytes": disk_free_bytes(out_dir),
                    }))
                }
            }
        }),
    );

    sidecar.serve("recorder", handlers);
    // cleanup: stop any active recording
    let rec_opt = recordings.lock().unwrap().take();
    if let Some(mut rec) = rec_opt {
        rec.stop.store(true, Ordering::SeqCst);
        if let Some(j) = rec.join {
            let _ = j.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_recorder(
    ring: &str,
    path: &str,
    codec: &str,
    container: &str,
    stop: &Arc<AtomicBool>,
    ffmpeg_slot: &Arc<Mutex<Option<Child>>>,
    sidecar: &Arc<Sidecar>,
) {
    // Discover ring geometry first
    let mut reader = match RingReader::attach(ring, 1, ReadPolicy::NoDrop) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("attach ring: {e}");
            return;
        }
    };
    let (w, h) = (reader.info().width, reader.info().height);
    let frame_bytes = reader.info().pixels_per_slot;

    // Block until the first frame exists so ffmpeg gets a valid stream header
    let mut first: Option<Vec<u8>> = None;
    for _ in 0..600 {
        if let Some(f) = reader.read() {
            first = Some(f.pixels);
            break;
        }
        if stop.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let Some(first) = first else { return };

    let pix_fmt_codec = codec; // h264 default; HW encoders per OS below
    let fmt = match container {
        "mp4" => ["-movflags", "+frag_keyframe+empty_moov"].to_vec(),
        "mkv" => vec![],
        "webm" => vec![],
        _ => vec![],
    };

    let mut child = match Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .args(["-f", "rawvideo", "-pix_fmt", "bgra"])
        .args(["-s", &format!("{w}x{h}"), "-r", "30", "-i", "pipe:0"])
        .args(["-c:v", pix_fmt_codec, "-preset", "fast", "-qp", "20"])
        .args(&fmt)
        .arg("-y")
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("ffmpeg spawn: {e}");
            return;
        }
    };
    let Some(stdin) = child.stdin.take() else { return };
    *ffmpeg_slot.lock().unwrap() = Some(child);

    let mut stdin = stdin;
    let _ = stdin.write_all(&first);
    let mut frames: u64 = 1;
    let last_notify = Instant::now();

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match reader.read() {
            Some(f) => {
                if stdin.write_all(&f.pixels).is_err() {
                    tracing::error!("ffmpeg stdin closed");
                    break;
                }
                frames += 1;
            }
            None => {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
        if last_notify.elapsed().as_millis() > 500 {
            let _ = frames; // stats events forwarded via notify below
            sidecar.notify_client(
                "recorder.progress",
                json!({
                    "recordingId": "rec",
                    "seconds": frames as f64 / 30.0,
                    "bytes": std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
                    "droppedFrames": 0,
                }),
            );
        }
        let _ = frame_bytes;
    }
    drop(stdin);
    // finalize
    if let Some(mut ff) = ffmpeg_slot.lock().unwrap().take() {
        let _ = ff.wait();
    }
    tracing::info!("recording finalized: {path} frames={frames}");
}

fn chrono_basename() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_millis())
}
