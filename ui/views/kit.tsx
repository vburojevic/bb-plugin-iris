// Small shared pieces for Iris views.
import type { CSSProperties, ReactNode } from "react";
import { LucideIcon } from "../icons";
import { cn } from "../../lib/utils";
import { formatValue, type NumberFormat } from "../../core/format";
import { toText } from "../../core/evaluate";
import { useEnv } from "../env";
import { type Tone, toneColor } from "../palette";

export { cn };

export const GAP: Record<string, string> = { none: "gap-0", sm: "gap-2", md: "gap-3", lg: "gap-5" };

export function str(v: unknown): string | undefined {
  return v == null || v === "" ? undefined : toText(v);
}

export function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function fmt(v: unknown, format: unknown): string {
  return formatValue(v, (format as NumberFormat) ?? undefined);
}

export function useTone(tone: unknown): string | undefined {
  const { palette } = useEnv();
  return toneColor(palette, tone);
}

/** A Lucide icon by name, e.g. "rocket" or "triangle-alert". */
export function Glyph({ name, size = 16, color, className, style }: { name: unknown; size?: number; color?: string; className?: string; style?: CSSProperties }) {
  const n = str(name);
  if (!n) return null;
  return <LucideIcon name={n} size={size} color={color} className={cn("shrink-0", className)} style={style} />;
}

export function ToneDot({ tone, className }: { tone: unknown; className?: string }) {
  const color = useTone(tone) ?? "var(--muted-foreground)";
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

/** A soft chip in a tone color. */
export function Chip({ tone, children, variant = "soft", icon, className }: { tone?: unknown; children: ReactNode; variant?: string; icon?: unknown; className?: string }) {
  const color = useTone(tone);
  const style: CSSProperties = color
    ? variant === "solid"
      ? { background: color, color: "var(--background, #fff)" }
      : variant === "outline"
        ? { boxShadow: `inset 0 0 0 1px ${color}`, color }
        : { background: `color-mix(in oklab, ${color} 14%, transparent)`, color }
    : {};
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 truncate rounded-full px-2 text-[11.5px] font-medium leading-none",
        !color && (variant === "outline" ? "ring-1 ring-border text-muted-foreground" : "bg-muted text-muted-foreground"),
        className,
      )}
      style={style}
    >
      {icon ? <Glyph name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-xs text-muted-foreground", className)}>{children}</div>;
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("iris-shimmer rounded-md", className)} aria-label="Loading" />;
}

export type { Tone };
