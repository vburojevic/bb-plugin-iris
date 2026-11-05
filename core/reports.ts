// Normalizers for the reports tools write: test runners, linters, type
// checkers, coverage and benchmarks. Each takes whatever load() returned (parsed
// JSON, or raw text for XML, lcov and tsc output) and returns one plain shape.

export interface TestCase {
  name: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  file?: string;
  line?: number;
  duration?: number;
  suite?: string;
}

export interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  file?: string;
  line?: number;
  detail?: string;
  fix?: string;
  status?: string;
  rule?: string;
}

export interface CoverageRow {
  file: string;
  lines: number;
  branches?: number;
  functions?: number;
}

export interface BenchRow {
  name: string;
  before?: number;
  after?: number;
  better: "lower" | "higher";
}

const s = (v: unknown) => (v == null ? undefined : String(v));
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function status(v: unknown): TestCase["status"] {
  const t = String(v ?? "").toLowerCase();
  if (/fail|error|broken/.test(t)) return "failed";
  if (/skip|pending|todo|disabled|ignored/.test(t)) return "skipped";
  return "passed";
}

export function normalizeTests(input: unknown): TestCase[] {
  if (typeof input === "string") return input.trim().startsWith("<") ? junit(input) : [];
  if (Array.isArray(input)) {
    return input.map((t) => {
      const o = obj(t);
      return { name: s(o.name ?? o.title ?? o.fullName) ?? "test", status: status(o.status ?? o.state ?? o.result), message: s(o.message ?? o.error), file: s(o.file), line: n(o.line), duration: n(o.duration), suite: s(o.suite) };
    });
  }
  const root = obj(input);
  // vitest / jest JSON reporter
  if (Array.isArray(root.testResults)) {
    const out: TestCase[] = [];
    for (const file of root.testResults as unknown[]) {
      const f = obj(file);
      const path = s(f.name ?? f.testFilePath);
      for (const a of (f.assertionResults ?? f.testResults ?? []) as unknown[]) {
        const t = obj(a);
        const messages = (t.failureMessages as unknown[] | undefined)?.map(String).join("\n");
        const loc = obj(t.location);
        out.push({
          name: s(t.fullName ?? t.title) ?? "test",
          status: status(t.status),
          message: messages ? stripAnsi(messages).split("\n").slice(0, 6).join("\n") : undefined,
          file: path ? relative(path) : undefined,
          line: n(loc.line),
          duration: n(t.duration),
          suite: (t.ancestorTitles as string[] | undefined)?.join(" > "),
        });
      }
      if (!(f.assertionResults ?? f.testResults) && f.status === "failed") out.push({ name: path ?? "suite", status: "failed", message: s(f.message) });
    }
    return out;
  }
  // Swift Testing / xcresult-style summaries
  if (Array.isArray(root.tests)) return normalizeTests(root.tests);
  return [];
}

function junit(xml: string): TestCase[] {
  const out: TestCase[] = [];
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(xml))) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]));
    const body = m[3] ?? "";
    const failure = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body);
    const skipped = /<skipped\b/.test(body);
    const msgAttr = failure ? /message="([^"]*)"/.exec(failure[2] ?? failure[5] ?? "")?.[1] : undefined;
    out.push({
      name: attrs.name ?? "test",
      suite: attrs.classname,
      status: failure ? "failed" : skipped ? "skipped" : "passed",
      message: failure ? decode(msgAttr ?? (failure[3] ?? "").trim().split("\n")[0] ?? "") : undefined,
      file: attrs.file,
      line: n(attrs.line),
      duration: attrs.time ? Number(attrs.time) * 1000 : undefined,
    });
  }
  return out;
}

