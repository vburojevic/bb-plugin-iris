// The release dashboard's data: one JSON file an agent keeps current while a
// release moves (version, build, platforms, checks, store state, blockers,
// timeline). Forgiving about shapes and words; every status maps to a tone.

export type Tone = "neutral" | "info" | "good" | "warn" | "bad";

/** "running" also pulses. */
export interface ReleaseStatus {
  tone: Tone;
  label: string;
  running: boolean;
}

export interface ReleaseItem {
  name: string;
  status: ReleaseStatus | null;
  detail?: string;
  build?: string;
  version?: string;
  url?: string;
  icon?: string;
}

export interface ReleaseEvent {
  time?: string;
  title: string;
  detail?: string;
  tone: Tone | null;
}

export interface ReleaseBlocker {
  title: string;
  owner?: string;
  detail?: string;
  url?: string;
}

export interface ReleaseModel {
  app?: string;
  version?: string;
  build?: string;
  channel?: string;
  status: ReleaseStatus | null;
  commit?: string;
  updated?: string;
  url?: string;
  notes?: string;
  progress: { done: number; total: number; label?: string } | null;
  platforms: ReleaseItem[];
  checks: ReleaseItem[];
  store: ReleaseItem[];
  blockers: ReleaseBlocker[];
  timeline: ReleaseEvent[];
}

const WORDS: [Tone, boolean, string, RegExp][] = [
  ["bad", false, "Failed", /^(fail(ed|ure|ing)?|error(ed)?|broken|red|crash(ed)?|timed[-_ ]out|startup[-_ ]failure)$/],
  ["bad", false, "Rejected", /^(rejected|invalid(_binary)?|metadata[-_ ]rejected|developer[-_ ]rejected)$/],
  ["bad", false, "Blocked", /^(blocked|on[-_ ]hold)$/],
  ["good", false, "Released", /^(released|shipped|live|published|ready[-_ ]for[-_ ]sale|available)$/],
  ["good", false, "Passed", /^(pass(ed)?|success(ful)?|succeeded|green|ok|done|complete(d)?)$/],
  ["good", false, "Ready", /^(ready|ready[-_ ]to[-_ ]test|ready[-_ ]for[-_ ]distribution|approved|pending[-_ ]developer[-_ ]release|pending[-_ ]apple[-_ ]release|valid|testing)$/],
  ["info", true, "Running", /^(running|in[-_ ]progress|building|uploading|processing|deploying|started|active)$/],
  ["warn", true, "In review", /^(in[-_ ]review|waiting[-_ ]for[-_ ]review|review|submitted|beta[-_ ]review|waiting)$/],
  ["warn", false, "Needs action", /^(warn(ing)?|at[-_ ]risk|missing[-_ ]compliance|needs[-_ ]action|action[-_ ]required|flaky)$/],
  ["neutral", false, "Pending", /^(pending|queued|not[-_ ]started|todo|prepare|preparing|prepare[-_ ]for[-_ ]submission|ready[-_ ]for[-_ ]review|draft|scheduled)$/],
  ["neutral", false, "Skipped", /^(skip(ped)?|cancel(l)?ed|n\/a|none|expired)$/],
];

