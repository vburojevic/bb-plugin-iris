// Delta: before and after for any values, with the change and whether it went the right way.

export type Better = "up" | "down" | "none";
export type Verdict = "better" | "worse" | "same" | "changed";

export interface DeltaRow {
  label: string;
  before: unknown;
  after: unknown;
  better: Better;
  format?: unknown;
  /** after minus before, when both are numbers. */
  change: number | null;
  /** The change as a fraction of before (0.25 is 25%), when before is a nonzero number. */
  ratio: number | null;
  verdict: Verdict;
}

export const MAX_DELTA_ROWS = 100;

/** A number, or a string that is one ("512"); anything else is null. */
export const deltaNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const label = (vals: unknown[], k: number) => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.slice(0, 120);
    if (typeof v === "number") return String(v);
  }
  return `Row ${k + 1}`;
};
/** Equal for display: missing, null and "" are all empty; objects compare whatever their key order. */
const stable = (v: unknown): string =>
  v == null || v === "" ? "" : typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;

/** Rows of {label, before, after, better?, format?}; better says which way is good: up, down or none. */
export function deltaRows(v: unknown, defaultBetter: unknown = "none"): DeltaRow[] {
  const fallback: Better = defaultBetter === "up" || defaultBetter === "down" ? defaultBetter : "none";
  const out: DeltaRow[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const better: Better = o.better === "up" || o.better === "down" || o.better === "none" ? o.better : fallback;
    const b = deltaNumber(o.before);
    const a = deltaNumber(o.after);
    let change = a != null && b != null ? a - b : null;
    if (change != null && !Number.isFinite(change)) change = null;
    // Rounding noise (0.1 + 0.2 against 0.3) is no change.
    if (change != null && a != null && b != null && Math.abs(change) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) change = 0;
    const ratio = change != null && b ? change / Math.abs(b) : null;
    const same = change != null ? change === 0 : a == null && b == null && stable(o.before) === stable(o.after);
    const verdict: Verdict = same ? "same" : change == null || better === "none" ? "changed" : (change > 0) === (better === "up") ? "better" : "worse";
    out.push({ label: label([o.label, o.name, o.metric], out.length), before: o.before, after: o.after, better, format: o.format, change, ratio, verdict });
    if (out.length >= MAX_DELTA_ROWS) break;
  }
  return out;
}

/** How many rows got better, worse, stayed the same or just changed. */
export function deltaTally(rows: DeltaRow[]): Record<Verdict, number> {
  const t: Record<Verdict, number> = { better: 0, worse: 0, same: 0, changed: 0 };
  for (const r of rows) t[r.verdict] += 1;
  return t;
}
