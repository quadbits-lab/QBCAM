import { useStudio } from "../store";
import { cn } from "./ui";

/** Full lockup (icon + wordmark) supplied by the brand kit. */
export function BrandLogo({ className }: { className?: string }) {
  const theme = useStudio((s) => s.theme);
  return (
    <img
      src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
      alt="QBCAM"
      className={cn("h-6 w-auto select-none", className)}
      draggable={false}
    />
  );
}

/** Square app icon supplied by the brand kit. */
export function BrandIcon({ className }: { className?: string }) {
  const theme = useStudio((s) => s.theme);
  return (
    <img
      src={theme === "dark" ? "/icon-dark.png" : "/icon-light.png"}
      alt=""
      aria-hidden
      className={cn("h-8 w-8 select-none rounded-md", className)}
      draggable={false}
    />
  );
}
