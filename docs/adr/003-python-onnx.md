# ADR-003 — Python (ONNX Runtime) for ML

**Status:** Accepted

## Decision
Detection and swap inference run in Python 3.12 with ONNX Runtime and OpenCV
(`FaceDetectorYN`/YuNet); swap backends are pluggable ONNX sessions
(StubSwapper default, bring-your-own inswapper-class behind a license gate).

## Rationale
Ecosystem coverage (ORT execution providers across CUDA/TensorRT, CoreML,
DirectML, ROCm, CPU) and iteration speed. The 2023mar YuNet ONNX from OpenCV
Zoo is Apache-2.0 (commercial-use OK, §13.3) and decodes via OpenCV's DNN
graph, avoiding hand-rolled anchor decoding.

## Consequences
- The Python sidecar is spawned by the Bun supervisor through the workspace
  venv; packaging uses a relocatable Python at release (spec §17.1).
- Swap weights are NEVER bundled; `tools/scripts/license-gate.ts` blocks
  releases containing non-commercial models.
