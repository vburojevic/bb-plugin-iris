// Pure logic behind the evidence components: Acceptance (is it really done),
// Compare (what changed between two images) and Provenance (which build is
// really where). The views only draw what these return, so tests cover the
// judgments without a browser.

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | undefined => (v == null || v === "" ? undefined : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined);

// ---------- Acceptance ----------

export const ACCEPTANCE_STATUSES = ["passed", "failed", "blocked", "untested", "claimed"] as const;
export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];

/** Worst first: the order a verdict and a row's summary read in. */
const SEVERITY: AcceptanceStatus[] = ["failed", "blocked", "claimed", "untested", "passed"];

/** Reads a status the way people write it; anything unknown is untested, never passed. */
export function acceptanceStatus(v: unknown): AcceptanceStatus {
  if (v === true) return "passed";
  if (v === false) return "failed";
  const t = String(v ?? "").trim().toLowerCase();
  if ((ACCEPTANCE_STATUSES as readonly string[]).includes(t)) return t as AcceptanceStatus;
  // Passed only when that is all the text says: "done but not verified" is not a pass.
  if (/^(pass(ed|es|ing)?|ok(ay)?|done|yes|verified|proven|green|success(ful)?|✓|✔)$/.test(t)) return "passed";
  if (/^(fail|error|broken|no$|red$|✗|✘)/.test(t)) return "failed";
  if (/^(block|stuck|waiting on)/.test(t)) return "blocked";
  if (/claim|assert|said|unverified|not verified|unproven|reported|supposedly/.test(t)) return "claimed";
  return "untested";
}

export interface AcceptanceCell {
  status: AcceptanceStatus;
  note?: string;
  evidence?: string;
  /** True when the criterion gave no cell for this column. */
  missing?: boolean;
}

export interface AcceptanceRow {
  name: string;
  /** The row's status: its own, or the worst of its cells. */
  status: AcceptanceStatus;
  note?: string;
  evidence?: string;
  /** One per column, in column order; empty without columns. */
  cells: AcceptanceCell[];
}

export interface AcceptanceModel {
  columns: string[];
  rows: AcceptanceRow[];
  counts: Record<AcceptanceStatus, number>;
  /** done: everything passed. not done: something failed or is blocked. unproven: the rest. */
  verdict: "done" | "not done" | "unproven" | "empty";
}

export function worstStatus(list: AcceptanceStatus[]): AcceptanceStatus {
  for (const s of SEVERITY) if (list.includes(s)) return s;
  return "untested";
}

function cellOf(v: unknown): AcceptanceCell {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = obj(v);
    return { status: acceptanceStatus(o.status), note: text(o.note), evidence: text(o.evidence) };
  }
  return { status: acceptanceStatus(v) };
}

/**
 * Turns criteria into one shape. Without columns each criterion is one row.
 * With columns (given, or gathered from the cells in first-seen order) it is a
 * matrix: a cell a criterion leaves out reads as untested, and a criterion with
 * only a status fills every column with it.
 */
