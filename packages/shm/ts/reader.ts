/**
 * SHM ring diagnostics — packages/shm/SPEC.md.
 *
 * `parseRingHealth` is pure and hermetically testable. `RingDiag` attaches to
 * a live ring via bun:ffi for real diagnostics; note that POSIX shm attach
 * across processes can be blocked by developer sandboxes (seatbelt) — the
 * production app runs unsandboxed, where this works normally.
 *
 * Diagnostics only (spec §10.2): never on the hot path.
 */
import { dlopen, suffix, toBuffer } from "bun:ffi";

export const HEADER_BYTES = 256;
export const SLOT_HEADER_BYTES = 32;
export const MAGIC = 0x51_42_4d_31; // "QBM1"

export interface RingHealth {
  name: string;
  slots: number;
  slotBytes: number;
  width: number;
  height: number;
  format: number;
  writeSeq: number;
}

/** Parse a QBM1 header from the first 256 bytes. Throws on bad magic. */
export function parseRingHealth(dv: DataView, name: string): RingHealth {
  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)} — not a QBM1 ring`);
  return {
    name,
    slots: dv.getUint32(8, true),
    slotBytes: dv.getUint32(12, true),
    width: dv.getUint32(16, true),
    height: dv.getUint32(20, true),
    format: dv.getUint32(24, true),
    writeSeq: Number(dv.getBigUint64(32, true)),
  };
}

const lib = dlopen(`libc.${suffix}`, {
  shm_open: { args: ["ptr", "i32", "i32"], returns: "i32" },
  munmap: { args: ["ptr", "usize"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
});

const O_RDWR = 0x2;
const PROT_READ_WRITE = 0x3;
const MAP_SHARED = 0x1;

function cstr(s: string) {
  return new TextEncoder().encode(`${s}\0`);
}

export class RingDiag {
  private dv: DataView | null = null;
  private mapped: { p: unknown; len: number } | null = null;
  readonly name: string;

  constructor(name: string, windowBytes = 1024 * 1024) {
    this.name = name;
    const fd = lib.symbols.shm_open(cstr(name), O_RDWR, 0o600);
    if (fd < 0) throw new Error(`cannot open ring ${name} (errno ${fd})`);
    const p = lib.symbols.mmap(null, windowBytes, PROT_READ_WRITE, MAP_SHARED, fd, 0);
    lib.symbols.close(fd);
    if (Number(p.valueOf()) <= 0) throw new Error(`mmap failed for ${name}`);
    this.dv = new DataView(toBuffer(p, 0, windowBytes).buffer);
    this.mapped = { p, len: windowBytes };
  }

  health(): RingHealth {
    if (!this.dv) throw new Error("closed");
    return parseRingHealth(this.dv, this.name);
  }

  close() {
    if (this.mapped) {
      // p is an unknown-typed FFI pointer; pass through as-is
      lib.symbols.munmap(this.mapped.p as never, this.mapped.len);
      this.mapped = null;
    }
    this.dv = null;
  }
}
