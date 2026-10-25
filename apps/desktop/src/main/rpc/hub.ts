/**
 * RPC hub — maps UI requests (spec §10.4 UiRequests) to sidecar calls and DB
 * operations, enforces identity consent (TS-01) and routes events back up.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveCameraId } from "../camera";
import type { Store } from "../db";
import { defaultOutputDirs } from "../paths";
import { loadSettings, saveSettings } from "../settings";
import type { Shell } from "../shell";
import type { SupervisedService } from "../supervisor";
import { type ModelManagerHandle, startModelManager } from "../workers/model-manager";
import { detectorInstalled, findDetectorPath, modelStatuses } from "../workers/model-store";

type CameraInfo = { id: string; name: string; kind: string };

export class Hub {
  private services: Map<string, SupervisedService>;
  private modelManager: ModelManagerHandle;
  private activeRecording: { recordingId: string; path: string } | null = null;
  private activeSessionId: string | null = null;
  private activeRingOut: string | null = null;
  private activeDeviceId: string | null = null;
  private vcamOn = false;

  constructor(
    private store: Store,
    private shell: Shell,
    services: SupervisedService[],
    private appVersion: string,
  ) {
    this.services = new Map(services.map((s) => [s.def.name, s]));

    this.modelManager = startModelManager();
    this.modelManager.setProgressListener((m) => shell.sendToUi("models.progress", m));
    this.modelManager.setDoneListener((m) => {
      if (m.ok) {
        this.store.upsertModel({
          id: m.modelId,
          kind: "",
          version: "",
          license: "",
          sha256: "",
          installed: true,
        });
      }
      shell.sendToUi("service.state", {
        service: "model-manager",
        state: m.ok ? "ready" : "crashed",
      });
    });
  }

  svc(name: string): SupervisedService {
    const s = this.services.get(name);
    if (!s) throw new Error(`service not running: ${name}`);
    return s;
  }

  async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "getSettings":
        return loadSettings();
      case "setSettings":
        return saveSettings((params as { patch: Record<string, unknown> }).patch);
      case "listCameras":
        return this.svc("camio").client!.request("capture.list");
      case "listIdentities":
        return { identities: this.store.listIdentities() };
      case "importIdentity":
        return this.importIdentity(params as ImportIdentityParams);
      case "deleteIdentity":
        return this.deleteIdentity(params as { identityId: string });
      case "listLibrary":
        return { items: this.store.listLibrary() };
      case "library.delete": {
        const info = this.store.deleteLibraryItem((params as { id: string }).id);
        if (info) {
          try {
            const file = Bun.file(info.path);
            if (await file.exists()) await Bun.write(info.path, "");
            await Bun.write(info.path + ".xmp", "").catch(() => {});
          } catch {
            // best-effort removal
          }
        }
        return { ok: !!info };
      }
      case "startPipeline":
        return this.startPipeline(params as { identityId: string | null });
      case "stopPipeline":
        return this.stopPipeline();
      case "setPreset":
        return this.svc("vision").client!.request("pipeline.setParams", {
          preset: (params as { preset: string }).preset,
        });
      case "setBlend":
        return this.svc("vision").client!.request("pipeline.setParams", params);
      case "bypass":
        return this.svc("vision").client!.request("pipeline.bypass", params);
      case "startRecording":
        return this.startRecording();
      case "stopRecording":
        return this.stopRecording();
      case "captureStill":
        return this.captureStill(params as { format: string });
      case "toggleVcam":
        return this.toggleVcam((params as { on: boolean }).on);
      case "listModels":
        return { models: this.listModels() };
      case "ensureModels":
        for (const id of (params as { modelIds: string[] }).modelIds) {
          await this.modelManager.ensure(id);
        }
        return { ok: true, models: this.listModels() };
      case "setByoModel":
        return this.setByoModel(params as SetByoParams);
      case "getSetupStatus":
        return this.getSetupStatus();
      case "cameraSnapshot":
        return this.cameraSnapshot(
          params as { deviceId: string; width?: number; height?: number; fps?: number },
        );
      case "probeMicrophone":
        return this.probeMicrophone(params as { deviceId: string; ms?: number });
      case "completeOnboarding":
        return this.completeOnboarding(
          params as {
            cameraMode: "device" | "synthetic";
            cameraDeviceId: string | null;
            microphoneDeviceId: string | null;
            cameraPermission?: "granted" | "denied" | "unknown";
            microphonePermission?: "granted" | "denied" | "unknown";
          },
        );
      case "resetOnboarding":
        return this.resetOnboarding();
      case "openSystemSettings": {
        const pane = (params as { pane: "camera" | "microphone" }).pane;
        const url =
          pane === "microphone"
            ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            : "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";
        return { ok: await this.shell.openExternal(url) };
      }
      case "pickImageFiles":
        return {
          paths: await this.shell.pickFiles({
            allowedFileTypes: "png,jpg,jpeg,webp",
            multiple: true,
          }),
        };
      case "pickModelFile": {
        const paths = await this.shell.pickFiles({
          allowedFileTypes: "onnx",
          multiple: false,
        });
        return { path: paths[0] ?? null };
      }
      case "revealInFolder":
        return {
          ok: await this.shell.showItemInFolder((params as { path: string }).path),
        };
      case "getServiceStates":
        return {
          states: [...this.services.entries()].map(([name, s]) => ({
            name,
            state: s.state,
          })),
        };
      case "getPreview": {
        const info = await this.svc("vision").client!.request<{ port: number; token: string }>(
          "preview.info",
        );
        return { port: info.port, token: info.token };
      }
      default:
        throw new Error(`unknown ui method: ${method}`);
    }
  }

  // ---------- identity (TS-01 consent gate) ----------

  private async importIdentity(p: ImportIdentityParams) {
    if (!p.name?.trim()) throw new Error("identity name required");
    if (!p.consentStatement?.trim()) {
      throw new Error("consent attestation is required to import an identity");
    }
    // embedding + quality via qb-vision
    const embed = await this.svc("vision").client!.request<{
      embedding: number[];
      quality: number;
      detectedFaces: number;
      bestPath: string;
    }>("identity.embed", { paths: p.paths });
    if (embed.detectedFaces === 0) {
      throw new Error("no face detected in the provided photos");
    }
    const id = randomUUID();
    const thumb = embed.bestPath;
    mkdirSync(join(defaultOutputDirs().exports, "identity-crops"), { recursive: true });
    this.store.insertIdentity({
      id,
      name: p.name.trim(),
      embedding: new Uint8Array(new Float32Array(embed.embedding).buffer),
      thumbPath: thumb,
      tags: [],
      quality: embed.quality,
      createdAt: Date.now(),
    });
    let isPrimary = true;
    for (const path of p.paths) {
      this.store.insertIdentityImage({
        id: randomUUID(),
        identityId: id,
        path,
        quality: path === embed.bestPath ? embed.quality : 0,
        isPrimary,
      });
      isPrimary = false;
    }
    this.store.insertConsent({
      id: randomUUID(),
      identityId: id,
      kind: "import",
      statement: p.consentStatement,
      attestedAt: Date.now(),
      appVersion: this.appVersion,
    });
    return { identityId: id, quality: embed.quality, detectedFaces: embed.detectedFaces };
  }

  private async deleteIdentity(p: { identityId: string }) {
    const info = this.store.deleteIdentity(p.identityId);
    let wiped = 0;
    for (const path of [...info.images, info.thumbPath ?? ""]) {
      if (!path) continue;
      try {
        (await Bun.file(path).exists()) && (await Bun.write(path, ""), wiped++);
      } catch {
        // best-effort wipe
      }
    }
    return { ok: true, wipedFiles: wiped };
  }

  // ---------- setup / onboarding ----------

  private serviceStates() {
    return [...this.services.entries()].map(([name, s]) => ({ name, state: s.state }));
  }

  private listModels() {
    const stored = new Map(this.store.listModels().map((m) => [m.id, m]));
    return modelStatuses().map((m) => {
      const row = stored.get(m.id);
      return {
        id: m.id,
        kind: m.kind,
        version: m.version,
        licenseSpdx: m.licenseSpdx,
        commercialUse: m.commercialUse,
        byo: m.byo,
        installed: m.byo ? !!row?.installed : m.installed,
        byoPath: row?.byoPath ?? null,
        installedPath: m.installedPath,
      };
    });
  }

  private async getSetupStatus() {
    const settings = loadSettings();
    let cameras: CameraInfo[] = [];
    let audio: CameraInfo[] = [];
    let ffmpeg = false;
    try {
      const res = await this.svc("camio").client!.request<{
        cameras?: CameraInfo[];
        devices?: CameraInfo[];
        audio?: CameraInfo[];
        ffmpeg?: boolean;
      }>("capture.list");
      cameras = res.cameras ?? res.devices ?? [];
      audio = res.audio ?? [];
      ffmpeg = res.ffmpeg ?? false;
    } catch (err) {
      console.warn("[hub] capture.list failed:", err);
    }
    const detector = detectorInstalled();
    return {
      onboarding: settings.onboarding,
      camera: settings.camera,
      cameras,
      audio,
      ffmpeg,
      detector: { installed: detector, path: findDetectorPath() },
      models: this.listModels(),
      services: this.serviceStates(),
    };
  }

  private async cameraSnapshot(p: {
    deviceId: string;
    width?: number;
    height?: number;
    fps?: number;
  }) {
    const settings = loadSettings();
    try {
      return await this.svc("camio").client!.request("capture.snapshot", {
        deviceId: p.deviceId,
        width: p.width ?? settings.camera.width,
        height: p.height ?? settings.camera.height,
        fps: p.fps ?? settings.camera.fps,
      });
    } catch (err) {
      throw asFriendlyError(err);
    }
  }

  private async probeMicrophone(p: { deviceId: string; ms?: number }) {
    try {
      return await this.svc("camio").client!.request("audio.level", {
        deviceId: p.deviceId,
        ms: p.ms ?? 300,
      });
    } catch (err) {
      throw asFriendlyError(err);
    }
  }

  private async completeOnboarding(p: {
    cameraMode: "device" | "synthetic";
    cameraDeviceId: string | null;
    microphoneDeviceId: string | null;
    cameraPermission?: "granted" | "denied" | "unknown";
    microphonePermission?: "granted" | "denied" | "unknown";
  }) {
    if (!detectorInstalled()) {
      throw new Error("MODEL_REQUIRED: install the face detector before finishing setup");
    }
    const deviceId = p.cameraMode === "synthetic" ? "fake" : p.cameraDeviceId?.trim() || "auto";
    const next = saveSettings({
      camera: { deviceId },
      onboarding: {
        completedAt: Date.now(),
        cameraMode: p.cameraMode,
        cameraPermission: p.cameraPermission ?? "unknown",
        microphonePermission: p.microphonePermission ?? "unknown",
        microphoneDeviceId: p.microphoneDeviceId,
        detectorReadyAt: Date.now(),
      },
    });
    return { ok: true, onboarding: next.onboarding };
  }

  private async resetOnboarding() {
    const next = saveSettings({
      camera: { deviceId: "auto" },
      onboarding: {
        completedAt: null,
        cameraMode: "device",
        cameraPermission: "unknown",
        microphonePermission: "unknown",
        microphoneDeviceId: null,
        detectorReadyAt: null,
      },
    });
    return { ok: true, onboarding: next.onboarding };
  }

  // ---------- pipeline ----------

  private requireOnboarding() {
    if (process.env.QBCAM_ALLOW_UNONBOARDED === "1") return;
    const settings = loadSettings();
    if (!settings.onboarding.completedAt) {
      throw new Error("ONBOARDING_REQUIRED: finish setup before starting the pipeline");
    }
  }

  private async resolveCamera(settings: ReturnType<typeof loadSettings>): Promise<string> {
    // The device id is authoritative: onboarding writes "fake" for the
    // synthetic path, and Settings can switch between real/synthetic later.
    let cameras: CameraInfo[] = [];
    try {
      const res = await this.svc("camio").client!.request<{
        cameras?: CameraInfo[];
        devices?: CameraInfo[];
      }>("capture.list");
      cameras = res.cameras ?? res.devices ?? [];
    } catch (err) {
      throw new Error(`CAMERA_UNAVAILABLE: cannot list cameras — ${String(err)}`);
    }
    const resolved = resolveCameraId(settings.camera.deviceId, cameras);
    if (!resolved.ok) throw new Error(`${resolved.code}: ${resolved.message}`);
    return resolved.deviceId;
  }

  private async closeActiveCapture() {
    if (!this.activeDeviceId) return;
    try {
      await this.svc("camio").client!.request("capture.close", { deviceId: this.activeDeviceId });
    } catch (err) {
      console.warn("[hub] capture.close failed:", err);
    }
    this.activeDeviceId = null;
  }

  private async startPipeline(p: { identityId: string | null }) {
    this.requireOnboarding();
    const settings = loadSettings();
    const camio = this.svc("camio");
    const vision = this.svc("vision");

    let ringIn: string;
    if (p.identityId) {
      const identity = this.store.getIdentity(p.identityId);
      if (!identity) throw new Error("unknown identity");
      if (!identity.consented) {
        // TS-01: consent gate is blocking
        throw new Error("identity has no consent attestation and cannot be used");
      }
    }

    const deviceId = await this.resolveCamera(settings);
    await this.closeActiveCapture();

    const session = randomUUID();
    this.activeSessionId = session;
    this.store.insertSession({ id: session, mode: "live", startedAt: Date.now() });
    ringIn = `qbcam.${session.slice(0, 4)}.frames.in`;
    const ringOut = `qbcam.${session.slice(0, 4)}.frames.out`;

    try {
      await camio.client!.request("capture.open", {
        deviceId,
        width: settings.camera.width,
        height: settings.camera.height,
        fps: settings.camera.fps,
        format: settings.camera.format,
        ringIn,
      });
    } catch (err) {
      throw asFriendlyError(err);
    }
    this.activeDeviceId = deviceId;

    const identityBindings = p.identityId
      ? [{ selector: { mode: "largest" }, identityId: p.identityId }]
      : [];
    try {
      const result = await vision.client!.request<Record<string, unknown>>("pipeline.start", {
        ringIn,
        ringOut,
        preset: settings.pipeline.preset,
        identityBindings,
      });
      const preview = await vision.client!.request<{ port: number; token: string }>("preview.info");
      this.activeRingOut = ringOut;
      return {
        ...result,
        ringOut,
        session,
        deviceId,
        synthetic: deviceId.startsWith("fake"),
        previewPort: preview.port,
        previewToken: preview.token,
      };
    } catch (err) {
      await this.closeActiveCapture();
      this.activeRingOut = null;
      this.activeSessionId = null;
      throw asFriendlyError(err);
    }
  }

  private async stopPipeline() {
    if (this.activeRecording) {
      try {
        await this.stopRecording();
      } catch (err) {
        console.warn("[hub] stopRecording during stopPipeline failed:", err);
      }
    }
    try {
      await this.svc("vision").client!.request("pipeline.stop");
    } catch (err) {
      console.warn("[hub] pipeline.stop failed:", err);
    }
    await this.closeActiveCapture();
    this.activeRingOut = null;
    this.activeSessionId = null;
    this.activeRecording = null;
    return { ok: true };
  }

  // ---------- recorder ----------

  private async startRecording() {
    const settings = loadSettings();
    const recorder = this.svc("recorder");
    if (!this.activeRingOut) {
      throw new Error("pipeline not running — start the pipeline before recording");
    }
    const dir = settings.record.dir.replace("~", process.env.HOME ?? "~");
    mkdirSync(dir, { recursive: true });
    const res = await recorder.client!.request<{ recordingId: string; path: string }>(
      "recorder.start",
      {
        ringOut: this.activeRingOut,
        container: settings.record.container,
        codec: settings.record.codec,
        audio: settings.record.audio,
        outputDir: dir,
      },
    );
    this.activeRecording = res;
    return res;
  }

  private async stopRecording() {
    if (!this.activeRecording) throw new Error("not recording");
    const recorder = this.svc("recorder");
    const res = await recorder.client!.request<{
      recordingId: string;
      path: string;
      durationMs: number;
      bytes: number;
      signed: boolean;
    }>("recorder.stop");
    this.store.insertRecording({
      id: res.recordingId,
      sessionId: this.activeSessionId,
      path: res.path,
      durationMs: res.durationMs,
      bytes: res.bytes,
      codec: loadSettings().record.codec,
      container: loadSettings().record.container,
      createdAt: Date.now(),
    });
    // TS-02: provenance is mandatory on saved outputs (not removable via UI)
    let signed = false;
    try {
      const media = this.svc("media");
      const sign = await media.client!.request<{ signed: boolean; sidecarPath: string }>(
        "media.sign",
        { path: res.path, kind: "recording", faceSwap: true },
      );
      signed = sign.signed;
      this.store.insertProvenance({
        id: randomUUID(),
        assetId: res.recordingId,
        manifestJson: sign.sidecarPath,
        signer: "qb-media/xmp-v0",
        signedAt: Date.now(),
      });
    } catch (err) {
      console.warn("[hub] provenance signing failed:", err);
    }
    this.activeRecording = null;
    return { ...res, signed };
  }

  private async captureStill(p: { format: string }) {
    const media = this.svc("media");
    const dir = defaultOutputDirs().snapshots;
    mkdirSync(dir, { recursive: true });
    const res = await media.client!.request<{ paths: string[]; signed: boolean }>("still.capture", {
      mode: "single",
      format: p.format ?? "png",
      outputDir: dir,
      ringOut: this.activeRingOut ?? "",
    });
    if (!this.activeRingOut) {
      return { paths: [], signed: false, error: "pipeline not running" };
    }
    for (const path of res.paths) {
      const snapshotId = randomUUID();
      this.store.insertSnapshot({
        id: snapshotId,
        sessionId: this.activeSessionId,
        path,
        w: 0,
        h: 0,
        format: p.format ?? "png",
        createdAt: Date.now(),
      });
      if (res.signed) {
        this.store.insertProvenance({
          id: randomUUID(),
          assetId: snapshotId,
          manifestJson: `${path}.xmp`,
          signer: "qb-media/xmp-v0",
          signedAt: Date.now(),
        });
      }
    }
    return res;
  }

  // ---------- vcam ----------

  private async toggleVcam(on: boolean) {
    const vcam = this.svc("vcam");
    const settings = loadSettings();
    if (on) {
      await vcam.client!.request("vcam.start", {
        ringOut: `qbcam.vcam.${Date.now().toString(36)}.frames.out`,
        width: settings.vcam.width,
        height: settings.vcam.height,
        fps: settings.vcam.fps,
        format: "NV12",
      });
    } else {
      await vcam.client!.request("vcam.stop");
    }
    this.vcamOn = on;
    return { on };
  }

  // ---------- models ----------

  private async setByoModel(p: SetByoParams) {
    if (!p.licenseAccepted) {
      throw new Error("license must be accepted before using a bring-your-own model");
    }
    const file = Bun.file(p.path);
    if (!(await file.exists())) throw new Error(`model file not found: ${p.path}`);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await file.arrayBuffer());
    const sha256 = hasher.digest("hex");
    this.store.upsertModel({
      id: p.modelId,
      kind: "swapper",
      version: "byo",
      license: "user-provided",
      sha256,
      installed: true,
      byoPath: p.path,
    });
    return { ok: true, sha256 };
  }
}

interface ImportIdentityParams {
  paths: string[];
  name: string;
  consentStatement: string;
}

interface SetByoParams {
  modelId: string;
  path: string;
  licenseAccepted: boolean;
}

/** Sidecars encode failures as JSON strings; turn them into actionable errors. */
function asFriendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const start = raw.indexOf("{");
  if (start !== -1) {
    try {
      const payload = JSON.parse(raw.slice(start, raw.lastIndexOf("}") + 1)) as {
        code?: string;
        message?: string;
        detail?: string;
      };
      if (payload.code) {
        const detail = payload.detail ? ` — ${payload.detail}` : "";
        return new Error(`${payload.code}: ${payload.message ?? "capture failed"}${detail}`);
      }
    } catch {
      // not a structured sidecar error
    }
  }
  return new Error(raw);
}
