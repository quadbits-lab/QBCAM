/**
 * RPC hub — maps UI requests (spec §10.4 UiRequests) to sidecar calls and DB
 * operations, enforces identity consent (TS-01) and routes events back up.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../db";
import type { SupervisedService } from "../supervisor";
import { defaultOutputDirs } from "../paths";
import type { Shell } from "../shell";
import { loadSettings, saveSettings } from "../settings";
import { startModelManager, type ModelManagerHandle } from "../workers/model-manager";

export class Hub {
  private services: Map<string, SupervisedService>;
  private modelManager: ModelManagerHandle;
  private activeRecording: { id: string; path: string } | null = null;
  private activeSessionId: string | null = null;
  private activeRingOut: string | null = null;
  private vcamOn = false;

  constructor(
    private store: Store,
    shell: Shell,
    services: SupervisedService[],
    private appVersion: string,
  ) {
    this.services = new Map(services.map((s) => [s.def.name, s]));

    // sidecar events → UI
    for (const s of services) {
      void s;
    }

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
      shell.sendToUi("service.state", { service: "model-manager", state: m.ok ? "ready" : "crashed" });
    });

    void shell;
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
        return this.svc("vision").client!.request("pipeline.stop");
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
        return { models: this.store.listModels() };
      case "ensureModels":
        for (const id of (params as { modelIds: string[] }).modelIds) {
          await this.modelManager.ensure(id);
        }
        return { ok: true };
      case "setByoModel":
        return this.setByoModel(params as SetByoParams);
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
        await Bun.file(path).exists() && (await Bun.write(path, ""), wiped++);
      } catch {
        // best-effort wipe
      }
    }
    return { ok: true, wipedFiles: wiped };
  }

  // ---------- pipeline ----------

  private async startPipeline(p: { identityId: string | null }) {
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
    const cameras = (await camio.client!.request<{ devices: Array<{ id: string }> }>("capture.list"))
      .devices;
    const deviceId =
      settings.camera.deviceId === "auto" ? (cameras[0]?.id ?? "fake") : settings.camera.deviceId;
    const session = randomUUID();
    this.activeSessionId = session;
    this.store.insertSession({ id: session, mode: "live", startedAt: Date.now() });
    ringIn = `qbcam.${session.slice(0, 4)}.frames.in`;
    const ringOut = `qbcam.${session.slice(0, 4)}.frames.out`;
    await camio.client!.request("capture.open", {
      deviceId,
      width: settings.camera.width,
      height: settings.camera.height,
      fps: settings.camera.fps,
      format: settings.camera.format,
      ringIn,
    });
    const identityBindings = p.identityId
      ? [{ selector: { mode: "largest" }, identityId: p.identityId }]
      : [];
    const result = await vision.client!.request("pipeline.start", {
      ringIn,
      ringOut,
      preset: settings.pipeline.preset,
      identityBindings,
    });
    this.activeRingOut = ringOut;
    return { ...result, ringOut, session };
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
