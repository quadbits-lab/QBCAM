/**
 * Record + vcam integration: camio (fake) → vision → out ring →
 *   qb-recorder (10s MP4, ffprobe-validated) + qb-vcam-mock (client counts).
 * UNSANDBOXED required (cross-process shm).
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { rpcClient } from "./ipc.ts";
import { runCapture, runLong } from "./proc.ts";

const ROOT = join(import.meta.dir, "..", "..");
const PY = join(ROOT, ".venv/bin/python3");
const SESSION = randomBytes(2).toString("hex");
const RING_IN = `qbcam.${SESSION}.frames.in`;
const RING_OUT = `qbcam.${SESSION}.frames.out`;
const TMP_OUT = "/tmp/qbcam-int-recordings";

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

function spawn(name: string, bin: string, extraArgs: string[] = []) {
  return runLong({
    interpreterPath: bin,
    extraArgs,
    env: {
      ...process.env,
      QB_SOCKET: `/tmp/qbcam-int-${name}.sock`,
      QB_TOKEN: "int-token",
      QB_SERVICE_NAME: name,
    },
  });
}

const camioProc = spawn("camio", join(ROOT, "target/debug/qb-camio"));
const visionProc = spawn("vision", PY, ["-m", "qb_vision.server"]);
const recorderProc = spawn("recorder", join(ROOT, "target/debug/qb-recorder"));
const vcamProc = spawn("vcam", join(ROOT, "target/debug/qb-vcam-mock"));
await Bun.sleep(800);

const camio = await rpcClient("/tmp/qbcam-int-camio.sock", "int-token", "camio");
const vision = await rpcClient("/tmp/qbcam-int-vision.sock", "int-token", "vision");
const recorder = await rpcClient("/tmp/qbcam-int-recorder.sock", "int-token", "recorder");
const vcam = await rpcClient("/tmp/qbcam-int-vcam.sock", "int-token", "vcam");
console.log("✔ all sidecars ready");

// pipeline
await camio.request("capture.open", {
  deviceId: "fake", width: 1280, height: 720, fps: 30, format: "MJPG", ringIn: RING_IN,
});
const start = await vision.request("pipeline.start", {
  ringIn: RING_IN, ringOut: RING_OUT, preset: "balanced", identityBindings: [],
});
console.log(`✔ pipeline up (ep=${start.executionProvider})`);
await Bun.sleep(1000);

// vcam attach (mock) — §8.2 contract
const describe = await vcam.request("vcam.describe");
if (describe.deviceName !== "QBCAM Virtual Camera") fail("TS-03: device name must be honest");
await vcam.request("vcam.start", { ringOut: RING_OUT, width: 1280, height: 720, fps: 30, format: "NV12" });
await Bun.sleep(500);
const clients = await vcam.request("vcam.describe");
if (clients.activeClients < 1) fail("vcam mock shows no active clients");
console.log("✔ vcam mock streaming, clients =", clients.activeClients);

// record 8 seconds
const rec = await recorder.request("recorder.start", {
  ringOut: RING_OUT, container: "mp4", codec: "h264", audio: "off", outputDir: TMP_OUT,
});
console.log(`✔ recording → ${rec.path}`);
await Bun.sleep(8000);
const stopped = await recorder.request("recorder.stop");
console.log(`✔ recording stopped: ${stopped.durationMs}ms, ${stopped.bytes} bytes`);
if (stopped.durationMs < 5000) fail("recording too short");

// ffprobe validation
const probe = await runCapture({
  argv: ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,codec_name,duration", "-of", "json", rec.path],
});
const info = JSON.parse(probe.stdout);
const stream = info.streams?.[0];
console.log("ffprobe:", JSON.stringify(stream));
if (!stream || stream.codec_name !== "h264") fail("recording is not h264");
if (stream.width !== 1280 || stream.height !== 720) fail("unexpected resolution");

// vcam consumed frames — allow the consumer thread to notice stop
await vcam.request("vcam.stop");
let drained = false;
for (let i = 0; i < 40; i++) {
  const after = await vcam.request("vcam.describe");
  if (after.activeClients === 0) {
    drained = true;
    break;
  }
  await Bun.sleep(100);
}
if (!drained) fail("vcam clients did not drain");

// cleanup
await vision.request("pipeline.stop");
await camio.request("capture.close", { deviceId: "fake" });
vision.close(); camio.close(); recorder.close(); vcam.close();
visionProc.kill(); camioProc.kill(); recorderProc.kill(); vcamProc.kill();
console.log("\n✔ integration-record PASSED");
process.exit(0);
