# ADR-009 — Fail-safe default is slate, never raw passthrough

**Status:** Accepted

## Decision
On pipeline stall/crash with swap active, the output shows a
"QBCAM — NOT STREAMING" slate by default. `freeze` and `passthrough` are
opt-in per settings. The panic bypass (F9) is a separate, explicit action.

## Rationale
A crashed pipeline must never silently expose the user's real face or
background to a call that believes the synthetic persona is active
(FR-109, §15.1 threat model). Slate is the only failure mode that is safe
for every user.

## Consequences
- `Pipeline._fail_safe_frame` is exercised by tests (exception → degraded +
  slate, not raw).
- The vcam idle state shows the same slate (TS-03).
