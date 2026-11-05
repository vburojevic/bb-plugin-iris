// Redline's model: a word-level diff of two versions of prose, grouped into
// changes the person accepts or rejects one by one, and the text those
// decisions produce. Words, punctuation and whitespace are separate tokens;
// changes split only by spaces merge into one ("the quick" -> "a fast"), but
// never across a line break.

export type Decision = "accept" | "reject";
export type Segment = { kind: "same"; text: string } | { kind: "change"; id: number; del: string; ins: string };

const TOKEN = /\r?\n|[^\S\r\n]+|[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*|[^\s]/gu;
/** Past this many token edits the texts are rewrites, shown as one change. Keeps the diff fast and small. */
const MAX_EDITS = 1500;

export function tokenize(s: string): string[] {
  return s.match(TOKEN) ?? [];
}

type Op = { op: "eq" | "del" | "ins"; text: string };

/** Myers' O(ND) diff over tokens, after trimming the shared start and end. */
export function diffTokens(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: Op[] = a.slice(0, start).map((text) => ({ op: "eq", text }));
  const tail: Op[] = a.slice(endA).map((text) => ({ op: "eq", text }));
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const middle = myers(A, B) ?? [...A.map((text) => ({ op: "del" as const, text })), ...B.map((text) => ({ op: "ins" as const, text }))];
  return [...head, ...middle, ...tail];
}

/** Myers' diff, or null when the texts differ by more than MAX_EDITS tokens. */
function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;
  // Walk back through the saved frontiers.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const saved = trace[d];
    const at = (k: number) => saved[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ op: "eq", text: a[--x] }), y--;
    if (d > 0) {
      if (x === prevX) ops.push({ op: "ins", text: b[--y] });
      else ops.push({ op: "del", text: a[--x] });
    }
  }
  while (x > 0 && y > 0) ops.push({ op: "eq", text: a[--x] }), y--;
  return ops.reverse();
}

/** The two versions as plain runs and numbered changes. */
export function redline(before: string, after: string): Segment[] {
  const ops = diffTokens(tokenize(before), tokenize(after));
  type Run = { kind: "same"; text: string } | { kind: "change"; del: string; ins: string };
  const runs: Run[] = [];
  for (const o of ops) {
    const last = runs[runs.length - 1];
    if (o.op === "eq") {
      if (last?.kind === "same") last.text += o.text;
      else runs.push({ kind: "same", text: o.text });
    } else {
      const c = last?.kind === "change" ? last : (runs.push({ kind: "change", del: "", ins: "" }), runs[runs.length - 1] as Extract<Run, { kind: "change" }>);
      if (o.op === "del") c.del += o.text;
      else c.ins += o.text;
    }
  }
  // Merge change, spaces, change into one change.
  const merged: Run[] = [];
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    const prev = merged[merged.length - 1];
    const next = runs[k + 1];
    if (r.kind === "same" && prev?.kind === "change" && next?.kind === "change" && /^[^\S\r\n]+$/.test(r.text)) {
      prev.del += r.text + next.del;
      prev.ins += r.text + next.ins;
      k++;
      continue;
    }
    merged.push(r.kind === "same" ? { ...r } : { ...r });
  }
  // Whitespace-only changes apply silently; they aren't worth a decision.
  const out: Segment[] = [];
  let id = 0;
  for (const r of merged) {
    const text = r.kind === "same" ? r.text : null;
    if (r.kind === "change" && !(r.del + r.ins).trim()) {
      pushSame(out, r.ins);
      continue;
    }
    if (text != null) pushSame(out, text);
    else if (r.kind === "change") out.push({ kind: "change", id: id++, del: r.del, ins: r.ins });
  }
  return out;
}

function pushSame(out: Segment[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === "same") last.text += text;
  else out.push({ kind: "same", text });
}

/** The text the decisions produce; an undecided change counts as accepted. */
export function applyDecisions(segments: Segment[], decisions: Record<number, Decision | undefined>): string {
  return segments.map((s) => (s.kind === "same" ? s.text : decisions[s.id] === "reject" ? s.del : s.ins)).join("");
}

export function changeCount(segments: Segment[]): number {
  return segments.filter((s) => s.kind === "change").length;
}

/** Reads the decisions saved with the card, dropping ids that no longer exist. */
export function readDecisions(saved: unknown, count: number): Record<number, Decision> {
  const out: Record<number, Decision> = {};
  if (!saved || typeof saved !== "object") return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const id = Number(k);
    if (Number.isInteger(id) && id >= 0 && id < count && (v === "accept" || v === "reject")) out[id] = v;
  }
  return out;
}

/** check(): before and after must both be text. */
export function redlineProblems(before: unknown, after: unknown): string[] {
  const problems: string[] = [];
  if (before !== undefined && typeof before !== "string") problems.push("before must be text");
  if (after !== undefined && typeof after !== "string") problems.push("after must be text");
  return problems;
}
