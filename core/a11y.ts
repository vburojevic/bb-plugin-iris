// AccessibilityAudit rules that need no browser: reading an axe-core result
// (one object, or the array @axe-core/cli writes) or a Lighthouse report into
// one shape: rules with their impact, WCAG criteria and failing nodes, counts
// by impact, and the page screenshot with node boxes when the report has them.

export const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
export type Impact = (typeof IMPACTS)[number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AuditNode {
  /** CSS selector; frames and shadow roots join with " >> ". */
  target: string;
  html: string;
  /** How it fails (axe's failureSummary, Lighthouse's explanation). */
  summary: string;
  label: string;
  box: Box | null;
  impact: Impact;
}

export interface AuditRule {
  id: string;
  /** violation: fails; review: needs a person to check (axe incomplete, Lighthouse manual). */
  kind: "violation" | "review";
  impact: Impact;
  title: string;
  description: string;
  helpUrl: string;
  /** Success criteria, e.g. ["1.4.3"]; empty for best practices. */
  wcag: string[];
  level: "A" | "AA" | "AAA" | null;
  bestPractice: boolean;
  nodes: AuditNode[];
}

export interface Audit {
  engine: string;
  url: string;
  when: string;
  rules: AuditRule[];
  passed: number;
  /** Lighthouse's accessibility score, 0-100. */
  score: number | null;
  counts: Record<Impact, { rules: number; nodes: number }>;
  review: number;
  screenshot: { src: string; width: number; height: number } | null;
  problems: string[];
}

/** WCAG success criteria axe checks, for readable group names. */
export const WCAG_NAMES: Record<string, string> = {
  "1.1.1": "Non-text Content", "1.2.2": "Captions", "1.3.1": "Info and Relationships", "1.3.5": "Identify Input Purpose",
  "1.4.1": "Use of Color", "1.4.2": "Audio Control", "1.4.3": "Contrast (Minimum)", "1.4.4": "Resize Text", "1.4.6": "Contrast (Enhanced)",
  "1.4.10": "Reflow", "1.4.12": "Text Spacing", "2.1.1": "Keyboard", "2.2.1": "Timing Adjustable", "2.2.2": "Pause, Stop, Hide",
  "2.4.1": "Bypass Blocks", "2.4.2": "Page Titled", "2.4.4": "Link Purpose", "2.4.7": "Focus Visible", "2.5.3": "Label in Name",
  "2.5.8": "Target Size (Minimum)", "3.1.1": "Language of Page", "3.1.2": "Language of Parts", "3.3.2": "Labels or Instructions",
  "4.1.1": "Parsing", "4.1.2": "Name, Role, Value", "4.1.3": "Status Messages",
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const impactOf = (v: unknown, fallback: Impact): Impact => (IMPACTS.includes(v as Impact) ? (v as Impact) : fallback);
const rank = (i: Impact) => IMPACTS.indexOf(i);

/** Reads WCAG criteria and level from axe tags (wcag143, wcag2aa, wcag21a, best-practice). */
export function wcagFromTags(tags: unknown): { wcag: string[]; level: AuditRule["level"]; bestPractice: boolean } {
  const list = Array.isArray(tags) ? tags.map(text) : [];
  const wcag: string[] = [];
  let level: AuditRule["level"] = null;
  for (const t of list) {
    const sc = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    if (sc) {
      const id = `${sc[1]}.${sc[2]}.${sc[3]}`;
      if (!wcag.includes(id)) wcag.push(id);
      continue;
    }
    const lv = /^wcag2\d?(a{1,3})$/.exec(t);
    if (lv) {
      const l = lv[1].toUpperCase() as "A" | "AA" | "AAA";
      if (!level || l.length < level.length) level = l;
    }
  }
  return { wcag, level, bestPractice: list.includes("best-practice") };
}

function readBox(v: unknown): Box | null {
  if (!isObj(v)) return null;
  const x = finite(v.x) ? v.x : finite(v.left) ? v.left : null;
  const y = finite(v.y) ? v.y : finite(v.top) ? v.top : null;
  const w = finite(v.width) ? v.width : finite(v.right) && x != null ? v.right - x : null;
  const h = finite(v.height) ? v.height : finite(v.bottom) && y != null ? v.bottom - y : null;
  return x != null && y != null && w != null && h != null && w >= 0 && h >= 0 ? { x, y, w, h } : null;
}

const nodeBox = (n: Record<string, unknown>) => readBox(n.box) ?? readBox(n.boundingBox) ?? readBox(n.boundingRect) ?? readBox(n.boundingClientRect) ?? readBox(n.rect);

function target(v: unknown): string {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return "";
  return v.map((part) => (Array.isArray(part) ? part.map(text).join(" >> ") : text(part))).join(" >> ");
}

/** A Lighthouse description's "[Learn more](url)" link, and the text without it. */
function splitLink(description: string): [string, string] {
  // Bounded parts on a capped description: a long or unclosed bracket can't make it backtrack.
  const m = /\[([^\]\n]{0,200})\]\((https?:[^)\s]{1,2000})\)\.?/.exec(description.slice(0, 8000));
  if (!m) return [description.trim(), ""];
  return [description.replace(m[0], "").replace(/\s+$/, "").trim(), m[2]];
}

