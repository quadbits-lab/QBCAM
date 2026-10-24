"""Generic QBCAM sidecar server (Python mirror of the Rust/TS protocol):
UDS, newline-delimited JSON-RPC 2.0, per-run token auth, notifications."""

from __future__ import annotations

import hmac
import json
import os
import socket
import threading
from typing import Any, Callable

Handler = Callable[[dict], Any]


class SidecarServer:
    def __init__(self, socket_path: str, token: str) -> None:
        self.socket_path = socket_path
        self.token = token
        self._handlers: dict[str, Handler] = {}
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._clients: list[socket.socket] = []

    def method(self, name: str, handler: Handler) -> None:
        self._handlers[name] = handler

    def serve(self) -> None:
        try:
            os.unlink(self.socket_path)
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.socket_path)
        srv.listen(2)
        srv.settimeout(0.2)
        while not self._stop.is_set():
            try:
                conn, _ = srv.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            threading.Thread(target=self._client_loop, args=(conn,), daemon=True).start()
        try:
            os.unlink(self.socket_path)
        except FileNotFoundError:
            pass

    def stop(self) -> None:
        self._stop.set()

    def _client_loop(self, conn: socket.socket) -> None:
        authed = False
        buf = b""
        conn.settimeout(None)
        with self._lock:
            self._clients.append(conn)
        try:
            while not self._stop.is_set():
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    method = msg.get("method")
                    if not method:
                        continue
                    msg_id = msg.get("id")
                    params = msg.get("params") or {}

                    if method == "hello":
                        token = str(params.get("token", ""))
                        if hmac.compare_digest(token, self.token):
                            authed = True
                            self._reply(conn, msg_id, {"ok": True, "service": os.environ.get("QB_SERVICE_NAME")})
                            self._send(conn, "ready", {"service": os.environ.get("QB_SERVICE_NAME")})
                        else:
                            self._reply_err(conn, msg_id, -32000, "bad token")
                        continue
                    if not authed:
                        self._reply_err(conn, msg_id, -32001, "not authenticated")
                        continue
                    if method == "ping":
                        self._reply(conn, msg_id, {"pong": 0})
                        continue
                    if method == "shutdown":
                        self._reply(conn, msg_id, {"ok": True})
                        self.stop()
                        continue
                    handler = self._handlers.get(method)
                    if handler is None:
                        self._reply_err(conn, msg_id, -32601, f"method not found: {method}")
                        continue
                    try:
                        result = handler(params)
                        self._reply(conn, msg_id, result)
                    except Exception as exc:  # noqa: BLE001 — boundary: report to core
                        self._reply_err(conn, msg_id, -32000, str(exc))
        finally:
            with self._lock:
                if conn in self._clients:
                    self._clients.remove(conn)
            try:
                conn.close()
            except OSError:
                pass

    def notify(self, method: str, params: dict) -> None:
        with self._lock:
            clients = list(self._clients)
        for conn in clients:
            self._send(conn, method, params)

    def _send(self, conn: socket.socket, method: str, params: dict) -> None:
        self._write(conn, {"jsonrpc": "2.0", "method": method, "params": params})

    def _reply(self, conn: socket.socket, msg_id: Any, result: Any) -> None:
        self._write(conn, {"jsonrpc": "2.0", "id": msg_id, "result": result})

    def _reply_err(self, conn: socket.socket, msg_id: Any, code: int, message: str) -> None:
        self._write(conn, {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}})

    def _write(self, conn: socket.socket, payload: dict) -> None:
        try:
            conn.sendall((json.dumps(payload) + "\n").encode())
        except OSError:
            pass
