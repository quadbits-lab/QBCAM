import { useRef } from "react";
import type { RefObject } from "react";
import { rpc } from "../api";
import { useStudio } from "../store";

export function StudioTab({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const s = useStudio();
  const previewRef = useRef<HTMLDivElement>(null);

  async function togglePipeline() {
    try {
      if (!s.pipelineOn) {
        const res = await rpc<{ executionProvider: string; previewPort?: number; previewToken?: string }>(
          "startPipeline",
          { identityId: s.selectedIdentity },
        );
        s.setPipelineOn(true);
        if (res.previewPort && res.previewToken) s.setPreview(res.previewPort, res.previewToken);
        else {
          const info = await rpc<{ port: number; token: string }>("getPreview");
          s.setPreview(info.port, info.token);
        }
      } else {
        await rpc("stopPipeline");
        s.setPipelineOn(false);
        s.setPreview(0, "");
      }
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    }
  }

  async function toggleBypass() {
    const on = !s.bypass;
    try {
      await rpc("bypass", { on });
      s.setBypass(on);
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    }
  }

  async function toggleRecord() {
    try {
      if (!s.recording) {
        await rpc("startRecording");
        s.setRecording(true);
      } else {
        await rpc("stopRecording");
        s.setRecording(false);
        const lib = await rpc<{ items: [] }>("listLibrary");
        s.setLibrary(lib.items);
      }
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    }
  }

  async function snapshot() {
    try {
      await rpc("captureStill", { format: "png" });
      s.setToast("snapshot saved");
      setTimeout(() => s.setToast(null), 2000);
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    }
  }

  async function toggleVcam() {
    try {
      await rpc("toggleVcam", { on: !s.vcamOn });
      s.setVcamOn(!s.vcamOn);
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* left: source identity */}
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-1)] p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-1)]">
          Source identity
        </h2>
        <div className="space-y-1">
          <button
            onClick={() => s.setSelectedIdentity(null)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
              !s.selectedIdentity ? "bg-[var(--bg-2)] ring-1 ring-[var(--accent)]" : "hover:bg-[var(--bg-2)]"
            }`}
          >
            None (detection only)
          </button>
          {s.identities.map((id) => (
            <button
              key={id.id}
              onClick={() => s.setSelectedIdentity(id.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                s.selectedIdentity === id.id
                  ? "bg-[var(--bg-2)] ring-1 ring-[var(--accent)]"
                  : "hover:bg-[var(--bg-2)]"
              }`}
            >
              {id.name}
              <span className="ml-2 text-xs text-[var(--text-1)]">
                q{(id.quality * 100).toFixed(0)}
              </span>
            </button>
          ))}
          {s.identities.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--text-1)]">
              No identities yet — import one in the Identities tab.
            </p>
          )}
        </div>
      </aside>

      {/* center: preview */}
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-4" ref={previewRef}>
        <div className="relative w-full max-w-3xl overflow-hidden rounded-xl border border-[var(--border)] bg-black">
          <canvas ref={canvasRef} width={1280} height={720} className="block w-full" aria-label="Live preview" />
          {s.stats.bypassed && (
            <span className="absolute top-3 left-3 rounded bg-[var(--danger)] px-2 py-0.5 text-xs font-semibold">
              BYPASS ACTIVE
            </span>
          )}
          {/* face badges */}
          {s.faces.map((f) => (
            <span
              key={f.trackId}
              className="pointer-events-none absolute rounded border border-[var(--accent-2)] px-1 text-xs text-[var(--accent-2)]"
              style={{
                left: `${(f.x / 1280) * 100}%`,
                top: `${(f.y / 720) * 100}%`,
              }}
            >
              [{f.trackId}]
            </span>
          ))}
        </div>
        <div className="mono flex gap-4 text-xs text-[var(--text-1)]" aria-live="off">
          <span>{s.stats.fps.toFixed(1)} FPS</span>
          <span className={s.stats.frameMs > 50 ? "text-[var(--danger)]" : ""}>
            {s.stats.frameMs.toFixed(1)} ms
          </span>
          <span>EP: {s.stats.executionProvider}</span>
          <span>faces: {s.stats.faces}</span>
        </div>
      </section>

      {/* right: controls */}
      <aside className="w-64 shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-1)] p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-1)]">
          Quality
        </h2>
        <div className="mb-4 space-y-1">
          {["fast", "balanced", "quality"].map((p) => (
            <button
              key={p}
              onClick={() => rpc("setPreset", { preset: p }).catch((e) => s.setError(String(e)))}
              className="w-full rounded-lg px-3 py-1.5 text-left text-sm capitalize hover:bg-[var(--bg-2)]"
            >
              {p}
            </button>
          ))}
        </div>

        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-1)]">
          Blend
        </h2>
        <div className="space-y-3 pb-4">
          {(
            [
              ["maskFeather", "Feather"],
              ["colorMatch", "Color"],
              ["sharpen", "Sharpen"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs text-[var(--text-1)]">
              {label}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                defaultValue={key === "maskFeather" ? 0.6 : key === "colorMatch" ? 0.5 : 0.2}
                onChange={(e) => rpc("setBlend", { [key]: Number(e.target.value) }).catch(() => {})}
                className="mt-1 w-full accent-[var(--accent)]"
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              defaultChecked
              onChange={(e) => rpc("setBlend", { keepMouth: e.target.checked }).catch(() => {})}
              className="accent-[var(--accent)]"
            />
            Keep mouth
          </label>
        </div>
      </aside>

      {/* bottom action bar */}
      <footer className="fixed inset-x-0 bottom-0 flex items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-1)] px-4 py-3">
        <button
          onClick={togglePipeline}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            s.pipelineOn
              ? "bg-[var(--bg-2)] ring-1 ring-[var(--accent-2)] text-[var(--accent-2)]"
              : "bg-[var(--accent)] text-white"
          }`}
        >
          {s.pipelineOn ? "Stop Pipeline" : "Start Pipeline"}
        </button>
        <button
          onClick={toggleBypass}
          aria-keyshortcuts="F9"
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            s.bypass ? "bg-[var(--danger)] text-white" : "bg-[var(--bg-2)] text-[var(--text-0)]"
          }`}
          title="Panic bypass — always visible (FR-108)"
        >
          ⛔ Bypass (F9)
        </button>
        <button
          onClick={toggleRecord}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            s.recording ? "bg-[var(--danger)] text-white" : "bg-[var(--bg-2)] text-[var(--text-0)]"
          }`}
        >
          {s.recording ? "■ Stop Recording" : "⏺ Record"}
        </button>
        <button onClick={snapshot} className="rounded-lg bg-[var(--bg-2)] px-4 py-2 text-sm">
          📸 Snapshot
        </button>
        <button
          onClick={toggleVcam}
          className={`rounded-lg px-4 py-2 text-sm ${
            s.vcamOn ? "bg-[var(--accent-2)] text-black" : "bg-[var(--bg-2)]"
          }`}
        >
          🔌 Virtual Cam: {s.vcamOn ? "ON" : "OFF"}
        </button>
        {s.recording && (
          <span className="mono ml-auto text-[var(--danger)]" aria-live="polite">
            ● REC
          </span>
        )}
      </footer>
    </div>
  );
}
