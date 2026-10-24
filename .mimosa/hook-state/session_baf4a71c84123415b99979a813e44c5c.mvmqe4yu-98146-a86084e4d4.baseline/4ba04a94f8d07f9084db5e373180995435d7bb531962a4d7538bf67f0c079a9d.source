import numpy as np
import pytest

from qbcam_shm import PixelFormat, RingReader, RingWriter, create_ring, unlink_ring

W, H = 32, 24
FRAME = W * H * 4  # BGRA
SLOT = 32 + FRAME


@pytest.fixture()
def ring():
    name = f"/qbcam.pytest.{np.random.default_rng().integers(2**63):x}"
    create_ring(name, 8, SLOT, W, H, PixelFormat.BGRA)
    yield name
    try:
        unlink_ring(name)
    except OSError:
        pass


def test_header_fields(ring):
    from qbcam_shm import _Mapping

    m = _Mapping(ring)
    info = m.info()
    assert info.slots == 8
    assert info.width == W
    assert info.height == H
    assert info.format == PixelFormat.BGRA
    m.close()


def test_write_latest_read(ring):
    w = RingWriter(ring)
    r = RingReader(ring, 0, "latest")
    px = np.arange(FRAME, dtype=np.uint8) % 255
    for i in range(5):
        w.write_frame(px, i * 33_000_000, face_count=1)
    meta, got = r.read()
    assert meta.seq == 5
    assert meta.face_count == 1
    assert np.array_equal(got, px)
    assert r.read() is None


def test_nodrop_in_order(ring):
    w = RingWriter(ring)
    r = RingReader(ring, 1, "nodrop")
    for i in range(6):
        px = np.full(FRAME, i, dtype=np.uint8)
        w.write_frame(px, 0)
        meta, _ = r.read()
        assert meta.seq == i + 1
        assert px[0] == i


def test_wrong_size_rejected(ring):
    w = RingWriter(ring)
    with pytest.raises(ValueError, match="pixels_per_slot"):
        w.write_frame(np.zeros(10, dtype=np.uint8), 0)


def test_wrong_magic_rejected():
    from qbcam_shm import _Mapping

    with pytest.raises((ValueError, FileNotFoundError)):
        _Mapping("/qbcam.pytest.does-not-exist-zz")