export function normalizeAcceptance(criteria: unknown, columns?: unknown): AcceptanceModel {
  const list = Array.isArray(criteria) ? criteria : criteria && typeof criteria === "object" ? Object.entries(criteria).map(([name, status]) => ({ name, status })) : [];
  const items = list.map((c) => (typeof c === "string" ? { name: c } : obj(c)));
  // Given columns first, then any column a cell names that they leave out, so no result is dropped.
  const cols: string[] = Array.isArray(columns) ? columns.map((c) => text(c) ?? "").filter(Boolean) : [];
  const fold = (k: string) => k.trim().toLowerCase();
  for (const c of items) for (const k of Object.keys(obj(c.cells))) if (!cols.some((x) => fold(x) === fold(k))) cols.push(k);
  const rows: AcceptanceRow[] = items.map((c, k) => {
    const name = text(c.name ?? c.title ?? c.criterion) ?? `Criterion ${k + 1}`;
    const own = c.status !== undefined ? acceptanceStatus(c.status) : undefined;
    const raw = obj(c.cells);
    const keys = Object.keys(raw);
    // Only a criterion with no cells at all lets its status stand for every column.
    const cells: AcceptanceCell[] = cols.map((col) => {
      const key = keys.find((k) => fold(k) === fold(col));
      if (key !== undefined) return cellOf(raw[key]);
      return own && !keys.length ? { status: own } : { status: "untested", missing: true };
    });
    const status = cells.length ? worstStatus(cells.map((x) => x.status)) : (own ?? "untested");
    return { name, status, note: text(c.note), evidence: text(c.evidence), cells };
  });
  const counts = Object.fromEntries(ACCEPTANCE_STATUSES.map((s) => [s, 0])) as Record<AcceptanceStatus, number>;
  for (const r of rows) {
    if (r.cells.length) for (const x of r.cells) counts[x.status]++;
    else counts[r.status]++;
  }
  const total = ACCEPTANCE_STATUSES.reduce((n, s) => n + counts[s], 0);
  const verdict: AcceptanceModel["verdict"] = !total ? "empty" : counts.passed === total ? "done" : counts.failed || counts.blocked ? "not done" : "unproven";
  return { columns: cols, rows, counts, verdict };
}

/** Evidence opens as a URL when it is one, else as a workspace file (path:line allowed). */
export function evidenceTarget(evidence: string): { kind: "url"; url: string } | { kind: "file"; path: string; line: number | null } {
  if (/^https?:\/\//i.test(evidence)) return { kind: "url", url: evidence };
  // path:line only when the part before the colon looks like a file path, so "localhost:3000" stays whole.
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(evidence);
  return m && m[1] && /[/\\]|\.[a-z0-9]+$/i.test(m[1]) && !/^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|app)$/i.test(m[1]) ? { kind: "file", path: m[1], line: Number(m[2]) } : { kind: "file", path: evidence, line: null };
}

// ---------- Compare ----------

