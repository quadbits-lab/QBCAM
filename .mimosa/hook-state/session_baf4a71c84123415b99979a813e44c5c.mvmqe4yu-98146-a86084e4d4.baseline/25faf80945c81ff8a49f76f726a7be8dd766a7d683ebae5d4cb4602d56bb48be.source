/**
 * models:dev — fetch the dev-licensed (permissive) model set into
 * models/install/, verify sha256, and stamp the registry with real hashes.
 * Weights are NEVER committed (spec §13.3).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const REGISTRY_PATH = join(ROOT, "models", "registry.json");
const INSTALL_DIR = join(ROOT, "models", "install");

interface RegistryFile {
  url: string;
  sha256: string;
  bytes: number;
}
interface RegistryModel {
  id: string;
  version: string;
  kind: string;
  files: RegistryFile[];
  license: { spdx: string; commercialUse: boolean; url: string };
  byo?: { instructions: string };
}
interface Registry {
  schema: number;
  models: RegistryModel[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;
mkdirSync(INSTALL_DIR, { recursive: true });

let mutated = false;
for (const model of registry.models) {
  if (model.files.length === 0) continue; // BYO — nothing to fetch
  for (const file of model.files) {
    const name = file.url.split("/").pop()!;
    const dest = join(INSTALL_DIR, name);
    if (!existsSync(dest)) {
      console.log(`downloading ${name} …`);
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${file.url}`);
      writeFileSync(dest, new Uint8Array(await res.arrayBuffer()));
    }
    const data = readFileSync(dest);
    const hash = createHash("sha256").update(data).digest("hex");
    if (file.sha256 === "PLACEHOLDER_FILLED_BY_MODELS_DEV") {
      file.sha256 = hash;
      file.bytes = data.length;
      mutated = true;
      console.log(`stamped ${name}: sha256=${hash.slice(0, 16)}… bytes=${data.length}`);
    } else if (file.sha256 !== hash) {
      throw new Error(`sha256 mismatch for ${name}: expected ${file.sha256}, got ${hash}`);
    } else {
      console.log(`ok ${name} (${hash.slice(0, 16)}…)`);
    }
  }
}

if (mutated) {
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  console.log("registry.json updated with real hashes — commit this");
}
console.log("models:dev complete");
