/**
 * qb-core — Bun main process entry (spec §6 qb-core).
 * Wires: DB, settings, supervisor + sidecars, shell adapter, RPC hub.
 * Defaults to the headless shell; the Electrobun entrypoint
 * (`electrobun-entry.ts`) injects the native-window shell instead.
 */

import { mkdirSync } from "node:fs";
import { Store } from "./db";
import { dataDir, defaultOutputDirs, logsDir, runDir } from "./paths";
import { Hub } from "./rpc/hub";
import { sidecarServices } from "./services-registry";
import type { Shell } from "./shell";
import { HeadlessShell } from "./shell/headless";
import { SupervisedService } from "./supervisor";

const VERSION = "0.1.0";

export async function main(shell: Shell = new HeadlessShell()) {
  mkdirSync(logsDir(), { recursive: true });
  mkdirSync(runDir(), { recursive: true });
  const dirs = defaultOutputDirs();
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const store = new Store(dataDir());
  const services = sidecarServices().map(
    (entry) =>
      new SupervisedService(
        { name: entry.name, launch: entry.launch },
        runDir(),
        (name, state) => {
          shell.sendToUi("service.state", { service: name, state });
          console.log(`[core] service ${name}: ${state}`);
        },
        (name, method, params) => {
          // forward sidecar events to UI; pipeline stats + faces are the hot ones
          if (
            method === "pipeline.stats" ||
            method === "pipeline.faces" ||
            method === "pipeline.degraded" ||
            method === "pipeline.recovered" ||
            method === "recorder.progress"
          ) {
            shell.sendToUi(method, params);
          } else {
            console.log(`[event ${name}] ${method}`, JSON.stringify(params).slice(0, 200));
          }
        },
      ),
  );

  const hub = new Hub(store, shell, services, VERSION);

  shell.onRequest(async ({ method, params }) => hub.dispatch(method, params));
  shell.onQuit?.(() => shutdown());
  await shell.start();
  console.log(`[core] shell: ${shell.kind}`);

  // start sidecars (vision/media optional for basic UI boot; all supervised)
  for (const s of services) {
    try {
      await s.start();
    } catch (err) {
      console.error(`[core] failed to start ${s.def.name}:`, err);
    }
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  // Last-resort cleanup for native quit paths (Cmd+Q, crash) that cannot await.
  process.on("exit", () => {
    for (const s of services) s.killNow();
  });
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[core] shutting down");
    for (const s of services) await s.stop();
    await shell.stop();
    store.close();
    process.exit(0);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[core] fatal:", err);
    process.exit(1);
  });
}
