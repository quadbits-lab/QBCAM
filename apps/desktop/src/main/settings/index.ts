/** Settings store — defaults from contracts (Appendix B), user file overrides. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "@qbcam/contracts/settings";
import { dataDir } from "../paths";

const FILE = () => join(dataDir(), "settings.json");

export function loadSettings(): Settings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  try {
    if (!existsSync(FILE())) return defaults;
    const user = JSON.parse(readFileSync(FILE(), "utf8")) as Partial<Settings>;
    return deepMerge(defaults, user) as Settings;
  } catch (err) {
    console.warn("[settings] failed to load user settings, using defaults:", err);
    return defaults;
  }
}

export function saveSettings(patch: Record<string, unknown>): Settings {
  const current = loadSettings();
  const next = deepMerge(current, patch) as Settings;
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(FILE(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  // An explicit null clears a field (e.g. resetting onboarding.completedAt).
  if (patch === null) return null as T;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return patch as T;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}
