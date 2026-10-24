//! Sidecar JSON-RPC server over UDS — mirrors apps/desktop/src/main/rpc/sidecar-server.ts.
//! Framing: newline-delimited JSON. Auth: `hello` with the per-run token.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub type Handler = Arc<dyn Fn(Value) -> Result<Value, String> + Send + Sync>;

pub struct Sidecar {
    pub socket_path: String,
    pub token: String,
    stop: Arc<AtomicBool>,
    client: Arc<Mutex<Option<UnixStream>>>,
}

impl Sidecar {
    pub fn new(socket_path: String, token: String) -> Arc<Self> {
        let _ = std::fs::remove_file(&socket_path);
        Arc::new(Self {
            socket_path,
            token,
            stop: Arc::new(AtomicBool::new(false)),
            client: Arc::new(Mutex::new(None)),
        })
    }

    /// Bind, accept connections (single client), serve requests until shutdown.
    pub fn serve(self: Arc<Self>, handlers: HashMap<String, Handler>) {
        let listener = UnixListener::bind(&self.socket_path).expect("bind sidecar socket");
        tracing::info!(socket = %self.socket_path, "sidecar listening");
        for stream in listener.incoming() {
            if self.stop.load(Ordering::SeqCst) {
                break;
            }
            let Ok(stream) = stream else { continue };
            *self.client.lock().unwrap() = Some(stream.try_clone().expect("clone stream"));
            let sidecar = self.clone();
            let handlers = handlers.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stream);
                let mut line = String::new();
                let mut authed = false;
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                    let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { continue };
                    let id = msg.get("id").cloned().unwrap_or(Value::Null);
                    let Some(method) = msg.get("method").and_then(|m| m.as_str()).map(String::from) else {
                        continue;
                    };
                    let params = msg.get("params").cloned().unwrap_or(json!({}));

                    if method == "hello" {
                        let token = params.get("token").and_then(|t| t.as_str()).unwrap_or("");
                        if token == sidecar.token {
                            authed = true;
                            write_msg(&sidecar.client, id.clone(), json!({ "result": { "ok": true, "service": "camio" } }));
                            write_msg(&sidecar.client, Value::Null, json!({ "method": "ready", "params": { "service": "camio" } }));
                        } else {
                            write_msg(&sidecar.client, id, json!({ "error": { "code": -32000, "message": "bad token" } }));
                        }
                        continue;
                    }
                    if !authed {
                        write_msg(&sidecar.client, id, json!({ "error": { "code": -32001, "message": "not authenticated" } }));
                        continue;
                    }
                    let result = if method == "ping" {
                        Ok(json!({ "pong": now_ms() }))
                    } else if method == "shutdown" {
                        sidecar.stop.store(true, Ordering::SeqCst);
                        Ok(json!({ "ok": true }))
                    } else if let Some(h) = handlers.get(&method) {
                        h(params)
                    } else {
                        Err(format!("method not found: {method}"))
                    };
                    match result {
                        Ok(v) => write_msg(&sidecar.client, id, json!({ "result": v })),
                        Err(e) => write_msg(&sidecar.client, id, json!({ "error": { "code": -32000, "message": e } })),
                    }
                }
            });
        }
        let _ = std::fs::remove_file(&self.socket_path);
    }

    pub fn notify_client(&self, method: &str, params: Value) {
        write_msg(
            &self.client,
            Value::Null,
            json!({ "method": method, "params": params }),
        );
    }

    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
}

fn write_msg(client: &Arc<Mutex<Option<UnixStream>>>, id: Value, mut msg: Value) {
    if !id.is_null() {
        msg["id"] = id;
    }
    let mut out = serde_json::to_string(&msg).unwrap_or_default();
    out.push('\n');
    if let Some(s) = client.lock().unwrap().as_mut() {
        let _ = s.write_all(out.as_bytes());
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
