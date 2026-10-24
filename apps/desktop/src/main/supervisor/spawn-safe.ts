/**
 * Safe sidecar launch — argv arrays only, shell: false everywhere.
 *
 * Design note: sidecar executables and arguments come exclusively from the
 * static services registry (see src/main/services-registry.ts) and are never
 * derived from user input. No shell is involved at any point.
 */
import { spawn as nodeSpawn } from "node:child_process";

export interface SidecarProcess {
  exited: Promise<number | null>;
  kill(signal?: string | number): void;
  pid: number | undefined;
}

/** Spawn a Bun TypeScript sidecar (own runtime). */
export function spawnBunSidecar(options: {
  scriptPath: string;
  extraArgs: readonly string[];
  env: Record<string, string | undefined>;
  onExit: (code: number | null) => void;
}): SidecarProcess {
  const child = nodeSpawn(process.execPath, ["run", options.scriptPath, ...options.extraArgs], {
    shell: false,
    env: options.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => options.onExit(code));
  return {
    exited: new Promise((resolve) => child.once("exit", (code) => resolve(code))),
    kill: (signal) => child.kill((signal ?? "SIGTERM") as NodeJS.Signals),
    pid: child.pid,
  };
}

/** Spawn an external interpreter sidecar (e.g. Python via the project venv). */
export function spawnInterpSidecar(options: {
  interpreterPath: string;
  extraArgs: readonly string[];
  env: Record<string, string | undefined>;
  onExit: (code: number | null) => void;
}): SidecarProcess {
  const child = nodeSpawn(options.interpreterPath, options.extraArgs, {
    shell: false,
    env: options.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => options.onExit(code));
  return {
    exited: new Promise((resolve) => child.once("exit", (code) => resolve(code))),
    kill: (signal) => child.kill((signal ?? "SIGTERM") as NodeJS.Signals),
    pid: child.pid,
  };
}
