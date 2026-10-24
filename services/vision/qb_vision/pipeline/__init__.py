"""Pipeline orchestrator (spec §7): detect cadence → track → swap → blend →
temporal, with fail-safe (FR-109) and adaptive governor (§7.4)."""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum

import cv2
import numpy as np

from .blend import BlendParams, paste_back
from .detect import Detection, YuNetDetector
from .swap import SwapBackend, StubSwapper, SwapResult
from .track import IoUTracker

_log = logging.getLogger(__name__)


class FailSafe(str, Enum):
    SLATE = "slate"
    FREEZE = "freeze"
    PASSTHROUGH = "passthrough"


@dataclass
class PipelineParams:
    preset: str = "balanced"
    det_interval: int = 3
    mask_feather: float = 0.6
    color_match: float = 0.5
    sharpen: float = 0.2
    keep_mouth: bool = True
    keep_eyes: bool = False
    temporal_alpha: float = 0.3
    fail_safe: FailSafe = FailSafe.SLATE
    swap_strength: float = 1.0


@dataclass
class FrameStats:
    fps: float = 0.0
    frame_ms: float = 0.0
    frame_ms_p95: float = 0.0
    dropped: int = 0
    faces: int = 0
    execution_provider: str = "n/a"
    preset: str = "balanced"
    bypassed: bool = False
    degraded: bool = False


PRESET_DEFAULTS = {
    "fast": PipelineParams(preset="fast", det_interval=5, sharpen=0.0, keep_mouth=False),
    "balanced": PipelineParams(preset="balanced", det_interval=3),
    "quality": PipelineParams(preset="quality", det_interval=1, temporal_alpha=0.2),
}


@dataclass
class IdentityBinding:
    selector_mode: str  # largest | index | all | tracked
    selector_n: int = 0
    track_id: int = 0
    identity_id: str = ""
    source_bgr: np.ndarray | None = None
    embedding: np.ndarray | None = None


