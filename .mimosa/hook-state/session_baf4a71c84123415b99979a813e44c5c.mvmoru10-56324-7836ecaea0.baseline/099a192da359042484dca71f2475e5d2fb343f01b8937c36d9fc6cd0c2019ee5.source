import { useState } from "react";
import { rpc } from "../api";
import { useStudio } from "../store";

/** Models — §13.3: BYO swap weights are never bundled; license must be
 * accepted explicitly before use. */
export function ModelsTab() {
  const s = useStudio();
  const [byoPath, setByoPath] = useState("");
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-4 text-lg font-semibold">Models</h1>
      <div className="mb-6 space-y-2">
        {s.models.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-1)] px-4 py-3">
            <div>
              <span className="text-sm font-medium">{m.id}</span>
              <span className="ml-2 rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-xs">{m.kind}</span>
              <p className="text-xs text-[var(--text-1)]">
                v{m.version || "—"} · {m.licenseSpdx || "user-provided"} ·{" "}
                {m.commercialUse ? "commercial ok" : "NOT commercial"} ·{" "}
                {m.installed ? "installed" : "not installed"}
                {m.byo ? " · BYO" : ""}
              </p>
            </div>
            {!m.installed && !m.byo && (
              <button
                onClick={async () => {
                  await rpc("ensureModels", { modelIds: [m.id] }).catch((e) => s.setError(String(e)));
                  const models = await rpc<{ models: [] }>("listModels");
                  s.setModels(models.models);
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white"
              >
                Download
              </button>
            )}
          </div>
        ))}
      </div>

      <section className="max-w-xl rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
        <h2 className="mb-2 text-sm font-semibold">Bring your own swap model</h2>
        <p className="mb-3 text-xs text-[var(--text-1)]">
          QBCAM never bundles or redistributes face-swap weights (spec §13.3). Point it at an
          inswapper_128-class ONNX file you are licensed to use. You accept its license by loading it.
        </p>
        <input
          value={byoPath}
          onChange={(e) => setByoPath(e.target.value)}
          placeholder="/path/to/inswapper_128.onnx"
          className="mono mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-0)] px-3 py-2 text-xs"
        />
        <label className="mb-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I confirm I hold a valid license for this model file
        </label>
        <button
          disabled={!accepted || !byoPath}
          onClick={async () => {
            try {
              await rpc("setByoModel", { modelId: "swapper-byo", path: byoPath, licenseAccepted: accepted });
              const models = await rpc<{ models: [] }>("listModels");
              s.setModels(models.models);
              s.setToast("BYO model registered");
            } catch (err: any) {
              s.setError(err.message ?? String(err));
            }
          }}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Register model
        </button>
      </section>
    </div>
  );
}
