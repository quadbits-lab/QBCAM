# ADR-008 — Models distributed separately via signed manifest

**Status:** Accepted

## Decision
The installer ships zero model weights. `models/registry.json` (metadata
only, hashes stamped by `models:dev`) is signed with ed25519
(`tools/scripts/sign-manifest.ts`) and served by the manifest worker.
`model-manager` verifies signature + per-file sha256, downloads resumably,
and installs atomically. Bring-your-own swap weights are registered only
after explicit license acceptance (spec §13.3).

## Rationale
Keeps the installer ≤ 60 MB, decouples model updates from app updates, and
makes the §13.3 license gate enforceable: a release build physically cannot
include weights nobody licensed.

## Consequences
- Dev models (YuNet, Apache-2.0) are fetched by `bun run models:dev` and
  gitignored; CI regenerates them per run.
- `commercialUse: false` models can exist in the registry (BYO) but the
  license gate blocks bundling them.
