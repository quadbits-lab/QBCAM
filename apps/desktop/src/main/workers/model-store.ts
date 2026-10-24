/**
 * Model install logic (spec §13.2): download, sha256-verify, atomically
 * install models from the registry. Runs in the qb-core process so it works
 * under both the headless and bundled Electrobun shells (a Worker entrypoint
 * is not emitted by the desktop bundler).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { modelsDir, repoRoot } from "../paths";

export interface ModelFileEntry {
  url: string;
  sha256: string;
  bytes: number;
}

export interface RegistryModel {
  id: string;
  version: string;
  kind: string;
  files: ModelFileEntry[];
  license: { spdx: string; commercialUse: boolean; url: string };
  requires?: Record<string, string>;
  byo?: { instructions: string };
}

interface Registry {
  schema: number;
  models: RegistryModel[];
}

export interface ModelProgress {
  modelId: string;
  stage: string;
  percent: number;
}

let registry: Registry | null = null;

export function registryPath(): string {
  return process.env.QBCAM_MODELS_REGISTRY ?? join(repoRoot(), "models", "registry.json");
}

function loadRegistry(): Registry {
  if (registry) return registry;
  registry = JSON.parse(readFileSync(registryPath(), "utf8")) as Registry;
  return registry;
}

export function verifyFileSha256(path: string, expected: string): boolean {
  const hasher = createHash("sha256");
  hasher.update(readFileSync(path));
  return hasher.digest("hex") === expected.toLowerCase();
}

export function registryModels(): RegistryModel[] {
  return loadRegistry().models;
}

/** Locate a detector ONNX the same way qb-vision does (dev install or app data). */
export function findDetectorPath(): string | null {
  const bases = [join(repoRoot(), "models", "install"), modelsDir(), join(repoRoot(), "models")];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const found = walkForOnnx(base, "yunet");
    if (found) return found;
  }
  return null;
}

function walkForOnnx(dir: string, needle: string, depth = 0): string | null {
  if (depth > 4) return null;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
  } catch {
    return null;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = walkForOnnx(path, needle, depth + 1);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().includes(needle) && entry.name.endsWith(".onnx")) {
      return path;
    }
  }
  return null;
}

export interface ModelStatus {
  id: string;
  kind: string;
  version: string;
  licenseSpdx: string;
  commercialUse: boolean;
  byo: boolean;
  installed: boolean;
  installedPath: string | null;
}

export function modelStatuses(): ModelStatus[] {
  return registryModels().map((m) => {
    if (m.byo) {
      return {
        id: m.id,
        kind: m.kind,
        version: m.version,
        licenseSpdx: m.license.spdx,
        commercialUse: m.license.commercialUse,
        byo: true,
        installed: false,
        installedPath: null,
      };
    }
    const path = m.kind === "detector" ? findDetectorPath() : findInstalledModel(m);
    return {
      id: m.id,
      kind: m.kind,
      version: m.version,
      licenseSpdx: m.license.spdx,
      commercialUse: m.license.commercialUse,
      byo: false,
      installed: path !== null,
      installedPath: path,
    };
  });
}

export function findInstalledModel(model: RegistryModel): string | null {
  const dir = join(modelsDir(), model.id, model.version);
  if (model.files.length === 0) return null;
  for (const file of model.files) {
    const dest = join(dir, basename(new URL(file.url).pathname));
    if (!existsSync(dest) || !verifyFileSha256(dest, file.sha256)) return null;
  }
  return dir;
}

export function detectorInstalled(): boolean {
  return findDetectorPath() !== null;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} failed: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const part = `${dest}.part`;
  writeFileSync(part, buf);
  renameSync(part, dest);
}

export async function ensureModel(
  modelId: string,
  modelsDir: string,
  onProgress: (p: ModelProgress) => void,
): Promise<string> {
  const reg = loadRegistry();
  const model = reg.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`unknown model id: ${modelId}`);
  if (model.files.length === 0) throw new Error(`${modelId} has no downloadable files`);

  const dir = join(modelsDir, model.id, model.version);
  mkdirSync(dir, { recursive: true });

  for (const [i, file] of model.files.entries()) {
    const dest = join(dir, basename(new URL(file.url).pathname));
    if (existsSync(dest) && verifyFileSha256(dest, file.sha256)) {
      onProgress({ modelId, stage: "verify", percent: 100 });
      continue;
    }
    if (existsSync(dest)) rmSync(dest);

    onProgress({ modelId, stage: "download", percent: 0 });
    await downloadToFile(file.url, dest);
    onProgress({
      modelId,
      stage: "verify",
      percent: ((i + 1) / (model.files.length + 1)) * 100,
    });
    if (!verifyFileSha256(dest, file.sha256)) {
      rmSync(dest, { force: true });
      throw new Error("sha256 mismatch after download");
    }
  }

  writeFileSync(join(dir, "LICENSE"), `${model.license.spdx}\n${model.license.url}\n`);
  onProgress({ modelId, stage: "done", percent: 100 });
  return dir;
}
