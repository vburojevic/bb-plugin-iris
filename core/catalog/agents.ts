// Agent runs, debugging and a few workshop pieces. Data logic lives in
// core/evalreport.ts, trace.ts, context.ts, toolcall.ts, testhistory.ts,
// flame.ts, bisect.ts, blast.ts, schemadiff.ts, decisions.ts and
// themepreview.ts; views in the "agents", "debug" and "craft" chunks.
import { component, p } from "./spec";

export const AGENTS = [
  component({
    name: "EvalReport",
    group: "Agents",
    summary:
      "Eval cases across runs against a baseline: the score and its change, categories, and a case-by-run grid with regressions first; a case opens its judge's notes. Reads an eval runner's results JSON (results: [{id, category, score, judgeWhy}]), promptfoo output or {case, run, score} rows.",
    props: {
      runs: p.any("One report, a list of them (oldest first) or rows {case, run, score, pass?, note?}; load() each results file", { required: true }),
      baseline: p.any("A score, a report, {score, byCategory} or {case: score}; default the run before"),
      tolerance: p.num("Points a score may drop before it counts as a regression", { def: 0 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<EvalReport title="Iris evals" tolerance={3} baseline={{ score: 95.2, byCategory: { ci: 98, data: 94, progress: 86.3 } }} runs={[
  { at: "2026-11-06T10:00:00Z", results: [
    { id: "ci-logs", category: "ci", score: 100 }, { id: "data-csv", category: "data", score: 90 },
    { id: "progress-eta", category: "progress", score: 80 }, { id: "ci-changes", category: "ci", score: 100 } ] },
  { at: "2026-11-07T22:41:00Z", results: [
    { id: "ci-logs", category: "ci", score: 90, judgeWhy: "Loads the log, but the prose never states the error." },
    { id: "data-csv", category: "data", score: 100 }, { id: "progress-eta", category: "progress", score: 95 },
    { id: "ci-changes", category: "ci", score: 100 }, { id: "status-week", category: "status", score: 0, error: "timed out after 300 s" } ] },
]} />`,
    aliases: ["Evals", "EvalResults", "EvalRuns"],
    heavy: true,
  }),
  component({
    name: "AgentTrace",
    group: "Agents",
    summary:
      "An agent run as a span tree on a timeline: model calls, tool calls and subagents with time, tokens, cost and errors; click a span for its input and output. Reads nested or flat spans ({id, parent}) and OpenTelemetry JSON.",
    props: {
      spans: p.any("[{name, kind: agent|llm|tool|step, ms?, start?, tokens?, cost?, error?, input?, output?, model?, children?}], flat ones with id and parent, or OpenTelemetry JSON", { required: true }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<AgentTrace title="Fix the flaky checkout test" spans={[
  { name: "Fix the flaky checkout test", kind: "agent", children: [
    { name: "Plan", kind: "llm", model: "opus", ms: 2400, tokens: { input: 18200, output: 640 }, cost: 0.11 },
    { name: "Grep", kind: "tool", ms: 120, input: { pattern: "applyDiscount" }, output: "src/cart.ts:42" },
    { name: "Bash", kind: "tool", ms: 8300, input: { command: "npm test -- cart" }, error: "1 failed: applies discount once" },
    { name: "Reviewer", kind: "agent", children: [
      { name: "Read diff", kind: "llm", model: "opus", ms: 3100, tokens: 9400, cost: 0.06 },
      { name: "Edit", kind: "tool", ms: 40, input: { file: "src/cart.ts" } } ] },
    { name: "Bash", kind: "tool", ms: 7900, input: { command: "npm test -- cart" }, output: "12 passed" } ] },
]} />`,
    aliases: ["Trace", "SpanTree", "RunTrace"],
    heavy: true,
  }),
  component({
    name: "ContextMeter",
    group: "Agents",
    summary:
      'How full a session\'s context window is, split by category, with model, cost and how both moved over the session. Pass load("bb:thread") in a live card (it records readings as they change), a list from load("bb:threads?usage=1") for totals by model, or {used, window, model, categories, cost}.',
    props: {
      thread: p.any('load("bb:thread"), load("bb:threads?usage=1"), or {title?, context: {used, window, model?, categories?}, cost?}', { required: true }),
      points: p.list("History to draw", "{t, used, cost?}[]"),
      warn: p.num("Share of the window that warns", { def: 0.8 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Card title="This session" icon="gauge" state="live">
<ContextMeter thread={{ title: "Ship the onboarding redesign", context: { used: 712000, window: 1000000, model: "claude-opus",
  categories: [{ label: "Messages", tokens: 431000 }, { label: "Tool results", tokens: 214000 }, { label: "System", tokens: 47000 }] },
  cost: { amount: 6.82, currency: "USD" } }}
  points={[{ t: "2026-11-08T09:00", used: 80000, cost: 0.4 }, { t: "2026-11-08T10:00", used: 390000, cost: 2.1 },
    { t: "2026-11-08T11:00", used: 820000, cost: 4.6 }, { t: "2026-11-08T11:20", used: 240000, cost: 4.9 },
    { t: "2026-11-08T12:30", used: 712000, cost: 6.82 }]} />
</Card>`,
    aliases: ["ContextWindow", "TokenMeter", "ContextUsage"],
    heavy: true,
  }),
  component({
    name: "ToolCall",
    group: "Agents",
    summary: "One tool or MCP call: name and server, arguments, result, timing and retries, collapsed to one line until opened. MCP results ({content, isError}) and JSON text read as data. For HTTP, HttpExchange.",
    props: {
      name: p.str('Tool name; "mcp__server__tool" splits', { required: true }),
      args: p.any("Arguments, data or JSON text"),
      result: p.any("What it returned"),
      error: p.any("Why it failed"),
      ms: p.num("How long it took"),
      attempts: p.list("Every try, last one included", "{ms?, error?}[]"),
      server: p.str("MCP server"),
      open: p.bool("Start opened", { def: false }),
    },
    children: "none",
    example: `<Stack>
<ToolCall name="mcp__github__create_issue" open ms={640} args={{ repo: "acme/shop", title: "Checkout crashes on empty cart", labels: ["bug", "p1"] }}
  result={{ content: [{ type: "text", text: '{"number": 812, "url": "https://github.com/acme/shop/issues/812"}' }] }} />
<ToolCall name="fetch_prices" args={{ sku: "A-1042" }} attempts={[{ ms: 5000, error: "timeout" }, { ms: 5000, error: "timeout" }, { ms: 310 }]} result={{ price: 42.5, currency: "EUR" }} />
<ToolCall name="Bash" args={{ command: "npm run build" }} ms={2100} error="exit 2: src/app.tsx(14,3): Type 'string' is not assignable to type 'number'" />
</Stack>`,
    aliases: ["ToolUse", "McpCall", "FunctionCall"],
    heavy: true,
  }),
];

export const DEBUG = [
  component({
    name: "Flamegraph",
    group: "Debug",
    summary:
      "A CPU profile as a flame graph: click a frame to zoom into it, search to highlight matches and their share, hover for self and total time, and the heaviest functions listed. Reads .cpuprofile (node --cpu-prof), Chrome trace JSON, speedscope JSON and folded stacks.",
    props: {
      profile: p.any("load() of the profile, folded stacks text, or {name, value, children}", { required: true }),
      unit: p.str("What the numbers are when the format doesn't say, e.g. \"samples\""),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Flamegraph title="Cold start" unit="ms" profile={\`main;boot;loadConfig;readFile 38
main;boot;loadConfig;parseYaml 64
main;boot;initDb;connect 120
main;boot;initDb;migrate;runSql 210
main;render;layout 95
main;render;paint;rasterize 140
main;render;paint;composite 30
main;idle 40\`} />`,
    aliases: ["FlameGraph", "CpuProfile", "Profile", "Icicle"],
    heavy: true,
  }),
  component({
    name: "Bisect",
    group: "Debug",
    summary: "A git bisect in flight: the commits from good to bad, each marked, the range still in play, the commit under test and about how many steps are left; once found, the first bad commit.",
    props: {
      commits: p.any("git log --oneline good..bad output (newest first), or [{sha, subject?, verdict?: good|bad|skip}]"),
      log: p.str("git bisect log output: marks and subjects"),
      current: p.str("The commit being tested now"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Bisect title="Login stopped remembering me" current="5e1b9c0" commits={[
  { sha: "a91f0de", subject: "Cache the session token", verdict: "bad" },
  { sha: "77c2e4b", subject: "Retry failed uploads" },
  { sha: "5e1b9c0", subject: "Move auth to a worker" },
  { sha: "3d0a8f1", subject: "Bump the JSON parser" },
  { sha: "c48e211", subject: "Faster cold start", verdict: "good" },
  { sha: "0b7d5aa", subject: "Release 2.3.0", verdict: "good" },
]} />`,
    aliases: ["GitBisect", "BisectStatus"],
    heavy: true,
  }),
  component({
    name: "BlastRadius",
    group: "Debug",
    summary: "What a change can break: each changed file with the files that import it, level by level, and the tests that reach it, as a tree. Reads madge --json, [[from, to]] import edges and a tests list or {test: [files it covers]}.",
    props: {
      changed: p.any("Changed files: a list, or git diff --name-only text", { required: true }),
      imports: p.any("{file: [imports]} (madge --json) or [[from, to]] where from imports to"),
      tests: p.any("Test files, or {test: [files]}; default files named *.test.* or *.spec.*"),
      depth: p.num("Import levels to follow", { def: 3 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<BlastRadius title="Changing the cart total" changed={["src/cart/total.ts"]} imports={{
  "src/cart/checkout.ts": ["src/cart/total.ts"],
  "src/cart/summary.tsx": ["src/cart/total.ts", "src/ui/price.tsx"],
  "src/pages/checkout.tsx": ["src/cart/checkout.ts", "src/cart/summary.tsx"],
  "src/pages/order.tsx": ["src/cart/summary.tsx"],
  "src/cart/total.test.ts": ["src/cart/total.ts"],
  "src/cart/checkout.test.ts": ["src/cart/checkout.ts"],
  "e2e/checkout.spec.ts": ["src/pages/checkout.tsx"],
}} />`,
    aliases: ["ImpactAnalysis", "AffectedFiles", "ChangeImpact"],
    heavy: true,
  }),
];

export const TEST_HISTORY = [
  component({
    name: "TestHistory",
    group: "Project",
    summary: "Pass and fail per test across runs, with flaky tests (pass and fail flipping, or passing on retry) marked first, then failing ones and since when, then fixed ones. Each run is any report Tests reads.",
    props: {
      runs: p.any("Reports oldest first (vitest or jest JSON, JUnit XML, [{name, status}]), or rows {test, run, status}", { required: true }),
      labels: p.list("A name per run, e.g. commits", "string[]"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<TestHistory title="Last 6 CI runs" labels={["a91f0de", "77c2e4b", "5e1b9c0", "3d0a8f1", "c48e211", "0b7d5aa"]} runs={[
  [{ name: "cart applies discount once", status: "passed" }, { name: "checkout keeps the address", status: "passed" }, { name: "login remembers the device", status: "passed" }, { name: "search ranks exact matches", status: "failed" }],
  [{ name: "cart applies discount once", status: "failed" }, { name: "checkout keeps the address", status: "passed" }, { name: "login remembers the device", status: "passed" }, { name: "search ranks exact matches", status: "failed" }],
  [{ name: "cart applies discount once", status: "passed" }, { name: "checkout keeps the address", status: "passed" }, { name: "login remembers the device", status: "passed" }, { name: "search ranks exact matches", status: "passed" }],
  [{ name: "cart applies discount once", status: "failed" }, { name: "checkout keeps the address", status: "passed" }, { name: "login remembers the device", status: "failed", message: "expected a saved device, got none" }, { name: "search ranks exact matches", status: "passed" }],
  [{ name: "cart applies discount once", status: "passed" }, { name: "checkout keeps the address", status: "passed" }, { name: "login remembers the device", status: "failed", message: "expected a saved device, got none" }, { name: "search ranks exact matches", status: "passed" }],
  [{ name: "cart applies discount once", status: "passed" }, { name: "checkout keeps the address", status: "skipped" }, { name: "login remembers the device", status: "failed", message: "expected a saved device, got none" }, { name: "search ranks exact matches", status: "passed" }],
]} />`,
    aliases: ["FlakyTests", "TestTrend", "TestRuns"],
    heavy: true,
  }),
];

export const DECISIONS = [
  component({
    name: "DecisionLog",
    group: "Planning",
    summary: "Decisions made so far: topic, what was decided, who decided, why and when, newest first, with topic filters and search; superseded ones stay but read as no longer in force. Reads rows with any common column names, a CSV or a Markdown decisions table.",
    props: {
      items: p.any("[{topic, decision, by, why, date, status?: active|proposed|superseded|reversed, link?}], or load() of a CSV or DECISIONS.md", { required: true }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<DecisionLog title="Architecture decisions" items={[
  { topic: "Storage", decision: "SQLite on device, synced in the background", by: "Maya", why: "The app must work offline on flights; sync conflicts are rare for this data.", date: "2026-10-02" },
  { topic: "Auth", decision: "Passkeys only, no passwords", by: "Vedran", why: "No passwords to leak or reset; every target OS supports them.", date: "2026-11-01" },
  { topic: "Storage", decision: "Postgres on the server for everything", by: "Maya", why: "One store to run.", date: "2026-09-12", status: "superseded" },
  { topic: "API", decision: "REST with JSON, not GraphQL", by: "Kenji", why: "Fewer moving parts for a small team.", date: "2026-10-20" },
  { topic: "Analytics", decision: "Count screens on device; send no events", by: "Priya", date: "2026-11-05", status: "proposed" },
]} />`,
    aliases: ["Decisions", "ADR", "DecisionRecord", "DecisionTable"],
    heavy: true,
  }),
];

export const SCHEMA_DIFF = [
  component({
    name: "SchemaDiff",
    group: "API",
    summary:
      "A database migration before it runs: each table with columns added, changed or dropped, every step marked destructive (loses data), risky (can fail, lock or break running code) or safe. Reads migration SQL, or compares before and after schemas (SQL, Prisma, Convex).",
    props: {
      sql: p.str("The migration; or put it between the tags"),
      before: p.any("The schema now: text or {tables}; with sql it tells type changes apart"),
      after: p.any("The schema after, to compare with before"),
      title: p.str("Caption"),
    },
    children: "raw",
    childrenDoc: "Migration SQL, verbatim",
    example: `<SchemaDiff title="0042_billing.sql" before="CREATE TABLE users (id bigint primary key, email text not null, legacy_flags jsonb);">
CREATE TABLE invoices (id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id), total numeric(10,2) NOT NULL);
ALTER TABLE users ADD COLUMN plan text NOT NULL, DROP COLUMN legacy_flags;
ALTER TABLE users ALTER COLUMN email TYPE varchar(64);
CREATE INDEX invoices_user_idx ON invoices (user_id);
DELETE FROM sessions;
</SchemaDiff>`,
    aliases: ["MigrationDiff", "Migration", "MigrationPreview"],
    heavy: true,
  }),
];

export const THEME_PREVIEW = [
  component({
    name: "ThemePreview",
    group: "Design",
    summary: "A mock app screen drawn only from the theme you give it (primary, background, foreground, border, radius, font and more), following inputs live: bind ColorInput and Slider states to it to try a theme. Tokens not given fall back to bb's theme.",
    props: {
      vars: p.obj("Theme tokens", "{primary?, primaryForeground?, background?, foreground?, card?, muted?, mutedForeground?, border?, accent?, radius?, font?, mono?}", { required: true }),
      mock: p.oneOf(["app", "form", "pricing"], "Which screen", { def: "app" }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<state brand="#5B5BD6" radius={10} font="system-ui" />
<Card title="Brand theme" icon="palette">
<Row>
  <ColorInput bind="brand" label="Primary" presets={["#5B5BD6", "#0D9488", "#E5484D", "#F76B15"]} />
  <Slider bind="radius" min={0} max={24} label="Radius" />
  <Select bind="font" label="Font" options={["system-ui", "Georgia", "ui-rounded", "ui-monospace"]} />
</Row>
<ThemePreview vars={{ primary: brand, radius: radius, font: font }} />
</Card>`,
    aliases: ["ThemeMock", "ThemePlayground", "MockUI"],
    heavy: true,
  }),
];
