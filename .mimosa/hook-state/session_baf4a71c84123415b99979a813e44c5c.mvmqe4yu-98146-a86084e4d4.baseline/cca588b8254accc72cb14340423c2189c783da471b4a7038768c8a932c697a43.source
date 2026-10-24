"""Detector smoke test — skips if the YuNet model isn't installed.

Runs the real ONNX model on a synthetic frame; asserts the ORT session loads
and inference executes (detection count is not asserted — synthetic blobs are
not guaranteed to be detected; golden-frame detection tests use real fixtures).
"""

from pathlib import Path

import pytest

from qb_vision.pipeline.detect import YuNetDetector, load_model_path
from tests.conftest import make_face_frame

MODEL = load_model_path()


@pytest.mark.skipif(not MODEL, reason="YuNet model not installed (run bun run models:dev)")
def test_yunet_session_loads_and_runs():
    det = YuNetDetector(MODEL)
    assert det._det is not None
    frame = make_face_frame()[..., :3]
    dets = det.detect(frame)
    assert isinstance(dets, list)
    for d in dets:
        assert 0 < d.score <= 1.0
        assert len(d.landmarks) == 10
        assert d.box[2] > 0 and d.box[3] > 0


def test_model_path_search_finds_repo_install():
    p = load_model_path()
    assert p == "" or Path(p).exists()
