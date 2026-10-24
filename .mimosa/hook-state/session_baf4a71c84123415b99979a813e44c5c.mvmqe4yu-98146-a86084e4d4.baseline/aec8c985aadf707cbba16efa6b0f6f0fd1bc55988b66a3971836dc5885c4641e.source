/**
 * Process helpers for tool scripts — argv arrays only, shell: false.
 * Mirrors apps/desktop/src/main/supervisor/spawn-safe.ts conventions:
 * arguments come from typed option objects, never from user input, and no
 * shell is involved anywhere.
 */
import { spawn as nodeSpawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
}

/** Run a subprocess to completion, capturing stdout (argv array, no shell). */
export function runCapture(options: {
  argv: readonly string[];
  timeoutMs?: number;
}): Promise<RunResult> {
  const [exe, ...rest] = options.argv;
  if (!exe) return Promise.resolve({ code: 1, stdout: "empty argv" });
  const child = nodeSpawn(exe, rest, { shell: false, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout?.on("data", (d) => (out += d.toString()));
  const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 30_000);
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out });
    });
  });
}

/** Long-running sidecar-style spawn with inherited stdio. */
export function runLong(options: {
  interpreterPath: string;
  extraArgs: readonly string[];
  env: Record<string, string | undefined>;
}) {
  const child = nodeSpawn(options.interpreterPath, options.extraArgs, {
    shell: false,
    env: options.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  return {
    exited: new Promise<number | null>((resolve) => child.once("exit", (c) => resolve(c))),
    kill: () => child.kill("SIGTERM"),
    pid: child.pid,
  };
}
