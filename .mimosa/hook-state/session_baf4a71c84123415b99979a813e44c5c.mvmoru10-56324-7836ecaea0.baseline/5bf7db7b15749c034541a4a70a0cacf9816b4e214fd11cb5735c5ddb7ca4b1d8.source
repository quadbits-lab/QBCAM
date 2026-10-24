/**
 * qb-core — Bun main process entry (spec §6 qb-core).
 * Wires: DB, settings, supervisor + sidecars, shell adapter, RPC hub.
 * Headless shell by default; Electrobun shell attaches in P8 via SHELL=electrobun.
 */
import { Hub } from "./rpc/hub";
import { Store } from "./db";
import { SupervisedService } from "./supervisor";
import { sidecarServices } from "./services-registry";
import { HeadlessShell } from "./shell/headless";
import { runDir, logsDir, defaultOutputDirs, dataDir } from "./paths";
import { mkdirSync } from "node:fs";

const VERSION = "0.1.0";

async function main() {
  mkdirSync(logsDir(), { recursive: true });
  mkdirSync(runDir(), { recursive: true });
  const dirs = defaultOutputDirs();
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const store = new Store(dataDir());
  const shell = new HeadlessShell();
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
          if (method === "pipeline.stats" || method === "pipeline.faces" || method === "recorder.progress") {
            shell.sendToUi(method, params);
          } else {
            console.log(`[event ${name}] ${method}`, JSON.stringify(params).slice(0, 200));
          }
        },
      ),
  );

  const hub = new Hub(store, shell, services, VERSION);

  shell.onRequest(async ({ method, params }) => hub.dispatch(method, params));
  await shell.start();

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
  async function shutdown() {
    console.log("[core] shutting down");
    for (const s of services) await s.stop();
    await shell.stop();
    store.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[core] fatal:", err);
  process.exit(1);
});