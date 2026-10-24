import { rpc } from "../api";
import { useStudio } from "../store";

export function LibraryTab() {
  const s = useStudio();
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-4 text-lg font-semibold">Library</h1>
      {s.library.length === 0 && (
        <p className="text-sm text-[var(--text-1)]">
          No recordings or snapshots yet. Record from the Studio tab.
        </p>
      )}
      <div className="space-y-2">
        {s.library.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-1)] px-4 py-3"
          >
            <div>
              <span className="text-sm">
                {item.kind === "recording" ? "🎬" : "📸"} {item.path.split("/").pop()}
              </span>
              <p className="text-xs text-[var(--text-1)]">
                {item.kind}
                {item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ""} ·{" "}
                {(item.bytes / 1024).toFixed(0)} KB ·{" "}
                {item.provenanceSigned ? "C2PA signed ✓" : "unsigned"}
              </p>
            </div>
            <button
              onClick={async () => {
                await rpc("library.delete", { id: item.id }).catch((e) => s.setError(String(e)));
                const lib = await rpc<{ items: [] }>("listLibrary");
                s.setLibrary(lib.items);
              }}
              className="text-xs text-[var(--danger)] hover:underline"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
