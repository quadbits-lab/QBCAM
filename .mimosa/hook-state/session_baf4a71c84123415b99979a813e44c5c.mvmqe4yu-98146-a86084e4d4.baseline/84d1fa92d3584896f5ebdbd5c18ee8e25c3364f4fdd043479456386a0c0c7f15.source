/**
 * Live pipeline integration: qb-camio (fake camera) → qb-vision (YuNet +
 * stub swap) → output ring. Mirrors qb-core's orchestration. Must run
 * UNSANDBOXED (POSIX shm across processes is scoped per process tree in dev
 * sandboxes).
 *
 * Usage: bun run tools/scripts/integration-live.ts
 * Exit 0 on success: out-ring seq advances, pipeline.stats reports fps > 0.
 */
import { randomBytes } from "node:crypto";
import { connect } from "bun";
import { join } from "node:path";
import { runCapture, runLong } from "./proc.ts";

const ROOT = join(import.meta.dir, "..", "..");
const SESSION = randomBytes(2).toString("hex");
const RING_IN = `qbcam.${SESSION}.frames.in`;
const RING_OUT = `qbcam.${SESSION}.frames.out`;

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

type Client = Awaited<ReturnType<typeof rpcClient>>;

async function rpcClient(sockPath: string, token: string, name: string) {
  let pendingId = 1;
  const pending = new Map<number, (v: any) => void>();
  const events: Array<{ method: string; params: any }> = [];
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));
  const sock = await connect({
    unix: sockPath,
    socket: {
      open(s) {
        s.write(JSON.stringify({ jsonrpc: "2.0", method: "hello", params: { token } }) + "\n");
      },
      data(_s, chunk) {
        for (const line of new TextDecoder().decode(chunk).trim().split("\n")) {
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.method === "ready") {
            readyResolve();
          } else if (m.method) {
            events.push({ method: m.method, params: m.params });
          } else if (m.id && pending.has(m.id)) {
            pending.get(m.id)!(m);
            pending.delete(m.id);
          }
        }
      },
      close() {},
      error() {},
    },
  });
  await ready;
  return {
    name,
    events,
    async request<T = any>(method: string, params: any = {}): Promise<T> {
      const id = pendingId++;
      const p = new Promise<any>((resolve) => pending.set(id, resolve));
      sock.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      const resp = await Promise.race([p, Bun.sleep(10_000).then(() => ({ error: { message: "timeout" } }))]);
      if (resp.error) throw new Error(`${name}.${method}: ${resp.error.message}`);
      return resp.result as T;
    },
    close() {
      sock.end();
    },
  };
}

const camioBin = join(ROOT, "target/debug/qb-camio");
const camioProc = runLong({
  interpreterPath: camioBin,
  extraArgs: [],
  env: {
    ...process.env,
    QB_SOCKET: "/tmp/qbcam-int-camio.sock",
    QB_TOKEN: "int-token",
    QB_SERVICE_NAME: "camio",
  },
});
await Bun.sleep(500);
const camio = await rpcClient("/tmp/qbcam-int-camio.sock", "int-token", "camio");
console.log("✔ camio ready");

await camio.request("capture.open", {
  deviceId: "fake",
  width: 1280,
  height: 720,
  fps: 30,
  format: "MJPG",
  ringIn: RING_IN,
});
console.log(`✔ capture.open → ${RING_IN}`);

const pyBin = join(ROOT, ".venv/bin/python3");
const py = runLong({
  interpreterPath: pyBin,
  extraArgs: ["-m", "qb_vision.server"],
  env: {
    ...process.env,
    QB_SOCKET: "/tmp/qbcam-int-vision.sock",
    QB_TOKEN: "int-token",
    QB_SERVICE_NAME: "vision",
  },
});
await Bun.sleep(1500);
const vision = await rpcClient("/tmp/qbcam-int-vision.sock", "int-token", "vision");
console.log("✔ vision ready");

const start = await vision.request("pipeline.start", {
  ringIn: RING_IN,
  ringOut: RING_OUT,
  preset: "balanced",
  identityBindings: [],
});
console.log(`✔ pipeline.start ep=${start.executionProvider}`);

// let it run 5 seconds
await Bun.sleep(5000);

// read the output ring with the standalone Python probe (args only)
const probe = await runCapture({
  argv: [pyBin, join(ROOT, "tools/scripts/ring_probe.py"), RING_OUT],
});
const probeOut = probe.stdout.trim();
console.log(`out-ring probe: ${probeOut}`);
if (!probeOut.startsWith("OK")) fail("output ring produced no frames");

const statsEvents = vision.events.filter((e) => e.method === "pipeline.stats");
const last = statsEvents.at(-1)?.params;
console.log(
  `pipeline.stats: fps=${last?.fps} frameMs=${last?.frameMs} faces=${last?.faces} ep=${last?.executionProvider}`,
);
if (!last || last.fps <= 0) fail("no positive fps in pipeline.stats");
if (!statsEvents.some((e) => e.params.fps > 10)) fail("fps never exceeded 10");

await vision.request("pipeline.stop");
await camio.request("capture.close", { deviceId: "fake" });
vision.close();
camio.close();
py.kill();
camioProc.kill();
console.log("\n✔ integration-live PASSED");
process.exit(0);
