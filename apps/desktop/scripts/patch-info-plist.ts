/**
 * Hutch build hook — add the TCC usage strings macOS requires for camera and
 * microphone access. Without these keys the system kills/denies access when
 * ffmpeg asks for the devices.
 *
 * Runs from `postWrap` (release, before signing) and `postPackage` (dev).
 * Idempotent. No-op outside macOS.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CAMERA =
  "QBCAM uses your camera to capture and swap faces locally. Video never leaves this machine.";
const MICROPHONE =
  "QBCAM uses your microphone only to test audio input during setup. Recordings are currently video-only.";

if (process.platform !== "darwin") {
  process.exit(0);
}

const plist = findPlist();
if (!plist) {
  console.warn("[patch-info-plist] no Info.plist found; skipping");
  process.exit(0);
}

setKey(plist, "NSCameraUsageDescription", CAMERA);
setKey(plist, "NSMicrophoneUsageDescription", MICROPHONE);
console.log(`[patch-info-plist] updated ${plist}`);

function findPlist(): string | null {
  const wrapper = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
  if (wrapper) {
    const candidate = join(wrapper, "Contents", "Info.plist");
    if (existsSync(candidate)) return candidate;
  }
  if (process.env.ELECTROBUN_BUILD_ENV !== "dev") return null;
  const buildDir = process.env.ELECTROBUN_BUILD_DIR;
  if (!buildDir || !existsSync(buildDir)) return null;
  for (const entry of readdirSync(buildDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
    const candidate = join(buildDir, entry.name, "Contents", "Info.plist");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function setKey(path: string, key: string, value: string) {
  if (run(["plutil", "-replace", key, "-string", value, path])) return;
  run(["plutil", "-insert", key, "-string", value, path]);
}

function run(args: string[]): boolean {
  const res = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  return res.exitCode === 0;
}