function emptyCounts(): Audit["counts"] {
  return { critical: { rules: 0, nodes: 0 }, serious: { rules: 0, nodes: 0 }, moderate: { rules: 0, nodes: 0 }, minor: { rules: 0, nodes: 0 } };
}

function finish(a: Omit<Audit, "counts" | "review">): Audit {
  const counts = emptyCounts();
  let review = 0;
  a.rules.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "violation" ? -1 : 1) || rank(x.impact) - rank(y.impact) || y.nodes.length - x.nodes.length || x.id.localeCompare(y.id));
  for (const r of a.rules) {
    if (r.kind === "review") {
      review++;
      continue;
    }
    counts[r.impact].rules++;
    counts[r.impact].nodes += r.nodes.length;
  }
  return { ...a, counts, review };
}

function readAxeRules(list: unknown, kind: AuditRule["kind"]): AuditRule[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((r) => {
    const fallback: Impact = kind === "review" ? "moderate" : "minor";
    const nodes = (Array.isArray(r.nodes) ? r.nodes : []).filter(isObj).map(
      (n): AuditNode => ({
        target: target(n.target),
        html: text(n.html),
        summary: text(n.failureSummary).trim(),
        label: "",
        box: nodeBox(n),
        impact: impactOf(n.impact, impactOf(r.impact, fallback)),
      }),
    );
    // A rule's impact is its worst node's when axe leaves the rule's own empty.
    const impact = impactOf(r.impact, nodes.reduce<Impact>((w, n) => (rank(n.impact) < rank(w) ? n.impact : w), fallback));
    return { id: text(r.id), kind, impact, title: text(r.help) || text(r.id), description: text(r.description), helpUrl: text(r.helpUrl), ...wcagFromTags(r.tags), nodes };
  });
}

function readAxe(r: Record<string, unknown>): Audit {
  const engine = isObj(r.testEngine) ? `${text(r.testEngine.name) || "axe-core"} ${text(r.testEngine.version)}`.trim() : "axe-core";
  return finish({
    engine,
    url: text(r.url),
    when: text(r.timestamp),
    rules: [...readAxeRules(r.violations, "violation"), ...readAxeRules(r.incomplete, "review")],
    passed: Array.isArray(r.passes) ? r.passes.length : 0,
    score: null,
    screenshot: null,
    problems: [],
  });
}

function readLighthouse(lhr: Record<string, unknown>): Audit {
  const audits = isObj(lhr.audits) ? lhr.audits : {};
  const category = isObj(lhr.categories) && isObj(lhr.categories.accessibility) ? lhr.categories.accessibility : null;
  // Without the accessibility category every other failing audit would read as an a11y one.
  const refs = category && Array.isArray(category.auditRefs) ? category.auditRefs.filter(isObj).map((x) => text(x.id)) : [];
  const shot = isObj(lhr.fullPageScreenshot) ? lhr.fullPageScreenshot : null;
  const shotNodes = shot && isObj(shot.nodes) ? shot.nodes : {};
  const rules: AuditRule[] = [];
  let passed = 0;
  for (const id of refs) {
    const a = audits[id];
    if (!isObj(a)) continue;
    const mode = text(a.scoreDisplayMode);
    // Manual checks are the same generic list on every page; errors are audits that didn't run.
    if (mode !== "binary" && mode !== "numeric") continue;
    if (a.score === 1) {
      passed++;
      continue;
    }
    if (a.score !== 0) continue;
    const details = isObj(a.details) ? a.details : {};
    const debug = isObj(details.debugData) ? details.debugData : {};
    const impact = impactOf(debug.impact, "minor");
    const [description, helpUrl] = splitLink(text(a.description));
    const nodes = (Array.isArray(details.items) ? details.items : []).filter(isObj).map((item): AuditNode => {
      const n = isObj(item.node) ? item.node : item;
      const lhId = text(n.lhId);
      return {
        target: text(n.selector),
        html: text(n.snippet),
        summary: text(n.explanation).trim(),
        label: text(n.nodeLabel),
        box: readBox(lhId ? shotNodes[lhId] : null) ?? nodeBox(n),
        impact,
      };
    });
    rules.push({ id, kind: "violation", impact, title: text(a.title) || id, description, helpUrl, ...wcagFromTags(debug.tags), nodes });
  }
  const img = shot && isObj(shot.screenshot) ? shot.screenshot : null;
  const data = img ? text(img.data) : "";
  return finish({
    engine: `Lighthouse ${text(lhr.lighthouseVersion)}`.trim(),
    url: text(lhr.finalDisplayedUrl) || text(lhr.finalUrl) || text(lhr.requestedUrl),
    when: text(lhr.fetchTime),
    rules,
    passed,
    score: category && finite(category.score) ? Math.round(category.score * 100) : null,
    screenshot: img && data.startsWith("data:image/") && finite(img.width) && finite(img.height) ? { src: data, width: img.width, height: img.height } : null,
    problems: category ? [] : ["this Lighthouse report has no accessibility category; run it with --only-categories=accessibility or the default categories"],
  });
}