export const COMPARE_MODES = ["wipe", "side", "blink", "diff"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export interface CompareImage {
  src: string;
  label: string;
}

export function normalizeCompareImages(images: unknown): CompareImage[] {
  const list = Array.isArray(images) ? images : [];
  const out: CompareImage[] = [];
  for (const item of list) {
    const src = typeof item === "string" ? item : text(obj(item).src);
    if (!src) continue;
    out.push({ src, label: text(obj(item).label) ?? "" });
  }
  const names = out.length === 2 ? ["Reference", "Current"] : out.map((_, k) => (k === 0 ? "Reference" : `Image ${k + 1}`));
  return out.map((im, k) => ({ ...im, label: im.label || names[k] }));
}

/** Wipe suits a pair; more images read best side by side. */
export function compareMode(mode: unknown, count: number): CompareMode {
  if (typeof mode === "string" && (COMPARE_MODES as readonly string[]).includes(mode)) return mode as CompareMode;
  return count === 2 ? "wipe" : "side";
}

export interface PixelDiff {
  changed: number;
  total: number;
  /** 1 where a pixel changed, row-major. */
  mask: Uint8Array;
  /** The smallest box holding every change, or null when nothing changed. */
  bounds: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Counts pixels whose color differs between two RGBA buffers of one size. A
 * pixel changes when any channel (alpha included) moves more than threshold
 * (0-255), so compression noise and antialiasing below it are ignored.
 */
export function diffPixels(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number, threshold = 16): PixelDiff {
  const total = width * height;
  if (a.length < total * 4 || b.length < total * 4) throw new Error(`diffPixels needs ${total * 4} bytes per image, got ${a.length} and ${b.length}`);
  const mask = new Uint8Array(total);
  const t = Math.max(0, Math.min(255, threshold));
  let changed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (Math.abs(a[o] - b[o]) > t || Math.abs(a[o + 1] - b[o + 1]) > t || Math.abs(a[o + 2] - b[o + 2]) > t || Math.abs(a[o + 3] - b[o + 3]) > t) {
      mask[i] = 1;
      changed++;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { changed, total, mask, bounds: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
}

/** The size both images are drawn at for a diff: the reference's, scaled down to fit a pixel budget. */
export function diffSize(width: number, height: number, maxPixels = 4_000_000): { width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// ---------- Provenance ----------

export const PROVENANCE_FACTS = ["branch", "sha", "build", "version", "device"] as const;
/** Facts compared against expected; branch and device describe, they do not identify a build. */
export const COMPARED_FACTS = ["sha", "build", "version"] as const;
export type ComparedFact = (typeof COMPARED_FACTS)[number];

export interface ProvenanceMismatch {
  fact: ComparedFact;
  actual: string;
  expected: string;
}

export interface ProvenanceStage {
  name: string;
  status?: string;
  facts: [string, string][];
  mismatches: ProvenanceMismatch[];
}

export interface ProvenanceModel {
  stages: ProvenanceStage[];
  expected: [ComparedFact, string][];
  /** Stages whose facts differ from expected. */
  differing: number;
  /** Stages that carry at least one expected fact, so could be checked. */
  checked: number;
}

/** Shas match when one is a prefix of the other (short and full forms), case aside. */
export function sameFact(fact: ComparedFact, actual: string, expected: string): boolean {
  const a = actual.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  if (fact === "sha") return a.length >= 4 && e.length >= 4 ? a.startsWith(e) || e.startsWith(a) : a === e;
  if (fact === "version") return a.replace(/^v/, "") === e.replace(/^v/, "");
  return a === e;
}

export function normalizeProvenance(stages: unknown, expected?: unknown): ProvenanceModel {
  const want = obj(expected);
  const exp = COMPARED_FACTS.flatMap((f) => (text(want[f]) ? [[f, text(want[f]) as string] as [ComparedFact, string]] : []));
  let differing = 0;
  let checked = 0;
  const list = (Array.isArray(stages) ? stages : []).map((s, k): ProvenanceStage => {
    const o = typeof s === "string" ? { name: s } : obj(s);
    const raw = obj(o.facts);
    const keys = [...PROVENANCE_FACTS.filter((f) => f in raw), ...Object.keys(raw).filter((f) => !(PROVENANCE_FACTS as readonly string[]).includes(f))];
    const facts = keys.flatMap((f) => (text(raw[f]) ? [[f, text(raw[f]) as string] as [string, string]] : []));
    const mismatches: ProvenanceMismatch[] = [];
    let comparable = false;
    for (const [fact, value] of exp) {
      const actual = text(raw[fact]);
      if (!actual) continue;
      comparable = true;
      if (!sameFact(fact, actual, value)) mismatches.push({ fact, actual, expected: value });
    }
    if (comparable) checked++;
    if (mismatches.length) differing++;
    return { name: text(o.name) ?? `Stage ${k + 1}`, status: text(o.status), facts, mismatches };
  });
  return { stages: list, expected: exp, differing, checked };
}

/** A stage status's tone, read from the words people use. */
export function stageTone(status: string | undefined): "good" | "warn" | "bad" | "info" | "neutral" {
  const t = (status ?? "").toLowerCase();
  if (!t) return "neutral";
  if (/\b(no|zero|0|without) (errors?|failures?|crash(es)?)\b/.test(t)) return "good";
  if (/fail|error|broken|rejected|crash/.test(t)) return "bad";
  if (/\b(not|no|never)\b|stale|outdated|behind|\bold\b|drift|mismatch|warn|partial|missing/.test(t)) return "warn";
  if (/running|building|progress|deploying|installing|uploading|processing|review|queued|pending|waiting/.test(t)) return "info";
  if (/\b(pass(ed)?|ok|done|live|deployed|installed|shipped|released|merged|success|ready|current|verified|green|built)\b/.test(t)) return "good";
  return "neutral";
}

/** How a fact reads in a narrow column: a sha shortens to 7 characters. */
export function showFact(fact: string, value: string): string {
  return fact === "sha" && /^[0-9a-f]{8,}$/i.test(value) ? value.slice(0, 7) : value;
}
