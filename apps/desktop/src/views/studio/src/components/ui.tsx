import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-105 active:brightness-95 border border-transparent",
  secondary:
    "bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line)] hover:border-[var(--muted)]",
  ghost:
    "bg-transparent text-[var(--muted)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
  danger: "bg-[var(--rec)] text-white border border-transparent hover:brightness-110",
  quiet:
    "bg-transparent text-[var(--text)] border border-[var(--line-soft)] hover:bg-[var(--surface-2)]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background-color,border-color,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function Card({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "raised" | "accent";
}) {
  const bg =
    tone === "raised"
      ? "bg-[var(--surface-2)]"
      : tone === "accent"
        ? "bg-[var(--surface-2)]"
        : "bg-[var(--surface)]";
  return <div className={cn("panel rounded-lg", bg, className)}>{children}</div>;
}

export function PanelHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--line-soft)] px-4 py-3">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1">{eyebrow}</div>}
        <div className="truncate text-sm font-semibold tracking-tight">{title}</div>
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "rec" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-[var(--line)] text-[var(--muted)]",
  accent: "border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10",
  ok: "border-[var(--ok)]/40 text-[var(--ok)] bg-[var(--ok)]/10",
  warn: "border-[var(--warn)]/40 text-[var(--warn)] bg-[var(--warn)]/10",
  rec: "border-[var(--rec)]/40 text-[var(--rec)] bg-[var(--rec)]/10",
  info: "border-[var(--info)]/40 text-[var(--info)] bg-[var(--info)]/10",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: Tone }) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "rec"
          ? "var(--rec)"
          : tone === "accent"
            ? "var(--accent)"
            : tone === "info"
              ? "var(--info)"
              : "var(--faint)";
  return <span className="status-dot shrink-0" style={{ background: color }} aria-hidden />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: all form usages wrap a control; composite fields are visual groups
    <label className={cn("block", className)}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--faint)]">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--faint)] focus:border-[var(--accent)]",
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full border transition-colors",
          checked
            ? "border-[var(--accent)] bg-[var(--accent)]"
            : "border-[var(--line)] bg-[var(--surface-3)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left,background-color]",
            checked ? "left-[18px] bg-[var(--accent-ink)]" : "left-0.5 bg-[var(--muted)]",
          )}
        />
      </button>
    </label>
  );
}

/** Segmented level meter used for microphone input and confidence. */
export function Meter({
  level,
  bars = 18,
  tone = "accent",
  className,
}: {
  level: number;
  bars?: number;
  tone?: Tone;
  className?: string;
}) {
  const active = Math.round(Math.max(0, Math.min(1, level)) * bars);
  const color =
    tone === "rec"
      ? "var(--rec)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "info"
          ? "var(--info)"
          : "var(--accent)";
  return (
    <div className={cn("flex h-6 items-end gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional and never reordered
          key={i}
          className="w-full rounded-sm transition-[background-color,opacity] duration-100"
          style={{
            height: `${35 + (i % 5) * 12}%`,
            background: i < active ? color : "var(--surface-3)",
            opacity: i < active ? 1 : 0.8,
          }}
        />
      ))}
    </div>
  );
}

export function ProgressBar({ percent, tone = "accent" }: { percent: number; tone?: Tone }) {
  const color =
    tone === "rec"
      ? "var(--rec)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "ok"
          ? "var(--ok)"
          : "var(--accent)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
      />
    </div>
  );
}

export function ProgressRing({
  percent,
  size = 76,
  label,
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="mono absolute text-[11px] text-[var(--muted)]">
        {label ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid-bg flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--line)] px-6 py-10 text-center">
      {icon && <div className="mb-3 text-[var(--faint)]">{icon}</div>}
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--muted)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
