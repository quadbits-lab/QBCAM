import {
  Camera,
  Check,
  ChevronRight,
  Cpu,
  FolderOpen,
  ImagePlus,
  LockKeyhole,
  Mic,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../api";
import { PipelineDiagram } from "../components/PipelineDiagram";
import {
  Badge,
  Button,
  Card,
  Chip,
  cn,
  EmptyState,
  Field,
  Input,
  Meter,
  PanelHeader,
  ProgressBar,
  Select,
  StatusDot,
} from "../components/ui";
import type { Identity, SetupStatus } from "../store";
import { useStudio } from "../store";

export interface OnboardingController {
  setup: SetupStatus;
  consent: boolean;
  setConsent: (v: boolean) => void;
  cameraMode: "device" | "synthetic";
  setCameraMode: (v: "device" | "synthetic") => void;
  cameraDevice: string;
  setCameraDevice: (v: string) => void;
  micDevice: string;
  setMicDevice: (v: string) => void;
  cameraPermission: "granted" | "denied" | "unknown";
  micPermission: "granted" | "denied" | "unknown";
  cameraTest: { ok: boolean; profile?: string; error?: string } | null;
  setCameraTest: (test: { ok: boolean; profile?: string; error?: string } | null) => void;
  micLevel: number;
  setMicLevel: (level: number) => void;
  micError: string | null;
  setMicError: (message: string | null) => void;
  permissionBusy: "camera" | "mic" | null;
  requestCamera: () => Promise<void>;
  requestMic: () => Promise<void>;
  openSettings: (pane: "camera" | "microphone") => Promise<void>;
  refresh: () => Promise<void>;
  identity: Identity | null;
  setIdentity: (identity: Identity | null) => void;
  detectorReady: boolean;
  installDetector: () => Promise<void>;
  installing: boolean;
  next: () => void;
  back: () => void;
  finish: () => Promise<void>;
  finishing: boolean;
}

const CONSENT =
  "I confirm I am the person in these photos, or that I have their explicit permission to use their likeness.";

export function StepWelcome({ ctx }: { ctx: OnboardingController }) {
  return (
    <StepShell
      eyebrow="Step 01 — Before you start"
      title="A local studio for synthetic media."
      lead="QBCAM swaps faces in real time on your machine. Frames never leave the device; the app coordinates Rust capture, a Python vision pipeline and a Bun control plane."
    >
      <Card className="p-4">
        <PipelineDiagram />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Fact icon={<LockKeyhole size={16} />} title="Local by default">
          No face data, frames or recordings are uploaded. Telemetry is opt-in and empty.
        </Fact>
        <Fact icon={<ShieldCheck size={16} />} title="Synthetic, always marked">
          A visible badge and provenance sidecars accompany every output.
        </Fact>
        <Fact icon={<Sparkles size={16} />} title="Bring your own swap">
          QBCAM never bundles face-swap weights. You supply a licensed model.
        </Fact>
        <Fact icon={<ScanFace size={16} />} title="Consent is a gate">
          Identities cannot be used without a timestamped attestation.
        </Fact>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
        <input
          type="checkbox"
          checked={ctx.consent}
          onChange={(e) => ctx.setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span className="text-sm leading-relaxed">
          <span className="font-medium">I agree to the acceptable-use terms.</span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Only faces you own or have permission to use. No impersonation, fraud or non-consensual
            imagery. This attestation is stored with the app settings.
          </span>
        </span>
      </label>
    </StepShell>
  );
}

export function StepPermissions({ ctx }: { ctx: OnboardingController }) {
  const cameraName =
    ctx.setup.cameras.find((c) => c.id === ctx.cameraDevice)?.name ??
    ctx.setup.cameras.find((c) => c.kind === "camera")?.name ??
    "No camera detected";
  const micName =
    ctx.setup.audio.find((d) => d.id === ctx.micDevice || `audio:${d.id}` === ctx.micDevice)
      ?.name ?? "No microphone detected";
  return (
    <StepShell
      eyebrow="Step 02 — System access"
      title="Grant camera and microphone access."
      lead="macOS attributes capture to QBCAM, not to the terminal. The first request raises the system prompt; if it was denied earlier, use the settings shortcut."
    >
      <div className="grid gap-3">
        <PermissionCard
          icon={<Camera size={18} />}
          title="Camera"
          device={cameraName}
          state={ctx.cameraPermission}
          busy={ctx.permissionBusy === "camera"}
          onRequest={ctx.requestCamera}
          onOpen={() => ctx.openSettings("camera")}
          note="Required for live capture. You can continue with the synthetic camera instead."
        />
        <PermissionCard
          icon={<Mic size={18} />}
          title="Microphone"
          device={micName}
          state={ctx.micPermission}
          busy={ctx.permissionBusy === "mic"}
          onRequest={ctx.requestMic}
          onOpen={() => ctx.openSettings("microphone")}
          note="Used only to test input in setup. Audio recording is not available yet."
        />
      </div>
      {!ctx.setup.ffmpeg && (
        <Callout tone="rec" title="ffmpeg is missing">
          QBCAM captures through ffmpeg. Install it with{" "}
          <span className="mono">brew install ffmpeg</span> and press re-scan.
        </Callout>
      )}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void ctx.refresh()}>
          <RefreshCw size={14} /> Re-scan
        </Button>
        <span className="text-xs text-[var(--faint)]">
          Device lists refresh automatically after a permission change.
        </span>
      </div>
    </StepShell>
  );
}

export function StepDevices({ ctx }: { ctx: OnboardingController }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [sampling, setSampling] = useState(false);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cameras = ctx.setup.cameras.filter((c) => c.kind !== "audio");
  const realCameras = cameras.filter((c) => c.kind === "camera" || c.kind === "screen");
  const synthetic = ctx.cameraMode === "synthetic";

  useEffect(() => {
    let cancelled = false;
    async function sampleCamera() {
      if (synthetic || !ctx.cameraDevice) return;
      try {
        const res = await rpc<{ ok: boolean; jpegBase64?: string; profile?: string }>(
          "cameraSnapshot",
          { deviceId: ctx.cameraDevice },
        );
        if (cancelled) return;
        if (res?.jpegBase64) {
          setFrame(res.jpegBase64);
          setCaptureError(null);
          ctx.setCameraTest({ ok: true, profile: res.profile });
        }
      } catch (err) {
        if (cancelled) return;
        setFrame(null);
        const message = cleanError(err);
        setCaptureError(message);
        ctx.setCameraTest({ ok: false, error: message });
      }
      if (!cancelled) cameraTimer.current = setTimeout(sampleCamera, 1400);
    }
    setFrame(null);
    setCaptureError(null);
    void sampleCamera();
    return () => {
      cancelled = true;
      if (cameraTimer.current) clearTimeout(cameraTimer.current);
    };
  }, [ctx.cameraDevice, synthetic, ctx.setCameraTest]);

  useEffect(() => {
    let cancelled = false;
    async function sampleMic() {
      if (!ctx.micDevice) return;
      try {
        const res = await rpc<{ level: number }>("probeMicrophone", {
          deviceId: ctx.micDevice,
          ms: 300,
        });
        if (!cancelled) {
          setSampling(true);
          ctx.setMicLevel(res.level);
          ctx.setMicError(null);
        }
      } catch (err) {
        if (!cancelled) {
          ctx.setMicLevel(0);
          ctx.setMicError(cleanError(err));
        }
      }
      if (!cancelled) micTimer.current = setTimeout(sampleMic, 900);
    }
    // Microphone sampling is opt-in through the permissions step to avoid
    // repeated TCC prompts when the user skipped it.
    if (ctx.micPermission === "granted") void sampleMic();
    return () => {
      cancelled = true;
      if (micTimer.current) clearTimeout(micTimer.current);
    };
  }, [ctx.micDevice, ctx.micPermission, ctx.setMicLevel, ctx.setMicError]);

  return (
    <StepShell
      eyebrow="Step 03 — Devices"
      title="Test what the pipeline will actually see."
      lead="This still comes from the same ffmpeg capture path used by the live pipeline, not from the browser. Choose a device or continue without one."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="overflow-hidden">
          <div className="relative aspect-video w-full bg-black">
            {synthetic ? (
              <div className="scanline grid-bg absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--faint)]">
                <ScanFace size={40} />
                <span className="mono text-[10px] uppercase tracking-[0.2em]">
                  Synthetic source
                </span>
                <span className="max-w-xs text-center text-[11px] text-[var(--muted)]">
                  Deterministic test pattern — no camera access required.
                </span>
              </div>
            ) : frame ? (
              <img
                src={`data:image/jpeg;base64,${frame}`}
                alt="Live camera test frame"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--faint)]">
                {captureError ? (
                  <>
                    <TriangleAlert size={28} className="text-[var(--warn)]" />
                    <span className="max-w-sm px-6 text-center text-xs text-[var(--warn)]">
                      {captureError}
                    </span>
                  </>
                ) : (
                  <>
                    <Camera size={28} />
                    <span className="mono text-[10px] uppercase tracking-[0.2em]">
                      Waiting for first frame…
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="absolute left-3 top-3 flex gap-2">
              <Badge tone={synthetic ? "warn" : "accent"}>
                {synthetic ? "synthetic" : "live capture"}
              </Badge>
              {!synthetic && <Badge tone="neutral">720p</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] px-4 py-3 text-xs text-[var(--muted)]">
            <StatusDot
              tone={synthetic ? "warn" : captureError ? "rec" : frame ? "ok" : "neutral"}
            />
            <span>
              {synthetic
                ? "Synthetic test pattern"
                : captureError
                  ? "Capture failed"
                  : "Capturing stills every 1.4s"}
            </span>
            {ctx.cameraPermission === "denied" && !synthetic && (
              <Button variant="ghost" size="sm" onClick={() => ctx.openSettings("camera")}>
                Open camera settings
              </Button>
            )}
          </div>
        </Card>

        <div className="space-y-3">
          <Field label="Camera">
            <Select
              value={synthetic ? "fake" : ctx.cameraDevice}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "fake") ctx.setCameraMode("synthetic");
                else {
                  ctx.setCameraMode("device");
                  ctx.setCameraDevice(value);
                }
              }}
            >
              {realCameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === "screen" ? " (screen)" : ""}
                </option>
              ))}
              <option value="fake">Synthetic camera (no hardware)</option>
            </Select>
          </Field>

          <Field
            label="Microphone"
            hint={ctx.micPermission === "denied" ? "Access denied — open settings." : undefined}
          >
            <Select value={ctx.micDevice} onChange={(e) => ctx.setMicDevice(e.target.value)}>
              {ctx.setup.audio.length === 0 && <option value="audio:0">Default microphone</option>}
              {ctx.setup.audio.map((d) => (
                <option key={d.id} value={`audio:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">Input level</span>
              {sampling && <Badge tone="ok">sampling</Badge>}
            </div>
            <Meter level={ctx.micLevel} tone={ctx.micLevel > 0.75 ? "warn" : "accent"} />
            <p className="mt-2 text-[11px] text-[var(--faint)]">
              {ctx.micPermission === "granted"
                ? ctx.micLevel < 0.02
                  ? "Very quiet — speak or clap to confirm the mic is live."
                  : "Signal detected. Microphone is working."
                : "Allow microphone access in the previous step to test it."}
            </p>
            {ctx.micError && <p className="mt-1 text-[11px] text-[var(--warn)]">{ctx.micError}</p>}
          </Card>

          {realCameras.length === 0 && (
            <Callout tone="warn" title="No camera detected">
              If you expect one, grant access and re-scan. Otherwise continue with the synthetic
              camera — Studio will label it as synthetic.
            </Callout>
          )}

          <Button
            variant={synthetic ? "secondary" : "ghost"}
            size="sm"
            className="w-full"
            onClick={() => ctx.setCameraMode("synthetic")}
          >
            <ScanFace size={14} /> Continue without a camera
          </Button>
        </div>
      </div>
    </StepShell>
  );
}

export function StepModels({ ctx }: { ctx: OnboardingController }) {
  const detector = ctx.setup.models.find((m) => m.id === "detector-yunet");
  const progress = useStudio((s) => s.modelProgress["detector-yunet"]);
  return (
    <StepShell
      eyebrow="Step 04 — Models"
      title="Install the face detector."
      lead="The detector is Apache-2.0 and small. Swap weights are bring-your-own; QBCAM never downloads or bundles them."
    >
      <Card>
        <PanelHeader
          eyebrow="Required"
          title="YuNet face detector"
          action={
            detector?.installed ? (
              <Badge tone="ok">
                <Check size={11} /> installed
              </Badge>
            ) : (
              <Badge tone="warn">missing</Badge>
            )
          }
        />
        <div className="space-y-3 px-4 py-4">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span className="mono">face_detection_yunet_2023mar.onnx · Apache-2.0 · ~230 KB</span>
            <Badge tone="neutral">commercial ok</Badge>
          </div>
          {ctx.installing && (
            <div className="space-y-1.5">
              <ProgressBar percent={progress?.percent ?? 0} />
              <div className="mono text-[10px] uppercase tracking-wider text-[var(--faint)]">
                {progress?.stage ?? "starting"} · {Math.round(progress?.percent ?? 0)}%
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void ctx.installDetector()}
              disabled={ctx.installing || detector?.installed}
            >
              {detector?.installed
                ? "Detector ready"
                : ctx.installing
                  ? "Installing…"
                  : "Download detector"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void ctx.refresh()}>
              <RefreshCw size={14} /> Re-check
            </Button>
          </div>
        </div>
      </Card>

      <ByoModelCard onRegistered={() => void ctx.refresh()} />
    </StepShell>
  );
}

function ByoModelCard({ onRegistered }: { onRegistered: () => void }) {
  const [path, setPath] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    try {
      const res = await rpc<{ path: string | null }>("pickModelFile");
      if (res.path) setPath(res.path);
    } catch (err) {
      setError(cleanError(err));
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      await rpc("setByoModel", { modelId: "swapper-byo", path, licenseAccepted: accepted });
      onRegistered();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <PanelHeader eyebrow="Optional" title="Bring your own swap model" />
      <div className="space-y-3 px-4 py-4">
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          Point QBCAM at an inswapper_128-class ONNX file you are licensed to use. It is read from
          disk and never redistributed.
        </p>
        <div className="flex gap-2">
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/inswapper_128.onnx"
            className="mono text-xs"
          />
          <Button variant="secondary" size="sm" onClick={() => void browse()}>
            <FolderOpen size={14} /> Browse
          </Button>
        </div>
        <label className="flex items-start gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          I confirm I hold a valid license for this model file.
        </label>
        {error && <p className="text-xs text-[var(--warn)]">{error}</p>}
        <Button
          variant="secondary"
          size="sm"
          disabled={!path || !accepted || busy}
          onClick={() => void register()}
        >
          {busy ? "Registering…" : "Register model"}
        </Button>
      </div>
    </Card>
  );
}

export function StepIdentity({ ctx }: { ctx: OnboardingController }) {
  const [name, setName] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    try {
      const res = await rpc<{ paths: string[] }>("pickImageFiles");
      if (res.paths.length > 0) setPaths(res.paths);
      else setError("No files selected. Paste absolute paths below if the picker is unavailable.");
    } catch (err) {
      setError(cleanError(err));
    }
  }

  async function importIdentity() {
    setBusy(true);
    setError(null);
    try {
      const all = [
        ...paths,
        ...manual
          .split("\n")
          .map((p) => p.trim())
          .filter(Boolean),
      ];
      const res = await rpc<{ identityId: string; quality: number }>("importIdentity", {
        paths: all,
        name: name.trim() || "Source face",
        consentStatement: CONSENT,
      });
      ctx.setIdentity({
        id: res.identityId,
        name: name.trim() || "Source face",
        thumbPath: null,
        tags: [],
        quality: res.quality,
        createdAt: Date.now(),
        consentAttestedAt: Date.now(),
      });
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  if (ctx.identity) {
    return (
      <StepShell
        eyebrow="Step 05 — Source face"
        title="Source face ready."
        lead="The identity is bound to a consent attestation and can be selected in Studio."
      >
        <Card className="flex items-center gap-4 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
            <UserRoundCheck size={20} />
          </span>
          <div>
            <div className="text-sm font-semibold">{ctx.identity.name}</div>
            <div className="mono text-[10px] uppercase tracking-wider text-[var(--faint)]">
              quality {Math.round(ctx.identity.quality * 100)}% · consent recorded
            </div>
          </div>
        </Card>
        <Button variant="ghost" size="sm" onClick={() => ctx.setIdentity(null)}>
          Import another
        </Button>
      </StepShell>
    );
  }

  return (
    <StepShell
      eyebrow="Step 05 — Source face (optional)"
      title="Who should the camera swap to?"
      lead="Import one or more stills of the source face. Detection-only mode works without one, and you can add identities later."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Studio avatar"
            />
          </Field>
          <div className="mt-3">
            <Field label="Photos" hint="1–5 clear, front-facing images work best.">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => void browse()}>
                  <ImagePlus size={14} /> Choose images
                </Button>
                <span className="self-center text-xs text-[var(--faint)]">
                  {paths.length > 0 ? `${paths.length} selected` : "none selected"}
                </span>
              </div>
            </Field>
            {paths.length > 0 && (
              <ul className="mono mt-2 space-y-1 text-[10px] text-[var(--faint)]">
                {paths.map((p) => (
                  <li key={p} className="truncate">
                    {p.split("/").pop()}
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
                Paste absolute paths instead
              </summary>
              <textarea
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                rows={2}
                placeholder="/Users/you/Pictures/me.jpg"
                className="mono mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-[11px]"
              />
            </details>
          </div>
        </Card>
        <Card className="flex flex-col justify-between p-4">
          <div>
            <div className="label mb-2">Consent gate (required)</div>
            <label className="flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              {CONSENT}
            </label>
            {error && <p className="mt-3 text-xs text-[var(--warn)]">{error}</p>}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={ctx.next}>
              Skip for now <ChevronRight size={14} />
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!consent || busy || (paths.length === 0 && manual.trim().length === 0)}
              onClick={() => void importIdentity()}
            >
              {busy ? "Importing…" : "Import identity"}
            </Button>
          </div>
        </Card>
      </div>
    </StepShell>
  );
}

export function StepReady({ ctx }: { ctx: OnboardingController }) {
  const detector = ctx.detectorReady;
  const cameraReady = ctx.cameraMode === "synthetic" || ctx.cameraTest?.ok;
  const rows = [
    { label: "Acceptable use", ok: ctx.consent, detail: "attested" },
    {
      label: "Camera",
      ok: cameraReady,
      detail:
        ctx.cameraMode === "synthetic"
          ? "synthetic source"
          : ctx.cameraTest?.ok
            ? "test frame captured"
            : "not tested",
    },
    {
      label: "Microphone",
      ok: ctx.micPermission === "granted",
      detail: ctx.micPermission === "granted" ? "signal tested" : "optional",
    },
    { label: "Face detector", ok: detector, detail: detector ? "installed" : "required" },
    {
      label: "Source face",
      ok: !!ctx.identity,
      detail: ctx.identity ? ctx.identity.name : "optional — detection only",
    },
  ];
  const ready = rows.filter((r) => r.ok).length;
  const canFinish = ctx.consent && cameraReady && detector;
  return (
    <StepShell
      eyebrow="Step 06 — Ready"
      title={canFinish ? "The console is ready." : "Finish the required steps."}
      lead="Nothing starts until setup is complete. You can re-run this flow from Settings at any time."
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <Card>
          <PanelHeader eyebrow="Readiness" title={`${ready} of ${rows.length} checks`} />
          <ul className="divide-y divide-[var(--line-soft)]">
            {rows.map((row) => (
              <li key={row.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <StatusDot
                    tone={
                      row.ok
                        ? "ok"
                        : row.label === "Face detector" || row.label === "Camera"
                          ? "warn"
                          : "neutral"
                    }
                  />
                  {row.label}
                </span>
                <span className="mono text-[10px] uppercase tracking-wider text-[var(--faint)]">
                  {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col items-center justify-center gap-2 p-4">
          <div className="mono text-3xl">
            {ready}/{rows.length}
          </div>
          <div className="label">checks passed</div>
          <ProgressBar percent={(ready / rows.length) * 100} />
          <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
            {ctx.cameraMode === "synthetic"
              ? "Studio will run in synthetic-camera mode."
              : "Studio will use your selected camera."}
          </p>
        </Card>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          disabled={!canFinish || ctx.finishing}
          onClick={() => void ctx.finish()}
        >
          {ctx.finishing ? "Opening Studio…" : "Open Studio"} <ChevronRight size={16} />
        </Button>
        {!canFinish && (
          <span className="text-xs text-[var(--warn)]">
            Camera test and detector are required; consent must be checked.
          </span>
        )}
      </div>
    </StepShell>
  );
}

export function StepShell({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rise mx-auto w-full max-w-3xl">
      <div className="label mb-3">{eyebrow}</div>
      <h1 className="text-balance text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{lead}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

function Fact({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-[var(--accent)]">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{children}</p>
    </Card>
  );
}

function PermissionCard({
  icon,
  title,
  device,
  state,
  busy,
  onRequest,
  onOpen,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  device: string;
  state: "granted" | "denied" | "unknown";
  busy: boolean;
  onRequest: () => Promise<void>;
  onOpen: () => void;
  note: string;
}) {
  const tone = state === "granted" ? "ok" : state === "denied" ? "rec" : "neutral";
  return (
    <Card className="flex items-start gap-4 p-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--muted)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          <Badge tone={tone}>{state}</Badge>
        </div>
        <div className="mono mt-0.5 truncate text-[11px] text-[var(--faint)]">{device}</div>
        <p className="mt-2 text-xs text-[var(--muted)]">{note}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={state === "granted" ? "ghost" : "primary"}
            size="sm"
            onClick={() => void onRequest()}
            disabled={busy}
          >
            {busy ? "Requesting…" : state === "granted" ? "Test again" : "Request access"}
          </Button>
          {state === "denied" && (
            <Button variant="secondary" size="sm" onClick={onOpen}>
              Open System Settings
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "warn" | "rec" | "info";
  title: string;
  children: React.ReactNode;
}) {
  const color = tone === "rec" ? "var(--rec)" : tone === "warn" ? "var(--warn)" : "var(--info)";
  return (
    <div
      className="flex items-start gap-3 rounded-md border px-4 py-3 text-xs leading-relaxed"
      style={{
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <TriangleAlert size={15} style={{ color }} className="mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold" style={{ color }}>
          {title}.{" "}
        </span>
        <span className="text-[var(--muted)]">{children}</span>
      </div>
    </div>
  );
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/[A-Z_]{3,}:\s*([^—]+)/);
  return (match?.[1] ?? raw).trim();
}
