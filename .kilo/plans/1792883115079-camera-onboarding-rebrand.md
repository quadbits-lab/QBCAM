# QBCAM — Camera reliability, mandatory onboarding, full UI rebrand

## Goal

Make a real camera actually work in the desktop app, gate the Studio behind a complete first-run onboarding flow, and rebrand the UI as a broadcast-hardware console with icons, diagrams, and clear system status.

## Confirmed decisions

- **Onboarding is mandatory** on a fresh install. Real camera/mic are tested and guided, but the user may explicitly continue in **synthetic camera** mode. Detector install is required.
- **Full visual rebrand** in a **broadcast-hardware** direction (graphite, warm white, signal lime, amber/red status colors, mono instrumentation).
- **Microphone = test + permission only**; audio muxing into recordings stays out of scope.
- Onboarding includes: consent → permissions → camera/mic test → models → optional source identity → readiness summary.

## Diagnosis (verified in code)

1. `services/camio/src/ffmpeg.rs:91` always returns `fake` first; `apps/desktop/src/main/rpc/hub.ts:220` resolves `camera.deviceId === "auto"` to `cameras[0]`, so the real camera is never selected unless typed manually in Settings.
2. The Electrobun `.app` is generated without `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`; ffmpeg children therefore cannot obtain TCC camera/mic access.
3. `ffmpeg.rs:36-75` hardcodes `uyvy422` + `1280x720` + device framerate, sets `stderr` to `Stdio::null()`, and offers no fallback profile — most cameras fail silently or with an unusable error.
4. `hub.stopPipeline` only stops vision (`hub.ts:92-93`); camio capture and its ffmpeg child keep running.
5. Pipeline exceptions are swallowed (`services/vision/qb_vision/pipeline/__init__.py:145-152`); only a generic `pipeline.degraded` event is emitted and the UI ignores `degraded`, so failures never reach the user.
6. Current onboarding (`Wizard.tsx`) is a 3-step modal gated by `localStorage("qbcam.wizardDone")`; no device test, permission state, mic, identity, or readiness. Model download hang was already fixed by running installs in-process.
7. `stopPipeline` has no camera cleanup; repeated start/stop leaks ffmpeg processes.

## Workstream 1 — Capture, probe, and permissions (backend)

1. **Fix device enumeration** (`services/camio/src/ffmpeg.rs`)
   - Parse avfoundation output into `camera` and `audio` devices; keep the fake camera but return real cameras first.
   - Add `kind` (`camera` | `audio` | `fake`), index, and display name. Refactor parsing into a pure function with unit tests.
   - Because avfoundation indices are not stable across reboots, persist a `name:<display name>` identity and resolve it to the current index at capture time; keep raw indices valid.
   - `capture.list` returns `{ cameras, audio }` (keep `devices` for compatibility).

2. **Robust capture profiles** (`ffmpeg.rs`, `main.rs`)
   - Try, in order: (a) explicit size/fps/`uyvy422`, (b) explicit size/fps with device pixel format, (c) device-native plus `-vf scale=W:H:force_original_aspect_ratio=decrease,pad=...,fps=FPS`.
   - Capture stderr into a bounded ring buffer (reader thread) instead of `Stdio::null()`; include a short tail in errors.
   - `capture.open` must block until the first frame or fail after ~3 s, returning `{ ok, profile, firstFrameTs, device }` or `{ error, code, detail }`.

3. **Snapshot probe** (`capture.snapshot`)
   - Single-frame ffmpeg run with the same profile fallback, output MJPEG, return base64 JPEG + width/height + device. This is the production capture path, so onboarding tests reality, not `getUserMedia`.
   - Classify failures: `PERMISSION_DENIED`, `DEVICE_NOT_FOUND`, `DEVICE_BUSY`, `FFMPEG_MISSING`, `CAPTURE_FAILED` using stderr patterns and process errors.

4. **Microphone probe** (`audio.list`, `audio.level`)
   - List avfoundation audio devices; `audio.level {deviceId, ms: 300}` captures `s16le`, mono 16 kHz for the requested window and returns `{ level, peak }` (RMS/peak), or a classified error.
   - No audio recording or muxing in this change.

