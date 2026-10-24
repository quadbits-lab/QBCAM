# ADR-002 — Hot path outside JavaScript

**Status:** Accepted

## Decision
Frames flow capture → inference → virtual camera entirely between native
(Rust) and Python processes over POSIX shared-memory ring buffers. Bun /
Electrobun is control plane only: JSON-RPC over UDS plus a low-resolution
JPEG preview WebSocket (spec §4, §10.2).

## Rationale
GC pauses, event-loop scheduling, and per-frame serialization in JS make a
33 ms glass-to-glass budget unreliable. The measured baseline (this repo's
integration runs) shows ~44–47 FPS at 720p with Bun handling zero frame
bytes. TypeScript touches frames only for diagnostics via `bun:ffi`
(never on the hot path).

## Consequences
- The ring layout (`packages/shm/SPEC.md`) is a cross-language contract with
  mirror implementations (Rust, Python) and tests in both.
- Dev sandboxes that scope POSIX shm per process tree will pass unit tests
  but fail cross-process integrations; integrations must run unsandboxed
  (documented in `tools/scripts/integration-live.ts`).
