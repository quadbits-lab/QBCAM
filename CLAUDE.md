# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

QBCAM is a real-time face-swap / virtual-webcam / recorder desktop app: a polyglot monorepo (Bun/TypeScript + Rust + Python). See `README.md` for the feature/status overview, `docs/compat.md` for the virtual-camera client matrix (mock vcam only today), and `docs/adr/` for the ten architectural decisions.

## Commands

Toolchain: `bun`, `uv`, `cargo`, `ffmpeg`.

```bash
# clean checkout setup
bun install && uv sync --all-packages && cargo build --workspace && bun run models:dev
bun run --cwd apps/desktop/src/views/studio build   # required once — see Studio UI note

bun run dev                 # qb-core + headless shell; prints http://127.0.0.1:<port> (token included)
bun run dev:desktop         # Electrobun window shell via hutch (builds the Studio UI first)
bun run lint                # biome check . (TS)   |  bun run lint:py  -> ruff check services tools
bun run fmt                 # biome --write + ruff format
bun run typecheck           # tsc -b
bun run test                # bun test — apps/desktop/tests + packages/shm/ts
bun run test:py             # pytest for vision + media (shm suite is separate, below)
bun run test:rs             # cargo test --workspace
bun run contracts:gen       # regenerate packages/contracts/dist (JSON Schema + Pydantic)
bun run --cwd apps/desktop permissions:reset  # macOS TCC reset for dev rebuilds
bun run drift:guard         # contract drift check — see caveat
bun run license:gate        # fails if non-commercial weights would be bundled
```

Single tests:
- Python: `uv run --project services/vision pytest services/vision/tests/test_pipeline.py::test_name -q`
- Python shm mirror: `uv run --project packages/shm/py pytest packages/shm/py/tests -q`
- Rust: `cargo test -p <crate> <test_name>`
- Bun: `bun test <path> -t "<name>"`

Notes:
- **Rebuild the Studio UI after changing `apps/desktop/src/views/studio`.** `HeadlessShell` serves static files from `views/studio/dist/`, which is gitignored and therefore absent on a clean checkout; plain `bun run dev` does not build it. `bun run dev:desktop` (hutch) does.
- **Onboarding gates Studio**: completion lives in `settings.json` (`onboarding.completedAt`). `startPipeline` returns `ONBOARDING_REQUIRED` until setup finishes; `QBCAM_ALLOW_UNONBOARDED=1` bypasses it for tests/integrations. Reset from Settings or `resetOnboarding`.
- **Camera/mic permissions**: the Electrobun build hook (`scripts/patch-info-plist.ts`) injects the macOS usage strings. If TCC keeps a stale denial, run `bun run --cwd apps/desktop permissions:reset` and restart.
- **`bun run dev:desktop` needs `hutch` on PATH** (`curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh`). Hutch projects the pinned Electrobun 2.0.4 SDK into gitignored `apps/desktop/.hutch/devkit` and builds `apps/desktop/build/`; both are generated, never committed.
- `bun run drift:guard` cannot detect drift today: `packages/contracts/dist` is gitignored, so its `git diff` is always clean. Regenerate and inspect the output instead.
- CI (`.github/workflows/ci.yml`) runs a 3-language matrix plus an integration job. TS lint and Rust clippy are currently `|| true` (non-blocking); contract codegen, bun/pytest/cargo tests, `license:gate` and both integration scripts are blocking.
- Cross-process integrations (`tools/scripts/integration-live.ts`, `integration-record.ts`) need ffmpeg, built cargo binaries, fetched models, and **must run unsandboxed** — POSIX shm segments are not visible across sandboxed processes.
- `bun run bench` points at `tools/bench/run.ts`, which does not exist yet.

## Architecture

**Hot path stays out of JavaScript (ADR-002).** Frames move between processes through POSIX shared-memory ring buffers; Bun is control plane only:

```
qb-camio (Rust: FFmpeg capture / fake cam) ─ring─▶ qb-vision (Python: YuNet detect → track → swap → blend → fail-safe)
                                                      ├─ring─▶ qb-recorder (Rust → fragmented MP4)
                                                      ├─ring─▶ qb-vcam-mock (Rust, §8.2 vcam contract)
                                                      └─ WS JPEG preview ─▶ Studio UI
qb-core (Bun, apps/desktop/src/main): supervisor + JSON-RPC hub + SQLite + model-manager worker
```