5. **Pipeline lifecycle fixes** (`hub.ts`)
   - Track `activeDeviceId`; `startPipeline` closes any previous camio capture before opening a new one; `stopPipeline` calls `capture.close` and clears state.
   - If vision fails to start after capture opened, close the camera before returning the error (no orphan ffmpeg).
   - Resolve `auto` to the **first real camera**, then fake; resolve `name:<display name>` against the current device list; explicit `fake` stays synthetic; explicit missing id returns `DEVICE_NOT_FOUND` with a helpful message (never silently falls back).
   - Return `{ deviceId, cameraKind, previewPort, previewToken, session }` from `startPipeline`; make preview info part of the response to remove the extra round-trip.
   - Enforce onboarding: `startPipeline` throws `ONBOARDING_REQUIRED` unless `settings.onboarding.completedAt` is set (escape hatch: `QBCAM_ALLOW_UNONBOARDED=1` for tests).

6. **Pipeline diagnostics** (`services/vision/qb_vision/pipeline/__init__.py`, `server.py`)
   - Log the full traceback and include `{error: type + message}` in `pipeline.degraded`; rate-limit repeats (e.g. once per 5 s).
   - Emit `pipeline.recovered` when degradation clears.
   - Forward `pipeline.degraded` / `pipeline.recovered` to the UI in `apps/desktop/src/main/index.ts` (currently only stats/faces/recorder are forwarded).

7. **macOS permission packaging**
   - `apps/desktop/electrobun.config.ts`: add `build.mac.entitlements` for `com.apple.security.device.camera` and `com.apple.security.device.audio-input`; wire `scripts.postWrap` and `scripts.postPackage` to a plist patch hook.
   - `apps/desktop/scripts/patch-info-plist.ts`: idempotently set `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` on the built `.app` (locate via `ELECTROBUN_WRAPPER_BUNDLE_PATH` or `ELECTROBUN_BUILD_DIR`); run for dev (`postPackage`) and release (`postWrap`, before signing).
   - Add `permissions:reset` script: `tccutil reset Camera ai.qbcam.desktop` and `tccutil reset Microphone ai.qbcam.desktop`, documented for dev rebuilds.

8. **Shell capabilities** (`apps/desktop/src/main/shell/*`)
   - Add `openExternal(url)` (Electrobun `Utils.openExternal`; headless `open` on macOS / no-op elsewhere), `showItemInFolder(path)`, and `pickFiles({ filters, multiple })` (Electrobun `Utils.openFileDialog`; headless returns `[]`).
   - New RPC `openSystemSettings { pane: "camera" | "microphone" }` using the `x-apple.systempreferences:com.apple.preference.security?Privacy_*` URLs.

## Workstream 2 — Onboarding state and contracts

1. Extend `packages/contracts/src/settings.ts`:
   ```ts
   onboarding: {
     schema: 1,
     completedAt: number | null,
     cameraMode: "device" | "synthetic",
     cameraPermission: "granted" | "denied" | "unknown",
     microphonePermission: "granted" | "denied" | "unknown",
     microphoneDeviceId: string | null,
     detectorReadyAt: number | null
   }
   ```
   Add defaults to `DEFAULT_SETTINGS`; `deepMerge` keeps existing users compatible.

2. Add UI requests (contracts + `hub.ts`):
   - `getSetupStatus` → onboarding, permission states, cameras, audio devices, detector presence (verify on disk), ffmpeg present, service states.
   - `cameraSnapshot { deviceId }`, `probeMicrophone { deviceId, ms }`.
   - `completeOnboarding { cameraMode, cameraDeviceId, microphoneDeviceId }`, `resetOnboarding`.
   - `openSystemSettings { pane }`, `pickImageFiles`.
   - Run `bun run contracts:gen`; keep generated models in sync.

3. Detector presence (`workers/model-store.ts`): add `detectorInstalled()` using the registry sha/size and the same search order as `services/vision/qb_vision/pipeline/detect.py` (app-data models dir, repo `models/install`). `getSetupStatus` and onboarding readiness use it, not the DB row.

4. Gate behavior: UI boots into onboarding when `completedAt === null`; after completion it reloads setup status and mounts the app shell. Settings gets “Run setup again” → `resetOnboarding` + return to step 1.

## Workstream 3 — Brand foundation

