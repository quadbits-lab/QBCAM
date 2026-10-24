import { Film, FolderSearch, Image as ImageIcon, LayoutGrid, List, Trash2 } from "lucide-react";
import { useState } from "react";
import { rpc } from "../api";
import { Page } from "../components/Page";
import { Badge, Button, Card, cn, EmptyState } from "../components/ui";
import { type LibraryItem, useStudio } from "../store";

export function LibraryTab() {
  const s = useStudio();
  const [view, setView] = useState<"grid" | "list">("grid");

  async function refresh() {
    const lib = await rpc<{ items: LibraryItem[] }>("listLibrary");
    s.setLibrary(lib.items);
  }

  async function remove(item: LibraryItem) {
    if (!confirm(`Delete ${item.path.split("/").pop()}?`)) return;
    try {
      await rpc("library.delete", { id: item.id });
      await refresh();
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reveal(item: LibraryItem) {
    try {
      await rpc("revealInFolder", { path: item.path });
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Page
      title="Library"
      description="Recordings and snapshots with their provenance status."
      wide
      actions={
        <div className="flex rounded-md border border-[var(--line)] p-0.5">
          <button
            type="button"
            onClick={() => setView("grid")}
            className={cn(
              "rounded p-1.5",
              view === "grid" ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--muted)]",
            )}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "rounded p-1.5",
              view === "list" ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--muted)]",
            )}
            aria-label="List view"
            aria-pressed={view === "list"}
          >
            <List size={14} />
          </button>
        </div>
      }
    >
      {s.library.length === 0 ? (
        <EmptyState
          icon={<Film size={30} />}
          title="Nothing captured yet"
          description="Recordings and snapshots from Studio appear here with their provenance sidecar status."
        />
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {s.library.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <div className="grid-bg flex aspect-video items-center justify-center border-b border-[var(--line-soft)] text-[var(--faint)]">
                {item.kind === "recording" ? <Film size={26} /> : <ImageIcon size={26} />}
              </div>
              <div className="p-3">
                <div className="truncate text-xs font-medium">{item.path.split("/").pop()}</div>
                <div className="mono mt-1 text-[10px] uppercase tracking-wider text-[var(--faint)]">
                  {item.kind} · {(item.bytes / 1024).toFixed(0)} KB
                  {item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ""}
                </div>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <Badge tone={item.provenanceSigned ? "ok" : "neutral"}>
                    {item.provenanceSigned ? "provenance signed" : "unsigned"}
                  </Badge>
                  <div className="flex">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void reveal(item)}
                      aria-label="Reveal in Finder"
                    >
                      <FolderSearch size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[var(--rec)] hover:text-[var(--rec)]"
                      onClick={() => void remove(item)}
                      aria-label="Delete"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--line-soft)] text-[var(--faint)]">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Provenance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {s.library.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--surface-2)]/60">
                  <td className="max-w-[280px] truncate px-3 py-2">{item.path.split("/").pop()}</td>
                  <td className="px-3 py-2 capitalize text-[var(--muted)]">{item.kind}</td>
                  <td className="mono px-3 py-2 text-[10px] text-[var(--muted)]">
                    {item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="mono px-3 py-2 text-[10px] text-[var(--muted)]">
                    {(item.bytes / 1024).toFixed(0)} KB
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={item.provenanceSigned ? "ok" : "neutral"}>
                      {item.provenanceSigned ? "signed" : "unsigned"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void reveal(item)}
                      aria-label="Reveal in Finder"
                    >
                      <FolderSearch size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[var(--rec)] hover:text-[var(--rec)]"
                      onClick={() => void remove(item)}
                      aria-label="Delete"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
