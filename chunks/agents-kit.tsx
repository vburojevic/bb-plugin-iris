// Pieces the "agents", "debug" and "craft" chunk views share: a header line,
// a data block for inputs and outputs, a small meter, and number formats.

import { Glyph, cn, useEnv } from "@iris/ui";
import { useState, type ReactNode } from "react";
import { formatValue } from "../core/format";

export const ms = (v: number | null | undefined) => (v == null ? "" : formatValue(v, "ms"));
export const compact = (v: number | null | undefined) => (v == null ? "" : formatValue(v, "compact"));
export const money = (v: number | null | undefined, currency = "USD") => {
  if (v == null) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: v < 1 ? 3 : 2, minimumFractionDigits: 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
};
export const pct = (r: number) => `${Math.round(r * 100)}%`;
export const tint = (c: string, p: number) => `color-mix(in oklab, ${c} ${p}%, transparent)`;
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";

/** The caption on the left, a short summary on the right, wrapping on narrow cards. */
export function Caption({ title, children }: { title?: string; children?: ReactNode }) {
  if (!title && !children) return null;
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      {title ? <span className="min-w-0 truncate text-[13px] font-medium">{title}</span> : <span />}
      {children ? <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs tabular-nums text-muted-foreground">{children}</span> : null}
    </div>
  );
}

/** A labeled number in a summary strip. */
export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11.5px] text-muted-foreground">{label}</div>
      <div className="truncate text-[17px] font-semibold tabular-nums leading-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub ? <div className="truncate text-[11.5px] tabular-nums text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Data shown as text: strings as they are, the rest as indented JSON; long ones fold. */
export function DataBlock({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  const [all, setAll] = useState(false);
  if (value === undefined) return null;
  const text = asText(value);
  const LIMIT = 1600;
  const long = text.length > LIMIT || text.split("\n").length > 24;
  const shown = all || !long ? text : `${text.slice(0, LIMIT).split("\n").slice(0, 24).join("\n")}\n...`;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <span style={tone ? { color: tone } : undefined}>{label}</span>
        {long ? (
          <button type="button" onClick={() => setAll(!all)} className={cn("rounded px-1 hover:text-foreground", FOCUS)}>
            {all ? "Show less" : `Show all ${text.split("\n").length} lines`}
          </button>
        ) : null}
      </div>
      <pre className="iris-scroll-x max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-2.5 py-2 font-mono text-[11.5px] leading-[1.55]" style={tone ? { boxShadow: `inset 2px 0 0 ${tone}` } : undefined}>
        {shown}
      </pre>
    </div>
  );
}

/** A thin horizontal bar: one value against a whole. */
export function Meter({ share, color, className }: { share: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: color }} />
    </div>
  );
}

/** A disclosure arrow that turns when open. */
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return <Glyph name="chevron-right" size={13} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90", className)} />;
}

/** A plain problem line under a component. */
export function Problems({ items }: { items: string[] }) {
  const { palette } = useEnv();
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
      {items.slice(0, 4).map((p, k) => (
        <li key={k} className="flex items-start gap-1.5">
          <Glyph name="info" size={12} className="mt-px" color={palette.tone.info} />
          <span className="min-w-0 break-words">{p}</span>
        </li>
      ))}
    </ul>
  );
}

/** An empty state in muted text. */
export function Nothing({ children }: { children: ReactNode }) {
  return <div className="py-2 text-[13px] text-muted-foreground">{children}</div>;
}
