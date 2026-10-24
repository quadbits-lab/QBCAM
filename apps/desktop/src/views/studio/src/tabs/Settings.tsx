import { useEffect, useState } from "react";
import { rpc } from "../api";
import { useStudio } from "../store";

export function SettingsTab() {
  const s = useStudio();
  const [settings, setSettingsState] = useState<any>(null);

  useEffect(() => {
    rpc("getSettings")
      .then(setSettingsState)
      .catch((e) => s.setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(p: Record<string, unknown>) {
    const next = await rpc("setSettings", { patch: p });
    setSettingsState(next);
  }

  if (!settings) return <div className="flex-1 p-6 text-sm text-[var(--text-1)]">Loading…</div>;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-4 text-lg font-semibold">Settings</h1>
      <div className="max-w-xl space-y-6">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Camera</h2>
          <label className="block text-xs text-[var(--text-1)]">
            Device ID ("auto", "fake", or camera index)
            <input
              defaultValue={settings.camera.deviceId}
              onBlur={(e) => patch({ camera: { deviceId: e.target.value } })}
              className="mono mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-0)] px-3 py-2 text-xs"
            />
          </label>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Fail-safe (FR-109)</h2>
          <p className="mb-2 text-xs text-[var(--text-1)]">
            What viewers see if the pipeline stalls. Default is slate — never raw passthrough (ADR-009).
          </p>
          <select
            defaultValue={settings.pipeline.failSafe}
            onChange={(e) => patch({ pipeline: { failSafe: e.target.value } })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-0)] px-3 py-2 text-sm"
          >
            <option value="slate">Slate (QBCAM — not streaming)</option>
            <option value="freeze">Freeze last frame</option>
            <option value="passthrough">Passthrough raw</option>
          </select>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Privacy</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              defaultChecked={settings.privacy.crashReports}
              onChange={(e) => patch({ privacy: { crashReports: e.target.checked } })}
            />
            Send crash reports (opt-in; never images or paths)
          </label>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Hotkeys (defaults)</h2>
          <ul className="mono space-y-1 text-xs text-[var(--text-1)]">
            {Object.entries(settings.hotkeys).map(([k, v]) => (
              <li key={k}>
                {k}: {v as string}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