1. New tokens in `apps/desktop/src/views/studio/src/index.css` (dark-first, light derived):
   - `--bg #0A0B0D`, `--surface #111316`, `--surface-2 #171A1F`, `--line #262A31`, `--text #F2F4F7`, `--muted #98A1AE`
   - `--accent #C6F24E` (lime), `--accent-ink #0A0B0D`, `--info #5CC8FF`, `--ok #4ADE80`, `--warn #FFB020`, `--rec #FF4D4D`
   - Hairline grid background utility, corner tick marks, segmented meters, uppercase mono labels (`--font-mono`).
   - Buttons: lime with dark ink for primary, hairline ghost secondary, red destructive; never white text on lime.
2. Typography: add **Space Grotesk** (display/UI, OFL) and keep **IBM Plex Mono** (figures). Self-host woff2 under `src/fonts/` (local-first, no external requests); keep DM Sans as fallback.
3. Add `lucide-react` to `apps/desktop/src/views/studio/package.json` and use it for all navigation/status/action icons; remove emoji icons from Studio/Library.
4. Shared primitives in `src/components/`: `Button`, `Card`, `StatusDot`, `Meter`, `ProgressRing`, `Stepper`, `PipelineDiagram` (SVG: camera → detect → swap → blend → recorder/vcam), `ReadinessPanel`, `Toast`, `EmptyState`, `Field`/`Select`.
5. Motion: 120–180 ms ease-out transitions, staged content reveal on step change; respect `prefers-reduced-motion`.

## Workstream 4 — Onboarding UI (6 steps, full-screen)

Shell: left numbered stepper with completion ticks, main panel (max ~720 px), right persistent “Readiness” infographic (permission/device/model checklist); right panel hides below ~1100 px. Back/Next are explicit; Next is disabled until the step’s requirement passes.

1. **Welcome & consent** — value prop, local-first/privacy facts, synthetic-media policy; consent checkbox is required and its text is reused for `importIdentity`.
2. **Permissions** — camera and microphone cards with status (`unknown/granted/denied`), “Request access” triggers the backend probe (which raises the real TCC prompt), “Open System Settings” deep link, and macOS-specific checklist copy. Re-scan button.
3. **Camera & mic test** — device dropdowns (real cameras first, synthetic card last), live still preview polled at ~1 fps via `cameraSnapshot`, capture profile + resolution readout, mic segmented level meter via `probeMicrophone` (300 ms samples), “silent mic” warning after ~3 s. Failure cards show classified reason + fixes (permission, camera busy, ffmpeg missing). Explicit “Continue with synthetic camera” sets `cameraMode: synthetic`; readiness marks camera as synthetic.
4. **Models** — detector card with install state, progress bar from `models.progress`, license badge, Retry; block Next until `detectorInstalled()`. Optional BYO swap registration (native file picker + license confirmation + existing `setByoModel`).
5. **Source face (optional)** — native image picker (`pickImageFiles`, path-input fallback in headless), name, consent checkbox, calls `importIdentity`; “Skip for now” allowed; readiness shows “no source face — detection only”.
6. **Readiness summary** — pipeline infographic, checklist (consent, permissions, camera mode/device, mic, detector, source face), “Open Studio”. Writes `completeOnboarding` and only then mounts the app.

Acceptance: after completing with a real camera, pressing Start Pipeline in Studio shows real frames and no `degraded` state; a fresh `resetOnboarding` replays the flow; the app is unreachable until completion.

## Workstream 5 — Studio and tabs restructure

1. **App shell**: narrower icon rail (collapsible) + top status strip (camera device, pipeline state, model, vcam, recorder timer, service health) + content. Breadcrumb becomes page title with mono section label.
2. **Studio page**: 3-zone layout — identity rail (compact cards with quality meter), canvas with HUD overlay (resolution, FPS, frame time, face count, `SYNTHETIC MEDIA` badge, bypass indicator), right inspector with tabs **Quality / Blend / Output**; bottom action dock (Start/Stop, Bypass, Record, Snapshot, Virtual Cam) with icons and shortcut hints. Degraded/error banner with reason and “Diagnostics” expander. Responsive: inspector becomes a drawer under 1200 px.
3. **Models**: cards with license/commercial-use badges, install progress, BYO wizard using `pickFiles`.
4. **Library**: grid/list toggle with thumbnail (use existing `thumbPath`), provenance badge, reveal-in-Finder action via `showItemInFolder`.
5. **Settings**: grouped sections — Devices (camera/mic pickers, resolution/fps), Permissions (status + open settings), Appearance, Recording paths, Privacy, Hotkeys, “Run setup again”.
6. Remove `Wizard.tsx`; replace with the onboarding module. Keep store tab/theme persistence; remove the `qbcam.wizardDone` localStorage gate.

