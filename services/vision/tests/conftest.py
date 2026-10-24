import numpy as np


def make_face_frame(width=320, height=240) -> np.ndarray:
    """Synthetic BGRA frame with a face-like blob (mirrors the Rust fake camera)."""
    frame = np.zeros((height, width, 4), dtype=np.uint8)
    # gradient background
    yy, xx = np.mgrid[0:height, 0:width]
    frame[..., 0] = (40 + 100 * xx / width).astype(np.uint8)
    frame[..., 1] = (40 + 80 * yy / height).astype(np.uint8)
    frame[..., 2] = 60
    frame[..., 3] = 255
    # face circle
    cx, cy, r = width // 2, int(height * 0.45), int(height * 0.28)
    mask = (xx - cx) ** 2 + (yy - cy) ** 2 < r**2
    frame[mask, 0] = 200
    frame[mask, 1] = 180
    frame[mask, 2] = 220
    # eyes + mouth
    eye_y = cy - int(r * 0.25)
    for ex in (cx - int(r * 0.4), cx + int(r * 0.4)):
        eye = (xx - ex) ** 2 + (yy - eye_y) ** 2 < (r * 0.15) ** 2
        frame[eye] = (30, 30, 30, 255)
    mouth = (np.abs(yy - (cy + int(r * 0.35))) < 3) & (np.abs(xx - cx) < r * 0.5)
    frame[mouth] = (30, 30, 30, 255)
    return frame
