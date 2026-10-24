import { useRef, useState } from "react";
import { rpc } from "../api";
import { useStudio } from "../store";

/**
 * Identities — TS-01: consent attestation is BLOCKING. No identity can be
 * created or used without the explicit statement (spec §14).
 */
const CONSENT_STATEMENT =
  "I confirm I am the person in these photos, or that I have their explicit permission to use their likeness.";

export function IdentitiesTab() {
  const s = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function import_() {
    if (!name.trim() || paths.length === 0) {
      s.setError("Provide a name and at least one photo path");
      return;
    }
    if (!consent) {
      s.setError("Consent attestation is required before an identity can be used");
      return;
    }
    setBusy(true);
    try {
      await rpc("importIdentity", { paths, name: name.trim(), consentStatement: CONSENT_STATEMENT });
      const lib = await rpc<{ identities: [] }>("listIdentities");
      s.setIdentities(lib.identities);
      setName("");
      setPaths([]);
      setConsent(false);
      s.setToast("identity imported");
      setTimeout(() => s.setToast(null), 2000);
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  // In the webview there is no free file dialog; v0 accepts absolute paths
  // pasted by the user (drag-drop comes with the native shell in M3).
  async function deleteIdentity(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this identity and ALL derived data (embeddings, thumbnails)?")) return;
    try {
      await rpc("deleteIdentity", { identityId: id });
      const lib = await rpc<{ identities: [] }>("listIdentities");
      s.setIdentities(lib.identities);
    } catch (err: any) {
      s.setError(err.message ?? String(err));
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-4 text-lg font-semibold">Identities</h1>

      <section className="mb-8 max-w-xl rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Import identity</h2>
        <label className="mb-2 block text-xs text-[var(--text-1)]">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-0)] px-3 py-2 text-sm"
            placeholder="e.g. My Avatar"
          />
        </label>
        <label className="mb-2 block text-xs text-[var(--text-1)]">
          Photo paths (one per line, 1–N photos; best face is auto-picked)
          <textarea
            value={paths.join("\n")}
            onChange={(e) => setPaths(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))}
            rows={3}
            className="mono mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-0)] px-3 py-2 text-xs"
            placeholder="/Users/you/Pictures/me.jpg"
          />
        </label>
        <fieldset className="mb-3 rounded-lg border border-[var(--danger)]/50 p-3">
          <legend className="px-1 text-xs font-semibold text-[var(--danger)]">Consent (required)</legend>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 accent-[var(--danger)]"
            />
            <span>{CONSENT_STATEMENT}</span>
          </label>
        </fieldset>
        <button
          onClick={import_}
          disabled={busy || !consent}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Importing…" : "Import"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Library ({s.identities.length})</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {s.identities.map((id) => (
            <div key={id.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-1)] p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{id.name}</span>
                <button
                  onClick={(e) => deleteIdentity(id.id, e)}
                  className="text-xs text-[var(--danger)] hover:underline"
                  aria-label={`Delete ${id.name} and all derived data`}
                >
                  Delete all data
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--text-1)]">
                quality {(id.quality * 100).toFixed(0)}% ·{" "}
                {id.consentAttestedAt
                  ? `consented ${new Date(id.consentAttestedAt).toLocaleDateString()}`
                  : "NOT CONSENTED"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