class Pipeline:
    def __init__(self, params: PipelineParams, detector: YuNetDetector | None, on_event=None):
        self.params = params
        self.detector = detector
        self.tracker = IoUTracker()
        self.backends: dict[str, SwapBackend] = {"stub": StubSwapper()}
        self.bindings: list[IdentityBinding] = []
        self.bypassed = False
        self._last_frame: np.ndarray | None = None
        self._frame_times: deque[float] = deque(maxlen=120)
        self._arrivals: deque[float] = deque(maxlen=120)
        self._dropped = 0
        self._faces: list[dict] = []
        self._on_event = on_event or (lambda name, payload: None)
        self._last_synth_badge = True
        self._degraded = False
        self._slow_since: float | None = None
        self._last_degraded_event = 0.0

    # ---- configuration (hot-swappable per spec §7.6) ----

    def apply_params(self, patch: dict) -> None:
        mapping = {
            "preset": "preset",
            "swapStrength": "swap_strength",
            "maskFeather": "mask_feather",
            "colorMatch": "color_match",
            "sharpen": "sharpen",
            "keepMouth": "keep_mouth",
            "keepEyes": "keep_eyes",
            "temporalAlpha": "temporal_alpha",
        }
        if "preset" in patch:
            base = PRESET_DEFAULTS.get(patch["preset"], PipelineParams())
            self.params = PipelineParams(
                preset=base.preset,
                det_interval=base.det_interval,
                mask_feather=self.params.mask_feather,
                color_match=self.params.color_match,
                sharpen=base.sharpen,
                keep_mouth=base.keep_mouth,
                keep_eyes=self.params.keep_eyes,
                temporal_alpha=base.temporal_alpha,
                fail_safe=self.params.fail_safe,
                swap_strength=self.params.swap_strength,
            )
        for k, v in patch.items():
            attr = mapping.get(k)
            if attr and attr != "preset":
                setattr(self.params, attr, v)
        if "failSafe" in patch:
            self.params.fail_safe = FailSafe(patch["failSafe"])

    def set_bindings(self, bindings: list[IdentityBinding]) -> None:
        self.bindings = bindings
        for b in bindings:
            if b.source_bgr is not None:
                for backend in self.backends.values():
                    backend.load(b.source_bgr)

    def set_bypass(self, on: bool) -> None:
        self.bypassed = on

    def load_backend(self, backend: SwapBackend) -> None:
        self.backends[backend.name] = backend
        for b in self.bindings:
            if b.source_bgr is not None:
                backend.load(b.source_bgr)

    # ---- per-frame processing ----

    def process(self, frame_bgra: np.ndarray, frame_index: int) -> tuple[np.ndarray, FrameStats]:
        start = time.perf_counter()
        self._arrivals.append(start)
        if self.bypassed:
            stats = self._stats(start, 0, degraded=False)
            return frame_bgra, stats

        try:
            out = self._process_inner(frame_bgra, frame_index, start)
        except Exception as exc:
            # fail-safe per FR-109 / ADR-009: never leak a half-processed frame
            _log.exception("pipeline exception; fail-safe engaged")
            self._degraded = True
            now = time.perf_counter()
            if now - self._last_degraded_event >= 5.0:
                self._last_degraded_event = now
                self._on_event(
                    "pipeline.degraded",
                    {
                        "reason": "pipeline exception; fail-safe engaged",
                        "error": f"{type(exc).__name__}: {exc}",
                    },
                )
            out = self._fail_safe_frame(frame_bgra)
        stats = self._stats(start, self._dropped, degraded=self._degraded)
        return out, stats

    def _fail_safe_frame(self, frame_bgra: np.ndarray) -> np.ndarray:
        if self.params.fail_safe == FailSafe.PASSTHROUGH:
            return frame_bgra
        if self.params.fail_safe == FailSafe.FREEZE and self._last_frame is not None:
            return self._last_frame
        return draw_slate(frame_bgra)

    def _process_inner(self, frame_bgra: np.ndarray, frame_index: int, start: float) -> np.ndarray:
        bgr = cv2.cvtColor(frame_bgra, cv2.COLOR_BGRA2BGR)
        do_detect = (
            self.detector is not None
            and (frame_index % self.params.det_interval == 0 or not self.tracker.tracks)
        )
        if do_detect:
            dets = self.detector.detect(bgr)
            self.tracker.update([(d.box, d.landmarks, d.score) for d in dets])
        else:
            self.tracker.update([])  # age only

        self._faces = [
            {"trackId": t.track_id, "x": t.box[0], "y": t.box[1], "w": t.box[2], "h": t.box[3]}
            for t in self.tracker.tracks
        ]
        self._on_event("pipeline.faces", {"faces": self._faces})

        targets = self._select_targets()
        for track in targets:
            backend = self._backend_for(track)
            if backend is None:
                continue
            aligned = align_crop(bgr, track.box)
            result = backend.swap(aligned)
            if result.face_bgr is not None:
                blend_params = BlendParams(
                    feather=self.params.mask_feather,
                    color_match=self.params.color_match,
                    sharpen=self.params.sharpen,
                    keep_mouth=self.params.keep_mouth,
                    keep_eyes=self.params.keep_eyes,
                )
                paste_back(frame_bgra, result.face_bgr, track.box, track.landmarks, blend_params)

        draw_synthetic_badge(frame_bgra)
        self._last_frame = frame_bgra.copy()
        self._maybe_adapt(start)
        return frame_bgra

    def _select_targets(self):
        mode = self.bindings[0].selector_mode if self.bindings else "largest"
        tracks = list(self.tracker.tracks)
        if mode == "largest":
            tracks.sort(key=lambda t: t.box[2] * t.box[3], reverse=True)
            return tracks[:1]
        if mode == "index":
            n = self.bindings[0].selector_n if self.bindings else 0
            return tracks[n : n + 1]
        if mode == "tracked":
            tid = self.bindings[0].track_id if self.bindings else 0
            return [t for t in tracks if t.track_id == tid]
        return tracks[:4]  # 'all', capped per §7.5

    def _backend_for(self, track) -> SwapBackend | None:
        backend = self.backends.get("inswapper-byo") if any(
            b.embedding is not None for b in self.bindings
        ) else None
        return backend or self.backends.get("stub")

    def _maybe_adapt(self, start: float) -> None:
        """Adaptive quality governor (§7.4): step down when p95 frame time is
        over budget for 3s, step back up after 15s of headroom."""
        budget_ms = {"fast": 16.0, "balanced": 33.0, "quality": 33.0}[self.params.preset]
        recent = list(self._frame_times)[-90:]
        if len(recent) < 30:
            return
        p95 = sorted(recent)[int(len(recent) * 0.95)]
        now = time.perf_counter()
        if p95 > budget_ms:
            if self._slow_since is None:
                self._slow_since = now
            elif now - self._slow_since > 3.0 and not self._degraded:
                self._degraded = True
                self.params.det_interval = min(10, self.params.det_interval + 2)
                self._on_event("pipeline.degraded", {"reason": f"p95 {p95:.1f}ms > {budget_ms}ms; raised det interval"})
        else:
            self._slow_since = None
            if self._degraded and now - (self._slow_since or now) >= 0:
                if p95 < budget_ms * 0.7:
                    self._degraded = False
                    self._on_event("pipeline.recovered", {})
                    self.params.det_interval = max(
                        {"fast": 5, "balanced": 3, "quality": 1}[self.params.preset],
                        self.params.det_interval - 2,
                    )

    def _stats(self, start: float, dropped: int, degraded: bool) -> FrameStats:
        elapsed = (time.perf_counter() - start) * 1000
        self._frame_times.append(elapsed)
        recent = list(self._frame_times)
        # FPS is the arrival rate, not the inverse of processing time (which
        # can exceed the capture rate on fast machines and mislead operators).
        arrivals = list(self._arrivals)
        if len(arrivals) > 1 and arrivals[-1] > arrivals[0]:
            fps = (len(arrivals) - 1) / (arrivals[-1] - arrivals[0])
        else:
            fps = 1000.0 / elapsed if elapsed > 0 else 0.0
        p95 = sorted(recent)[int(len(recent) * 0.95)] if len(recent) > 10 else elapsed
        return FrameStats(
            fps=fps,
            frame_ms=elapsed,
            frame_ms_p95=p95,
            dropped=dropped,
            faces=len(self._faces),
            execution_provider=("opencv-yunet" if self.detector else "n/a"),
            preset=self.params.preset,
            bypassed=self.bypassed,
            degraded=degraded,
        )


