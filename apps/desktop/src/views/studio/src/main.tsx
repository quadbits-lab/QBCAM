import {
  Boxes,
  Camera,
  FolderOpen,
  LayoutDashboard,
  Moon,
  RotateCcw,
  Settings as SettingsIcon,
  Sun,
  Users,
  Wifi,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { connectEvents, connectPreview, initApi, rpc } from "./api";
import { BrandIcon, BrandLogo } from "./components/Brand";
import { Badge, Button, cn, StatusDot } from "./components/ui";
import { Onboarding } from "./onboarding/Onboarding";
import { type Tab, useStudio } from "./store";
import { IdentitiesTab } from "./tabs/Identities";
import { LibraryTab } from "./tabs/Library";
import { ModelsTab } from "./tabs/Models";
import { SettingsTab } from "./tabs/Settings";
import { StudioTab } from "./tabs/Studio";
import "./index.css";

const NAV: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "studio", label: "Studio", icon: LayoutDashboard },
  { id: "identities", label: "Identities", icon: Users },
  { id: "library", label: "Library", icon: FolderOpen },
  { id: "models", label: "Models", icon: Boxes },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const PAGE_DESC: Record<Tab, string> = {
  studio: "Live capture, swap pipeline, recording and virtual camera.",
  identities: "Source faces for the swap pipeline. Consent is required per identity.",
  library: "Recordings and snapshots with provenance status.",
  models: "Detector and bring-your-own swap weights.",
  settings: "Devices, pipeline behavior, privacy and hotkeys.",
};

