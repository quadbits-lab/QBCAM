# Virtual Camera Compatibility Matrix

Per spec §8.3 / Appendix D. Entries are added per release after the scripted
smoke test against each client. ⬜ untested · ✅ working · ❌ blocked · 🚧 partial

Status as of v0.1.0-alpha: **mock vcam only** (ADR-005) — no client can
select QBCAM as a camera yet. Native drivers are milestone M3.

| Client | Version | Win 11 | Win 10 | macOS 14 | macOS 15 | Ubuntu 24.04 | Notes |
|---|---|:---:|:---:|:---:|:---:|:---:|---|
| Zoom | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | re-test after MF/CMIO drivers (M3) |
| Google Meet (Chrome) | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| Microsoft Teams | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | UWP ignores DirectShow fallback — check |
| OBS Studio | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | usually most permissive; test first |
| Discord | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| Browser `getUserMedia` | — | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |

## Smoke procedure (per client, per release)

1. Install the release build; complete first-run wizard.
2. Start Studio with the fake camera; enable Virtual Cam.
3. Select "QBCAM Virtual Camera" in the client.
4. Verify: video visible at expected resolution; frame rate ≥ 24 FPS;
   slate shown after stopping the pipeline; no stale frames when idle.
5. Record results above with client version + OS build.
