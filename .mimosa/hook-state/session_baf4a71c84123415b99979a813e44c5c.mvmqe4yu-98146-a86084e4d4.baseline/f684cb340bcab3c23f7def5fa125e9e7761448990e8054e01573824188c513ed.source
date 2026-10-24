"""Detection stage — YuNet face detector via OpenCV FaceDetectorYN (spec §7.2).

Model: face_detection_yunet_2023mar.onnx (Apache-2.0, OpenCV Zoo).
FaceDetectorYN handles anchor decoding; we map its [N,15] output to
Detection(box, 5-point landmarks, score).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class Detection:
    box: tuple[int, int, int, int]  # x, y, w, h
    landmarks: tuple[float, ...]  # 10 floats (5 points)
    score: float


class YuNetDetector:
    def __init__(self, model_path: str, score_thresh: float = 0.6) -> None:
        self._det = cv2.FaceDetectorYN.create(
            model_path, "", (320, 320), score_thresh, 0.3, 5000
        )

    def detect(self, frame_bgr: np.ndarray, score_thresh: float = 0.6) -> list[Detection]:
        h, w = frame_bgr.shape[:2]
        self._det.setScoreThreshold(score_thresh)
        self._det.setInputSize((w, h))
        _retval, faces = self._det.detect(frame_bgr)
        dets: list[Detection] = []
        if faces is None:
            return dets
        for row in faces:
            x, y, fw, fh = (int(v) for v in row[:4])
            pts = tuple(float(v) for v in row[4:14])
            score = float(row[14])
            dets.append(Detection(box=(max(0, x), max(0, y), fw, fh), landmarks=pts, score=score))
        return dets


def load_model_path() -> str:
    """Locate the detector model: repo models/install (dev) or ~/.qbcam/models
    (installed by model-manager)."""
    bases = [
        Path(__file__).resolve().parents[4] / "models" / "install",
        Path.home() / ".qbcam" / "models",
        Path.home() / "Library" / "Application Support" / "QBCAM" / "models",
    ]
    for base in bases:
        if not base.exists():
            continue
        for f in sorted(base.rglob("*.onnx")):
            if "yunet" in f.name.lower():
                return str(f)
    return ""
