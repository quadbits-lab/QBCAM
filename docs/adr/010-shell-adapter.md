# ADR-010 — System webview via shell adapter; Electrobun 2.x behind it

**Status:** Accepted (headless + Electrobun shells shipped)

## Decision
All UI code talks to a thin `Shell` interface
(`apps/desktop/src/main/shell/index.ts`). Two implementations exist:
`HeadlessShell` (Bun.serve HTTP + WS on 127.0.0.1, token-authed — dev/CI) and
`ElectrobunShell` (`BrowserWindow` over the same loopback URL — native window).
Electrobun 2.x is built and launched by Hutch (`apps/desktop/hutch.config.ts`,
`electrobun.config.ts`); the SDK is projected into the gitignored
`apps/desktop/.hutch/devkit`.

## Rationale
Electrobun 2.x is young (spec R3); every 🔬 shell spike risks rework. The
adapter confines that risk to one file per implementation. The system webview
default (vs. bundled CEF) keeps the shell tiny per spec §1. Pointing the window
at loopback keeps the existing UI/RPC/preview path untouched for the first
native-shell milestone; moving to Electrobun RPC is an isolated follow-up.

## Consequences
- Development and CI never block on desktop-shell APIs: the same UI, RPC
  surface, and events run in a plain browser.
- The headless shell binds loopback only with a per-session token; it is a
  dev/CI surface, not the shipping UI. In the Electrobun shell the same
  token-authed loopback server is process-internal, and native quit stops the
  sidecars through `Shell.onQuit`.
- `bun run dev:desktop` requires Hutch on PATH; plain `bun run dev` stays
  Hutch-free.