const decode = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const stripAnsi = (t: string) => t.replace(/\u001b\[[\d;]*m/g, "");
const relative = (p: string) => {
  const i = p.search(/\/(src|test|tests|core|ui|app|lib|packages|Sources|Tests)\//);
  return i > 0 ? p.slice(i + 1) : p;
};

const SEV: Record<string, Finding["severity"]> = { critical: "critical", blocker: "critical", high: "high", error: "high", major: "high", medium: "medium", warning: "medium", warn: "medium", moderate: "medium", low: "low", minor: "low", note: "info", info: "info", suggestion: "info" };

export function normalizeFindings(input: unknown): Finding[] {
  if (typeof input === "string") return tscText(input);
  if (Array.isArray(input)) {
    // eslint -f json: [{filePath, messages: [{severity, message, line, ruleId}]}]
    if (input.length && Array.isArray(obj(input[0]).messages)) {
      return input.flatMap((f) => {
        const o = obj(f);
        return (o.messages as unknown[]).map((m) => {
          const x = obj(m);
          return { severity: x.severity === 2 ? "high" : "medium", title: s(x.message) ?? "", file: relative(s(o.filePath) ?? ""), line: n(x.line), rule: s(x.ruleId), fix: x.fix ? "Autofixable" : undefined } satisfies Finding;
        });
      });
    }
    // ruff json: [{code, message, filename, location: {row}}]
    return input.map((f) => {
      const o = obj(f);
      const loc = obj(o.location);
      return {
        severity: SEV[String(o.severity ?? o.level ?? "medium").toLowerCase()] ?? "medium",
        title: s(o.title ?? o.message ?? o.summary) ?? "",
        file: s(o.file ?? o.filename ?? o.path),
        line: n(o.line ?? loc.row ?? loc.line),
        detail: s(o.detail ?? o.description),
        fix: s(o.fix ?? (obj(o.fix).message as string | undefined)),
        status: s(o.status),
        rule: s(o.rule ?? o.code),
      } satisfies Finding;
    });
  }
  const root = obj(input);
  // SARIF
  if (Array.isArray(root.runs)) {
    return (root.runs as unknown[]).flatMap((r) =>
      ((obj(r).results ?? []) as unknown[]).map((res) => {
        const x = obj(res);
        const loc = obj(obj(obj((x.locations as unknown[] | undefined)?.[0]).physicalLocation));
        return {
          severity: SEV[String(x.level ?? "warning")] ?? "medium",
          title: s(obj(x.message).text) ?? "",
          file: s(obj(loc.artifactLocation).uri),
          line: n(obj(loc.region).startLine),
          rule: s(x.ruleId),
        } satisfies Finding;
      }),
    );
  }
  if (Array.isArray(root.findings)) return normalizeFindings(root.findings);
  return [];
}

function tscText(text: string): Finding[] {
  const out: Finding[] = [];
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ severity: m[4] === "error" ? "high" : "medium", title: m[6], file: m[1], line: Number(m[2]), rule: m[5] });
  const re2 = /^(.+?):(\d+):(\d+) - (error|warning) (TS\d+): (.+)$/gm;
  while ((m = re2.exec(text))) out.push({ severity: m[4] === "error" ? "high" : "medium", title: m[6], file: m[1], line: Number(m[2]), rule: m[5] });
  return out;
}

export function normalizeCoverage(input: unknown): CoverageRow[] {
  if (typeof input === "string") return lcov(input);
  if (Array.isArray(input)) return input.map((r) => ({ file: s(obj(r).file) ?? "", lines: n(obj(r).lines) ?? 0, branches: n(obj(r).branches), functions: n(obj(r).functions) }));
  const root = obj(input);
  // istanbul coverage-summary.json
  return Object.entries(root)
    .filter(([k]) => k !== "total")
    .map(([file, v]) => {
      const o = obj(v);
      return { file: relative(file), lines: n(obj(o.lines).pct) ?? 0, branches: n(obj(o.branches).pct), functions: n(obj(o.functions).pct) };
    });
}

function lcov(text: string): CoverageRow[] {
  const out: CoverageRow[] = [];
  let cur: { file: string; lf: number; lh: number; bf: number; bh: number; fnf: number; fnh: number } | null = null;
  for (const line of text.split("\n")) {
    const [k, v] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)];
    if (k === "SF") cur = { file: relative(v.trim()), lf: 0, lh: 0, bf: 0, bh: 0, fnf: 0, fnh: 0 };
    else if (cur && k === "LF") cur.lf = Number(v);
    else if (cur && k === "LH") cur.lh = Number(v);
    else if (cur && k === "BRF") cur.bf = Number(v);
    else if (cur && k === "BRH") cur.bh = Number(v);
    else if (cur && k === "FNF") cur.fnf = Number(v);
    else if (cur && k === "FNH") cur.fnh = Number(v);
    else if (cur && line.trim() === "end_of_record") {
      out.push({ file: cur.file, lines: cur.lf ? (cur.lh / cur.lf) * 100 : 100, branches: cur.bf ? (cur.bh / cur.bf) * 100 : undefined, functions: cur.fnf ? (cur.fnh / cur.fnf) * 100 : undefined });
      cur = null;
    }
  }
  return out;
}

export function normalizeBench(input: unknown): BenchRow[] {
  const root = obj(input);
  // hyperfine --export-json: {results: [{command, mean (s)}]}
  if (Array.isArray(root.results) && root.results.length && obj(root.results[0]).mean !== undefined) {
    const rs = root.results as unknown[];
    const base = n(obj(rs[0]).mean);
    return rs.map((r, k) => ({ name: s(obj(r).command) ?? `run ${k + 1}`, before: k === 0 ? undefined : base !== undefined ? base * 1000 : undefined, after: (n(obj(r).mean) ?? 0) * 1000, better: "lower" as const }));
  }
  const list = Array.isArray(input) ? input : Array.isArray(root.results) ? root.results : [];
  return list.map((r) => {
    const o = obj(r);
    return { name: s(o.name) ?? "", before: n(o.before), after: n(o.after ?? o.value), better: o.better === "higher" ? "higher" : "lower" };
  });
}
