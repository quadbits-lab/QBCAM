# QBCAM shared-memory ring buffer — binary layout (spec §10.2)

Segment name: `qbcam.<session>.<ring>` (e.g. `qbcam.7f3a.frames.in`)

```
┌────────────────────────── Header: 256 bytes ──────────────────────────┐
│ offset  size  field                                                   │
│ 0       4     magic        u32   0x51424D31 ("QBM1")                  │
│ 4       4     version      u32   (1)                                  │
│ 8       4     slots        u32   (default 4)                          │
│ 12      4     slotBytes    u32   bytes per slot (header+pixels)       │
│ 16      4     width        u32                                        │
│ 20      4     height       u32                                        │
│ 24      4     format       u32   (1=BGRA 2=NV12 3=RGB24)              │
│ 28      4     reserved                                                │
│ 32      8     writeSeq     u64   atomic, monotonic (starts at 0)      │
│ 40      64    readSeq[8]   u64   per-reader last-consumed seq         │
│ 104     152   reserved                                                │
├────────────────────────── Slot 0..N-1 ────────────────────────────────┤
│ slotHeader: 32 B { seq u64, ts_ns u64, flags u32, faceCount u32 }     │
│ pixels:     slotBytes - 32                                            │
└───────────────────────────────────────────────────────────────────────┘
```

## Protocol

- **Write**: `seq = fetch_add(writeSeq, 1) + 1` → fill `slot[(seq-1) % N]` (write
  slotHeader with `seq` and `ts_ns` last) → `release-store writeSeq = seq`.
- **Read (latest-frame-wins, live)**: `acquire-load writeSeq` → if `> readSeq[r]`,
  read `slot[writeSeq-1 % N]` (the newest complete slot) → `readSeq[r] = seq`.
  Stale frames are skipped, never queued.
- **Read (no-drop, recorder/offline)**: poll until `writeSeq > readSeq[r]`, then
  consume **every** seq in order (blocking). Used by qb-recorder and batch jobs.
- Reader index `r` is assigned at attach time (0..7). Readers must stop consuming
  once they fall more than `N-1` slots behind the writer (overwrite detection via
  `slot.seq != expected`), then resync to latest.
- A slot's `seq` field is the completeness marker: read it with acquire after the
  payload; if it doesn't match the writer's expected seq, the slot was overwritten
  mid-read — resync.

## Wake-ups

`eventfd` (Linux) · named event object (Windows) · `dispatch_semaphore`/kqueue
(macOS). v0 uses polling with `std::thread::sleep(1ms)` in the Rust readers;
wake-up integration is a tracked follow-up.

## Implementations

| Lang | Location | Notes |
|---|---|---|
| Rust | `packages/shm/crate` | hot path — camio writer, recorder/vcam readers |
| Python | `services/vision/qb_vision/rshm.py` | `mmap` + `numpy` views, atomics via `ctypes` |
| TypeScript | `packages/shm/ts/reader.ts` | `bun:ffi`, diagnostics only — never on the hot path |
