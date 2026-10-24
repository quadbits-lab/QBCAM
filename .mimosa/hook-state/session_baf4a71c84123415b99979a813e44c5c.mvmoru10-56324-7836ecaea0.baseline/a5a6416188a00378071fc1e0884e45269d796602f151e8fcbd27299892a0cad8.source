"""Preview WebSocket server (spec §10.1): binary JPEG frames on 127.0.0.1
with a per-session token. UI connects directly; qb-core learns the port via
the `preview.port` notification."""

from __future__ import annotations

import asyncio
import threading

import cv2
import numpy as np

try:
    import websockets.asyncio.server as ws_server
except ImportError:  # pragma: no cover
    ws_server = None


class PreviewServer:
    def __init__(self, token: str, max_fps: int = 30) -> None:
        self.token = token
        self.max_fps = max_fps
        self.port: int | None = None
        self._server = None
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last_jpeg: bytes | None = None

    async def _handler(self, ws) -> None:
        if getattr(ws, "request", None) is not None:
            qs = ws.request.path.split("token=")[-1]
            if self.token not in qs:
                await ws.close(code=4403)
                return
        self._clients.add(ws)
        try:
            if self._last_jpeg:
                await ws.send(self._last_jpeg)
            async for _ in ws:
                pass  # UI doesn't send on this channel
        except Exception:  # noqa: BLE001 — client disconnects are normal
            pass
        finally:
            self._clients.discard(ws)

    def start(self) -> None:
        if ws_server is None:
            raise RuntimeError("websockets package required for preview")

        started = threading.Event()

        def run_thread() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop

            async def run() -> None:
                self._server = await ws_server.serve(self._handler, "127.0.0.1", 0)

            loop.run_until_complete(run())
            started.set()
            loop.run_forever()

        self._thread = threading.Thread(target=run_thread, daemon=True)
        self._thread.start()
        started.wait(timeout=5)
        if self._server is not None and self._server.sockets:
            self.port = self._server.sockets[0].getsockname()[1]

    def push_frame(self, frame_bgra: np.ndarray, downscale: float = 0.5) -> None:
        """Encode + broadcast the latest frame (latest-wins; drops if busy)."""
        if self.port is None or not self._clients or self._loop is None:
            return
        h, w = frame_bgra.shape[:2]
        small = cv2.resize(frame_bgra, (int(w * downscale), int(h * downscale)))
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return
        jpeg = buf.tobytes()
        self._last_jpeg = jpeg

        async def broadcast() -> None:
            for ws in list(self._clients):
                try:
                    await ws.send(jpeg)
                except Exception:  # noqa: BLE001
                    self._clients.discard(ws)

        asyncio.run_coroutine_threadsafe(broadcast(), self._loop)

    def stop(self) -> None:
        if self._server is not None:
            self._loop.run_until_complete(self._server.close())
            self._server = None
