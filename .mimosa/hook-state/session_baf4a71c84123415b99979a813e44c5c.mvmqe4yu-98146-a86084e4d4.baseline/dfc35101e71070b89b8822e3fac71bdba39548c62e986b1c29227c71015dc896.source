/**
 * Static services registry — the ONLY place sidecar executables/args are
 * defined. Nothing user-supplied ever reaches here.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ServiceLaunch } from "./supervisor";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** Workspace .venv python (uv workspace root env). */
function venvPython(): string {
  const candidate = join(ROOT, ".venv", "bin", "python3");
  if (existsSync(candidate)) return candidate;
  const fallback = join(ROOT, ".venv", "bin", "python");
  if (existsSync(fallback)) return fallback;
  return "python3";
}

/** Rust debug binaries from the cargo workspace target dir. */
function targetBin(name: string): string {
  return join(ROOT, "target", "debug", name);
}

export interface ServiceEntry {
  name: string;
  launch: ServiceLaunch;
}

export function sidecarServices(): ServiceEntry[] {
  const py = venvPython();
  const entries: ServiceEntry[] = [
    {
      name: "camio",
      launch: { kind: "interp", interpreterPath: targetBin("qb-camio"), args: [] },
    },
    {
      name: "vision",
      launch: {
        kind: "interp",
        interpreterPath: py,
        args: ["-m", "qb_vision.server"],
      },
    },
    {
      name: "recorder",
      launch: { kind: "interp", interpreterPath: targetBin("qb-recorder"), args: [] },
    },
    {
      name: "vcam",
      launch: { kind: "interp", interpreterPath: targetBin("qb-vcam-mock"), args: [] },
    },
    {
      name: "media",
      launch: {
        kind: "interp",
        interpreterPath: py,
        args: ["-m", "qb_media.server"],
      },
    },
  ];
  return entries;
}

export const REPO_ROOT = ROOT;
