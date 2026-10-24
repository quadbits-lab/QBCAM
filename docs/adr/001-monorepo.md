# ADR-001 — Monorepo with Bun workspaces + per-language native tooling

**Status:** Accepted

## Decision
One repository. JS/TS via Bun workspaces (single lockfile), Python via a uv
workspace (one `pyproject.toml` per service), Rust via a Cargo workspace.
Cross-language contracts live in `packages/contracts` and are generated, not
hand-synced.

## Rationale
The product is a lattice of small services in three languages whose interfaces
change together (spec §5). Atomic cross-service changes and a single codegen
source beat multi-repo version choreography at this team size. Per-language
package managers remain native (uv, cargo) because forcing one through a JS
wrapper breaks ecosystem tooling.

## Consequences
- CI must build all three stacks (accepted: it is the drift guard).
- Generated code is committed (`packages/contracts/dist`) with a CI drift
  guard so consumers never depend on running codegen to build.
