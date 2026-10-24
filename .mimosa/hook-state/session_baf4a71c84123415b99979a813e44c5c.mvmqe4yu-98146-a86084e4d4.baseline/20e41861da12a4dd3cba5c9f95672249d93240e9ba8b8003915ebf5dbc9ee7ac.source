import { useState } from "react";
import { rpc } from "./api";
import { useStudio } from "./store";

/** First-run wizard (spec §12.5): acceptable use, model download, done. */
export function Wizard() {
  const s = useStudio();
  const [step, setStep] = useState<WizardStep>(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog" aria-modal>
      <div className="w-[560px] rounded-2xl bg-[var(--bg-1)] p-6 shadow-2xl">
        {step === 0 && (
          <>
            <h1 className="mb-3 text-lg font-semibold">Welcome to QBCAM</h1>
            <p className="mb-2 text-sm text-[var(--text-1)]">
              QBCAM swaps faces in real time. By using it you agree to the acceptable-use terms:
            </p>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-[var(--text-1)]">
              <li>Only use faces you own or have explicit permission to use.</li>
              <li>No impersonation, fraud, or non-consensual imagery.</li>
              <li>Outputs are marked as synthetic media (on-stream badge + embedded provenance).</li>
              <li>Everything runs locally; no face data leaves this machine by default.</li>
            </ul>
            <button
              onClick={() => setStep(1)}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              I agree
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="mb-3 text-lg font-semibold">Models</h1>
            <p className="mb-4 text-sm text-[var(--text-1)]">
              Download the face detector (Apache-2.0, ~230 KB). Swap models are bring-your-own
              (Models tab) — QBCAM never bundles them.
            </p>
            <button
              onClick={async () => {
                try {
                  await rpc("ensureModels", { modelIds: ["detector-yunet"] });
                  const models = await rpc<{ models: [] }>("listModels");
                  s.setModels(models.models);
                } catch (err: any) {
                  s.setError(err.message ?? String(err));
                }
                setStep(2);
              }}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Download detector
            </button>{" "}
            <button onClick={() => setStep(2)} className="rounded-lg bg-[var(--bg-2)] px-4 py-2 text-sm">
              Skip
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="mb-3 text-lg font-semibold">You're set</h1>
            <p className="mb-4 text-sm text-[var(--text-1)]">
              Head to Studio, press Start Pipeline (uses the fake camera if none configured), and
              record or enable the virtual camera.
            </p>
            <button
              onClick={() => {
                localStorage.setItem("qbcam.wizardDone", "1");
                s.setToast(null);
              }}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Open Studio
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type WizardStep = 0 | 1 | 2;