function App() {
  const s = useStudio();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("light", s.theme === "light");
    document.documentElement.classList.toggle("dark", s.theme === "dark");
  }, [s.theme]);

  const loadSetup = async () => {
    try {
      const [setup, identities, library] = await Promise.all([
        rpc<import("./store").SetupStatus>("getSetupStatus"),
        rpc<{ identities: [] }>("listIdentities"),
        rpc<{ items: [] }>("listLibrary"),
      ]);
      s.setSetup(setup);
      s.setModels(setup.models);
      s.setServiceStates(Object.fromEntries(setup.services.map((x) => [x.name, x.state])));
      s.setIdentities(identities.identities ?? []);
      s.setLibrary(library.items ?? []);
      s.setAppMode(setup.onboarding.completedAt ? "app" : "onboarding");
      s.setSetupError(null);
    } catch (err) {
      s.setSetupError(err instanceof Error ? err.message : String(err));
      s.setAppMode("loading");
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
  useEffect(() => {
    (async () => {
      try {
        await initApi();
      } catch (err) {
        s.setSetupError(err instanceof Error ? err.message : String(err));
        return;
      }
      await loadSetup();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions are stable
  useEffect(() => {
    let off: (() => void) | null = null;
    connectEvents({
      "pipeline.stats": (p) =>
        s.setStats({
          fps: p.fps,
          frameMs: p.frameMs,
          faces: p.faces,
          executionProvider: p.executionProvider,
          bypassed: p.bypassed,
        }),
      "pipeline.faces": (p) => s.setFaces(p.faces),
      "pipeline.degraded": (p) =>
        useStudio.getState().setDegraded({ reason: p.reason, error: p.error }),
      "pipeline.recovered": () => useStudio.getState().setDegraded(null),
      "recorder.progress": (p) => useStudio.getState().setRecorderSeconds(p.seconds),
      "service.state": (p) => {
        const cur = { ...useStudio.getState().serviceStates, [p.service]: p.state };
        useStudio.getState().setServiceStates(cur);
      },
      "models.progress": (p) => {
        useStudio.getState().setModelProgress(p.modelId, { stage: p.stage, percent: p.percent });
        if (p.stage === "done" || p.percent >= 100) {
          useStudio.getState().setModelProgress(p.modelId, null);
        }
      },
      "vcam.state": (p) => useStudio.getState().setVcamOn(p.on),
    }).then((unsub) => {
      off = unsub;
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!s.previewPort || !s.previewToken) return;
    const off = connectPreview(s.previewPort, s.previewToken, (jpeg) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob = new Blob([jpeg], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")?.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
    return off;
  }, [s.previewPort, s.previewToken]);

  if (s.appMode === "loading") {
    return <Splash error={s.setupError} onRetry={() => void loadSetup()} />;
  }

  if (s.appMode === "onboarding" && s.setup) {
    return <Onboarding setup={s.setup} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onRunSetup={async () => {
            await rpc("resetOnboarding").catch(() => null);
            await loadSetup();
            s.setTab("studio");
          }}
        />
        <main className="min-h-0 flex-1 overflow-hidden">
          {s.tab === "studio" && <StudioTab canvasRef={canvasRef} />}
          {s.tab === "identities" && <IdentitiesTab />}
          {s.tab === "library" && <LibraryTab />}
          {s.tab === "models" && <ModelsTab />}
          {s.tab === "settings" && (
            <SettingsTab
              onRunSetup={async () => {
                await rpc("resetOnboarding").catch(() => null);
                await loadSetup();
                s.setTab("studio");
              }}
            />
          )}
        </main>
      </div>
      <Toast />
      {s.error && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-4 rounded-md border border-[var(--rec)]/50 bg-[var(--surface)] px-4 py-3 text-sm shadow-xl"
        >
          <span className="text-[var(--rec)]">{s.error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => s.setError(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

function Splash({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="grid-bg flex h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-md text-center">
        {error ? (
          <>
            <div className="mono mb-3 text-xs uppercase tracking-[0.2em] text-[var(--rec)]">
              Core unavailable
            </div>
            <p className="mb-4 text-sm text-[var(--muted)]">{error}</p>
            <Button variant="primary" onClick={onRetry}>
              Retry connection
            </Button>
          </>
        ) : (
          <>
            <div className="mb-4 flex justify-center">
              <span className="pulse h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            </div>
            <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Starting qb-core
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Sidebar() {
  const s = useStudio();
  const collapsed = s.sidebarCollapsed;
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-[var(--line-soft)] bg-[var(--surface)] transition-[width] duration-150",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-0" : "px-4")}>
        {collapsed ? <BrandIcon /> : <BrandLogo />}
      </div>
      <nav aria-label="Sections" className="mt-2 flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = s.tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => s.setTab(item.id)}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-[var(--surface-2)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 bg-[var(--accent)]" />
              )}
              <Icon size={17} className={active ? "text-[var(--accent)]" : ""} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={s.toggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="mx-2 mt-2 rounded-md px-3 py-2 text-left text-xs text-[var(--faint)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      >
        {collapsed ? "»" : "« Collapse"}
      </button>
      <div
        className={cn(
          "mt-auto border-t border-[var(--line-soft)] py-3",
          collapsed ? "px-2 text-center" : "px-4",
        )}
      >
        {collapsed ? (
          <span className="mono text-[10px] text-[var(--faint)]">v0</span>
        ) : (
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] text-[var(--faint)]">v0.1.0</span>
            <StatusDot
              tone={Object.values(s.serviceStates).every((v) => v === "ready") ? "ok" : "warn"}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function Header({ onRunSetup }: { onRunSetup: () => Promise<void> }) {
  const s = useStudio();
  const setup = s.setup;
  const camera = setup?.cameras.find((c) => c.id === s.activeDeviceId);
  const configuredCamera = setup?.cameras.find(
    (c) => c.id === setup?.camera.deviceId || `name:${c.name}` === setup?.camera.deviceId,
  );
  const cameraLabel = s.synthetic
    ? "Synthetic camera"
    : (camera?.name ??
      configuredCamera?.name ??
      (setup?.camera.deviceId === "auto" ? "Auto camera" : "Camera idle"));
  const ready = Object.values(s.serviceStates).filter((v) => v === "ready").length;
  const total = Object.keys(s.serviceStates).length;

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--line-soft)] bg-[var(--surface)] px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="label">QBCAM</span>
          <span className="text-[var(--faint)]">/</span>
          <span className="truncate font-semibold">
            {s.tab.charAt(0).toUpperCase() + s.tab.slice(1)}
          </span>
        </div>
        <div className="mt-0.5 hidden truncate text-[11px] text-[var(--faint)] sm:block">
          {PAGE_DESC[s.tab]}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Badge tone={s.pipelineOn ? (s.synthetic ? "warn" : "accent") : "neutral"}>
          <Camera size={11} /> {cameraLabel}
        </Badge>
        <Badge tone={ready === total && total > 0 ? "ok" : "warn"}>
          <Wifi size={11} /> {ready}/{total || 0} services
        </Badge>
        <span className="mono hidden text-[11px] text-[var(--muted)] md:inline">
          {s.stats.fps.toFixed(0)} FPS · {s.stats.frameMs.toFixed(0)} ms
        </span>
        <button
          type="button"
          onClick={() => s.setTheme(s.theme === "dark" ? "light" : "dark")}
          className="rounded-md border border-[var(--line)] p-1.5 text-[var(--muted)] hover:text-[var(--text)]"
          aria-label={`Switch to ${s.theme === "dark" ? "light" : "dark"} theme`}
        >
          {s.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <Button variant="ghost" size="sm" onClick={() => void onRunSetup()} title="Run setup again">
          <RotateCcw size={14} />
          <span className="hidden lg:inline">Setup</span>
        </Button>
      </div>
    </header>
  );
}

function Toast() {
  const toast = useStudio((s) => s.toast);
  const setToast = useStudio((s) => s.setToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast, setToast]);
  if (!toast) return null;
  const tone = toast.kind === "error" ? "rec" : toast.kind === "success" ? "ok" : "accent";
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40">
      <div className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs shadow-xl">
        <StatusDot tone={tone === "accent" ? "accent" : tone} />
        {toast.message}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
