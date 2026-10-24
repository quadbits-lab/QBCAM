/** App data directories per OS (spec §11.2). */
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "QBCAM");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "QBCAM");
    default:
      return join(homedir(), ".qbcam");
  }
}

export function runDir(): string {
  return join(dataDir(), "run");
}

export function logsDir(): string {
  return join(dataDir(), "logs");
}

export function modelsDir(): string {
  return join(dataDir(), "models");
}

export function defaultOutputDirs() {
  const base = join(homedir(), "QBCAM");
  return {
    recordings: join(base, "Recordings"),
    snapshots: join(base, "Snapshots"),
    exports: join(base, "Exports"),
  };
}
