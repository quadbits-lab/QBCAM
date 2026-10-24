import type { ReactNode } from "react";
import { cn } from "./ui";

export function Page({
  title,
  description,
  actions,
  children,
  wide,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto px-6 pb-16 pt-6", wide ? "max-w-7xl" : "max-w-6xl")}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label mb-1.5">QBCAM / {title}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  layout = "split",
  children,
}: {
  title: string;
  description?: string;
  layout?: "split" | "stacked";
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--line-soft)] py-6 first:border-t-0">
      <div className={cn("grid gap-6", layout === "split" && "md:grid-cols-3")}>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{description}</p>
          )}
        </div>
        <div className={layout === "split" ? "md:col-span-2" : ""}>{children}</div>
      </div>
    </section>
  );
}
