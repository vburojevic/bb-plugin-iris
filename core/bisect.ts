// Bisect: a git bisect in flight. Commits come from `git log --oneline
// good..bad` (newest first, as text or [{sha, subject}]); verdicts from the
// commits themselves ({verdict: good|bad|skip}) or from `git bisect log`. The
// range left is every commit after the newest good one up to the oldest bad
// one; when only the bad one is left, it is the first bad commit.

export type BisectVerdict = "good" | "bad" | "skip";

export interface BisectCommit {
  sha: string;
  subject?: string;
  verdict: BisectVerdict | null;
  /** Still a candidate for the first bad commit. */
  inRange: boolean;
  current: boolean;
}

export interface BisectModel {
  /** Newest first. */
  commits: BisectCommit[];
  good: string | null;
  bad: string | null;
  /** Candidates not yet tested (the bad end and skipped ones left out). */
  remaining: number;
  /** About how many more tests: log2 of the candidates. */
  steps: number;
  /** The commit being tested now, or the one git would test next. */
  suspect: string | null;
  /** The first bad commit, once found. */
  found: string | null;
  problems: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const SHA = /^[0-9a-f]{4,40}$/i;

function verdictOf(v: unknown): BisectVerdict | null {
  const s = String(v ?? "").toLowerCase();
  if (/^(good|old|pass|passed|ok)$/.test(s)) return "good";
  if (/^(bad|new|fail|failed|broken)$/.test(s)) return "bad";
  if (/^skip/.test(s)) return "skip";
  return null;
}

/** Verdicts and subjects from `git bisect log`, in the order they were given. */
export function readBisectLog(log: string): { marks: { sha: string; verdict: BisectVerdict; subject?: string }[]; firstBad: { sha: string; subject?: string } | null } {
  const marks: { sha: string; verdict: BisectVerdict; subject?: string }[] = [];
  const subjects = new Map<string, string>();
  let firstBad: { sha: string; subject?: string } | null = null;
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#\s*(good|bad|skip|old|new):\s*\[([0-9a-f]{4,40})\]\s*(.*)$/i.exec(line))) {
      subjects.set(m[2].toLowerCase(), m[3]);
      continue;
    }
    if ((m = /^#\s*first (?:bad|new) commit:\s*\[([0-9a-f]{4,40})\]\s*(.*)$/i.exec(line))) {
      firstBad = { sha: m[1], subject: m[2] || undefined };
      continue;
    }
    if ((m = /^([0-9a-f]{40}) is the first (?:bad|new) commit/i.exec(line))) {
      firstBad = { sha: m[1] };
      continue;
    }
    if ((m = /^git bisect (good|bad|skip|old|new)\s+(.+)$/i.exec(line))) {
      const v = verdictOf(m[1]) as BisectVerdict;
      for (const sha of m[2].split(/\s+/)) if (SHA.test(sha)) marks.push({ sha, verdict: v });
      continue;
    }
    if ((m = /^git bisect start\s+(.+)$/i.exec(line))) {
      // git bisect start <bad> [<good>...]
      const shas = m[1].split(/\s+/).filter((s) => SHA.test(s) && s !== "--");
      shas.forEach((sha, k) => marks.push({ sha, verdict: k === 0 ? "bad" : "good" }));
    }
  }
  for (const mk of marks) mk.subject = subjects.get(mk.sha.toLowerCase()) ?? [...subjects].find(([s]) => s.startsWith(mk.sha.toLowerCase()) || mk.sha.toLowerCase().startsWith(s))?.[1];
  if (firstBad && !firstBad.subject) firstBad.subject = subjects.get(firstBad.sha.toLowerCase());
  return { marks, firstBad };
}

function commitsOf(v: unknown): { sha: string; subject?: string; verdict: BisectVerdict | null }[] {
  if (typeof v === "string")
    return v
      .split(/\r?\n/)
      .map((l) => /^\s*\*?\s*([0-9a-f]{4,40})\b\s*(?:\([^)]*\)\s*)?(.*)$/i.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ sha: m[1], subject: m[2].trim() || undefined, verdict: null }));
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => (typeof c === "string" ? { sha: c.split(/\s+/)[0], subject: c.split(/\s+/).slice(1).join(" ") || undefined, verdict: null } : isObj(c) ? { sha: String(c.sha ?? c.hash ?? c.id ?? c.commit ?? ""), subject: typeof (c.subject ?? c.message ?? c.title) === "string" ? String(c.subject ?? c.message ?? c.title).split("\n")[0] : undefined, verdict: verdictOf(c.verdict ?? c.status ?? c.mark) } : null))
    .filter((c): c is { sha: string; subject: string | undefined; verdict: BisectVerdict | null } => !!c && SHA.test(c.sha));
}

