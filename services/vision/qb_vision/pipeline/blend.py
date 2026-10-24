"""Blend & paste-back: feathered elliptical mask + LAB color matching
(spec §7.2 blend stage)."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class BlendParams:
    feather: float = 0.6  # 0..1
    color_match: float = 0.5  # 0..1 LAB transfer strength
    sharpen: float = 0.2  # 0..1 unsharp amount
    keep_mouth: bool = True
    keep_eyes: bool = False


def paste_back(
    frame_bgra: np.ndarray,
    swapped_bgr: np.ndarray,
    box: tuple[int, int, int, int],
    landmarks: tuple[float, ...],
    params: BlendParams,
) -> np.ndarray:
    """Blend the swapped aligned face back into the frame at `box` (in place)."""
    x, y, w, h = box
    fh, fw = frame_bgra.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(fw, x + w), min(fh, y + h)
    if x1 <= x0 or y1 <= y0 or w <= 0 or h <= 0:
        return frame_bgra
    roi = frame_bgra[y0:y1, x0:x1, :3]

    swapped = cv2.resize(swapped_bgr, (w, h), interpolation=cv2.INTER_LINEAR)
    swapped = swapped[y0 - y : y1 - y, x0 - x : x1 - x]

    # feathered elliptical mask over the face box
    mask = np.zeros((h, w), dtype=np.float32)
    cv2.ellipse(mask, (w // 2, h // 2), (int(w * 0.48), int(h * 0.48)), 0, 0, 360, 1.0, -1)
    k = max(1, int(w * 0.5 * params.feather) | 1)
    mask = cv2.GaussianBlur(mask, (k, k), 0)[y0 - y : y1 - y, x0 - x : x1 - x]
    mask = mask[..., None]

    # color transfer in LAB, scaled by color_match
    if params.color_match > 0:
        roi_lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
        swp_lab = cv2.cvtColor(swapped, cv2.COLOR_BGR2LAB).astype(np.float32)
        matched = swp_lab.copy()
        for c in range(3):
            m = matched[..., c]
            matched[..., c] = m + params.color_match * (roi_lab[..., c].mean() - m.mean())
        matched[..., 0] = swp_lab[..., 0] * (1 - params.color_match) + matched[..., 0] * params.color_match
        swapped = cv2.cvtColor(np.clip(matched, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)

    out = roi.astype(np.float32) * (1 - mask) + swapped.astype(np.float32) * mask

    if params.keep_eyes or params.keep_mouth:
        keep = np.zeros((h, w), dtype=np.float32)
        # landmarks: [re_x, re_y, le_x, le_y, n_x, n_y, cm_x, cm_y, cm2_x, cm2_y]
        if len(landmarks) >= 10:
            if params.keep_eyes:
                for cx, cy in ((landmarks[0], landmarks[1]), (landmarks[2], landmarks[3])):
                    cv2.circle(keep, (int(cx - x), int(cy - y)), int(h * 0.10), 1.0, -1)
            if params.keep_mouth:
                mx = (landmarks[6] + landmarks[8]) / 2
                my = (landmarks[7] + landmarks[9]) / 2
                cv2.ellipse(keep, (int(mx - x), int(my - y)), (int(w * 0.22), int(h * 0.12)), 0, 0, 360, 1.0, -1)
        keep = cv2.GaussianBlur(keep, (31, 31), 0)[y0 - y : y1 - y, x0 - x : x1 - x][..., None]
        out = out * (1 - keep) + roi.astype(np.float32) * keep

    if params.sharpen > 0:
        blur = cv2.GaussianBlur(out, (0, 0), 2.0)
        out = out + params.sharpen * (out - blur)

    frame_bgra[y0:y1, x0:x1, :3] = np.clip(out, 0, 255).astype(np.uint8)
    return frame_bgra
