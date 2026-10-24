"""Face tracker — IoU/centroid matching with stable track IDs and EMA
smoothing of landmarks (spec §7.2). Runs between detection frames."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Track:
    track_id: int
    box: tuple[int, int, int, int]
    landmarks: tuple[float, ...]
    score: float
    age: int = 0
    missed: int = 0
    _ema: tuple[float, ...] = field(default=())


class IoUTracker:
    def __init__(self, max_age: int = 5, iou_match: float = 0.3, ema_alpha: float = 0.4) -> None:
        self.max_age = max_age
        self.iou_match = iou_match
        self.ema_alpha = ema_alpha
        self._next_id = 1
        self.tracks: list[Track] = []

    def update(self, detections: list[tuple[tuple[int, int, int, int], tuple[float, ...], float]]) -> list[Track]:
        matched = set()
        for track in self.tracks:
            best_iou, best_det = 0.0, None
            for i, (box, lm, score) in enumerate(detections):
                if i in matched:
                    continue
                v = _iou(track.box, box)
                if v > best_iou:
                    best_iou, best_det = v, i
            if best_det is not None and best_iou >= self.iou_match:
                box, lm, score = detections[best_det]
                matched.add(best_det)
                track.box = box
                track.landmarks = _ema_tuple(track._ema, lm, self.ema_alpha) if track._ema else lm
                track._ema = track.landmarks
                track.score = score
                track.age += 1
                track.missed = 0
            else:
                track.missed += 1
        self.tracks = [t for t in self.tracks if t.missed <= self.max_age]
        for i, (box, lm, score) in enumerate(detections):
            if i not in matched:
                self.tracks.append(
                    Track(
                        track_id=self._next_id,
                        box=box,
                        landmarks=lm,
                        score=score,
                        _ema=lm,
                    )
                )
                self._next_id += 1
        return self.tracks


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def _ema_tuple(prev: tuple[float, ...], cur: tuple[float, ...], alpha: float) -> tuple[float, ...]:
    return tuple(p * (1 - alpha) + c * alpha for p, c in zip(prev, cur))
