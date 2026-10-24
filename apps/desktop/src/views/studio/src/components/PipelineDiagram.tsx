import { ArrowRight, Camera, MonitorPlay, ScanFace, SlidersHorizontal, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./ui";

const NODES: Array<{ id: string; label: string; detail: string; icon: ReactNode }> = [
  { id: "capture", label: "Capture", detail: "camera · 720p", icon: <Camera size={16} /> },
  { id: "detect", label: "Detect", detail: "YuNet · track", icon: <ScanFace size={16} /> },
  { id: "swap", label: "Swap", detail: "BYO · blend", icon: <Users size={16} /> },
  { id: "output", label: "Output", detail: "record · vcam", icon: <MonitorPlay size={16} /> },
];

export function PipelineDiagram({
  compact = false,
  activeId,
  className,
}: {
  compact?: boolean;
  activeId?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn("w-full", className)}
      role="img"
      aria-label="Pipeline: capture, detect, swap, output"
    >
      <div className={cn("flex items-stretch", compact ? "gap-1.5" : "gap-2")}>
        {NODES.map((node, index) => (
          <div key={node.id} className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5",
                compact ? "py-1.5" : "py-2.5",
                activeId === node.id
                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10"
                  : "border-[var(--line-soft)] bg-[var(--surface-2)]",
              )}
            >
              <span
                className={cn(
                  "shrink-0",
                  activeId === node.id ? "text-[var(--accent)]" : "text-[var(--muted)]",
                )}
              >
                {node.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold leading-tight">
                  {node.label}
                </span>
                {!compact && (
                  <span className="mono block truncate text-[9px] uppercase tracking-wider text-[var(--faint)]">
                    {node.detail}
                  </span>
                )}
              </span>
            </div>
            {index < NODES.length - 1 && (
              <ArrowRight size={12} className="shrink-0 text-[var(--faint)]" aria-hidden />
            )}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--faint)]">
          <SlidersHorizontal size={11} aria-hidden />
          <span>Frames stay in shared memory between Rust and Python; Bun only coordinates.</span>
        </div>
      )}
    </div>
  );
}
