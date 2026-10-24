# QBCAM

Real-time AI face swap, virtual webcam & studio recorder for the desktop —
implemented from the v0.1.0 development specification.

**Status: vertical slice complete (≈ M1 + most of M2 + recording from M4).**
The full live pipeline runs at **44–47 FPS @ 720p** end-to-end on Apple
silicon: capture → shared-memory ring → detection/swap pipeline → recorder +
virtual-camera sink, with the Studio UI driving it in a browser at 47 FPS.

![pipeline](https://img.shields.io/badge/pipeline-44--47_FPS_720p-34D399)

## Architecture

```
📷 camera / fake ──▶ qb-camio (Rust) ──shm ring──▶ qb-vision (Python, YuNet + swap)
                                                      │            └─shm ring─┐
                                                      ▼ preview WS (JPEG)     ▼
                                          🎨 Studio UI (React)          qb-recorder (Rust)
                                                                        qb-vcam (mock, M3 native)
        🧠 qb-core (Bun) — supervisor · JSON-RPC hub · SQLite · model-manager ─┘
```

Design principle (ADR-002): **the hot path stays out of JavaScript** — frames
flow between Rust and Python over POSIX shared memory; Bun is control plane
only. See `docs/adr/` for all ten decisions.

## Layout

| Path | What |
|---|---|
| `apps/desktop` | qb-core (Bun main) + Studio web UI (React/Tailwind/Zustand) |
| `packages/contracts` | TypeBox schemas → JSON Schema → Pydantic (codegen + drift guard) |
| `packages/shm` | Shared-memory ring spec + Rust crate + Python mirror + TS diagnostics |
| `packages/ipc-rs` | Sidecar JSON-RPC/UDS (Rust reference) |
| `services/vision` | qb-vision: detect (YuNet) → track → swap (stub + BYO) → blend → fail-safe |
| `services/media` | qb-media: provenance (XMP/C2PA-shaped), stills, thumbnails |
| `services/camio` | qb-camio: FFmpeg capture + synthetic fake camera → ring |
| `services/recorder` | qb-recorder: no-drop ring reader → fragmented MP4 (crash-safe) |
| `services/vcam` | qb-vcam-mock (§8.2 contract) + per-OS native stubs (M3) |
| `edge/` | manifest-worker (signed) + telemetry-worker (schema-allowlisted) |
| `models/` | registry.json (metadata only — **weights are never committed**) |
| `tools/` | integrations, bench, fixtures, sign-manifest, license gate |

## Quick start (macOS, Apple Silicon)

```bash
# 1. Prereqs: bun, uv, rust (cargo), ffmpeg
brew install oven-sh/bun/bun uv ffmpeg && curl --proto '=https' -tlsv1.2 -sSf https://sh.rustup.rs | sh
# optional, for the native window: Hutch (Electrobun's build CLI)
curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh

# 2. Install everything
bun install
uv sync --all-packages
cargo build --workspace

# 3. Fetch the dev detector (Apache-2.0, ~230 KB) & stamp hashes
bun run models:dev

# 4a. Run the app (headless shell → browser)
bun run dev            # prints http://127.0.0.1:<port> (token included)
# → first-run onboarding → Studio → Start Pipeline → live preview

# 4b. Or run the native Electrobun window (Hutch + system webview)
bun run dev:desktop    # prepares .hutch/devkit, builds Studio, opens the QBCAM window
                       # first run downloads the pinned Electrobun 2.0.4 devkit

# 5. Quality gates
bun run lint && bun run test          # TS: hub, supervisor, store, shm parser
bun run test:py                       # vision, media, shm-mirror suites
bun run test:rs                       # ring buffer, fake camera
bun run drift:guard                   # contracts codegen is committed & clean
bun run license:gate                  # §13.3 — no non-commercial weights bundled

# 6. Cross-process integrations (run unsandboxed — POSIX shm scoping)
bun run tools/scripts/integration-live.ts     # camio → vision → ring, fps gate
bun run tools/scripts/integration-record.ts   # + recorder (ffprobe-validated) + vcam
```

Output artifacts land in `~/QBCAM/{Recordings,Snapshots,Exports}` with XMP
provenance sidecars. App data lives under
`~/Library/Application Support/QBCAM` (macOS) / `~/.qbcam` (Linux/Windows).

## First run (onboarding)

Studio is gated until setup completes:

1. **Consent** — acceptable-use attestation.
2. **Permissions** — camera/mic cards; the probe raises the macOS TCC prompt.
3. **Camera & mic** — real stills from the ffmpeg capture path, mic level meter,
   device pickers, or “continue without a camera” (synthetic source).
4. **Models** — detector install (required) + optional BYO swap ONNX.
5. **Source face** — optional identity import with consent.
6. **Ready** — readiness checklist, then Open Studio.

Re-run setup from **Settings → Run setup again**. For headless/CI runs,
`QBCAM_ALLOW_UNONBOARDED=1` bypasses the `startPipeline` gate.

### macOS permissions

The build hook adds `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`
to the app bundle (dev and release). If a stale denial survives a dev rebuild:

```bash
bun run --cwd apps/desktop permissions:reset   # tccutil reset Camera/Microphone
# restart the app, then approve the prompt again
```

## Trust & safety rails (spec §14 — implemented)

- **TS-01 consent gate**: identities are unusable without a timestamped
  attestation; enforced in the hub and the DB, surfaced in the UI.
- **TS-02 provenance**: recordings/snapshots get non-removable sidecars
  declaring `trainedAlgorithmicMedia`.
- **TS-03 honest device**: "QBCAM Virtual Camera", fixed vendor string.
- **TS-04 synthetic badge**: in-stream `SYNTHETIC MEDIA` marker whenever the
  pipeline runs.
- **FR-109 / ADR-009 fail-safe**: stall → slate (never raw passthrough).
- **§13.3 license gate**: release blocker for non-commercial weights;
  swap models are bring-your-own with explicit license acceptance.

## What's implemented vs. deferred

Implemented: contracts + codegen + drift guard · SHM ring (3 languages) ·
supervisor (restart/backoff/heartbeat) · JSON-RPC/UDS ×3 languages ·
YuNet detection + tracking + stub/BYO swap + blend + adaptive governor ·
preview WS · recorder (ffprobe-validated MP4) · vcam mock contract ·
provenance · model-manager with signed manifests · Studio UI (browser-
verified) · Electrobun window shell (Hutch 2.x, system webview) ·
edge workers (wrangler-dev verified) · CI.

Deferred (documented in the spec): native per-OS virtual cameras (M3),
installers/notarization (M6–M7), audio recording, NSFW/age classifiers
(TS-07/08), Windows/Linux runtime verification. See `docs/compat.md` for the
client matrix state.
