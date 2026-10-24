import { describe, expect, test } from "bun:test";
import { dlopen, suffix, toBuffer } from "bun:ffi";
import { RingDiag } from "./reader.ts";

// Standalone header validation through the same FFI plumbing the diag reader
// uses: synthesize a QBM1 ring byte-for-byte per SPEC.md, then parse it with
// RingDiag. Cross-language (Rust writer → TS/Python readers) is covered by the
// qbcam-shm crate tests and the P5 integration run.

const lib = dlopen(`libc.${suffix}`, {
  shm_open: { args: ["ptr", "i32", "i32"], returns: "i32" },
  ftruncate: { args: ["i32", "i64"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  munmap: { args: ["ptr", "usize"], returns: "i32" },
});

const CREAT_FLAG = process.platform === "darwin" ? 0x200 : 0x40;

describe("RingDiag", () => {
  test("reads header of a synthesized QBM1 ring", () => {
    const name = `/qbcam.tstest.${Date.now()}`;
    const fd = lib.symbols.shm_open(new TextEncoder().encode(`${name}\0`), 0x2 | CREAT_FLAG, 0o600);
    expect(fd).toBeGreaterThanOrEqual(0);

    const slots = 4;
    const slotBytes = 32 + 64 * 48 * 4;
    const total = 256 + slots * slotBytes;
    expect(lib.symbols.ftruncate(fd, total)).toBe(0);
    const p = lib.symbols.mmap(null, total, 0x3, 0x1, fd, 0);
    expect(Number(p.valueOf())).toBeGreaterThan(0);

    // header per SPEC.md: magic, version, slots, slotBytes, w, h, fmt, rsvd, writeSeq
    const buf = toBuffer(p, 0, total);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setUint32(0, 0x51_42_4d_31, true);
    dv.setUint32(4, 1, true);
    dv.setUint32(8, slots, true);
    dv.setUint32(12, slotBytes, true);
    dv.setUint32(16, 64, true);
    dv.setUint32(20, 48, true);
    dv.setUint32(24, 1, true);
    dv.setBigUint64(32, 42n, true);
    lib.symbols.close(fd);

    const diag = new RingDiag(name);
    const h = diag.health();
    expect(h.slots).toBe(4);
    expect(h.width).toBe(64);
    expect(h.height).toBe(48);
    expect(h.format).toBe(1);
    expect(h.writeSeq).toBe(42);
    diag.close();
    lib.symbols.munmap(p, total);
  });
});
