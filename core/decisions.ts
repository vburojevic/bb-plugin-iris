// DecisionLog: decisions with their topic, what was decided, who decided, why
// and when. Reads rows with any common column names (Topic, Decision, Owner,
// Rationale, Date; case and spacing ignored), a CSV load(), or the Markdown
// table agents keep in a DECISIONS.md. Newest first; a superseded or reversed
// decision stays listed but reads as no longer in force.

export type DecisionStatus = "active" | "proposed" | "superseded" | "reversed";

export interface DecisionRow {
  topic?: string;
  decision: string;
  by?: string;
  why?: string;
  date?: string;
  /** ms since epoch, when the date parses. */
  time: number | null;
  status: DecisionStatus;
  link?: string;
  /** Position in the input, which breaks ties between equal dates. */
  order: number;
}

export interface DecisionModel {
  rows: DecisionRow[];
  topics: { name: string; count: number }[];
  problems: string[];
}

export const MAX_DECISIONS = 500;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

const KEYS: Record<"topic" | "decision" | "by" | "why" | "date" | "status" | "link", string[]> = {
  topic: ["topic", "area", "subject", "category", "scope", "question", "component"],
  decision: ["decision", "decided", "choice", "outcome", "resolution", "what", "title", "summary"],
  by: ["by", "who", "owner", "decidedby", "decider", "author", "approver", "approvedby"],
  why: ["why", "rationale", "reason", "reasoning", "because", "context", "notes", "note"],
  date: ["date", "when", "at", "decidedat", "decidedon", "time", "day"],
  status: ["status", "state"],
  link: ["link", "url", "href", "ref", "pr", "issue"],
};

const squash = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");

function pick(o: Obj, field: keyof typeof KEYS): string | undefined {
  const keys = Object.keys(o);
  for (const want of KEYS[field]) {
    const k = keys.find((x) => squash(x) === want);
    if (k) {
      const v = o[k];
      const s = Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : text(v);
      if (s) return s;
    }
  }
  return undefined;
}

function statusOf(v: string | undefined, decision: string): DecisionStatus {
  const s = (v ?? "").toLowerCase();
  if (/supersed|replaced|obsolete/.test(s)) return "superseded";
  if (/revers|revert|rescind|withdrawn|rejected|dropped/.test(s)) return "reversed";
  if (/propos|draft|pending|open|discuss/.test(s)) return "proposed";
  if (!s && /^~~.*~~$/.test(decision)) return "superseded";
  return "active";
}

function timeOf(date: string | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date);
  return Number.isFinite(t) ? t : null;
}

/** A Markdown table (| a | b |) as rows keyed by its header. */
export function markdownRows(src: string): Obj[] {
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];
  const cells = (l: string) => l.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const head = cells(lines[0]);
  const body = lines.slice(1).filter((l) => !/^[|\s:-]+$/.test(l));
  return body.map((l) => Object.fromEntries(cells(l).map((c, k) => [head[k] ?? `col${k}`, c])));
}

const strip = (s: string) => s.replace(/^~~(.*)~~$/, "$1").replace(/\*\*(.+?)\*\*/g, "$1");

export function normalizeDecisions(input: unknown): DecisionModel {
  const problems: string[] = [];
  const items: unknown[] = typeof input === "string" ? markdownRows(input) : Array.isArray(input) ? input : isObj(input) && Array.isArray(input.decisions) ? input.decisions : [];
  if (typeof input === "string" && !items.length) problems.push("found no Markdown table rows; give rows of {topic, decision, by, why, date}");
  const rows: DecisionRow[] = [];
  items.forEach((item, k) => {
    if (rows.length >= MAX_DECISIONS) return;
    const o: Obj = typeof item === "string" ? { decision: item } : isObj(item) ? item : {};
    const raw = pick(o, "decision");
    if (!raw) return;
    const date = pick(o, "date");
    rows.push({
      topic: pick(o, "topic"),
      decision: strip(raw).slice(0, 600),
      by: pick(o, "by")?.slice(0, 120),
      why: pick(o, "why")?.slice(0, 2000),
      date,
      time: timeOf(date),
      status: statusOf(pick(o, "status"), raw),
      link: pick(o, "link"),
      order: k,
    });
  });
  if (items.length > MAX_DECISIONS) problems.push(`showing the first ${MAX_DECISIONS} of ${items.length} decisions`);
  if (items.length && !rows.length) problems.push("no row has a decision: name the column decision (or choice, outcome, what)");
  // Newest first; undated rows keep their place after the dated ones, latest written first.
  rows.sort((a, b) => (a.time == null) !== (b.time == null) ? (a.time == null ? 1 : -1) : a.time != null && b.time != null && a.time !== b.time ? b.time - a.time : b.order - a.order);
  const counts = new Map<string, number>();
  for (const r of rows) if (r.topic) counts.set(r.topic, (counts.get(r.topic) ?? 0) + 1);
  return { rows, topics: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), problems };
}

/** Rows that mention every word of the query in any field. */
export function filterDecisions(rows: DecisionRow[], query: string, topic: string | null): DecisionRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (topic && r.topic !== topic) return false;
    if (!words.length) return true;
    const hay = [r.topic, r.decision, r.by, r.why, r.date].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
