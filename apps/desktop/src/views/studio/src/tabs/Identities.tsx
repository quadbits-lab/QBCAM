import { FolderOpen, ImagePlus, ShieldAlert, Trash2, UserRoundCheck, Users } from "lucide-react";
import { useState } from "react";
import { rpc } from "../api";
import { Page } from "../components/Page";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PanelHeader,
  ProgressRing,
  StatusDot,
} from "../components/ui";
import { type Identity, useStudio } from "../store";

const CONSENT =
  "I confirm I am the person in these photos, or that I have their explicit permission to use their likeness.";

export function IdentitiesTab() {
  const s = useStudio();
  const [name, setName] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function browse() {
    try {
      const res = await rpc<{ paths: string[] }>("pickImageFiles");
      if (res.paths.length > 0) setPaths(res.paths);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function importIdentity() {
    const all = [
      ...paths,
      ...manual
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
    ];
    if (!name.trim() || all.length === 0) {
      s.setError("Provide a name and at least one photo.");
      return;
    }
    if (!consent) {
      s.setError("Consent attestation is required before an identity can be used.");
      return;
    }
    setBusy(true);
    try {
      await rpc("importIdentity", {
        paths: all,
        name: name.trim(),
        consentStatement: CONSENT,
      });
      const lib = await rpc<{ identities: Identity[] }>("listIdentities");
      s.setIdentities(lib.identities);
      setName("");
      setPaths([]);
      setManual("");
      setConsent(false);
      s.setToast({ message: "Identity imported", kind: "success" });
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(identity: Identity) {
    if (!confirm(`Delete ${identity.name} and all derived data (embeddings, thumbnails)?`)) return;
    try {
      await rpc("deleteIdentity", { identityId: identity.id });
      const lib = await rpc<{ identities: Identity[] }>("listIdentities");
      s.setIdentities(lib.identities);
      if (s.selectedIdentity === identity.id) s.setSelectedIdentity(null);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Page
      title="Identities"
      description="Source faces for the swap pipeline. Consent is required per identity and stored with it."
      actions={
        <Badge tone="neutral">
          <Users size={11} /> {s.identities.length} identities
        </Badge>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card>
          <PanelHeader eyebrow="New identity" title="Import source face" />
          <div className="space-y-3 px-4 py-4">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Studio avatar"
              />
            </Field>

            <Field
              label="Photos"
              hint="1–5 clear, front-facing images. The best face is auto-picked."
            >
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void browse()}>
                  <ImagePlus size={14} /> Choose images
                </Button>
                <span className="text-xs text-[var(--faint)]">
                  {paths.length > 0 ? `${paths.length} selected` : "none selected"}
                </span>
              </div>
            </Field>
            {paths.length > 0 && (
              <ul className="mono space-y-1 text-[10px] text-[var(--faint)]">
                {paths.map((p) => (
                  <li key={p} className="truncate">
                    {p.split("/").pop()}
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
                Paste absolute paths instead
              </summary>
              <textarea
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                rows={3}
                placeholder="/Users/you/Pictures/me.jpg"
                className="mono mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-[11px]"
              />
            </details>

            <div className="rounded-md border border-[var(--rec)]/40 bg-[var(--rec)]/5 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-[var(--rec)]">
                <ShieldAlert size={13} /> Consent (required)
              </div>
              <label className="flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--rec)]"
                />
                {CONSENT}
              </label>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              disabled={busy || !consent}
              onClick={() => void importIdentity()}
            >
              {busy ? "Importing…" : "Import identity"}
            </Button>
          </div>
        </Card>

        <div>
          {s.identities.length === 0 ? (
            <EmptyState
              icon={<UserRoundCheck size={30} />}
              title="No identities yet"
              description="Import a source face to enable the swap stage. Without one, Studio runs detection-only."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {s.identities.map((identity) => (
                <Card key={identity.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <ProgressRing percent={identity.quality * 100} size={54} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{identity.name}</div>
                      <div className="mono mt-0.5 text-[9px] uppercase tracking-wider text-[var(--faint)]">
                        {identity.consentAttestedAt
                          ? `consented ${new Date(identity.consentAttestedAt).toLocaleDateString()}`
                          : "NOT CONSENTED"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={s.selectedIdentity === identity.id ? "accent" : "neutral"}>
                          {s.selectedIdentity === identity.id ? "active source" : "library"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--line-soft)] pt-2.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        s.setSelectedIdentity(identity.id);
                        s.setTab("studio");
                      }}
                    >
                      Use in Studio
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-[var(--rec)] hover:text-[var(--rec)]"
                      onClick={() => void remove(identity)}
                      aria-label={`Delete ${identity.name} and all derived data`}
                    >
                      <Trash2 size={13} /> Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--line-soft)] px-3 py-2 text-[11px] text-[var(--faint)]">
            <StatusDot tone="ok" />
            Derived embeddings and thumbnails are deleted with the identity. Nothing is uploaded.
          </div>
        </div>
      </div>
    </Page>
  );
}
