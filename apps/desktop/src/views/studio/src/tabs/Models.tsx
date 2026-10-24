import { Boxes, Check, Download, FolderOpen, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { rpc } from "../api";
import { Page } from "../components/Page";
import { Badge, Button, Card, Field, Input, PanelHeader, ProgressBar } from "../components/ui";
import { type ModelState, type SetupStatus, useStudio } from "../store";

export function ModelsTab() {
  const s = useStudio();
  const [installing, setInstalling] = useState<string | null>(null);

  async function refresh() {
    try {
      const setup = await rpc<SetupStatus>("getSetupStatus");
      s.setSetup(setup);
      s.setModels(setup.models);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function install(model: ModelState) {
    setInstalling(model.id);
    try {
      await rpc("ensureModels", { modelIds: [model.id] });
      await refresh();
      s.setToast({ message: `${model.id} installed`, kind: "success" });
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
      s.setModelProgress(model.id, null);
    }
  }

  return (
    <Page
      title="Models"
      description="Detector and swap weights. Swap models are bring-your-own — never bundled."
      actions={
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <RefreshCw size={14} /> Re-scan
        </Button>
      }
    >
      <div className="grid gap-3">
        {s.models.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            installing={installing === model.id}
            onInstall={() => void install(model)}
          />
        ))}
        {s.models.length === 0 && (
          <Card className="p-4 text-sm text-[var(--muted)]">No models found in the registry.</Card>
        )}
      </div>

      <div className="mt-6">
        <ByoCard onRegistered={() => void refresh()} />
      </div>
    </Page>
  );
}

function ModelCard({
  model,
  installing,
  onInstall,
}: {
  model: ModelState;
  installing: boolean;
  onInstall: () => void;
}) {
  const progress = useStudio((s) => s.modelProgress[model.id]);
  const detector = model.kind === "detector";
  return (
    <Card>
      <PanelHeader
        eyebrow={detector ? "Required" : model.byo ? "Bring your own" : "Optional"}
        title={model.id}
        action={
          model.installed ? (
            <Badge tone="ok">
              <Check size={11} /> installed
            </Badge>
          ) : model.byo ? (
            <Badge tone="neutral">registered on demand</Badge>
          ) : (
            <Badge tone="warn">missing</Badge>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <Badge tone="neutral">{model.kind || "model"}</Badge>
          <span className="mono">v{model.version || "byo"}</span>
          <span>·</span>
          <span>{model.licenseSpdx || "user-provided"}</span>
          <Badge tone={model.commercialUse ? "ok" : "warn"}>
            {model.commercialUse ? "commercial ok" : "non-commercial"}
          </Badge>
          {model.installedPath && (
            <span className="mono max-w-[320px] truncate text-[10px] text-[var(--faint)]">
              {model.installedPath}
            </span>
          )}
        </div>
        {!model.installed && !model.byo && (
          <Button variant="primary" size="sm" onClick={onInstall} disabled={installing}>
            <Download size={14} /> {installing ? "Installing…" : "Download"}
          </Button>
        )}
      </div>
      {installing && (
        <div className="space-y-1.5 px-4 pb-4">
          <ProgressBar percent={progress?.percent ?? 0} />
          <div className="mono text-[10px] uppercase tracking-wider text-[var(--faint)]">
            {progress?.stage ?? "starting"} · {Math.round(progress?.percent ?? 0)}%
          </div>
        </div>
      )}
    </Card>
  );
}

function ByoCard({ onRegistered }: { onRegistered: () => void }) {
  const s = useStudio();
  const [path, setPath] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function browse() {
    try {
      const res = await rpc<{ path: string | null }>("pickModelFile");
      if (res.path) setPath(res.path);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function register() {
    setBusy(true);
    try {
      await rpc("setByoModel", { modelId: "swapper-byo", path, licenseAccepted: accepted });
      onRegistered();
      s.setToast({ message: "BYO model registered", kind: "success" });
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <PanelHeader
        eyebrow="§13.3"
        title="Bring your own swap model"
        action={
          <Badge tone="neutral">
            <ShieldCheck size={11} /> license required
          </Badge>
        }
      />
      <div className="space-y-3 px-4 py-4">
        <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          QBCAM never bundles or redistributes face-swap weights. Point it at an inswapper_128-class
          ONNX file you are licensed to use. You accept its license by registering it.
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
        <Field label="License">
          <label className="flex items-start gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            I confirm I hold a valid license for this model file and accept responsibility for its
            use.
          </label>
        </Field>
        <Button
          variant="primary"
          size="sm"
          disabled={!path || !accepted || busy}
          onClick={() => void register()}
        >
          <Boxes size={14} /> {busy ? "Registering…" : "Register model"}
        </Button>
      </div>
    </Card>
  );
}
