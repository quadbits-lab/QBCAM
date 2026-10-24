/**
 * SHM ring diagnostics reader — packages/shm/SPEC.md via bun:ffi.
 * Diagnostics only (spec §10.2): this must never sit on the hot path; it
 * exists so qb-core can report ring health (writeSeq, slots, dims).
 * POSIX (macOS/Linux) only.
 */
import { dlopen, suffix, toBuffer } from "bun:ffi";

export const HEADER_BYTES = 256;
export const SLOT_HEADER_BYTES = 32;
export const MAGIC = 0x51_42_4d_31; // "QBM1"

const lib = dlopen(`libc.${suffix}`, {
  shm_open: { args: ["ptr", "i32", "i32"], returns: "i32" },
  shm_unlink: { args: ["ptr"], returns: "i32" },
  ftruncate: { args: ["i32", "i64"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  munmap: { args: ["ptr", "usize"], returns: "i32" },
});

const O_RDWR = 0x2;
const PROT_READ_WRITE = 0x3;
const MAP_SHARED = 0x1;
const CREAT_FLAG = process.platform === "darwin" ? 0x200 : 0x40;

function cstr(s: string) {
  return new TextEncoder().encode(`${s}\0`);
}

export interface RingHealth {
  name: string;
  slots: number;
  slotBytes: number;
  width: number;
  height: number;
  format: number;
  writeSeq: number;
}

export class RingDiag {
  private dv: DataView | null = null;
  readonly win: number;
  readonly name: string;

  /** Attach for diagnostics. Throws if the ring doesn't exist. */
  constructor(name: string, windowBytes = 1024 * 1024) {
    this.name = name;
    this.win = windowBytes;
    const fd = lib.symbols.shm_open(cstr(name), O_RDWR, 0o600);
    if (fd < 0) throw new Error(`cannot open ring ${name}`);
    const p = lib.symbols.mmap(null, windowBytes, PROT_READ_WRITE, MAP_SHARED, fd, 0);
    lib.symbols.close(fd);
    if (Number(p.valueOf()) <= 0) throw new Error(`mmap failed for ${name}`);
    this.dv = new DataView(toBuffer(p, 0, windowBytes).buffer);
  }

  private u32(off: number): number {
    return this.dv!.getUint32(off, true);
  }

  health(): RingHealth {
    if (this.u32(0) !== MAGIC) throw new Error("bad magic — not a QBM1 ring");
    return {
      name: this.name,
      slots: this.u32(8),
      slotBytes: this.u32(12),
      width: this.u32(16),
      height: this.u32(20),
      format: this.u32(24),
      writeSeq: Number(this.dv!.getBigUint64(32, true)),
    };
  }

  close() {
    this.dv = null;
  }
}
