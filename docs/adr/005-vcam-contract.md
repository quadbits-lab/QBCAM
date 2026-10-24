# ADR-005 — Native per-OS virtual camera behind a single contract

**Status:** Accepted (mock implementation shipped; native drivers are M3)

## Decision
`qb-vcam` exposes one contract (`vcam.describe/install/start/stop/setSlate`).
v0 ships a mock implementation (JPEG/PPM sink + client tracking + slate) so
the full pipeline is testable without drivers. Native drivers — Media
Foundation virtual camera (Windows), CoreMediaIO Camera Extension (macOS),
v4l2loopback writer (Linux) — are the M3 milestone (spec §8).

## Rationale
OS virtual-camera APIs are native-only and signing-heavy; the rest of the app
must not block on them. The mock upholds the trust rules that matter
(honest device name, slate when idle, latest-frame-wins) so behavior tests
written against the mock hold for the native drivers.

## Consequences
- Other apps cannot select the mock as a camera until M3; the Studio's
  Virtual Cam toggle exercises the contract and sink end-to-end.
- Compatibility matrix (`docs/compat.md`) stays empty until native drivers
  land; entries are added per release with scripted smoke tests.
