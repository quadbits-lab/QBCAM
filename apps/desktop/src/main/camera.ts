/** Camera selection rules shared by Settings, onboarding and startPipeline. */
export interface CameraDevice {
  id: string;
  name: string;
  kind: string;
}

export type CameraResolution =
  | { ok: true; deviceId: string }
  | { ok: false; code: "DEVICE_NOT_FOUND"; message: string };

/**
 * Resolve a configured device to a concrete capture id.
 * `auto` prefers a real camera (never the synthetic fallback), then the first
 * available video device; explicit ids and `name:<display name>` are matched
 * against the live list so avfoundation index churn does not break settings.
 */
export function resolveCameraId(
  wanted: string | null | undefined,
  cameras: CameraDevice[],
): CameraResolution {
  const wantedValue = (wanted ?? "auto").trim();
  if (wantedValue === "fake" || wantedValue.startsWith("fake")) {
    return { ok: true, deviceId: "fake" };
  }
  if (!wantedValue || wantedValue === "auto") {
    const preferred =
      cameras.find((c) => c.kind === "camera") ?? cameras.find((c) => c.kind === "screen");
    return { ok: true, deviceId: preferred?.id ?? "fake" };
  }
  const byId = cameras.find((c) => c.id === wantedValue);
  if (byId) return { ok: true, deviceId: byId.id };
  const byName = cameras.find((c) => `name:${c.name}` === wantedValue || c.name === wantedValue);
  if (byName) return { ok: true, deviceId: byName.id };
  return {
    ok: false,
    code: "DEVICE_NOT_FOUND",
    message: `camera "${wantedValue}" is not available. Pick another device in Settings.`,
  };
}
