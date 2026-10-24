"""qb-vision sidecar entry (spec §7.6): JSON-RPC control + shm in/out + preview WS."""

from __future__ import annotations

import os
import threading

import cv2
import numpy as np

from .pipeline import IdentityBinding, PRESET_DEFAULTS, Pipeline, PipelineParams
from .pipeline.detect import YuNetDetector, load_model_path
from .pipeline.swap import InswapperByo
from .preview import PreviewServer
from .sidecar import SidecarServer


class VisionService:
    def __init__(self) -> None:
        socket_path = os.environ["QB_SOCKET"]
        token = os.environ["QB_TOKEN"]
        self.server = SidecarServer(socket_path, token)
        self.preview = PreviewServer(token=token)
        self.pipeline: Pipeline | None = None
        self._running = threading.Event()
        self._thread: threading.Thread | None = None
        self._ring_in_name: str | None = None
        self._ring_out_name: str | None = None
        self._register()

    def _register(self) -> None:
        s = self.server

        def _preview_info(_params: dict) -> dict:
            if self.preview.port is None:
                self.preview.start()
                s.notify("preview.port", {"port": self.preview.port, "token": s.token})
            return {"port": self.preview.port}

        def _start(params: dict) -> dict:
            if self._running.is_set():
                self._stop_pipeline()
            self._ring_in_name = params["ringIn"]
            self._ring_out_name = params["ringOut"]

            model_path = load_model_path()
            detector = None
            ep = "none"
            if model_path:
                try:
                    detector = YuNetDetector(model_path)
                    ep = "opencv-yunet"
                except Exception as exc:  # noqa: BLE001
                    s.notify("pipeline.degraded", {"reason": f"detector load failed: {exc}"})

            pparams = PRESET_DEFAULTS.get(params.get("preset", "balanced"), PipelineParams())
            self.pipeline = Pipeline(pparams, detector, on_event=lambda name, payload: s.notify(name, payload))

            for binding in params.get("identityBindings", []):
                self.pipeline.set_bindings(
                    self.pipeline.bindings
                    + [
                        IdentityBinding(
                            selector_mode=binding["selector"]["mode"],
                            selector_n=binding["selector"].get("n", 0),
                            track_id=binding["selector"].get("trackId", 0),
                            identity_id=binding.get("identityId", ""),
                        )
                    ]
                )
            self.preview.start()
            s.notify("preview.port", {"port": self.preview.port, "token": s.token})
            self._running.set()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            return {"ok": True, "executionProvider": ep, "modelHashes": [os.path.basename(model_path)] if model_path else []}

        def _set_params(params: dict) -> None:
            if self.pipeline:
                self.pipeline.apply_params(params)

        def _set_source(params: dict) -> None:
            if not self.pipeline:
                return
            bindings = [
                IdentityBinding(
                    selector_mode=b["selector"]["mode"],
                    selector_n=b["selector"].get("n", 0),
                    track_id=b["selector"].get("trackId", 0),
                    identity_id=b.get("identityId", ""),
                )
                for b in params.get("bindings", [])
            ]
            self.pipeline.set_bindings(bindings)

        def _set_source_image(params: dict) -> None:
            """Identity source image (BGR bytes) + optional embedding for BYO swap."""
            if not self.pipeline:
                return
            arr = np.frombuffer(params["imageBgr"], dtype=np.uint8)
            img = arr.reshape(params["height"], params["width"], 3)
            for b in self.pipeline.bindings:
                if b.identity_id == params.get("identityId"):
                    b.source_bgr = img
                    if params.get("embedding"):
                        b.embedding = np.asarray(params["embedding"], dtype=np.float32)
            self.pipeline.set_bindings(self.pipeline.bindings)

        def _bypass(params: dict) -> None:
            if self.pipeline:
                self.pipeline.set_bypass(bool(params.get("on")))

        def _stats(_params: dict) -> dict:
            if not self.pipeline:
                return {"fps": 0, "frameMs": 0, "frameMsP95": 0, "dropped": 0, "faces": 0,
                        "executionProvider": "n/a", "preset": "n/a", "bypassed": False, "degraded": False}
            from .pipeline import FrameStats

            stats: FrameStats = self.pipeline._stats(0, self.pipeline._dropped, self.pipeline._degraded)
            return {
                "fps": round(stats.fps, 1),
                "frameMs": round(stats.frame_ms, 1),
                "frameMsP95": round(stats.frame_ms_p95, 1),
                "dropped": stats.dropped,
                "faces": stats.faces,
                "executionProvider": stats.execution_provider,
                "preset": stats.preset,
                "bypassed": stats.bypassed,
                "degraded": stats.degraded,
            }

        def _stop(_params: dict) -> dict:
            self._stop_pipeline()
            if self.pipeline:
                return {
                    "fps": 0, "frameMs": 0, "frameMsP95": 0, "dropped": self.pipeline._dropped,
                    "faces": 0, "executionProvider": "n/a", "preset": self.pipeline.params.preset,
                    "bypassed": False, "degraded": False,
                }
            return {"fps": 0, "frameMs": 0, "frameMsP95": 0, "dropped": 0, "faces": 0,
                    "executionProvider": "n/a", "preset": "n/a", "bypassed": False, "degraded": False}

        def _embed(params: dict) -> dict:
            """Detect the best face in the provided photos; compute quality.
            Embedding is computed when a BYO embedder is configured; otherwise
            zeros (stub swap doesn't need embeddings)."""
            paths = params.get("paths", [])
            best_path, best_score, best_face_img, detected = "", 0.0, None, 0
            model_path = load_model_path()
            detector = YuNetDetector(model_path) if model_path else None
            for path in paths:
                img = cv2.imread(path)
                if img is None:
                    continue
                if detector is not None:
                    dets = detector.detect(img, score_thresh=0.5)
                else:
                    dets = []
                detected += len(dets)
                for d in dets:
                    if d.score > best_score:
                        best_score = d.score
                        best_path = path
                        x, y, w, h = d.box
                        best_face_img = img[max(0, y) : y + h, max(0, x) : x + w].copy()
            quality = best_score
            return {
                "embedding": [0.0] * 512,
                "quality": quality,
                "detectedFaces": detected,
                "bestPath": best_path,
                "bestFaceBgr": best_face_img.tobytes() if best_face_img is not None else "",
                "bestFaceShape": list(best_face_img.shape) if best_face_img is not None else [],
            }

        s.method("preview.info", _preview_info)
        s.method("pipeline.start", _start)
        s.method("pipeline.setParams", _set_params)
        s.method("pipeline.setSource", _set_source)
        s.method("pipeline.setSourceImage", _set_source_image)
        s.method("pipeline.bypass", _bypass)
        s.method("pipeline.stats", _stats)
        s.method("pipeline.stop", _stop)
        s.method("identity.embed", _embed)

    # ---- hot loop ----

    def _run_loop(self) -> None:
        from qbcam_shm import RingReader, RingWriter, create_ring

        assert self.pipeline is not None and self._ring_in_name and self._ring_out_name
        try:
            reader = RingReader(self._ring_in_name, 0, "latest")
            # the pipeline owns the out ring: create it with the in-ring's dims
            create_ring(
                self._ring_out_name,
                4,
                32 + reader.info.width * reader.info.height * 4,
                reader.info.width,
                reader.info.height,
                reader.info.format,
            )
            writer = RingWriter(self._ring_out_name)
        except Exception as exc:  # noqa: BLE001
            self.server.notify("pipeline.degraded", {"reason": f"ring attach failed: {exc}"})
            return
        frame_index = 0
        last_stats = 0.0
        import time

        while self._running.is_set():
            got = reader.read()
            if got is None:
                time.sleep(0.004)
                continue
            meta, px = got
            height, width = reader.info.height, reader.info.width
            frame = px.reshape(height, width, 4).copy()
            out, stats = self.pipeline.process(frame, frame_index)
            frame_index += 1
            face_count = len(self.pipeline._faces)
            ok, buf = cv2.imencode(".jpg", cv2.resize(out, (640, 360)), [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok:
                self.preview.push_frame(out)
            try:
                writer.write_frame(
                    out.tobytes(), meta.ts_ns, flags=0, face_count=face_count
                )
            except ValueError:
                # out ring dimensions differ — only possible on reconfig; skip
                pass
            now = time.perf_counter()
            if now - last_stats > 0.5:  # 2 Hz per spec §4.3
                last_stats = now
                self.server.notify(
                    "pipeline.stats",
                    {
                        "fps": round(stats.fps, 1),
                        "frameMs": round(stats.frame_ms, 1),
                        "frameMsP95": round(stats.frame_ms_p95, 1),
                        "dropped": stats.dropped,
                        "faces": face_count,
                        "executionProvider": stats.execution_provider,
                        "preset": stats.preset,
                        "bypassed": stats.bypassed,
                        "degraded": stats.degraded,
                    },
                )

    def _stop_pipeline(self) -> None:
        self._running.clear()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def serve(self) -> None:
        self.server.serve()


def main() -> None:
    service = VisionService()
    service.serve()


if __name__ == "__main__":
    main()
