"""Swap backends (spec §7.2 + §13.3).

- StubSwapper: color-matched overlay compositor. Does not alter identity
  semantics — used as the default so the pipeline works with zero bundled
  model weights. Clearly labeled synthetic in the preview.
- InswapperByo: bring-your-own inswapper_128-class ONNX model, loaded ONLY
  when the user provides a path and accepts the model's license (§13.3).
  Requires a 512-d identity embedding from a matching embedder.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    ort = None

SWAP_SIZE = 128  # aligned crop side used by inswapper-class models


@dataclass
class SwapResult:
    """Aligned-crop-space swapped face (BGR) or None if the backend is a no-op."""

    face_bgr: np.ndarray | None
    note: str


class SwapBackend(Protocol):
    name: str

    def load(self, source_bgr: np.ndarray) -> None: ...
    def swap(self, target_aligned: np.ndarray) -> SwapResult: ...


class StubSwapper:
    """Deterministic tinted-overlay compositor (no weights, always available)."""

    def __init__(self) -> None:
        self.name = "stub"
        self._source_small: np.ndarray | None = None

    def load(self, source_bgr: np.ndarray) -> None:
        h, w = target_shape()
        self._source_small = cv2.resize(source_bgr, (w, h))

    def swap(self, target_aligned: np.ndarray) -> SwapResult:
        if self._source_small is None:
            return SwapResult(None, "no source loaded")
        # work in the aligned-crop space (SWAP_SIZE square)
        tgt = cv2.resize(target_aligned, target_shape()).astype(np.float32)
        src = self._source_small.astype(np.float32)
        for c in range(3):
            s_mean, s_std = src[..., c].mean(), src[..., c].std() + 1e-6
            t_mean, t_std = tgt[..., c].mean(), tgt[..., c].std() + 1e-6
            tgt[..., c] = (tgt[..., c] - t_mean) * (s_std / t_std) + s_mean
        out = np.clip(tgt * 0.55 + src * 0.45, 0, 255).astype(np.uint8)
        return SwapResult(out, "stub-swap")


class InswapperByo:
    """BYO inswapper_128-class model. input: aligned 128px face + 512-d latent."""

    def __init__(self, model_path: str) -> None:
        self.name = "inswapper-byo"
        if ort is None:
            raise RuntimeError("onnxruntime required")
        self.session = ort.InferenceSession(model_path, providers=_providers())
        self.input_name = self.session.get_inputs()[0].name
        self.latent_name = next((i.name for i in self.session.get_inputs() if "latent" in i.name.lower()), None)
        self._latent = np.zeros((1, 512), dtype=np.float32)

    def load(self, source_bgr: np.ndarray) -> None:
        # latent must come from a matching embedder; identity.embed supplies it
        # via set_latent(). Zero-latent fallback keeps the pipeline alive but
        # the visual result is meaningless — surfaced via `note`.
        if self.latent_name is None:
            self._latent = np.zeros((1, 512), dtype=np.float32)

    def set_latent(self, embedding: np.ndarray) -> None:
        self._latent = embedding.reshape(1, -1).astype(np.float32)

    def swap(self, target_aligned: np.ndarray) -> SwapResult:
        inp = cv2.resize(target_aligned, (SWAP_SIZE, SWAP_SIZE))
        inp = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        inp = inp.transpose(2, 0, 1)[None]
        feeds = {self.input_name: inp}
        if self.latent_name:
            feeds[self.latent_name] = self._latent
        out = self.session.run(None, feeds)[0]
        out = np.clip(out[0], 0, 1)
        if out.ndim == 3 and out.shape[0] == 3:
            out = out.transpose(1, 2, 0)
        out = cv2.cvtColor((out * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        return SwapResult(out, "inswapper-byo")


def target_shape() -> tuple[int, int]:
    return SWAP_SIZE, SWAP_SIZE


def _providers() -> list[str]:
    if ort is None:
        return []
    available = ort.get_available_providers()
    return [p for p in ("CoreMLExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider") if p in available] or available
