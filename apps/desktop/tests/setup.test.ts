import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "@qbcam/contracts/settings";
import { resolveCameraId } from "../src/main/camera";
import { repoRoot } from "../src/main/paths";
import {
  detectorInstalled,
  registryModels,
  verifyFileSha256,
} from "../src/main/workers/model-store";

const CAMERAS = [
  { id: "0", name: "FaceTime HD Camera", kind: "camera" },
  { id: "1", name: "Capture screen 0", kind: "screen" },
  { id: "fake", name: "Synthetic", kind: "fake" },
];

describe("camera selection", () => {
  test("auto prefers a real camera over synthetic and screen", () => {
    const res = resolveCameraId("auto", CAMERAS);
    expect(res).toEqual({ ok: true, deviceId: "0" });
  });

  test("auto falls back to synthetic when there is no hardware", () => {
    const res = resolveCameraId("auto", [{ id: "fake", name: "Synthetic", kind: "fake" }]);
    expect(res).toEqual({ ok: true, deviceId: "fake" });
  });

  test("name-based identities survive index churn", () => {
    const moved = [{ id: "7", name: "FaceTime HD Camera", kind: "camera" }];
    const res = resolveCameraId("name:FaceTime HD Camera", moved);
    expect(res).toEqual({ ok: true, deviceId: "7" });
  });

  test("explicit missing devices fail instead of silently using fake", () => {
    const res = resolveCameraId("9", CAMERAS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("DEVICE_NOT_FOUND");
  });

  test("explicit fake stays synthetic", () => {
    expect(resolveCameraId("fake", CAMERAS)).toEqual({ ok: true, deviceId: "fake" });
  });
});

describe("settings defaults", () => {
  test("fresh installs start inside onboarding", () => {
    expect(DEFAULT_SETTINGS.onboarding.completedAt).toBeNull();
    expect(DEFAULT_SETTINGS.onboarding.cameraMode).toBe("device");
    expect(DEFAULT_SETTINGS.onboarding.detectorReadyAt).toBeNull();
  });
});

describe("model registry", () => {
  test("registry exposes detector license metadata and BYO swap", () => {
    const models = registryModels();
    const detector = models.find((m) => m.id === "detector-yunet");
    expect(detector?.license.spdx).toBe("Apache-2.0");
    expect(detector?.license.commercialUse).toBe(true);
    expect(models.some((m) => m.byo)).toBe(true);
  });

  test("sha256 verification accepts the matching digest only", () => {
    const dir = mkdtempSync(join(tmpdir(), "qbcam-sha-"));
    try {
      const file = join(dir, "blob");
      writeFileSync(file, "qbcam");
      const digest = new Bun.CryptoHasher("sha256").update("qbcam").digest("hex");
      expect(verifyFileSha256(file, digest)).toBe(true);
      expect(verifyFileSha256(file, "0".repeat(64))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repoRoot resolves the workspace root", () => {
    expect(repoRoot()).toContain("QBCAM");
  });

  test("detector presence is a boolean regardless of dev install state", () => {
    expect(typeof detectorInstalled()).toBe("boolean");
  });
});
