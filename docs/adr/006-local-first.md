# ADR-006 — Local-first; no face data to cloud by default

**Status:** Accepted

## Decision
Photos, embeddings, frames, recordings, and settings never leave the device
in the default configuration. The only network endpoints are the update
host, the model CDN, and opt-in crash reports (schema-allowlisted,
media-free). Verified by test (spec G4, §15.2).

## Rationale
Biometric data handling is a legal and trust minefield (GDPR, BIPA-style
statutes); local-only processing is both the strongest policy and the
simplest to verify. Telemetry is off until the user opts in.

## Consequences
- The edge workers reject any field outside the allowlist (tested against
  `wrangler dev`), so "accidental" media upload fails closed.
- Cloud features in v2 require a separate, explicit consent flow.
