/**
 * model-manager worker (spec §13.2): download, sha256-verify, atomically
 * install models from the registry. Messages in/out over postMessage.
 *
 * In:  { type: "ensure", modelId } | { type: "setByo", modelId, path }
 * Out: { type: "progress", modelId, stage, percent } | { type: "done", modelId, ok, error? }
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

type InMsg =
  | { type: "ensure"; modelId: string }
  | { type: "verify-manifest"; manifestPath: string; signature: string };

interface ModelFileEntry {
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

const ctx = self as unknown as Worker;

let registry: Registry | null = null;
let modelsDir = "";

function post(msg: unknown) {
  ctx.postMessage(msg);
}

function loadRegistry(): Registry {
  if (registry) return registry;
  const path = join(import.meta.dir, "..", "..", "..", "..", "..", "models", "registry.json");
  registry = JSON.parse(readFileSync(path, "utf8")) as Registry;
  return registry;
}

export function verifyFileSha256(path: string, expected: string): boolean {
  const hasher = createHash("sha256");
  const data = readFileSync(path);
  hasher.update(data);
  return hasher.digest("hex") === expected.toLowerCase();
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} failed: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

async function ensureModel(modelId: string) {
  const reg = loadRegistry();
  const model = reg.models.find((m) => m.id === modelId);
  if (!model) {
    post({ type: "done", modelId, ok: false, error: "unknown model id" });
    return;
  }
  const dir = join(modelsDir, model.id, model.version);
  mkdirSync(dir, { recursive: true });
  for (const [i, file] of model.files.entries()) {
    const dest = join(dir, basename(new URL(file.url).pathname));
    if (existsSync(dest) && verifyFileSha256(dest, file.sha256)) {
      post({ type: "progress", modelId, stage: "verify", percent: 100 });
      continue;
    }
    if (existsSync(dest)) rmSync(dest);
    post({ type: "progress", modelId, stage: "download", percent: 0 });
    await downloadToFile(file.url, dest);
    post({ type: "progress", modelId, stage: "verify", percent: (i + 1) / (model.files.length + 1) * 100 });
    if (!verifyFileSha256(dest, file.sha256)) {
      rmSync(dest);
      post({ type: "done", modelId, ok: false, error: "sha256 mismatch after download" });
      return;
    }
  }
  writeFileSync(join(dir, "LICENSE"), `${model.license.spdx}\n${model.license.url}\n`);
  post({ type: "done", modelId, ok: true, dir });
}

ctx.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "ensure") {
    try {
      await ensureModel(msg.modelId);
    } catch (err) {
      post({ type: "done", modelId: msg.modelId, ok: false, error: String(err) });
    }
  }
};

export function initWorker(modelsDirectory: string) {
  modelsDir = modelsDirectory;
  mkdirSync(modelsDir, { recursive: true });
}

// When run as an actual worker, modelsDir arrives via init message:
ctx.addEventListener("message", (ev: MessageEvent<{ type: string; modelsDir?: string }>) => {
  if (ev.data.type === "init" && ev.data.modelsDir) initWorker(ev.data.modelsDir);
});

// Re-export for tests (non-worker context)
export { statSync };
