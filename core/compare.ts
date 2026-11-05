// Pure logic behind CompareGrid (many before and after pairs) and
// VideoCompare (two videos in sync). The pixel diff itself is Compare's
// (core/evidence.ts diffPixels); the views live in chunks/compare-grid.tsx and
// chunks/video-compare.tsx.

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

// ---------- CompareGrid ----------

export interface ComparePair {
  /** Unique within the grid. */
  key: string;
  label: string;
  /** A path, https URL or data: image; null when that side is missing. */
  ref: string | null;
  cand: string | null;
}

const REF_KEYS = ["ref", "reference", "before", "baseline", "expected", "a"];
const CAND_KEYS = ["cand", "candidate", "after", "current", "actual", "b"];

const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = text(o[k]) ?? text(obj(o[k]).src);
    if (v) return v;
  }
  return null;
};

/** The last path segment of a source, or "image" for a data: URL. */
export function sourceName(src: string): string {
  if (src.startsWith("data:")) return "image";
  const clean = src.split(/[?#]/)[0].replace(/\/+$/, "");
  return decodeURIComponentSafe(clean.split(/[\\/]/).pop() || clean);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Pairs written as {ref, cand, label?} (before/after and a few other names work), or [ref, cand, label?]. */
export function normalizePairs(v: unknown): { pairs: ComparePair[]; problems: string[] } {
  const pairs: ComparePair[] = [];
  const problems: string[] = [];
  if (v == null) return { pairs, problems };
  if (!Array.isArray(v)) return { pairs, problems: ["pairs must be a list"] };
  const seen = new Map<string, number>();
  v.forEach((item, k) => {
    let ref: string | null;
    let cand: string | null;
    let label: string | undefined;
    if (Array.isArray(item)) {
      ref = text(item[0]) ?? null;
      cand = text(item[1]) ?? null;
      label = text(item[2]);
    } else {
      const o = obj(item);
      ref = pick(o, REF_KEYS);
      cand = pick(o, CAND_KEYS);
      label = text(o.label ?? o.name ?? o.title);
    }
    if (!ref && !cand) return problems.push(`pair ${k + 1} has neither a ref nor a cand`);
    const name = label ?? sourceName((cand ?? ref) as string);
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    pairs.push({ key: n ? `${name}#${n + 1}` : name, label: n && !label ? `${name} (${n + 1})` : name, ref, cand });
  });
  return { pairs, problems };
}

/** The images Compare can open (the server's load_image types). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"];
const isImage = (p: string) => IMAGE_EXTENSIONS.includes(/\.([^./]+)$/.exec(p)?.[1]?.toLowerCase() ?? "");

/** Two folder paths from {ref, cand} (or before/after); null when either is missing. */
export function folderPair(v: unknown): { ref: string; cand: string } | null {
  const o = obj(v);
  const ref = pick(o, REF_KEYS);
  const cand = pick(o, CAND_KEYS);
  return ref && cand ? { ref, cand } : null;
}

/**
 * Two folders' images matched by their path inside each folder, case aside.
 * A file only one folder has becomes a pair with the other side missing.
 * Paths come back relative to their folder.
 */
export function matchFolders(refFiles: readonly string[], candFiles: readonly string[]): { key: string; ref: string | null; cand: string | null }[] {
  const fold = (p: string) => p.toLowerCase();
  const byKey = new Map<string, { key: string; ref: string | null; cand: string | null }>();
  for (const f of refFiles) if (isImage(f)) byKey.set(fold(f), { key: f, ref: f, cand: null });
  for (const f of candFiles) {
    if (!isImage(f)) continue;
    const hit = byKey.get(fold(f));
    if (hit) hit.cand = f;
    else byKey.set(fold(f), { key: f, ref: null, cand: f });
  }
  return [...byKey.values()].sort((a, b) => naturalCompare(a.key, b.key));
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export type PairStatus = "same" | "changed" | "missing" | "pending" | "error";

export type PairDiff =
  | { status: "ok"; changed: number; total: number; sizesDiffer: boolean; bounds: { x: number; y: number; width: number; height: number } | null }
  | { status: "error"; error: string };

/** A pair's status from its sides and its diff (undefined while it runs). Different sizes count as changed. */
export function pairStatus(pair: Pick<ComparePair, "ref" | "cand">, diff: PairDiff | undefined): PairStatus {
  if (!pair.ref || !pair.cand) return "missing";
  if (!diff) return "pending";
  if (diff.status === "error") return "error";
  return diff.changed > 0 || diff.sizesDiffer ? "changed" : "same";
}

export const GRID_SORTS = ["change", "name", "order"] as const;
export type GridSort = (typeof GRID_SORTS)[number];
export const GRID_FILTERS = ["all", "changed", "missing", "same"] as const;
export type GridFilter = (typeof GRID_FILTERS)[number];

/** Most changed first: changed by share, then missing, failed, still running, then same. */
const STATUS_RANK: Record<PairStatus, number> = { changed: 0, missing: 1, error: 2, pending: 3, same: 4 };

export interface GridItem {
  pair: ComparePair;
  status: PairStatus;
  diff?: PairDiff;
  /** Given order. */
  index: number;
}

export function changeShare(diff: PairDiff | undefined): number {
  return diff?.status === "ok" && diff.total ? diff.changed / diff.total : 0;
}

export function sortItems(items: GridItem[], by: GridSort): GridItem[] {
  const out = [...items];
  if (by === "name") out.sort((a, b) => naturalCompare(a.pair.label, b.pair.label) || a.index - b.index);
  else if (by === "change") out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || changeShare(b.diff) - changeShare(a.diff) || a.index - b.index);
  else out.sort((a, b) => a.index - b.index);
  return out;
}

export function filterItems(items: GridItem[], f: GridFilter): GridItem[] {
  return f === "all" ? items : items.filter((i) => i.status === f);
}

export function gridCounts(items: GridItem[]): Record<GridFilter, number> & { pending: number; error: number } {
  const c = { all: items.length, changed: 0, missing: 0, same: 0, pending: 0, error: 0 };
  for (const i of items) c[i.status]++;
  return c;
}

/** "0.42%", "under 0.01%", "0%": how much of the image changed, as Compare words it. */
export function shareText(changed: number, total: number): string {
  const share = total ? (changed / total) * 100 : 0;
  return share === 0 ? "0%" : share < 0.01 ? "under 0.01%" : `${share.toFixed(share < 1 ? 2 : 1)}%`;
}

export function readSort(v: unknown): GridSort {
  return (GRID_SORTS as readonly unknown[]).includes(v) ? (v as GridSort) : "change";
}

export function readFilter(v: unknown): GridFilter {
  return (GRID_FILTERS as readonly unknown[]).includes(v) ? (v as GridFilter) : "all";
}

// ---------- VideoCompare ----------

export interface CompareVideo {
  src: string;
  label: string;
}

export function normalizeVideos(v: unknown): CompareVideo[] {
  const list = Array.isArray(v) ? v : [];
  const out: CompareVideo[] = [];
  for (const item of list) {
    const src = typeof item === "string" ? text(item) : text(obj(item).src);
    if (src) out.push({ src, label: text(obj(item).label) ?? "" });
    if (out.length === 2) break;
  }
  const names = ["Reference", "Current"];
  return out.map((x, k) => ({ ...x, label: x.label || names[k] }));
}

/**
 * The shared timeline, in the first video's seconds. The second video shows
 * t + offset when the first shows t, so a positive offset means its moments
 * come later. The timeline runs from the first frame either video shows to
 * the last, so neither video's start or end is cut off.
 */
export function timeline(offset: number, durA: number, durB: number): { lo: number; hi: number } {
  const a = Math.max(0, durA || 0);
  const b = Math.max(0, durB || 0);
  if (!b) return { lo: 0, hi: a };
  // || 0 turns -0 into 0.
  if (!a) return { lo: -offset || 0, hi: b - offset };
  return { lo: Math.min(0, -offset) || 0, hi: Math.max(a, b - offset) };
}

/** Where one video should be at timeline time t: its own time, clamped, and whether t is inside it. */
export function videoTime(t: number, shift: number, duration: number): { time: number; inside: boolean; before: boolean } {
  const want = t + shift;
  const d = Math.max(0, duration || 0);
  return { time: Math.max(0, Math.min(d, want)), inside: want >= 0 && want < d, before: want < 0 };
}

/**
 * How a follower catches up with where it should be: a jump when it is far
 * off, otherwise a playback rate a few percent off the base so it drifts back
 * without a visible seek.
 */
export function catchUp(actual: number, want: number, rate: number): { seek: boolean; rate: number } {
  const drift = actual - want;
  if (Math.abs(drift) > 0.25) return { seek: true, rate };
  if (Math.abs(drift) < 0.015) return { seek: false, rate };
  const nudge = Math.max(-0.08, Math.min(0.08, drift * 0.6));
  return { seek: false, rate: rate * (1 - nudge) };
}

/** A signed offset as it reads: "+0.50 s", "-1.25 s", "0 s". */
export function offsetText(seconds: number): string {
  const r = Math.round(seconds * 1000) / 1000;
  if (!r) return "0 s";
  return `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(2)} s`;
}