## Workstream 6 — Docs and developer ergonomics

- README/CLAUDE.md: onboarding flow, `dev:desktop` prerequisites, macOS permission reset, `QBCAM_ALLOW_UNONBOARDED=1`, plist hook behavior.
- Add `permissions:reset` and, if useful, `setup:reset` (clears `onboarding.completedAt`) scripts.
- Note in ADR-010 that the native shell now supplies file dialogs/external links through `Shell`.

## Validation

1. **Rust**: parsing video/audio device lists, fake ordering, stderr classification, profile fallback selection; `cargo test --workspace`.
2. **TS**: auto camera selection prefers real cameras, onboarding gate on `startPipeline`, detector-on-disk check, settings default merge; `bun test`.
3. **macOS manual/automated**:
   - Build, confirm `Info.plist` contains both usage strings (dev and stable paths).
   - `permissions:reset`, launch, verify TCC prompt appears on the permission/test step.
   - Grant → live stills from FaceTime camera, mic meter moves; deny → classified error + System Settings link works.
   - No camera → synthetic path completes and Studio labels the source synthetic.
   - Remove detector → onboarding blocks Next; install → unblocks.
   - Finish onboarding → Studio Start Pipeline shows real frames, FPS > 0, no degraded banner; Stop Pipeline closes ffmpeg (no orphan processes); close window stops sidecars.
4. Headless `bun run dev` still works; native dialog/deep-link actions degrade gracefully.
5. Gates: `bun run test`, `bun run test:rs`, `bun run test:py`. **Prerequisite:** fix the pre-existing `bun run lint` failure (Biome 2 config uses removed `files.ignore`) and `bun run typecheck` (`bun-types` missing) so new code is verifiable.

## File map (primary)

- `services/camio/src/ffmpeg.rs`, `main.rs` — enumeration, profiles, snapshot, audio probe, stderr.
- `apps/desktop/src/main/rpc/hub.ts` — device resolution, pipeline lifecycle, onboarding gate, new RPCs.
- `apps/desktop/src/main/shell/{index,headless,electrobun}.ts` — `openExternal`, `pickFiles`, `showItemInFolder`.
- `apps/desktop/electrobun.config.ts`, `apps/desktop/scripts/patch-info-plist.ts` (+ reset script).
- `packages/contracts/src/settings.ts` (+ regenerated `dist/`).
- `apps/desktop/src/main/workers/model-store.ts` — detector presence.
- `apps/desktop/src/main/index.ts` — forward degraded/recovered events.
- `services/vision/qb_vision/pipeline/__init__.py`, `server.py` — diagnostics.
- `apps/desktop/src/views/studio/src/index.css`, `components/*`, `onboarding/*`, `main.tsx`, `store.ts`, `tabs/*`.
- `apps/desktop/src/views/studio/package.json` — `lucide-react`; fonts under `src/fonts/`.

## Risks

- **TCC caching on unsigned dev builds**: rebuilds can re-prompt or keep a stale denial; document `permissions:reset` + app restart.
- **Electrobun hook timing**: `postPackage` is the dev-safe hook; verify the plist after every dev build. Stable builds must patch in `postWrap` before signing.
- **ffmpeg device warm-up**: snapshots can take 1–3 s; probe with timeout and clear “camera busy” messaging.
- **Sidecar framing**: base64 JPEG is one JSON line; bound snapshot size (downscale to 960 px wide for onboarding) and keep polling at ~1 fps.
- **Concurrent edits**: another session recently changed Studio files and dependencies; re-check `git status`/`git diff` before editing and avoid reverting unrelated work.
- **Scope creep**: audio muxing, native vcam, and Windows/Linux permission UX remain out of scope.

## Out of scope

- Recording audio/muxing, native virtual cameras, notarization, swap-model downloads, cross-platform permission UX beyond generic errors.
