/**
 * license:gate — release blocker (spec §13.3). Fails if any model scheduled
 * for BUNDLING (files present in a release) has commercialUse=false, or if
 * the registry contains placeholder hashes for bundlable models.
 * BYO models (files: []) are explicitly allowed — they are user-provided.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const registry = JSON.parse(readFileSync(join(ROOT, "models", "registry.json"), "utf8")) as {
  models: Array<{
    id: string;
    files: Array<{ sha256: string }>;
    license: { spdx: string; commercialUse: boolean };
    byo?: unknown;
  }>;
};

let failed = false;
for (const model of registry.models) {
  const isByo = model.files.length === 0 && model.byo !== undefined;
  if (isByo) {
    console.log(`✔ ${model.id}: BYO (never bundled) — ok`);
    continue;
  }
  if (!model.license.commercialUse) {
    console.error(`✘ ${model.id}: license ${model.license.spdx} is not commercial-use — cannot bundle`);
    failed = true;
    continue;
  }
  for (const file of model.files) {
    if (file.sha256.startsWith("PLACEHOLDER")) {
      console.error(`✘ ${model.id}: placeholder sha256 — run bun run models:dev first`);
      failed = true;
    }
  }
  console.log(`✔ ${model.id}: ${model.license.spdx}, commercialUse=true — ok`);
}

if (failed) {
  console.error("\nlicense gate FAILED — see spec §13.3");
  process.exit(1);
}
console.log("\nlicense gate passed");