function titleCase(s: string): string {
  let t = s.replace(/[-_]+/g, " ").trim();
  if (t === t.toUpperCase()) t = t.toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** A status word (from CI, App Store Connect or the agent) as a tone and a label. */
export function readStatus(v: unknown): ReleaseStatus | null {
  if (v === true) return { tone: "good", label: "Passed", running: false };
  if (v === false) return { tone: "bad", label: "Failed", running: false };
  if (typeof v !== "string" || !v.trim()) return null;
  const key = v.trim().toLowerCase();
  for (const [tone, running, label, re] of WORDS) if (re.test(key)) return { tone, running, label: key.length > 3 && !/^(ok|red|green)$/.test(key) ? titleCase(v.trim()) : label };
  return { tone: "neutral", label: titleCase(v.trim()), running: false };
}

const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Lists written as arrays, or as objects keyed by name ({ ios: "passed" } or { ios: { status } }). */
function items(v: unknown, problems: string[], what: string): ReleaseItem[] {
  if (v == null) return [];
  const entries: [string | undefined, unknown][] = Array.isArray(v) ? v.map((x) => [undefined, x]) : obj(v) ? Object.entries(v as object) : [];
  if (!Array.isArray(v) && !obj(v)) problems.push(`${what} needs a list of {name, status}`);
  const out: ReleaseItem[] = [];
  entries.forEach(([key, x], k) => {
    const o = obj(x);
    const name = s(o?.name ?? o?.title ?? o?.platform ?? key ?? (typeof x === "string" ? x : undefined));
    if (!name) {
      problems.push(`${what} ${k + 1} needs a name`);
      return;
    }
    // A GitHub check run has both: status says "completed", conclusion says how.
    const conclusion = o ? (o.conclusion ?? o.result) : undefined;
    const raw = o ? (typeof conclusion === "string" && conclusion ? conclusion : (o.status ?? o.state)) : key !== undefined ? x : undefined;
    out.push({ name, status: readStatus(raw), detail: s(o?.detail ?? o?.note ?? o?.message), build: s(o?.build), version: s(o?.version), url: s(o?.url ?? o?.link), icon: s(o?.icon) });
  });
  return out;
}

export function normalizeRelease(v: unknown): { model: ReleaseModel; problems: string[] } {
  const problems: string[] = [];
  const o = obj(v) ?? {};
  if (!obj(v)) problems.push("release needs an object like { version, build, platforms, checks, store, blockers, timeline }");
  const progress = obj(o.progress);
  const done = Number(progress?.done);
  const total = Number(progress?.total);
  const blockers: ReleaseBlocker[] = [];
  if (o.blockers != null && !Array.isArray(o.blockers)) problems.push("blockers needs a list of strings or {title, owner, detail}");
  (Array.isArray(o.blockers) ? o.blockers : []).forEach((b, k) => {
    const x = obj(b);
    const title = s(x?.title ?? x?.name ?? b);
    if (!title) problems.push(`blocker ${k + 1} needs a title`);
    else blockers.push({ title, owner: s(x?.owner), detail: s(x?.detail ?? x?.note), url: s(x?.url) });
  });
  const timeline: ReleaseEvent[] = [];
  if (o.timeline != null && !Array.isArray(o.timeline)) problems.push("timeline needs a list of {time, title}");
  (Array.isArray(o.timeline) ? o.timeline : []).forEach((e, k) => {
    const x = obj(e);
    const title = s(x?.title ?? x?.event ?? e);
    if (!title) return problems.push(`timeline ${k + 1} needs a title`);
    const tone = typeof x?.tone === "string" && ["neutral", "info", "good", "warn", "bad"].includes(x.tone) ? (x.tone as Tone) : (readStatus(x?.status)?.tone ?? null);
    timeline.push({ time: s(x?.time ?? x?.at), title, detail: s(x?.detail), tone });
  });
  // store: a list, a keyed object, or one object for a single destination ({ name: "TestFlight", state }).
  const storeObj = obj(o.store);
  const store = storeObj && (storeObj.state !== undefined || storeObj.status !== undefined) ? items([storeObj.name ? storeObj : { ...storeObj, name: "Store" }], problems, "store") : items(o.store ?? o.distribution, problems, "store");
  const model: ReleaseModel = {
    app: s(o.app ?? o.name ?? o.product),
    version: s(o.version),
    build: s(o.build),
    channel: s(o.channel ?? o.track),
    status: readStatus(o.status ?? o.state),
    commit: s(o.commit ?? o.sha),
    updated: s(o.updated ?? o.updatedAt),
    url: s(o.url),
    notes: s(o.notes),
    progress: Number.isFinite(done) && Number.isFinite(total) && total > 0 ? { done: Math.max(0, Math.min(total, done)), total, label: s(progress?.label) } : null,
    platforms: items(o.platforms, problems, "platform"),
    checks: items(o.checks, problems, "check"),
    store,
    blockers,
    timeline,
  };
  if (!model.version && !model.build && !model.app) problems.push("release needs a version, build or app name");
  return { model, problems };
}

/** The overall state when the file doesn't name one: blockers and failures first. */
export function overallStatus(m: ReleaseModel): ReleaseStatus {
  if (m.status) return m.status;
  const all = [...m.platforms, ...m.checks, ...m.store].map((i) => i.status).filter((x): x is ReleaseStatus => !!x);
  if (m.blockers.length) return { tone: "bad", label: "Blocked", running: false };
  if (all.some((x) => x.tone === "bad")) return { tone: "bad", label: "Failing", running: false };
  if (all.some((x) => x.running)) return { tone: "info", label: "In progress", running: true };
  if (all.some((x) => x.tone === "warn")) return { tone: "warn", label: "Waiting", running: false };
  if (all.length && all.every((x) => x.tone === "good")) return { tone: "good", label: "Ready", running: false };
  return { tone: "neutral", label: "Preparing", running: false };
}

/** A platform name to a Lucide icon. */
export function platformIcon(name: string, icon?: string): string {
  if (icon) return icon;
  const n = name.toLowerCase();
  if (/watch/.test(n)) return "watch";
  if (/ipad|tablet/.test(n)) return "tablet";
  if (/mac|desktop|windows|linux/.test(n)) return "monitor";
  if (/tv/.test(n)) return "tv";
  if (/vision/.test(n)) return "glasses";
  if (/web|site|browser/.test(n)) return "globe";
  if (/server|api|backend/.test(n)) return "server";
  return "smartphone";
}

export const SAMPLE_RELEASE = {
  app: "Sprout",
  version: "2.4.0",
  build: "418",
  channel: "TestFlight",
  commit: "9dd4041",
  updated: "2026-11-03T14:20:00Z",
  progress: { done: 5, total: 7, label: "Release steps" },
  platforms: [
    { name: "iOS", status: "ready", build: "418", detail: "Processed" },
    { name: "macOS", status: "processing", build: "418", detail: "Uploading to App Store Connect" },
    { name: "watchOS", status: "ready", build: "418" },
  ],
  checks: [
    { name: "Unit tests", status: "passed", detail: "412 tests" },
    { name: "UI tests", status: "passed", detail: "38 tests on iPhone 17" },
    { name: "Lint", status: "passed" },
    { name: "Notarization", status: "running", detail: "macOS build" },
  ],
  store: [
    { name: "TestFlight internal", status: "testing", detail: "12 testers" },
    { name: "App Store", status: "prepare for submission" },
  ],
  blockers: [{ title: "Privacy manifest missing for the analytics SDK", owner: "Ana", detail: "App Store review will reject the build" }],
  timeline: [
    { time: "13:02", title: "Tag v2.4.0 pushed", status: "done" },
    { time: "13:05", title: "Buildkite build 1182 started", status: "done" },
    { time: "13:41", title: "iOS build 418 uploaded", status: "done" },
    { time: "14:12", title: "TestFlight processing finished", status: "done" },
    { time: "14:20", title: "macOS notarization", status: "running" },
  ],
};
