import {
  Ban,
  Camera,
  Circle,
  Disc3,
  Gauge,
  ImageDown,
  MonitorPlay,
  Play,
  Square,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { RefObject } from "react";
import { useRef, useState } from "react";
import { rpc } from "../api";
import { Badge, Button, cn, EmptyState, StatusDot } from "../components/ui";
import { useStudio } from "../store";

type Inspector = "quality" | "blend" | "output";

export function StudioTab({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const s = useStudio();
  const previewRef = useRef<HTMLDivElement>(null);
  const [inspector, setInspector] = useState<Inspector>("quality");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  async function togglePipeline() {
    setStarting(!s.pipelineOn);
    setStopping(s.pipelineOn);
    try {
      if (!s.pipelineOn) {
        const res = await rpc<{
          executionProvider: string;
          previewPort?: number;
          previewToken?: string;
          deviceId?: string;
          synthetic?: boolean;
        }>("startPipeline", { identityId: s.selectedIdentity });
        s.setPipelineOn(true);
        s.setActiveDevice(res.deviceId ?? null, !!res.synthetic);
        if (res.previewPort && res.previewToken) s.setPreview(res.previewPort, res.previewToken);
        else {
          const info = await rpc<{ port: number; token: string }>("getPreview");
          s.setPreview(info.port, info.token);
        }
        s.setDegraded(null);
      } else {
        await rpc("stopPipeline");
        s.setPipelineOn(false);
        s.setPreview(0, "");
        s.setActiveDevice(null, false);
        s.setFaces([]);
        s.setRecording(false);
      }
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
      setStopping(false);
    }
  }

  async function toggleBypass() {
    const on = !s.bypass;
    try {
      await rpc("bypass", { on });
      s.setBypass(on);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
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
        s.setToast({ message: "Recording saved", kind: "success" });
      }
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function snapshot() {
    try {
      await rpc("captureStill", { format: "png" });
      s.setToast({ message: "Snapshot saved", kind: "success" });
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleVcam() {
    try {
      await rpc("toggleVcam", { on: !s.vcamOn });
      s.setVcamOn(!s.vcamOn);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedName =
    s.identities.find((i) => i.id === s.selectedIdentity)?.name ?? "Detection only";
  const configuredCamera = s.setup?.cameras.find(
    (c) => c.id === s.setup?.camera.deviceId || `name:${c.name}` === s.setup?.camera.deviceId,
  );
  const cameraName = s.synthetic
    ? "Synthetic camera"
    : (s.setup?.cameras.find((c) => c.id === s.activeDeviceId)?.name ??
      configuredCamera?.name ??
      (s.setup?.camera.deviceId === "auto" ? "Auto camera" : "Camera idle"));

  return (
    <div className="relative flex h-full min-h-0">
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-[var(--line-soft)] bg-[var(--surface)] p-3">
        <div className="label mb-2">Source identity</div>
        <div className="space-y-1">
          <IdentityButton
            active={!s.selectedIdentity}
            onClick={() => s.setSelectedIdentity(null)}
            title="None"
            detail="detection only"
          />
          {s.identities.map((identity) => (
            <IdentityButton
              key={identity.id}
              active={s.selectedIdentity === identity.id}
              onClick={() => s.setSelectedIdentity(identity.id)}
              title={identity.name}
              detail={`quality ${Math.round(identity.quality * 100)}%`}
            />
          ))}
          {s.identities.length === 0 && (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-[var(--faint)]">
              No identities imported. Detection-only mode still runs the pipeline.
            </p>
          )}
        </div>

        <div className="mt-5 border-t border-[var(--line-soft)] pt-3">
          <div className="label mb-2">Input</div>
          <div className="rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] p-2.5 text-[11px]">
            <div className="flex items-center gap-2">
              <Camera size={13} className="text-[var(--muted)]" />
              <span className="truncate">{cameraName}</span>
            </div>
            <div className="mono mt-1 text-[9px] uppercase tracking-wider text-[var(--faint)]">
              {s.setup?.camera.width ?? 1280}×{s.setup?.camera.height ?? 720} ·{" "}
              {s.setup?.camera.fps ?? 30} fps
            </div>
            {s.synthetic && (
              <Badge tone="warn" className="mt-2">
                synthetic source
              </Badge>
            )}
          </div>
        </div>
      </aside>

      <section
        className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 pb-20"
        ref={previewRef}
      >
        {s.degraded && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs text-[var(--warn)]">
            <TriangleAlert size={14} />
            <span className="font-medium">{s.degraded.reason}</span>
            {s.degraded.error && (
              <span className="mono text-[10px] text-[var(--muted)]">{s.degraded.error}</span>
            )}
            <span className="ml-auto text-[10px] text-[var(--faint)]">
              Fail-safe is rendering a slate — raw frames are never passed through.
            </span>
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-[var(--line)] bg-black">
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="block max-h-full max-w-full object-contain"
            aria-label="Live preview"
          />
          {!s.pipelineOn && (
            <div className="absolute inset-0">
              <EmptyState
                icon={<MonitorPlay size={34} />}
                title="Pipeline is idle"
                description="Start the pipeline to see live capture, face detection and the swap output. The synthetic source works without a camera."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void togglePipeline()}
                    disabled={starting}
                  >
                    <Play size={14} /> {starting ? "Starting…" : "Start pipeline"}
                  </Button>
                }
              />
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
            <div className="flex flex-wrap gap-2">
              {s.synthetic ? (
                <Badge tone="warn">SYNTHETIC MEDIA</Badge>
              ) : (
                s.pipelineOn && <Badge tone="accent">LIVE</Badge>
              )}
              {s.bypass && <Badge tone="rec">BYPASS</Badge>}
              {s.recording && (
                <Badge tone="rec">
                  <Circle size={8} className="pulse fill-current" /> REC{" "}
                  {formatTime(s.recorderSeconds)}
                </Badge>
              )}
            </div>
            <div className="mono flex gap-2">
              <HudChip
                label="FPS"
                value={s.stats.fps.toFixed(0)}
                tone={s.stats.fps < 20 ? "warn" : "ok"}
              />
              <HudChip
                label="FRAME"
                value={`${s.stats.frameMs.toFixed(1)}ms`}
                tone={s.stats.frameMs > 50 ? "rec" : "neutral"}
              />
              <HudChip label="FACES" value={String(s.stats.faces)} tone="info" />
            </div>
          </div>

          {s.faces.map((face) => (
            <span
              key={face.trackId}
              className="pointer-events-none absolute rounded border border-[var(--accent)]/70 px-1"
              style={{
                left: `${(face.x / 1280) * 100}%`,
                top: `${(face.y / 720) * 100}%`,
                width: `${(face.w / 1280) * 100}%`,
                height: `${(face.h / 720) * 100}%`,
              }}
            >
              <span className="mono absolute -top-4 left-0 text-[9px] text-[var(--accent)]">
                {face.trackId}
              </span>
            </span>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <MiniStat icon={<Users size={13} />} label="Selected source" value={selectedName} />
          <MiniStat
            icon={<Gauge size={13} />}
            label="Execution provider"
            value={s.stats.executionProvider}
          />
          <MiniStat
            icon={<MonitorPlay size={13} />}
            label="Virtual camera"
            value={s.vcamOn ? "broadcasting" : "off"}
            tone={s.vcamOn ? "accent" : "neutral"}
          />
        </div>
      </section>

      <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-[var(--line-soft)] bg-[var(--surface)] p-3 pb-20 xl:block">
        <div className="mb-3 grid grid-cols-3 rounded-md border border-[var(--line)] p-0.5">
          {(["quality", "blend", "output"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setInspector(id)}
              className={cn(
                "rounded px-1 py-1.5 text-[11px] capitalize transition-colors",
                inspector === id
                  ? "bg-[var(--surface-2)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]",
              )}
            >
              {id}
            </button>
          ))}
        </div>

        {inspector === "quality" && <QualityPanel />}
        {inspector === "blend" && <BlendPanel />}
        {inspector === "output" && (
          <OutputPanel vcamOn={s.vcamOn} onVcam={() => void toggleVcam()} recording={s.recording} />
        )}
      </aside>

      <footer className="absolute bottom-0 left-60 right-0 flex flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 xl:right-72">
        <Button
          variant={s.pipelineOn ? "secondary" : "primary"}
          size="sm"
          onClick={() => void togglePipeline()}
          disabled={starting || stopping}
        >
          {s.pipelineOn ? <Square size={13} /> : <Play size={13} />}
          {s.pipelineOn
            ? stopping
              ? "Stopping…"
              : "Stop pipeline"
            : starting
              ? "Starting…"
              : "Start pipeline"}
        </Button>
        <Button
          variant={s.bypass ? "danger" : "secondary"}
          size="sm"
          onClick={() => void toggleBypass()}
          aria-keyshortcuts="F9"
          title="Panic bypass (F9) — always visible"
        >
          <Ban size={13} /> Bypass
        </Button>
        <Button
          variant={s.recording ? "danger" : "secondary"}
          size="sm"
          onClick={() => void toggleRecord()}
        >
          <Disc3 size={13} /> {s.recording ? "Stop recording" : "Record"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void snapshot()}>
          <ImageDown size={13} /> Snapshot
        </Button>
        <Button
          variant={s.vcamOn ? "primary" : "secondary"}
          size="sm"
          onClick={() => void toggleVcam()}
        >
          <MonitorPlay size={13} /> Virtual cam {s.vcamOn ? "on" : "off"}
        </Button>
        <div className="mono ml-auto hidden items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--faint)] sm:flex">
          <StatusDot tone={s.pipelineOn ? "ok" : "neutral"} />
          {s.pipelineOn ? `${s.stats.fps.toFixed(1)} fps` : "pipeline idle"}
        </div>
      </footer>
    </div>
  );
}

function IdentityButton({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
        active
          ? "border-[var(--accent)]/50 bg-[var(--accent)]/10"
          : "border-transparent hover:bg-[var(--surface-2)]",
      )}
    >
      <span className="block truncate text-xs font-medium">{title}</span>
      <span className="mono mt-0.5 block text-[9px] uppercase tracking-wider text-[var(--faint)]">
        {detail}
      </span>
    </button>
  );
}

function HudChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "rec" | "info" | "neutral";
}) {
  return (
    <span className="rounded border border-white/15 bg-black/55 px-2 py-1 text-[9px] uppercase tracking-wider text-white backdrop-blur">
      <span className="text-white/50">{label} </span>
      <span
        className={cn(
          tone === "warn" && "text-[var(--warn)]",
          tone === "rec" && "text-[var(--rec)]",
          tone === "ok" && "text-[var(--accent)]",
          tone === "info" && "text-[var(--info)]",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "accent";
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2">
      <span className={tone === "accent" ? "text-[var(--accent)]" : "text-[var(--faint)]"}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="label block">{label}</span>
        <span className="block truncate text-xs">{value}</span>
      </span>
    </div>
  );
}

function QualityPanel() {
  const s = useStudio();
  const [preset, setPreset] = useState("balanced");
  return (
    <div className="space-y-3">
      <div className="label">Preset</div>
      <div className="grid grid-cols-3 gap-1">
        {["fast", "balanced", "quality"].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setPreset(p);
              rpc("setPreset", { preset: p }).catch((e) => s.setError(String(e)));
            }}
            className={cn(
              "rounded border px-1 py-1.5 text-[11px] capitalize",
              preset === p
                ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--line-soft)] text-[var(--muted)] hover:text-[var(--text)]",
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="rounded-md border border-[var(--line-soft)] p-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
        Detection interval and swap cadence adapt automatically. The governor raises the interval
        when p95 frame time exceeds the budget.
      </div>
    </div>
  );
}

function BlendPanel() {
  const s = useStudio();
  const sliders = [
    ["maskFeather", "Mask feather", 0.6],
    ["colorMatch", "Color match", 0.5],
    ["sharpen", "Sharpen", 0.2],
  ] as const;
  return (
    <div className="space-y-4">
      {sliders.map(([key, label, initial]) => (
        <label key={key} className="block">
          <span className="label mb-1.5 flex items-center justify-between">
            <span>{label}</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={initial}
            onChange={(e) => rpc("setBlend", { [key]: Number(e.target.value) }).catch(() => {})}
            className="w-full accent-[var(--accent)]"
          />
        </label>
      ))}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          defaultChecked
          onChange={(e) => rpc("setBlend", { keepMouth: e.target.checked }).catch(() => {})}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Keep source mouth
      </label>
      <p className="text-[10px] leading-relaxed text-[var(--faint)]">
        {s.stats.executionProvider} · blend runs per tracked face.
      </p>
    </div>
  );
}

function OutputPanel({
  vcamOn,
  onVcam,
  recording,
}: {
  vcamOn: boolean;
  onVcam: () => void;
  recording: boolean;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-md border border-[var(--line-soft)] p-2.5">
        <div className="flex items-center justify-between">
          <span className="label">Virtual camera</span>
          <Badge tone={vcamOn ? "accent" : "neutral"}>{vcamOn ? "on" : "off"}</Badge>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
          Exposes the processed frames as “QBCAM Virtual Camera” to other apps.
        </p>
        <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={onVcam}>
          {vcamOn ? "Stop virtual camera" : "Start virtual camera"}
        </Button>
      </div>
      <div className="rounded-md border border-[var(--line-soft)] p-2.5">
        <div className="flex items-center justify-between">
          <span className="label">Recorder</span>
          <Badge tone={recording ? "rec" : "neutral"}>{recording ? "recording" : "idle"}</Badge>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
          Recordings are fragmented MP4 with a provenance sidecar. Audio capture is not available
          yet.
        </p>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