# ---------- helpers ----------

def align_crop(bgr: np.ndarray, box: tuple[int, int, int, int], size: int = 128) -> np.ndarray:
    """Similarity-warp the face box to a square aligned crop (spec §7.2)."""
    x, y, w, h = box
    fh, fw = bgr.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(fw, x + w), min(fh, y + h)
    if x1 <= x0 or y1 <= y0:
        return np.zeros((size, size, 3), dtype=np.uint8)
    crop = bgr[y0:y1, x0:x1]
    return cv2.resize(crop, (size, size), interpolation=cv2.INTER_LINEAR)


def draw_slate(frame_bgra: np.ndarray) -> np.ndarray:
    """'QBCAM — not streaming' slate over the frame (TS-03 idle state)."""
    out = frame_bgra.copy()
    h, w = out.shape[:2]
    overlay = out[..., :3].copy()
    overlay[:] = (40, 40, 40)
    alpha = 0.85
    out[..., :3] = (out[..., :3] * (1 - alpha) + overlay * alpha).astype(np.uint8)
    cv2.putText(out, "QBCAM - NOT STREAMING", (w // 2 - 220, h // 2 + 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 200, 200), 2, cv2.LINE_AA)
    return out


def draw_synthetic_badge(frame_bgra: np.ndarray) -> np.ndarray:
    """TS-04: in-stream synthetic indicator (can't be hidden when swap active)."""
    h, w = frame_bgra.shape[:2]
    cv2.rectangle(frame_bgra, (0, h - 34), (210, h), (0, 0, 0), -1)
    cv2.putText(frame_bgra, "SYNTHETIC MEDIA", (10, h - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 200, 255), 2, cv2.LINE_AA)
    return frame_bgra


def detection_to_face(d: Detection) -> dict:
    return {"trackId": -1, "x": d.box[0], "y": d.box[1], "w": d.box[2], "h": d.box[3]}
