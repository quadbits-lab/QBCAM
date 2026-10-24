/**
 * Main-process glue for model installs (spec §13.2).
 *
 * Deliberately in-process: the desktop bundler emits only the main entrypoint,
 * so a `new Worker(new URL("./…worker.ts", import.meta.url))` would point at a
 * file that does not exist in the bundle and the UI would hang forever. The
 * payload is a few hundred KB; fetch/hash work is negligible on the main loop.
 */
import { mkdirSync } from "node:fs";
import { modelsDir } from "../paths";
import { ensureModel, type ModelProgress } from "./model-store";

export interface ModelManagerHandle {
  ensure(modelId: string): Promise<void>;
  terminate(): void;
  setProgressListener(fn: (m: ModelProgress) => void): void;
  setDoneListener(fn: (m: { modelId: string; ok: boolean; error?: string }) => void): void;
}

export function startModelManager(): ModelManagerHandle {
  const dir = modelsDir();
  mkdirSync(dir, { recursive: true });
  let progressListener: ((m: ModelProgress) => void) | null = null;
  let doneListener: ((m: { modelId: string; ok: boolean; error?: string }) => void) | null = null;

  return {
    async ensure(modelId: string) {
      try {
        await ensureModel(modelId, dir, (m) => progressListener?.(m));
        doneListener?.({ modelId, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        doneListener?.({ modelId, ok: false, error: message });
        throw new Error(message);
      }
    },
    terminate() {
      // Nothing to tear down: installs are awaited by the RPC handler.
    },
    setProgressListener(fn) {
      progressListener = fn;
    },
    setDoneListener(fn) {
      doneListener = fn;
    },
  };
}
