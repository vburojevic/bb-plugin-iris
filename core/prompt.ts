import { BB_SOURCES } from "./bb-data";
// Everything agents are told about Iris, generated from the catalog so the
// prompt, the validator and the renderers can never disagree. Kept small on
// purpose, since every session pays for it: the rules, and an index of every
// component with its prop names. Types, meanings and examples load on demand
// through iris_docs and iris_examples. bb caps each instruction section at
// 4,096 characters, so the index is split across those two tools.

import { CATALOG, GROUPS, type ComponentSpec, type PropSpec } from "./catalog";
import { KIT, reactGuide } from "./react-kit";

export const SECTION_LIMIT = 4096;

export type Stance = "eager" | "balanced";

export function mainInstructions(stance: Stance): string {
  const when =
    stance === "eager"
      ? "Reach for Iris whenever any part of a reply can be shown instead of told: numbers, comparisons, tables, trends, flows, plans, code results, tests, diffs, logs, timelines, schedules, optional next steps. In doubt, show it."
      : "Use Iris when a part of a reply reads better as UI than as prose: numbers, comparisons, tables, trends, flows, plans, test and build results, diffs. Short answers stay prose.";
  return `# Iris: live UI in your replies
This chat renders \`\`\`iris blocks as live, interactive UI in the person's bb theme. ${when} The first sentence gives the verdict (a direct question like \"is it ready?\" gets yes or no first); then add only what the card can't show, such as the cause or a recommendation. Never restate in prose the numbers, names, risks or steps the card shows. Put the block in your final message, never mid-turn.

## Syntax: JSX
- Tags are components: <Card title="Tests">...</Card>. Strings in quotes, the rest in braces: value={486} rows={[...]} onClick={() => ...}.
- <state seats={10} /> declares values inputs change; <let total={seats * 29} /> derives values. Inputs bind by name: <Slider bind="seats" />.
- Expressions are JavaScript: map, filter, reduce, ternaries, template strings, arrow functions, JSX inside: {rows.map((r) => <Item title={r.name} />)}. Put spaces around < and >.
- Helpers: fmt(x, "usd"|"percent"|"ms"|"bytes"|"duration"|"compact"|"date"), round(x, d), sum(list, key), avg, median, sortBy(list, key, "desc"), groupBy, countBy, unique, range(n), plural(n, "test").
- Files: load("$BB_THREAD_STORAGE/tests.json") reads JSON, JSONL, CSV or TSV from the workspace or thread storage; load(path, {raw: true}) gives text, {fallback: x} gives x on failure; load("plugin:<id>/<name>") reads data a bb plugin publishes for Iris; load("bb:thread"), bb:threads, bb:usage, bb:pr, bb:commits, bb:changes, bb:environments, bb:machines and bb:plugins read bb's own live data (iris_docs(["bb"]) has their shapes).
- Handlers: assign state (onClick={() => count += 1}) or act: insert(text) puts text in the composer, send(text) sends it, copy(text), openFile(path, line), openUrl(url), explain(topic).
- Text between tags is Markdown. Mermaid, code, diffs, logs and stack traces go verbatim between their tags.

## Rules
- One Card per idea; the first Card carries the toolbar. state="live" on a Card re-reads its load() files every 2 s (plugin: 10 s); iris_pin pins one: use it for running jobs, with LiveLog and LiveProgress over the files the job writes.
- Math in TeX goes in <Math> ($inline$ and $$display$$), never in Text or code.
- Never retype data a file holds: save tool output to $BB_THREAD_STORAGE and load() it.
- Show only the facts you have: no invented severities, statuses, tones or numbers. Don't repeat in a card what another component in it already shows.
- A question you need answered goes through ask mode, or iris_ask for a rich pick (the agent waits). Choices and FollowUps are only for optional next steps after a finished answer.
- \`\`\`iris-react holds a TSX module whose default export is a React component, for apps with real state or logic (games, simulators, editors): sandboxed, no network. Import hooks from "react", icons from "lucide-react", and ${KIT.map((k) => k.name).join(", ")}, useStored and iris from "iris" so it looks native. iris_docs(["React"]) has their props.
- \`\`\`iris-app holds a full HTML page for canvas, WebGL and custom visuals: sandboxed, no network, theme in CSS vars (--background --foreground --primary --border --iris-1..8), window.iris.insert/send/copy.
- Before using a component you haven't used in this thread, call iris_docs with its name for prop types and a working example; the index below lists prop names only. Run iris_check on a block with load(), inputs or anything unusual, and on every iris-react app, before sending it.

## Example
\`\`\`iris
<state seats={10} plan="Pro" />
<let price={(plan == "Pro" ? 29 : 12) * seats} />
<Card title="Estimate" icon="calculator">
  <Row>
    <Segmented bind="plan" options={["Basic", "Pro"]} />
    <Slider bind="seats" min={1} max={50} label="Seats" />
  </Row>
  <Metric label="Per month" value={price} format="usd" />
</Card>
\`\`\``;
}

