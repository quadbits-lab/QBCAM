/** App data directories per OS (spec §11.2). */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Repository root. Prefers QBCAM_ROOT, then walks up from cwd (Hutch runs the
 * bundled main process with the app directory as cwd), and only then falls
 * back to the compiled module location (plain `bun run`).
 */
export function repoRoot(): string {
  const override = process.env.QBCAM_ROOT;
  if (override) return override;
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "Cargo.toml")) && existsSync(join(dir, "apps", "desktop"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(import.meta.dir, "..", "..", "..", "..");
}

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
