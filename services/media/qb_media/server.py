"""qb-media sidecar server: thumbnails, provenance signing, stills."""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from pathlib import Path

import cv2
from PIL import Image

from .provenance import validate_asset_path, write_xmp_sidecar
from .sidecar import SidecarServer


class MediaService:
    def __init__(self) -> None:
        socket_path = os.environ["QB_SOCKET"]
        token = os.environ["QB_TOKEN"]
        self.server = SidecarServer(socket_path, token)
        self._register()

    def _register(self) -> None:
        s = self.server

        def _thumbnail(params: dict) -> dict:
            src = validate_asset_path(params["path"])
            out_dir = Path.home() / ".qbcam" / "cache" / "thumbs"
            out_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = out_dir / f"{src.stem}-{hash(src.name) & 0xFFFFFFFF:08x}.jpg"
            img = Image.open(src)
            img.thumbnail((320, 320))
            img.convert("RGB").save(thumb_path, "JPEG", quality=85)
            return {"thumbPath": str(thumb_path)}

        def _sign(params: dict) -> dict:
            path = validate_asset_path(params["path"])
            if not path.exists():
                raise ValueError(f"asset not found: {path}")
            sidecar = write_xmp_sidecar(
                str(path),
                face_swap=bool(params.get("faceSwap", True)),
                consent_recorded=True,
            )
            return {"signed": True, "sidecarPath": sidecar}

        def _still(params: dict) -> dict:
            """Capture stills from a ring (single/burst/timer)."""
            from qbcam_shm import RingReader

            ring_name = params.get("ringOut") or params.get("ringIn")
            if not ring_name:
                raise ValueError("ringOut required for still.capture")
            mode = params.get("mode", "single")
            count = int(params.get("count", 1))
            interval_ms = int(params.get("intervalMs", 500))
            fmt = params.get("format", "png")
            out_dir = Path(params.get("outputDir", str(Path.home() / "QBCAM" / "Snapshots"))).resolve()
            out_dir.mkdir(parents=True, exist_ok=True)

            reader = RingReader(ring_name, 0, "latest")
            paths: list[str] = []
            n = count if mode in ("burst", "timer") else 1
            if mode == "timer":
                time.sleep(max(0, (int(params.get("countdownMs", 3000))) / 1000))
            for i in range(n):
                deadline = time.perf_counter() + 2.0
                frame = None
                while time.perf_counter() < deadline:
                    got = reader.read()
                    if got is not None:
                        frame = got[1]
                        break
                    time.sleep(0.005)
                if frame is None:
                    break
                h, w = reader.info.height, reader.info.width
                img = frame.reshape(h, w, 4)[:, :, :3]
                ext = {"png": ".png", "jpeg": ".jpg", "webp": ".webp"}[fmt]
                out = out_dir / f"snapshot-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}-{i}{ext}"
                if fmt == "png":
                    cv2.imwrite(str(out), img)
                else:
                    cv2.imwrite(str(out), img, [cv2.IMWRITE_JPEG_QUALITY, 95] if fmt == "jpeg" else [cv2.IMWRITE_WEBP_QUALITY, 95])
                paths.append(str(out))
            signed = False
            for p in paths:
                write_xmp_sidecar(p, face_swap=True, consent_recorded=True)
                signed = True
            return {"paths": paths, "signed": signed}

        s.method("media.thumbnail", _thumbnail)
        s.method("media.sign", _sign)
        s.method("still.capture", _still)

    def serve(self) -> None:
        self.server.serve()


def main() -> None:
    MediaService().serve()


if __name__ == "__main__":
    main()