const same = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
};

export function bisectState(input: { commits?: unknown; log?: unknown; current?: unknown }): BisectModel {
  const problems: string[] = [];
  const log = typeof input.log === "string" ? readBisectLog(input.log) : { marks: [], firstBad: null };
  let list = commitsOf(input.commits);
  const fromLog = !list.length;
  if (fromLog) {
    // Without the commit list only the marked commits are known, in the order they were marked.
    const seen = new Set<string>();
    list = [];
    for (const m of log.marks) if (!seen.has(m.sha.toLowerCase())) (seen.add(m.sha.toLowerCase()), list.push({ sha: m.sha, subject: m.subject, verdict: null }));
    if (log.firstBad && !seen.has(log.firstBad.sha.toLowerCase())) list.push({ sha: log.firstBad.sha, subject: log.firstBad.subject, verdict: null });
  }
  for (const m of log.marks) {
    const c = list.find((x) => same(x.sha, m.sha));
    if (c) {
      c.verdict = m.verdict;
      c.subject ??= m.subject;
    } else if (!fromLog && m.verdict !== "good") problems.push(`${m.sha.slice(0, 7)} is marked ${m.verdict} but isn't in the commits`);
    // A good mark outside the list is expected: git log good..bad leaves the good commit out.
  }
  const current = typeof input.current === "string" && input.current.trim() ? input.current.trim() : null;
  if (!list.length) {
    problems.push("needs commits (git log --oneline good..bad, newest first) or a git bisect log");
    return { commits: [], good: null, bad: null, remaining: 0, steps: 0, suspect: current, found: null, problems };
  }
  // Newest first, like git log; a list where a good commit sits above every bad one is oldest first.
  if (!fromLog) {
    const v = list.map((c) => c.verdict);
    const lastGood = v.lastIndexOf("good");
    const firstBad = v.indexOf("bad");
    if (lastGood >= 0 && firstBad >= 0 && lastGood < firstBad) list.reverse();
  }
  const verdicts = list.map((c) => c.verdict);
  const badIdx = verdicts.lastIndexOf("bad");
  const goodIdx = verdicts.indexOf("good");
  let found: string | null = log.firstBad ? (list.find((c) => same(c.sha, log.firstBad!.sha))?.sha ?? log.firstBad.sha) : null;
  let candidates: number[] = [];
  if (!fromLog && badIdx >= 0) {
    const end = goodIdx > badIdx ? goodIdx : list.length;
    for (let i = badIdx; i < end; i++) candidates.push(i);
    if (goodIdx >= 0 && goodIdx < badIdx) problems.push("a good commit is newer than the oldest bad one; check the marks");
  } else if (!fromLog) {
    // No bad mark yet: the newest commit is assumed bad, as when git bisect starts at HEAD.
    const end = goodIdx >= 0 ? goodIdx : list.length;
    for (let i = 0; i < end; i++) candidates.push(i);
  }
  candidates = candidates.filter((i) => verdicts[i] !== "good");
  const untested = candidates.filter((i) => verdicts[i] == null);
  // The good end is a good commit in the list, or (for good..bad lists) the good mark the list leaves out.
  const goodBelow = goodIdx > badIdx || (goodIdx < 0 && log.marks.some((m) => m.verdict === "good"));
  if (!found && !fromLog && badIdx >= 0 && goodBelow && untested.length === 0 && candidates.every((i) => i === badIdx || verdicts[i] === "skip")) {
    if (candidates.length === 1) found = list[badIdx].sha;
    else problems.push("only skipped commits are left: the first bad commit is one of them or the bad one");
  }
  const inRange = new Set(found ? [] : candidates);
  const suspectIdx = current ? list.findIndex((c) => same(c.sha, current)) : untested.length ? untested[Math.floor((untested.length - 1) / 2)] : -1;
  if (current && suspectIdx < 0 && !fromLog) problems.push(`the current commit ${current.slice(0, 7)} isn't in the commits`);
  return {
    commits: list.map((c, i) => ({ sha: c.sha, subject: c.subject, verdict: c.verdict, inRange: inRange.has(i), current: i === suspectIdx || (!!current && suspectIdx < 0 && same(c.sha, current)) })),
    good: goodIdx >= 0 ? list[goodIdx].sha : null,
    bad: badIdx >= 0 ? list[badIdx].sha : null,
    remaining: found ? 0 : untested.length,
    steps: found || !untested.length ? 0 : Math.ceil(Math.log2(untested.length + 1)),
    suspect: found ? null : suspectIdx >= 0 ? list[suspectIdx].sha : current,
    found,
    problems,
  };
}
