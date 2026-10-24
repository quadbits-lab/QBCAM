import { Camera, Check, Mic, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../api";
import { Page, Section } from "../components/Page";
import { Badge, Button, Field, Input, Select, StatusDot, Toggle } from "../components/ui";
import { useStudio } from "../store";

type SettingsShape = {
  camera: { deviceId: string; width: number; height: number; fps: number; format: string };
  pipeline: { failSafe: string };
  record: { dir: string };
  privacy: { crashReports: boolean; telemetry: boolean };
  trust: { invisibleWatermark: boolean; visibleWatermark: boolean; c2pa: boolean };
  hotkeys: Record<string, string>;
};

export function SettingsTab({ onRunSetup }: { onRunSetup: () => Promise<void> }) {
  const s = useStudio();
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    rpc<SettingsShape>("getSettings")
      .then(setSettings)
      .catch((e) => s.setError(String(e)));
  }, [s.setError]);

  async function patch(p: Record<string, unknown>) {
    setSaving(true);
    try {
      const next = await rpc<SettingsShape>("setSettings", { patch: p });
      setSettings(next);
      const setup = await rpc<import("../store").SetupStatus>("getSetupStatus");
      s.setSetup(setup);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <Page title="Settings" description="Loading configuration…">
        <div className="mono text-xs text-[var(--faint)]">reading settings.json</div>
      </Page>
    );
  }

  const setup = s.setup;
  const realCameras = setup?.cameras.filter((c) => c.kind !== "audio") ?? [];
  const matchedCamera = realCameras.find(
    (c) => c.id === settings.camera.deviceId || `name:${c.name}` === settings.camera.deviceId,
  );
  const currentCameraValue =
    settings.camera.deviceId === "fake"
      ? "fake"
      : settings.camera.deviceId === "auto"
        ? "auto"
        : matchedCamera
          ? `name:${matchedCamera.name}`
          : "auto";

  return (
    <Page
      title="Settings"
      description="Devices, pipeline behavior, permissions, privacy and hotkeys."
      actions={
        <Button variant="secondary" size="sm" onClick={() => void onRunSetup()}>
          <RotateCcw size={14} /> Run setup again
        </Button>
      }
    >
      <Section title="Devices" description="Capture source and output geometry.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Camera" hint="Synthetic mode is always available.">
            <Select
              value={currentCameraValue}
              onChange={(e) => {
                const value = e.target.value;
                void patch({
                  camera: { deviceId: value === "auto" && !realCameras[0] ? "fake" : value },
                });
              }}
            >
              <option value="auto">Auto — first available camera</option>
              {realCameras.map((c) => (
                <option key={`${c.id}-${c.name}`} value={`name:${c.name}`}>
                  {c.name}
                  {c.kind === "screen" ? " (screen)" : ""}
                </option>
              ))}
              <option value="fake">Synthetic camera</option>
            </Select>
          </Field>
          <Field label="Capture profile">
            <Select
              value={`${settings.camera.width}x${settings.camera.height}@${settings.camera.fps}`}
              onChange={(e) => {
                const [size, fps] = e.target.value.split("@");
                const [width, height] = size.split("x").map(Number);
                void patch({ camera: { width, height, fps: Number(fps) } });
              }}
            >
              <option value="1280x720@30">1280×720 · 30 fps</option>
              <option value="1280x720@60">1280×720 · 60 fps</option>
              <option value="1920x1080@30">1920×1080 · 30 fps</option>
              <option value="1920x1080@60">1920×1080 · 60 fps</option>
            </Select>
          </Field>
          <Field label="Fail-safe (FR-109)" hint="Never raw passthrough by default.">
            <Select
              value={settings.pipeline.failSafe}
              onChange={(e) => void patch({ pipeline: { failSafe: e.target.value } })}
            >
              <option value="slate">Slate — “QBCAM not streaming”</option>
              <option value="freeze">Freeze last good frame</option>
              <option value="passthrough">Passthrough raw</option>
            </Select>
          </Field>
          <Field label="Recording folder">
            <Input
              defaultValue={settings.record.dir}
              onBlur={(e) => void patch({ record: { dir: e.target.value } })}
              className="mono text-xs"
            />
          </Field>
        </div>
        {saving && <p className="mt-2 text-[11px] text-[var(--faint)]">saving…</p>}
      </Section>

      <Section title="Permissions" description="macOS attributes capture to the app bundle.">
        <div className="grid gap-2 sm:grid-cols-2">
          <PermissionRow
            icon={<Camera size={15} />}
            label="Camera"
            state={setup?.onboarding.cameraPermission ?? "unknown"}
            onOpen={() => void rpc("openSystemSettings", { pane: "camera" })}
          />
          <PermissionRow
            icon={<Mic size={15} />}
            label="Microphone"
            state={setup?.onboarding.microphonePermission ?? "unknown"}
            onOpen={() => void rpc("openSystemSettings", { pane: "microphone" })}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
          If a prompt was denied, open the pane, enable QBCAM, then restart the app. Dev builds may
          need <span className="mono">bun run --cwd apps/desktop permissions:reset</span>.
        </p>
      </Section>

      <Section title="Appearance" description="Theme is stored locally.">
        <div className="flex items-center gap-4">
          <Toggle
            checked={s.theme === "light"}
            onChange={(light) => s.setTheme(light ? "light" : "dark")}
            label="Light theme"
          />
          <Badge tone="neutral">{s.theme}</Badge>
        </div>
      </Section>

      <Section title="Privacy" description="Nothing is uploaded by default.">
        <div className="space-y-3">
          <Toggle
            checked={settings.privacy.crashReports}
            onChange={(v) => void patch({ privacy: { crashReports: v } })}
            label="Send crash reports (no images or paths)"
          />
          <Toggle
            checked={settings.privacy.telemetry}
            onChange={(v) => void patch({ privacy: { telemetry: v } })}
            label="Send anonymous telemetry"
          />
          <Toggle
            checked={settings.trust.c2pa}
            onChange={(v) => void patch({ trust: { c2pa: v } })}
            label="Provenance sidecars (C2PA-shaped)"
          />
        </div>
      </Section>

      <Section
        title="Hotkeys"
        description="Defaults; remapping lands with the native hotkey service."
      >
        <ul className="divide-y divide-[var(--line-soft)] rounded-md border border-[var(--line-soft)]">
          {Object.entries(settings.hotkeys).map(([key, value]) => (
            <li key={key} className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="capitalize text-[var(--muted)]">
                {key.replace(/([A-Z])/g, " $1")}
              </span>
              <span className="mono rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px]">
                {value}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Safety rails" description="These invariants cannot be disabled.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Invariant icon={<ShieldCheck size={14} />} label="Consent gate per identity" />
          <Invariant icon={<Check size={14} />} label="Synthetic badge while running" />
          <Invariant icon={<SlidersHorizontal size={14} />} label="Fail-safe slate on stall" />
          <Invariant icon={<Check size={14} />} label="Provenance on every output" />
        </div>
      </Section>
    </Page>
  );
}

function PermissionRow({
  icon,
  label,
  state,
  onOpen,
}: {
  icon: React.ReactNode;
  label: string;
  state: "granted" | "denied" | "unknown";
  onOpen: () => void;
}) {
  const tone = state === "granted" ? "ok" : state === "denied" ? "rec" : "neutral";
  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2.5">
      <span className="text-[var(--muted)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          <Badge tone={tone}>{state}</Badge>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        Open
      </Button>
    </div>
  );
}

function Invariant({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--line-soft)] px-3 py-2 text-xs text-[var(--muted)]">
      <StatusDot tone="ok" />
      <span className="text-[var(--faint)]">{icon}</span>
      {label}
    </div>
  );
}
