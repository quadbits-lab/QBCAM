"""Ring probe: attach to a QBCAM ring and print one summary line.
Args: <ring-name> [policy] — used by integration tests (args only, no eval)."""

import sys

sys.path.insert(0, "/Users/quadbits/RD/QBCAM/packages/shm/py")

from qbcam_shm import RingReader  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: ring_probe.py <ring-name> [policy]")
        return 2
    name = sys.argv[1]
    policy = sys.argv[2] if len(sys.argv) > 2 else "latest"
    r = RingReader(name, 0, policy)
    got = r.read()
    if got is None:
        print("NO FRAME")
        return 1
    meta, px = got
    print(f"OK seq={meta.seq} w={r.info.width} h={r.info.height} bytes={len(px)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
