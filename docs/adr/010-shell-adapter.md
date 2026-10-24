# ADR-010 — System webview via shell adapter; Electrobun 2.x behind it

**Status:** Accepted (headless shell shipped; Electrobun integration is the
next shell milestone)

## Decision
All UI code talks to a thin `Shell` interface
(`apps/desktop/src/main/shell/index.ts`). Two implementations exist:
`HeadlessShell` (Bun.serve HTTP + WS on 127.0.0.1, token-authed — shipped)
and an Electrobun 2.x implementation (`BrowserWindow` + `defineRPC`) that
slots in without touching UI code.

## Rationale
Electrobun 2.x is young (spec R3); every 🔬 shell spike risks rework. The
adapter confines that risk to one file per implementation. The system webview
default (vs. bundled CEF) keeps the shell tiny per spec §1.

## Consequences
- Development and CI never block on desktop-shell APIs: the same UI, RPC
  surface, and events run in a plain browser.
- The headless shell binds loopback only with a per-session token; it is a
  dev/CI surface, not the shipping UI.
