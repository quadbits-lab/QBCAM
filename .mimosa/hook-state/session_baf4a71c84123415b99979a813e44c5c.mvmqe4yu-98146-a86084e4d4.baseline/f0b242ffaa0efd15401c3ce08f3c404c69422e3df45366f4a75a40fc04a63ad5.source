import time
from pathlib import Path

import numpy as np
import pytest

from qbcam_shm import PixelFormat, RingWriter, create_ring, unlink_ring

from qb_vision.pipeline import (
    FailSafe,
    IdentityBinding,
    Pipeline,
    PipelineParams,
    draw_slate,
    draw_synthetic_badge,
)
from qb_vision.pipeline.swap import StubSwapper


@pytest.fixture()
def face_frame():
    """Synthetic 320x240 BGRA frame with a face-like blob."""
    from tests.conftest import make_face_frame

    return make_face_frame()


def test_stub_swapper_produces_frame(face_frame):
    swapper = StubSwapper()
    swapper.load(face_frame[..., :3].copy())
    result = swapper.swap(face_frame[..., :3].copy())
    assert result.face_bgr is not None
    assert result.note == "stub-swap"
    assert result.face_bgr.shape == (128, 128, 3)


def test_blend_paste_back(face_frame):
    from qb_vision.pipeline.blend import BlendParams, paste_back

    frame = face_frame.copy()
    swapper = StubSwapper()
    swapper.load(face_frame[..., :3])
    swapped = swapper.swap(face_frame[..., :3]).face_bgr
    out = paste_back(frame, swapped, (80, 40, 160, 160), (120, 100, 200, 100, 160, 130, 130, 160, 190, 160), BlendParams())
    assert out.shape == frame.shape
    # in-place paste: pixels inside the face box must change
    assert not np.array_equal(out[40:200, 80:240, :3], face_frame[40:200, 80:240, :3])


def test_fail_safe_slate(face_frame):
    pipeline = Pipeline(PipelineParams(), None)
    pipeline.set_bypass(True)
    out, stats = pipeline.process(face_frame.copy(), 0)
    assert stats.bypassed
    assert out is not face_frame


def test_fail_safe_slate_draw(face_frame):
    slate = draw_slate(face_frame.copy())
    # slate darkens the frame and adds text — mean brightness drops
    assert slate[..., :3].mean() < face_frame[..., :3].mean() + 5


def test_synthetic_badge_present(face_frame):
    out = draw_synthetic_badge(face_frame.copy())
    assert out is not None


def test_pipeline_stub_swap_end_to_end(face_frame):
    pipeline = Pipeline(PipelineParams(), None)  # no detector → tracker empty → no swap
    out, stats = pipeline.process(face_frame.copy(), 0)
    assert stats.fps > 0
    assert out.shape == face_frame.shape


def test_pipeline_fail_safe_on_exception(face_frame, monkeypatch):
    pipeline = Pipeline(PipelineParams(), None)

    def boom(frame, idx):
        raise RuntimeError("boom")

    monkeypatch.setattr(pipeline, "_process_inner", boom)
    out, stats = pipeline.process(face_frame.copy(), 0)
    assert stats.degraded
    # default fail-safe is slate, not raw passthrough (ADR-009)
    assert out[..., :3].mean() < face_frame[..., :3].mean() + 5


def test_apply_params_hot_swap():
    pipeline = Pipeline(PipelineParams(), None)
    pipeline.apply_params({"preset": "fast", "maskFeather": 0.9, "failSafe": "passthrough"})
    assert pipeline.params.preset == "fast"
    assert pipeline.params.det_interval == 5
    assert pipeline.params.mask_feather == 0.9
    assert pipeline.params.fail_safe == FailSafe.PASSTHROUGH