- **qb-core** (`apps/desktop/src/main`): `services-registry.ts` is the *only* place sidecar executables/args are defined (Rust binaries from `target/debug`, Python via the workspace `.venv`). `supervisor/` handles spawn, restart/backoff and heartbeat; sidecars authenticate with a per-run token over a `hello` handshake on an ephemeral UDS under the run dir (ADR-004), implemented three times: TS (`rpc/sidecar-server.ts`), Python (`sidecar.py` in vision/media), Rust (`packages/ipc-rs`). `rpc/hub.ts` maps UI requests to sidecar calls/DB ops and enforces the identity-consent gate (TS-01, also enforced in the DB).
- **Shell adapter (ADR-010)**: UI only talks to the `Shell` interface in `main/shell/index.ts`. `HeadlessShell` (Bun.serve on loopback, token-authed) is the dev/CI surface; `ElectrobunShell` (`main/shell/electrobun.ts`, launched by `main/electrobun-entry.ts`) opens a native system-webview window pointed at the same loopback URL. UI→core is HTTP `POST /ui/rpc` with an `x-qbcam-token` header; core→UI is WS JSON-RPC events plus raw JPEG preview frames. Studio UI (`src/views/studio`, React/Tailwind/Zustand) runs unchanged in either shell. The Electrobun entrypoints are excluded from `tsc -b` because they import the generated `.hutch/devkit`.
- **Contracts** (`packages/contracts`): TypeBox schemas in `src/` are the source of truth for RPC methods/events, settings and UI requests/events. `scripts/gen.ts` emits JSON Schema, defaults and `dist/py/qbcam_contracts.py`. Python services currently validate with hand-written Pydantic models rather than the generated ones. Change a schema → rerun `contracts:gen`.
- **SHM ring** (`packages/shm`): `SPEC.md` defines the binary layout (256-byte header, N slots, atomic `writeSeq`, per-reader `readSeq`; live readers are latest-frame-wins, the recorder reads no-drop). Three implementations — Rust crate (`crate/`), Python mirror (`py/qbcam_shm`), TS diagnostic reader (`ts/reader.ts`). Layout changes must be made in all three plus `SPEC.md` (whose implementation table still names a stale `qb_vision/rshm.py` path).
- **Trust & safety invariants** (spec §14, don't weaken): consent attestation required before an identity is usable; provenance sidecars (`qb_media/provenance.py`) on all outputs; fixed honest virtual-device name; in-stream synthetic badge while running; on pipeline stall output the slate, never raw passthrough (ADR-009); no non-commercial model weights bundled (`license:gate`; swap models are bring-your-own with license acceptance).
- **Models**: `models/registry.json` is metadata only (URLs + sha256, `models/install/` is gitignored); `models/manifest.signed.json` is produced by `tools/scripts/sign-manifest.ts` (ed25519 keys in gitignored `.keys/`) and served by `edge/manifest-worker`. `edge/telemetry-worker` accepts only schema-allowlisted fields. Both are Cloudflare Workers (wrangler).
- **Runtime paths** (`main/paths.ts`): app data in `~/Library/Application Support/QBCAM` (macOS), `%APPDATA%\QBCAM` (Windows), `~/.qbcam` (Linux); user outputs in `~/QBCAM/{Recordings,Snapshots,Exports}`. `QBCAM_ROOT` overrides repo-root discovery.

## Conventions

- TS formatting is enforced by Biome (2-space, 100 cols); Python by ruff (line length 100, py312).
- Workspaces: `package.json` (bun, including `apps/desktop/src/views/studio` as its own package), root `Cargo.toml` (cargo), root `pyproject.toml` (uv workspace of `services/vision`, `services/media`, `packages/shm/py`).
- `packages/config`, `packages/ui`, `packages/utils` are empty placeholders — no code lives there yet.
- Ignore `.mimosa/`, `.zcode/`, `.kilo/`, `.v2c/`, `.video_agent/`, `.hutch/`, `.cottontail-tmp/`, `edge/*/.wrangler/` — tool/session state, not project code.