export const CODE_WORK_INSTRUCTIONS = `# Iris for code work
Show tool output through its Iris component, reading the file the tool saved, never pasting or retyping it. Save output in $BB_THREAD_STORAGE as you run:
- tests: vitest run --reporter=json --outputFile=$BB_THREAD_STORAGE/tests.json (or jest --json --outputFile=..., JUnit XML), then <Tests results={load("$BB_THREAD_STORAGE/tests.json")} />
- a build or command log: cmd > $BB_THREAD_STORAGE/build.log 2>&1, then <Logs text={load("$BB_THREAD_STORAGE/build.log", {raw: true})} command="npm run build" exit={2} />
- lint or type errors: eslint -f json, tsc --noEmit --pretty false, SARIF, ruff check --output-format json, then <Findings items={load(...)} /> (tsc and lcov output load with {raw: true})
- coverage: <Coverage report={load("$BB_THREAD_STORAGE/cov/lcov.info", {raw: true})} />; before and after timings: <Benchmark />; an error with a stack: <StackTrace>
- code: <Snippet path="src/a.ts" from={10} to={40} />, never pasted; a change you describe: <Diff path="src/a.ts">unified patch</Diff>
- your work in this checkout reads live from bb, never retyped: <Changes /> (files and diffs; target="uncommitted" or a sha, paths={["src/"]}), <Commits />, <PullRequest />; subthreads you started: <Threads /> (or ids={[...]}); the project's worktrees: <Environments />
- a CI run: gh run view <id> --json name,displayTitle,status,conclusion,jobs,url > $BB_THREAD_STORAGE/run.json, then <Pipeline run={load("$BB_THREAD_STORAGE/run.json")} />
- a long job, live: start it writing to files, then show them; the card re-reads every 2 s while on screen. Its log: cmd > $BB_THREAD_STORAGE/job.log 2>&1, then <LiveLog file="$BB_THREAD_STORAGE/job.log" command="cmd" />. Its progress: have it rewrite $BB_THREAD_STORAGE/progress.json as {"done": 412, "total": 640, "label": "Tests", "eta": 95} (eta in seconds, optional), then <LiveProgress file=... />. Any load() inside <Card state="live"> refreshes the same way (Tests, Logs, DataGrid fill in as results land).
- big query results or CSVs: <DataGrid rows={load("$BB_THREAD_STORAGE/q.csv")} /> (sqlite3 -csv -header, psql --csv, duckdb -csv); a module or call graph: <Graph nodes={...} edges={[[from, to]]} />
- a review: <Findings items={[{severity, title, file, line, detail, fix}]} />
- a release in flight: keep $BB_THREAD_STORAGE/release.json current ({version, build, platforms, checks, store, blockers, timeline}), then <Release file=... /> follows it live
Tests or a build that fully passed need one sentence and no block.`;

function propLine(name: string, p: PropSpec): string {
  const type = p.values ? p.values.join("|") : p.type === "list" || p.type === "object" ? (p.shape ?? p.type) : p.type === "handler" ? "() => ..." : p.type === "state" ? '"stateName"' : p.type === "element" ? "<element/>" : p.type === "format" ? "format" : p.type;
  return `${name}${p.required ? "*" : ""}: ${type}${p.def !== undefined ? ` = ${JSON.stringify(p.def)}` : ""}. ${p.doc}`;
}

export function componentReference(c: ComponentSpec): string {
  const kids = c.children === "none" ? "" : c.children === "raw" ? " [verbatim content]" : c.children === "nodes" ? " [children]" : c.children === "markdown" ? " [markdown]" : " [text]";
  const props = Object.entries(c.props).map(([n, p]) => propLine(n, p));
  return `<${c.name}>${kids} ${c.summary}${props.length ? `\n  ${props.join("\n  ")}` : ""}`;
}

export interface IndexSection {
  /** Tool that carries this part of the index. */
  tool: "iris_docs" | "iris_examples";
  groups: string[];
  text: string;
}

/** One family's line: each component with its prop names, * marking required ones. */
function indexLine(group: string): string {
  const cs = CATALOG.filter((c) => c.group === group);
  return cs.length ? `${group}: ${cs.map((c) => `${c.name}(${Object.entries(c.props).map(([n, p]) => n + (p.required ? "*" : "")).join(" ")})`).join(" ")}` : "";
}

/**
 * The always-on component index, in two parts under the per-section cap: every component and
 * its prop names. iris_docs returns types, meanings and an example; iris_examples a family's examples.
 */
