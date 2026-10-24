import { Camera, Cpu, Flag, ShieldCheck, SlidersHorizontal, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "../api";
import { BrandLogo } from "../components/Brand";
import { Badge, Button, Card, cn, StatusDot } from "../components/ui";
import { type Identity, type SetupStatus, useStudio } from "../store";
import {
  type OnboardingController,
  StepDevices,
  StepIdentity,
  StepModels,
  StepPermissions,
  StepReady,
  StepWelcome,
} from "./steps";

const STEPS = [
  { id: "welcome", label: "Welcome", icon: ShieldCheck },
  { id: "permissions", label: "Permissions", icon: Camera },
  { id: "devices", label: "Camera & mic", icon: SlidersHorizontal },
  { id: "models", label: "Models", icon: Cpu },
  { id: "identity", label: "Source face", icon: UserRoundCheck },
  { id: "ready", label: "Ready", icon: Flag },
];

export function Onboarding({ setup }: { setup: SetupStatus }) {
  const setSetup = useStudio((s) => s.setSetup);
  const setAppMode = useStudio((s) => s.setAppMode);
  const setError = useStudio((s) => s.setError);

  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const hasRealCamera = setup.cameras.some((c) => c.kind === "camera");
  const [cameraMode, setCameraMode] = useState<"device" | "synthetic">(
    setup.onboarding.cameraMode === "synthetic" || !hasRealCamera ? "synthetic" : "device",
  );
  const [cameraDevice, setCameraDevice] = useState(() => {
    const explicit = setup.camera.deviceId;
    if (explicit && explicit !== "auto" && explicit !== "fake") {
      const byId = setup.cameras.find((c) => c.id === explicit);
      const byName = setup.cameras.find((c) => `name:${c.name}` === explicit);
      if (byId) return byId.id;
      if (byName) return byName.id;
    }
    return setup.cameras.find((c) => c.kind === "camera")?.id ?? "fake";
  });
  const [micDevice, setMicDevice] = useState(
    setup.onboarding.microphoneDeviceId ??
      (setup.audio[0] ? `audio:${setup.audio[0].id}` : "audio:0"),
  );
  const [cameraPermission, setCameraPermission] = useState(setup.onboarding.cameraPermission);
  const [micPermission, setMicPermission] = useState(setup.onboarding.microphonePermission);
  const [cameraTest, setCameraTest] = useState<{
    ok: boolean;
    profile?: string;
    error?: string;
  } | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [permissionBusy, setPermissionBusy] = useState<"camera" | "mic" | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [installing, setInstalling] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await rpc<SetupStatus>("getSetupStatus");
      setSetup(next);
      useStudio.getState().setModels(next.models);
      useStudio
        .getState()
        .setServiceStates(Object.fromEntries(next.services.map((s) => [s.name, s.state])));
      if (next.onboarding.cameraPermission !== "unknown") {
        setCameraPermission(next.onboarding.cameraPermission);
      }
      if (next.onboarding.microphonePermission !== "unknown") {
        setMicPermission(next.onboarding.microphonePermission);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [setSetup]);

  async function requestCamera() {
    setPermissionBusy("camera");
    setLocalError(null);
    const device =
      cameraMode === "synthetic"
        ? "fake"
        : cameraDevice || setup.cameras.find((c) => c.kind === "camera")?.id;
    if (!device || device === "fake") {
      setCameraPermission("unknown");
      setPermissionBusy(null);
      setLocalError("No real camera selected. Use the synthetic camera instead.");
      return;
    }
    try {
      const res = await rpc<{ ok: boolean; jpegBase64?: string; profile?: string }>(
        "cameraSnapshot",
        { deviceId: device },
      );
      setCameraPermission("granted");
      setCameraTest({ ok: !!res.jpegBase64, profile: res.profile });
    } catch (err) {
      setCameraPermission("denied");
      setCameraTest({ ok: false, error: friendly(err) });
      setLocalError(friendly(err));
    } finally {
      setPermissionBusy(null);
      void refresh();
    }
  }

  async function requestMic() {
    setPermissionBusy("mic");
    setLocalError(null);
    try {
      const res = await rpc<{ ok: boolean; level: number }>("probeMicrophone", {
        deviceId: micDevice,
        ms: 400,
      });
      setMicPermission("granted");
      setMicLevel(res.level ?? 0);
    } catch (err) {
      setMicPermission("denied");
      setMicError(friendly(err));
      setLocalError(friendly(err));
    } finally {
      setPermissionBusy(null);
      void refresh();
    }
  }

  async function openSettings(pane: "camera" | "microphone") {
    try {
      await rpc("openSystemSettings", { pane });
    } catch {
      // Headless shells cannot open the OS pane; the copy still explains it.
    }
  }

  async function installDetector() {
    setInstalling(true);
    setLocalError(null);
    try {
      await rpc("ensureModels", { modelIds: ["detector-yunet"] });
      await refresh();
      useStudio.getState().setModelProgress("detector-yunet", null);
    } catch (err) {
      setLocalError(friendly(err));
    } finally {
      setInstalling(false);
    }
  }

  async function finish() {
    setFinishing(true);
    setLocalError(null);
    try {
      await rpc("completeOnboarding", {
        cameraMode,
        cameraDeviceId: cameraMode === "synthetic" ? "fake" : cameraDevice,
        microphoneDeviceId: micDevice || null,
        cameraPermission: cameraTest?.ok ? "granted" : cameraPermission,
        microphonePermission: micPermission,
      });
      const next = await rpc<SetupStatus>("getSetupStatus");
      setSetup(next);
      setAppMode("app");
    } catch (err) {
      setLocalError(friendly(err));
      setError(friendly(err));
      setFinishing(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const detectorReady =
    setup.detector.installed || !!setup.models.find((m) => m.id === "detector-yunet")?.installed;
  const cameraReady = cameraMode === "synthetic" || !!cameraTest?.ok;

  const ctx: OnboardingController = {
    setup,
    consent,
    setConsent,
    cameraMode,
    setCameraMode,
    cameraDevice,
    setCameraDevice,
    micDevice,
    setMicDevice,
    cameraPermission,
    micPermission,
    cameraTest,
    setCameraTest,
    micLevel,
    setMicLevel,
    micError,
    setMicError,
    permissionBusy,
    requestCamera,
    requestMic,
    openSettings,
    refresh,
    identity,
    setIdentity,
    detectorReady,
    installDetector,
    installing,
    next: () => setStep((s) => Math.min(STEPS.length - 1, s + 1)),
    back: () => setStep((s) => Math.max(0, s - 1)),
    finish,
    finishing,
  };

  const canAdvance =
    step === 0 ? consent : step === 2 ? cameraReady : step === 3 ? detectorReady : true;

  return (
    <div className="grid-bg min-h-screen bg-[var(--background)]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 gap-0 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_304px]">
        <aside className="flex flex-col border-b border-[var(--line-soft)] px-5 py-6 lg:border-b-0 lg:border-r">
          <div>
            <BrandLogo className="h-6" />
            <div className="label mt-2">Setup console</div>
          </div>
          <nav className="mt-8 space-y-1" aria-label="Setup steps">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = index === step;
              const done = index < step;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => index <= step && setStep(index)}
                  disabled={index > step}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-[var(--surface-2)] text-[var(--text)]"
                      : done
                        ? "text-[var(--muted)] hover:bg-[var(--surface-2)]"
                        : "cursor-not-allowed text-[var(--faint)]",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "mono flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px]",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                        : done
                          ? "border-[var(--ok)]/40 text-[var(--ok)]"
                          : "border-[var(--line)] text-[var(--faint)]",
                    )}
                  >
                    {done ? "✓" : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  <Icon size={14} className="shrink-0 opacity-60" />
                </button>
              );
            })}
          </nav>
          <div className="mt-auto hidden pt-6 text-[10px] leading-relaxed text-[var(--faint)] lg:block">
            Everything runs locally. Setup can be re-run from Settings.
          </div>
        </aside>

        <main className="flex min-w-0 flex-col px-5 py-6 sm:px-8 lg:py-10">
          <div key={step} className="flex-1">
            {step === 0 && <StepWelcome ctx={ctx} />}
            {step === 1 && <StepPermissions ctx={ctx} />}
            {step === 2 && <StepDevices ctx={ctx} />}
            {step === 3 && <StepModels ctx={ctx} />}
            {step === 4 && <StepIdentity ctx={ctx} />}
            {step === 5 && <StepReady ctx={ctx} />}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--line-soft)] pt-4">
            <Button variant="ghost" size="sm" onClick={ctx.back} disabled={step === 0}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                variant="primary"
                size="sm"
                className="ml-auto"
                disabled={!canAdvance}
                onClick={ctx.next}
              >
                Continue
              </Button>
            ) : (
              <span className="ml-auto text-[11px] text-[var(--faint)]">
                Press Open Studio to finish setup.
              </span>
            )}
          </div>
          {localError && (
            <div className="mt-3 rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs text-[var(--warn)]">
              {localError}
            </div>
          )}
        </main>

        <aside className="hidden flex-col border-l border-[var(--line-soft)] px-5 py-6 xl:flex">
          <div className="label">Readiness</div>
          <div className="mt-3 space-y-2">
            <ReadinessRow label="Consent" ok={consent} detail="acceptable use" />
            <ReadinessRow
              label="Camera"
              ok={cameraReady}
              detail={
                cameraMode === "synthetic" ? "synthetic" : cameraTest?.ok ? "tested" : "not tested"
              }
            />
            <ReadinessRow
              label="Microphone"
              ok={micPermission === "granted"}
              detail={micPermission === "granted" ? "tested" : "optional"}
            />
            <ReadinessRow
              label="Detector"
              ok={detectorReady}
              detail={detectorReady ? "installed" : "required"}
            />
            <ReadinessRow
              label="Source face"
              ok={!!identity}
              detail={identity ? identity.name : "optional"}
            />
          </div>

          <Card className="mt-6 p-3">
            <div className="label mb-2">Selected path</div>
            <div className="space-y-1.5 text-[11px] text-[var(--muted)]">
              <div className="flex items-center justify-between gap-2">
                <span>Camera</span>
                <span className="mono max-w-[150px] truncate text-[var(--text)]">
                  {cameraMode === "synthetic"
                    ? "synthetic"
                    : (setup.cameras.find((c) => c.id === cameraDevice)?.name ?? "auto")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Microphone</span>
                <span className="mono max-w-[150px] truncate text-[var(--text)]">
                  {setup.audio.find((d) => `audio:${d.id}` === micDevice)?.name ?? "default"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Detector</span>
                <span className="mono text-[var(--text)]">
                  {detectorReady ? "ready" : "missing"}
                </span>
              </div>
            </div>
          </Card>

          <div className="mt-auto pt-6">
            <Badge tone="neutral">local-first · no uploads</Badge>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ReadinessRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--line-soft)] bg-[var(--surface)] px-2.5 py-2">
      <StatusDot tone={ok ? "ok" : "neutral"} />
      <span className="text-xs">{label}</span>
      <span className="mono ml-auto max-w-[130px] truncate text-[9px] uppercase tracking-wider text-[var(--faint)]">
        {detail}
      </span>
    </div>
  );
}

function friendly(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/[A-Z_]{3,}:\s*([^—]+)/);
  return (match?.[1] ?? raw).trim();
}
