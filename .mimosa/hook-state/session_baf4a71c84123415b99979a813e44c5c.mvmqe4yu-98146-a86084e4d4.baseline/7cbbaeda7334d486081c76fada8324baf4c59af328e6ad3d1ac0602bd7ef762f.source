"""QBCAM shared-memory ring buffer — Python mirror (spec §10.2 / SPEC.md).

This mirrors the Rust implementation in ``packages/shm/crate`` byte-for-byte:
256-byte header, 32-byte slot headers, atomic monotonic ``writeSeq``.

Conventions:
- The **hot path** writer is always the Rust side (``qb-camio``). The Python
  writer exists for offline batch and tests; it uses relaxed stores which are
  safe for our single-producer/single-consumer polling pattern on the
  platforms we ship (see ADR-002).
- Readers acquire-load ``writeSeq`` and publish their per-reader ``readSeq``.

The ring is created via ``shm_open`` — on POSIX this is what
``multiprocessing.shared_memory.SharedMemory`` uses under the hood, so a Rust
``create_ring("/qbcam.x…")`` is attachable here by the same name and vice
versa.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import mmap
import os
import struct
import threading
from dataclasses import dataclass
from enum import IntEnum

import numpy as np

MAGIC = 0x51424D31  # "QBM1"
VERSION = 1
HEADER_BYTES = 256
SLOT_HEADER_BYTES = 32
MAX_READERS = 8

_OFF_MAGIC = 0
_OFF_VERSION = 4
_OFF_SLOTS = 8
_OFF_SLOT_BYTES = 12
_OFF_WIDTH = 16
_OFF_HEIGHT = 20
_OFF_FORMAT = 24
_OFF_WRITE_SEQ = 32
_OFF_READ_SEQ = 40

_HDR = "<IIIIIIII"  # magic, version, slots, slot_bytes, width, height, format, reserved
_SLOT_HDR = "<QQII"  # seq, ts_ns, flags, face_count


class PixelFormat(IntEnum):
    BGRA = 1
    NV12 = 2
    RGB24 = 3


@dataclass(frozen=True)
class RingInfo:
    name: str
    slots: int
    slot_bytes: int
    width: int
    height: int
    format: PixelFormat

    @property
    def pixels_per_slot(self) -> int:
        return self.slot_bytes - SLOT_HEADER_BYTES


@dataclass(frozen=True)
class FrameMeta:
    seq: int
    ts_ns: int
    flags: int
    face_count: int


_libc = None
_libc_lock = threading.Lock()


def _get_libc() -> ctypes.CDLL:
    global _libc
    with _libc_lock:
        if _libc is None:
            _libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)
            _libc.shm_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_uint32]
            _libc.shm_open.restype = ctypes.c_int
            _libc.shm_unlink.argtypes = [ctypes.c_char_p]
            _libc.shm_unlink.restype = ctypes.c_int
        return _libc


def _shm_open_posix(name: str, flags: int, mode: int) -> int:
    """shm_open via CPython's _posixshmem when present (battle-tested on
    macOS), else raw ctypes. NOTE: on sandboxed dev environments (e.g.
    seatbelt-scoped CI runners) POSIX shm objects may be scoped to the
    creating process tree; production runs unsandboxed."""
    try:
        import _posixshmem  # type: ignore[import-not-found]

        return _posixshmem.shm_open(name, flags, mode=mode)
    except ImportError:
        pass
    libc = _get_libc()
    fd = libc.shm_open(name.encode(), flags, mode)
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))
    return fd


def _shm_unlink_posix(name: str) -> None:
    try:
        import _posixshmem  # type: ignore[import-not-found]

        _posixshmem.shm_unlink(name)
        return
    except ImportError:
        pass
    libc = _get_libc()
    if libc.shm_unlink(name.encode()) != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))


def create_ring(
    name: str,
    slots: int,
    slot_bytes: int,
    width: int,
    height: int,
    fmt: PixelFormat,
) -> RingInfo:
    """Create (or reuse) a ring identical to the Rust ``create_ring``."""
    if not 0 < slots <= 64:
        raise ValueError("slots must be 1..=64")
    cname = name if name.startswith("/") else f"/{name}"
    fd = _shm_open_posix(cname, os.O_CREAT | os.O_RDWR, 0o600)
    total = HEADER_BYTES + slots * slot_bytes
    try:
        os.ftruncate(fd, total)
        mm = mmap.mmap(fd, total)
    finally:
        os.close(fd)
    hdr = struct.pack(_HDR, MAGIC, VERSION, slots, slot_bytes, width, height, int(fmt), 0)
    if struct.unpack_from("<I", mm, _OFF_MAGIC)[0] != MAGIC:
        mm.seek(0)
        mm.write(bytes(total))
        mm.seek(0)
        mm.write(hdr)
        # writeSeq at 32 stays zero
    return RingInfo(cname, slots, slot_bytes, width, height, fmt)


def unlink_ring(name: str) -> None:
    cname = name if name.startswith("/") else f"/{name}"
    _shm_unlink_posix(cname)


class _Mapping:
    def __init__(self, name: str) -> None:
        cname = name if name.startswith("/") else f"/{name}"
        try:
            fd = _shm_open_posix(cname, os.O_RDWR, 0o600)
        except OSError as e:
            raise FileNotFoundError(e.errno, f"cannot attach ring {cname}: {e.strerror}") from e
        try:
            size = os.fstat(fd).st_size
            self.mm = mmap.mmap(fd, size)
        finally:
            os.close(fd)
        self.name = cname

    def close(self) -> None:
        self.mm.close()

    def info(self) -> RingInfo:
        magic, version, slots, slot_bytes, width, height, fmt, _ = struct.unpack_from(_HDR, self.mm, 0)
        if magic != MAGIC:
            raise ValueError(f"not a QBM1 ring: magic=0x{magic:08x}")
        return RingInfo(self.name, slots, slot_bytes, width, height, PixelFormat(fmt))


def _read_seq_u64(mm: mmap.mmap, off: int) -> int:
    return struct.unpack_from("<Q", mm, off)[0]


def _write_seq_u64(mm: mmap.mmap, off: int, val: int) -> None:
    struct.pack_into("<Q", mm, off, val)


class RingWriter:
    """Single-producer writer (Python side: offline batch & tests)."""

    def __init__(self, name: str) -> None:
        self._map = _Mapping(name)
        self._info = self._map.info()
        self._slots = self._info.slots
        self._slot_bytes = self._info.slot_bytes
        self._px_bytes = self._info.pixels_per_slot

    @property
    def info(self) -> RingInfo:
        return self._info

    def write_frame(self, pixels: np.ndarray | bytes, ts_ns: int, flags: int = 0, face_count: int = 0) -> int:
        buf = memoryview(pixels).cast("B") if not isinstance(pixels, np.ndarray) else pixels.tobytes()
        if len(buf) != self._px_bytes:
            raise ValueError(f"payload {len(buf)} != pixels_per_slot {self._px_bytes}")
        mm = self._map.mm
        seq = _read_seq_u64(mm, _OFF_WRITE_SEQ) + 1
        slot = (seq - 1) % self._slots
        base = HEADER_BYTES + slot * self._slot_bytes
        mm[base + SLOT_HEADER_BYTES : base + SLOT_HEADER_BYTES + self._px_bytes] = buf
        struct.pack_into("<QII", mm, base + 8, ts_ns, flags, face_count)  # ts, flags, faces
        struct.pack_into("<Q", mm, base, seq)  # completeness marker last
        _write_seq_u64(mm, _OFF_WRITE_SEQ, seq)
        return seq


class RingReader:
    """Reader. policy="latest" (live) or "nodrop" (recorder/offline)."""

    def __init__(self, name: str, reader_idx: int, policy: str = "latest") -> None:
        if not 0 <= reader_idx < MAX_READERS:
            raise ValueError("reader_idx must be 0..7")
        if policy not in ("latest", "nodrop"):
            raise ValueError("policy must be 'latest' or 'nodrop'")
        self._map = _Mapping(name)
        self._info = self._map.info()
        self._reader_idx = reader_idx
        self.policy = policy
        self._last_seq = _read_seq_u64(self._map.mm, _OFF_READ_SEQ + reader_idx * 8)

    @property
    def info(self) -> RingInfo:
        return self._info

    @property
    def last_seq(self) -> int:
        return self._last_seq

    def close(self) -> None:
        self._map.close()

    def _read_slot(self, seq: int) -> tuple[FrameMeta, np.ndarray] | None:
        mm = self._map.mm
        slot = (seq - 1) % self._info.slots
        base = HEADER_BYTES + slot * self._info.slot_bytes
        hdr_seq = _read_seq_u64(mm, base)
        if hdr_seq != seq:
            return None
        ts_ns, flags, face_count = struct.unpack_from("<QII", mm, base + 8)
        px = np.frombuffer(
            self._map.mm,
            dtype=np.uint8,
            count=self._info.pixels_per_slot,
            offset=base + SLOT_HEADER_BYTES,
        )
        if _read_seq_u64(mm, base) != seq:  # overwritten mid-read
            return None
        return FrameMeta(seq, ts_ns, flags, face_count), px.copy()

    def read(self) -> tuple[FrameMeta, np.ndarray] | None:
        mm = self._map.mm
        published = _read_seq_u64(mm, _OFF_WRITE_SEQ)
        if published <= self._last_seq:
            return None
        if self.policy == "latest":
            want = published
            got = self._read_slot(want)
            if got is None:
                return None
            self._last_seq = want
            _write_seq_u64(mm, _OFF_READ_SEQ + self._reader_idx * 8, want)
            return got
        # nodrop
        want = self._last_seq + 1
        if want > published:
            return None
        got = self._read_slot(want)
        if got is None:
            # Overwritten — too slow. Resync to latest (mirrors Rust behavior).
            latest = _read_seq_u64(mm, _OFF_WRITE_SEQ)
            got = self._read_slot(latest)
            if got is None:
                return None
            want = latest
        self._last_seq = want
        _write_seq_u64(mm, _OFF_READ_SEQ + self._reader_idx * 8, want)
        return got
