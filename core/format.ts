// Number, money, size, duration and date formatting, shared by the fmt()
// builtins and every component's `format` prop.

export type NumberFormat =
  | "number"
  | "integer"
  | "percent"
  | "usd"
  | "eur"
  | "gbp"
  | "bytes"
  | "duration"
  | "ms"
  | "compact"
  | "date"
  | "datetime"
  | "time"
  | "relative"
  | {
      style: "number" | "percent" | "currency" | "date";
      decimals?: number;
      currency?: string;
      date?: "short" | "medium" | "long" | "time" | "datetime" | "relative";
    };

export const FORMAT_NAMES = ["number", "integer", "percent", "usd", "eur", "gbp", "bytes", "duration", "ms", "compact", "date", "datetime", "time", "relative"] as const;

const LOCALE = "en-US";

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v < 1e11 ? v * 1000 : v);
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
  }
  return null;
}

/** Formats a value; anything that is not a number (or date) passes through as text. */
export function formatValue(v: unknown, format: NumberFormat | undefined | null): string {
  if (v == null) return "";
  if (!format) return typeof v === "number" ? formatNumber(v) : String(v);
  if (typeof format === "string") {
    switch (format) {
      case "number":
        return withNumber(v, (n) => formatNumber(n));
      case "integer":
        return withNumber(v, (n) => Math.round(n).toLocaleString(LOCALE));
      case "percent":
        return withNumber(v, (n) => formatPercent(n));
      case "usd":
      case "eur":
      case "gbp":
        return withNumber(v, (n) => formatCurrency(n, format.toUpperCase()));
      case "bytes":
        return withNumber(v, formatBytes);
      case "duration":
      case "ms":
        return withNumber(v, formatDuration);
      case "compact":
        return withNumber(v, (n) => new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(n));
      case "date":
      case "datetime":
      case "time":
      case "relative":
        return formatDate(v, format === "date" ? "medium" : format);
    }
    return String(v);
  }
  switch (format.style) {
    case "number":
      return withNumber(v, (n) => n.toLocaleString(LOCALE, decimals(format.decimals)));
    case "percent":
      return withNumber(v, (n) => formatPercent(n, format.decimals));
    case "currency":
      return withNumber(v, (n) => formatCurrency(n, format.currency ?? "USD", format.decimals));
    case "date":
      return formatDate(v, format.date ?? "medium");
  }
}

const decimals = (d?: number) => (d == null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: d, maximumFractionDigits: d });

function withNumber(v: unknown, f: (n: number) => string): string {
  const n = toNumber(v);
  return n === null ? String(v) : f(n);
}

export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  const max = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return n.toLocaleString(LOCALE, { maximumFractionDigits: max });
}

/** 0.42 and 42 both read as 42%: values above 1 are taken as already in percent. */
function formatPercent(n: number, d?: number): string {
  const value = Math.abs(n) <= 1 ? n * 100 : n;
  const digits = d ?? (Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0);
  return `${value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function formatCurrency(n: number, currency: string, d?: number): string {
  try {
    const whole = Number.isInteger(n) && Math.abs(n) >= 100;
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: d ?? (whole ? 0 : 2),
      maximumFractionDigits: d ?? (whole ? 0 : 2),
    }).format(n);
  } catch {
    return `${n.toLocaleString(LOCALE)} ${currency}`;
  }
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.abs(n);
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const s = v >= 100 || u === 0 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
  return `${n < 0 ? "-" : ""}${s} ${units[u]}`;
}

/** Milliseconds as "480 ms", "1.2 s", "1m 42s", "2h 5m". */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(ms)} ms`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(abs < 10_000 ? 2 : 1).replace(/\.?0+$/, "")} s`;
  const s = Math.round(abs / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const m = Math.round(s / 60);
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

function formatDate(v: unknown, style: string): string {
  const d = toDate(v);
  if (!d) return String(v);
  if (style === "relative") return relative(d);
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", day: "numeric" }
      : style === "long"
        ? { weekday: "long", year: "numeric", month: "long", day: "numeric" }
        : style === "time"
          ? { hour: "numeric", minute: "2-digit" }
          : style === "datetime"
            ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
            : { year: "numeric", month: "short", day: "numeric" };
  // A plain yyyy-mm-dd is a calendar day, not midnight UTC.
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) opts.timeZone = "UTC";
  return d.toLocaleString(LOCALE, opts);
}

function relative(d: Date): string {
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), "day");
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), "month");
  return rtf.format(Math.round(diff / (86_400 * 365)), "year");
}
