/**
 * Main-process glue for the model-manager worker (spec §13.2).
 */
import { mkdirSync } from "node:fs";
import { modelsDir } from "../paths";

export interface ModelManagerHandle {
  ensure(modelId: string): Promise<void>;
  terminate(): void;
  setProgressListener(fn: (m: { modelId: string; stage: string; percent: number }) => void): void;
  setDoneListener(fn: (m: { modelId: string; ok: boolean; error?: string }) => void): void;
}

export function startModelManager(): ModelManagerHandle {
  const dir = modelsDir();
  mkdirSync(dir, { recursive: true });
  const worker = new Worker(new URL("./model-manager.worker.ts", import.meta.url).href);
  let progressListener: ((m: { modelId: string; stage: string; percent: number }) => void) | null =
    null;
  let doneListener: ((m: { modelId: string; ok: boolean; error?: string }) => void) | null = null;
  const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

  worker.postMessage({ type: "init", modelsDir: dir });

  worker.onmessage = (ev: MessageEvent<Record<string, unknown>>) => {
    const msg = ev.data;
    if (msg.type === "progress") {
      progressListener?.(msg as { modelId: string; stage: string; percent: number });
    } else if (msg.type === "done") {
      const m = msg as { modelId: string; ok: boolean; error?: string };
      const p = pending.get(m.modelId);
      pending.delete(m.modelId);
      if (m.ok) p?.resolve();
      else p?.reject(new Error(m.error ?? "model install failed"));
      doneListener?.(m);
    }
  };

  return {
    ensure(modelId: string) {
      return new Promise((resolve, reject) => {
        pending.set(modelId, { resolve, reject });
        worker.postMessage({ type: "ensure", modelId });
      });
    },
    terminate() {
      worker.terminate();
    },
    setProgressListener(fn) {
      progressListener = fn;
    },
    setDoneListener(fn) {
      doneListener = fn;
    },
  };
}
