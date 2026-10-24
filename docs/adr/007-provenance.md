# ADR-007 — C2PA-shaped provenance on all saved outputs

**Status:** Accepted (XMP sidecar v0; full C2PA signing when certificates exist)

## Decision
Every recording and snapshot receives non-removable provenance: an XMP
sidecar plus a JSON manifest matching spec §14.2
(`claim_generator`, `c2pa.actions` with `trainedAlgorithmicMedia`,
`qbcam.synthetic` with faceSwap/consent flags). The library UI shows the
signed state.

## Rationale
Synthetic-media transparency is a product requirement (TS-02) and increasingly
a platform requirement. Signing needs a publisher certificate chain and trust
list membership (🔥 spike §14.2); the XMP form is forward-compatible — the
same assertions migrate into a real C2PA manifest when signing lands.

## Consequences
- `qb_media/provenance.py` validates asset paths against allowlisted output
  roots (no traversal) before writing sidecars.
- `library.delete` wipes assets AND sidecars.
