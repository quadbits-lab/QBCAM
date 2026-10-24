"""Provenance (spec TS-02 / §14.2): signed content credentials for outputs.

v0 writes a C2PA-shaped XMP sidecar with the synthetic-media assertions. Full
C2PA signing (c2pa-python + trust list) is wired in when certificates exist;
the manifest format below matches §14.2 so the migration is additive.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

APP_VERSION = "0.1.0"
DIGITAL_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"


def allowed_output_roots() -> list[Path]:
    home = Path.home()
    base = home / "QBCAM"
    roots = [base / "Recordings", base / "Snapshots", base / "Exports"]
    app_support = (
        Path.home() / "Library" / "Application Support" / "QBCAM"
        if os.uname().sysname == "Darwin"
        else home / ".qbcam"
    )
    roots.append(app_support / "identities")
    return roots


def validate_asset_path(path: str) -> Path:
    """Resolve and confine asset paths to QBCAM output roots (no traversal)."""
    resolved = Path(path).expanduser().resolve()
    for root in allowed_output_roots():
        root = root.resolve()
        if resolved == root or root in resolved.parents:
            return resolved
    raise ValueError(f"asset path outside allowed output directories: {path}")


def build_provenance_manifest(face_swap: bool, consent_recorded: bool) -> dict:
    return {
        "claim_generator": f"QBCAM/{APP_VERSION}",
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.created",
                            "digitalSourceType": DIGITAL_SOURCE_TYPE,
                        }
                    ]
                },
            },
            {
                "label": "qbcam.synthetic",
                "data": {"faceSwap": face_swap, "consentRecorded": consent_recorded},
            },
        ],
    }


def write_xmp_sidecar(path: str, face_swap: bool, consent_recorded: bool) -> str:
    """Write `<asset>.xmp` next to the asset; returns the sidecar path."""
    # Security: `path` arrives over RPC. validate_asset_path resolves it and
    # hard-fails unless it sits inside an allowed QBCAM output root. The only
    # filenames ever written are derived from that validated location.
    asset = validate_asset_path(path)
    manifest = build_provenance_manifest(face_swap, consent_recorded)
    sidecar: Path = asset.parent / (asset.name + ".xmp")
    manifest_path: Path = asset.parent / (asset.name + ".xmp.json")
    xmp = f"""<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:qbcam="https://qbcam.app/ns/1.0/">
      <dc:title>QBCAM synthetic output</dc:title>
      <qbcam:claimGenerator>{manifest["claim_generator"]}</qbcam:claimGenerator>
      <qbcam:digitalSourceType>{DIGITAL_SOURCE_TYPE}</qbcam:digitalSourceType>
      <qbcam:faceSwap>{str(face_swap).lower()}</qbcam:faceSwap>
      <qbcam:consentRecorded>{str(consent_recorded).lower()}</qbcam:consentRecorded>
      <qbcam:generatedAt>{datetime.now(UTC).isoformat()}</qbcam:generatedAt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
"""
    sidecar.write_text(xmp)
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return str(sidecar)