/** Reads any supported report; problems say why one can't be read. */
export function readAudit(report: unknown): Audit {
  const none = (problem: string): Audit => finish({ engine: "", url: "", when: "", rules: [], passed: 0, score: null, screenshot: null, problems: [problem] });
  if (Array.isArray(report)) {
    // @axe-core/cli writes one result per page; a list of bare violations works too.
    const pages = report.filter(isObj);
    if (pages.length && pages.every((p) => "violations" in p || "passes" in p)) {
      const all = pages.map(readAxe);
      if (all.length === 1) return all[0];
      // One rule across pages is one row: its nodes from every page, each labeled with its page.
      const rules = new Map<string, AuditRule>();
      all.forEach((a, k) => {
        for (const r of a.rules) {
          const nodes = r.nodes.map((n) => ({ ...n, label: a.url || `page ${k + 1}` }));
          const key = `${r.kind}:${r.id}`;
          const cur = rules.get(key);
          if (!cur) rules.set(key, { ...r, nodes });
          else rules.set(key, { ...cur, impact: rank(r.impact) < rank(cur.impact) ? r.impact : cur.impact, nodes: [...cur.nodes, ...nodes] });
        }
      });
      return finish({ ...all[0], url: `${all.length} pages`, rules: [...rules.values()], passed: all.reduce((s, a) => s + a.passed, 0) });
    }
    if (pages.length && pages.every((p) => "nodes" in p && ("id" in p || "help" in p))) return readAxe({ violations: pages });
    return none("report must be an axe-core result ({violations, passes, ...}), the array @axe-core/cli writes, or a Lighthouse JSON report");
  }
  if (!isObj(report)) return none("report must be an axe-core result or a Lighthouse JSON report, e.g. load(\"$BB_THREAD_STORAGE/axe.json\")");
  if (isObj(report.lhr)) return readLighthouse(report.lhr);
  if (isObj(report.audits) && (isObj(report.categories) || "lighthouseVersion" in report)) return readLighthouse(report);
  if ("violations" in report || "incomplete" in report || "passes" in report) return readAxe(report);
  if (isObj(report.results) && "violations" in report.results) return readAxe(report.results);
  return none("report must be an axe-core result ({violations, passes, ...}) or a Lighthouse JSON report");
}

/** Groups for the list: by impact (critical first) or by WCAG criterion (best practices last). */
export function groupRules(rules: AuditRule[], by: "impact" | "wcag"): { key: string; title: string; rules: AuditRule[] }[] {
  const violations = rules.filter((r) => r.kind === "violation");
  if (by === "impact") {
    return IMPACTS.map((i) => ({ key: i, title: i[0].toUpperCase() + i.slice(1), rules: violations.filter((r) => r.impact === i) })).filter((g) => g.rules.length);
  }
  const groups = new Map<string, AuditRule[]>();
  for (const r of violations) for (const sc of r.wcag.length ? r.wcag : ["~"]) groups.set(sc, [...(groups.get(sc) ?? []), r]);
  const order = (s: string) => (s === "~" ? [99] : s.split(".").map(Number));
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const x = order(a);
      const y = order(b);
      for (let k = 0; k < 3; k++) if ((x[k] ?? 0) !== (y[k] ?? 0)) return (x[k] ?? 0) - (y[k] ?? 0);
      return 0;
    })
    .map(([sc, list]) => ({ key: sc, title: sc === "~" ? "Best practices" : `${sc} ${WCAG_NAMES[sc] ?? ""}`.trim(), rules: list }));
}
