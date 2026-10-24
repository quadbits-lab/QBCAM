import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from qb_media.provenance import (
    allowed_output_roots,
    build_provenance_manifest,
    validate_asset_path,
    write_xmp_sidecar,
)


def test_manifest_shape():
    m = build_provenance_manifest(face_swap=True, consent_recorded=True)
    assert m["claim_generator"].startswith("QBCAM/")
    actions = m["assertions"][0]["data"]["actions"]
    assert actions[0]["digitalSourceType"].endswith("trainedAlgorithmicMedia")
    assert m["assertions"][1]["data"] == {"faceSwap": True, "consentRecorded": True}


def test_sidecar_written_and_confined(tmp_path: Path, monkeypatch):
    # redirect allowed roots to tmp for the test
    monkeypatch.setattr(
        "qb_media.provenance.allowed_output_roots", lambda: [tmp_path]
    )
    asset = tmp_path / "snap.png"
    Image.fromarray(np.zeros((10, 10, 3), dtype=np.uint8)).save(asset)
    sidecar = write_xmp_sidecar(str(asset), face_swap=True, consent_recorded=True)
    assert sidecar.endswith(".xmp")
    text = Path(sidecar).read_text()
    assert "trainedAlgorithmicMedia" in text
    manifest = json.loads(Path(sidecar + ".json").read_text())
    assert manifest["claim_generator"].startswith("QBCAM/")


def test_path_traversal_blocked(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "qb_media.provenance.allowed_output_roots", lambda: [tmp_path]
    )
    with pytest.raises(ValueError, match="outside allowed"):
        write_xmp_sidecar(str(tmp_path.parent / "evil.png"), True, True)
    with pytest.raises(ValueError, match="outside allowed"):
        write_xmp_sidecar(str(Path.home() / ".ssh" / "id_rsa"), True, True)
