import { describe, expect, test } from "bun:test";
import { parseRingHealth } from "./reader.ts";

// Hermetic test of the header parser (SPEC.md byte layout). Live cross-process
// attach (Rust writer → TS/Python readers) is covered by integration runs,
// which must execute outside developer sandboxes that scope POSIX shm per
// process tree.

function synthHeader(): DataView {
  const slots = 4;
  const slotBytes = 32 + 64 * 48 * 4;
  const total = 256 + slots * slotBytes;
  const dv = new DataView(new ArrayBuffer(total));
  dv.setUint32(0, 0x51_42_4d_31, true); // magic QBM1
  dv.setUint32(4, 1, true); // version
  dv.setUint32(8, slots, true);
  dv.setUint32(12, slotBytes, true);
  dv.setUint32(16, 64, true); // width
  dv.setUint32(20, 48, true); // height
  dv.setUint32(24, 1, true); // format BGRA
  dv.setBigUint64(32, 42n, true); // writeSeq
  return dv;
}

describe("parseRingHealth", () => {
  test("parses a valid QBM1 header", () => {
    const h = parseRingHealth(synthHeader(), "/qbcam.test");
    expect(h.slots).toBe(4);
    expect(h.slotBytes).toBe(32 + 64 * 48 * 4);
    expect(h.width).toBe(64);
    expect(h.height).toBe(48);
    expect(h.format).toBe(1);
    expect(h.writeSeq).toBe(42);
  });

  test("rejects bad magic", () => {
    const dv = synthHeader();
    dv.setUint32(0, 0xdeadbeef, true);
    expect(() => parseRingHealth(dv, "/x")).toThrow("bad magic");
  });
});
