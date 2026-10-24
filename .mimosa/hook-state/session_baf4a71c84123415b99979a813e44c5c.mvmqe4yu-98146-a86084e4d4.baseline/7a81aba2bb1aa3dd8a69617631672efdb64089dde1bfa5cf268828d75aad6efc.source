"""Metrics (spec §19): stage timings, fps, p50/p95, dropped counts."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class Metrics:
    window: int = 120
    stage_ms: dict[str, deque] = field(default_factory=lambda: {})

    def record(self, stage: str, ms: float) -> None:
        if stage not in self.stage_ms:
            self.stage_ms[stage] = deque(maxlen=self.window)
        self.stage_ms[stage].append(ms)

    def percentile(self, stage: str, p: float) -> float:
        values = sorted(self.stage_ms.get(stage, ()))
        if not values:
            return 0.0
        return values[min(len(values) - 1, int(len(values) * p))]

    def summary(self) -> dict:
        return {
            stage: {
                "p50": round(self.percentile(stage, 0.5), 2),
                "p95": round(self.percentile(stage, 0.95), 2),
                "n": len(vals),
            }
            for stage, vals in self.stage_ms.items()
        }


class Timer:
    def __init__(self, metrics: Metrics, stage: str) -> None:
        self.metrics = metrics
        self.stage = stage

    def __enter__(self) -> "Timer":
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *exc) -> None:
        self.metrics.record(self.stage, (time.perf_counter() - self.t0) * 1000)