export function indexSections(): IndexSection[] {
  const heads = [
    "# Iris components\nEvery component with its prop names (* = required). iris_docs([\"Chart\", \"Table\"]) returns their prop types, meanings and a working example; iris_docs([\"React\"]) the iris-react kit; iris_docs([\"bb\"]) the bb: live data shapes.\n",
    "# Iris components, continued\niris_examples([\"Planning\"]) returns working examples for whole families.\n",
  ];
  const lines = GROUPS.map(indexLine).filter(Boolean);
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  const sections: IndexSection[] = [
    { tool: "iris_docs", groups: [], text: heads[0] },
    { tool: "iris_examples", groups: [], text: heads[1] },
  ];
  let used = 0;
  lines.forEach((line, k) => {
    const s = used + line.length < total / 2 ? sections[0] : sections[1];
    s.text += `${line}\n`;
    s.groups.push(GROUPS.filter((g) => indexLine(g))[k]);
    used += line.length + 1;
  });
  for (const s of sections) if (s.text.length > SECTION_LIMIT) throw new Error(`${s.tool} index is ${s.text.length} characters, over the ${SECTION_LIMIT} cap`);
  return sections;
}

export interface ReferenceSection {
  /** Tool that carries this section. */
  tool: string;
  groups: string[];
  text: string;
}

/** Packs the component reference into sections under the per-section cap. */
export function referenceSections(): ReferenceSection[] {
  const sections: ReferenceSection[] = [];
  let cur: ReferenceSection | null = null;
  const header = (groups: string[]) => `# Iris components: ${groups.join(", ")}\n(* marks a required prop)\n`;
  for (const g of GROUPS) {
    for (const c of CATALOG.filter((x) => x.group === g)) {
      const entry = componentReference(c);
      const groups: string[] = cur ? (cur.groups.includes(g) ? cur.groups : [...cur.groups, g]) : [g];
      const body: string = cur ? `${cur.text.slice(cur.text.indexOf("\n", cur.text.indexOf("\n") + 1) + 1)}\n${entry}` : entry;
      const text: string = header(groups) + body;
      if (cur && text.length <= SECTION_LIMIT) {
        cur.groups = groups;
        cur.text = text;
      } else {
        cur = { tool: "", groups: [g], text: header([g]) + entry };
        sections.push(cur);
      }
    }
  }
  // A family too big for one section continues in the next, which gets a numbered name of its own.
  const seen = new Map<string, number>();
  sections.forEach((s, k) => {
    const base = k === 0 ? "iris_docs" : `iris_examples_${s.groups[0].toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    s.tool = n === 1 ? base : `${base}_${n}`;
  });
  return sections;
}

/** The bb: live data sources and what each returns. */
export function bbDataGuide(): string {
  return [
    "# bb live data: load(\"bb:<source>\")",
    "bb's own data, read by Iris for the card's thread and re-read every 2 s inside <Card state=\"live\">. Draw it with any component.",
    ...BB_SOURCES.map((s) => `- bb:${s.name}: ${s.summary}`),
    "Example:",
    "```iris",
    "<let t={load(\"bb:thread\")} />",
    "<let kids={load(\"bb:threads?usage=1\")} />",
    "<Card title=\"This session\" state=\"live\">",
    "  <Row>",
    "    <Gauge label=\"Context\" value={t.context ? t.context.percent : 0} format=\"percent\" />",
    "    <Metric label=\"Waiting on you\" value={kids.filter((k) => k.waitingOnYou).length} />",
    "  </Row>",
    "  <Table rows={kids} columns={[\"title\", \"status\", {key: \"waitingOnYou\", label: \"Needs you\"}]} />",
    "</Card>",
    "```",
  ].join("\n");
}

export function docsFor(names: string[]): string {
  const out: string[] = [];
  for (const raw of names) {
    if (/^(react|iris-react|react apps?)$/i.test(raw.trim())) {
      out.push(reactGuide());
      continue;
    }
    if (/^(bb|bb:|bb data|live data)$/i.test(raw.trim())) {
      out.push(bbDataGuide());
      continue;
    }
    const c = CATALOG.find((x) => x.name.toLowerCase() === raw.toLowerCase() || (x.aliases ?? []).some((a) => a.toLowerCase() === raw.toLowerCase()));
    if (!c) {
      out.push(`${raw}: not an Iris component. Components: ${CATALOG.map((x) => x.name).join(", ")}; "React" gives the iris-react guide`);
      continue;
    }
    out.push(`${componentReference(c)}\nExample:\n\`\`\`iris\n${c.example}\n\`\`\``);
  }
  return out.join("\n\n");
}

export function examplesForGroups(groups: string[]): string {
  return CATALOG.filter((c) => groups.includes(c.group))
    .map((c) => `${c.name}:\n\`\`\`iris\n${c.example}\n\`\`\``)
    .join("\n\n");
}
