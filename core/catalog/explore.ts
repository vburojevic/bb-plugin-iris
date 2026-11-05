// Wave 2: the data explorer, math and graphs, and live cards over files a job
// keeps writing.
import { component, p } from "./spec";

export const DATA_EXPLORE = [
  component({
    name: "DataGrid",
    group: "Data",
    summary:
      "An explorer for large results (CSV, JSON, SQL; 10,000+ rows scroll smoothly): sort, filter per column, search, group with counts and sums, a quick pivot, column stats, copy as CSV. Use Table for small, styled lists.",
    props: {
      rows: p.any("A list of objects, a list of lists (first row is the header), SQL output {columns, rows}, or CSV text; usually load(\"$BB_THREAD_STORAGE/q.csv\")", { required: true }),
      columns: p.list("Which columns and how; default: every key", "(string | {key, label?, format?, align?, width?, tone?: (value, row) => tone, render?: (value, row) => element})[]"),
      sort: p.str("Initial sort: a column key, prefix with - for descending, e.g. \"-ms\""),
      filters: p.obj("Initial column filters: {ms: \">100\", team: \"core\"}. Numbers and dates take > < = != and a..b; text matches anywhere, =x exactly, !x excludes", "{[column]: string}"),
      search: p.str("Initial search text"),
      groupBy: p.str("Open grouped by this column, with counts and sums"),
      pivot: p.obj("Open as a pivot", "{rows, columns?, value?, agg?: count|sum|mean|min|max}"),
      view: p.oneOf(["rows", "groups", "pivot", "stats"], "The view it opens in (default: from groupBy or pivot, else rows)"),
      height: p.num("Most height in pixels; the rows scroll inside", { def: 420 }),
      dense: p.bool("Tighter rows"),
      onRowClick: p.on("What clicking a row does: (row) => explain(row.name)"),
      bind: p.bind("Optional state that holds the clicked row", { required: false }),
    },
    children: "none",
    example: `<DataGrid sort="-ms" rows={range(2000).map((i) => ({\n  test: \`suite \${floor(i / 20) + 1} case \${i % 20 + 1}\`,\n  team: ["core", "ui", "infra", "docs"][i % 4],\n  ms: (i * 37) % 480 + 12,\n  passed: i % 9 != 0,\n}))} columns={["test", "team", { key: "ms", format: "ms" }, { key: "passed", tone: (v) => v ? "good" : "bad" }]} />`,
    aliases: ["DataExplorer", "Pivot", "PivotTable", "QueryResults"],
  }),
];

export const MATH = [
  component({
    name: "Math",
    group: "Math",
    summary:
      "TeX formulas typeset with KaTeX. A bare formula is centered on its own line; text with $inline$ and $$display$$ parts mixes prose and math; inline puts one formula in a line of text.",
    props: {
      tex: p.str("The TeX, as an alternative to the content"),
      inline: p.bool("One formula inside a line, not centered on its own"),
      label: p.str("An equation number or name at the right, e.g. \"(1)\""),
      macros: p.obj("TeX macros: {\"\\\\RR\": \"\\\\mathbb{R}\"}", "{[name]: string}"),
    },
    children: "raw",
    childrenDoc: "TeX, verbatim; with $...$ or $$...$$ it reads as text with formulas in it",
    example: `<Math>\nThe roots of $ax^2 + bx + c = 0$ are\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n</Math>`,
    aliases: ["Formula", "Equation", "TeX", "Latex", "KaTeX"],
    heavy: true,
  }),
  component({
    name: "FunctionPlot",
    group: "Math",
    summary: "Plots y = f(x) for one or more arrow functions over a domain, with a hover readout. Parameters bound to state get sliders, so the curves move as you drag.",
    props: {
      fns: p.list("The functions: (x) => Math.sin(a * x), or {fn, label?, tone?, dashed?}", "((x) => number | {fn, label?, tone?, dashed?})[]", { required: true }),
      domain: p.list("x from and to; default [-10, 10]", "[number, number]"),
      range: p.list("y from and to; default fits the curves", "[number, number]"),
      params: p.list("Sliders for parameters the functions read; each binds a <state>", "{bind, min?, max?, step?, label?}[]"),
      points: p.list("Marked points; y defaults to the first function at x", "{x, y?, label?, tone?}[]"),
      xLabel: p.str("x axis title"),
      yLabel: p.str("y axis title"),
      samples: p.num("Points per curve (default: one per 1.5 pixels)"),
      height: p.num("Pixels", { def: 280 }),
    },
    children: "none",
    example: `<state a={1.5} k={2} />\n<FunctionPlot domain={[-6.3, 6.3]} fns={[\n  { fn: (x) => a * Math.sin(k * x), label: "a sin(kx)" },\n  { fn: (x) => a * Math.cos(x), label: "a cos(x)", dashed: true },\n]} params={[{ bind: "a", min: 0.2, max: 3, step: 0.1 }, { bind: "k", min: 1, max: 5 }]} points={[{ x: 0, label: "origin" }]} />`,
    aliases: ["Plot2D", "FunctionGraph", "Desmos", "Curve"],
  }),
];

export const GRAPHS = [
  component({
    name: "Graph",
    group: "Diagrams",
    summary:
      "An interactive node-and-edge graph from data: dependency, call, module or service graphs. Pan, pinch or buttons to zoom, drag nodes, layered or force layout. Click a node for its detail, its neighbors and Ask to explain, or run onNodeClick.",
    props: {
      nodes: p.list("Nodes; ids named only in edges are added", "(string | {id, label?, group?, tone?, note?})[]"),
      edges: p.list("Edges: [from, to] pairs or {from, to, label?, tone?, dashed?}", "([from, to] | {from, to, label?, tone?, dashed?})[]", { required: true }),
      layout: p.oneOf(["layered", "force"], "Layered ranks for dependencies and flows; force for clusters", { def: "layered" }),
      direction: p.oneOf(["LR", "TB", "RL", "BT"], "Layered direction", { def: "LR" }),
      height: p.num("Pixels; default fits the graph, up to 520"),
      onNodeClick: p.on("What clicking a node does: (node) => openFile(node.id)"),
      explain: p.bool("Clicked nodes offer Ask to explain", { def: true }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Graph title="What block.tsx pulls in" nodes={[\n  { id: "app.tsx", group: "ui" },\n  { id: "ui/block.tsx", group: "ui", note: "Compiles a block and keeps its runtime" },\n  { id: "core/program.ts", group: "core" },\n  { id: "core/parse.ts", group: "core" },\n  { id: "core/evaluate.ts", group: "core" },\n  { id: "core/catalog", group: "catalog" },\n]} edges={[\n  ["app.tsx", "ui/block.tsx"], ["ui/block.tsx", "core/program.ts"], ["ui/block.tsx", "core/catalog"],\n  ["core/program.ts", "core/parse.ts"], ["core/program.ts", "core/evaluate.ts"], { from: "core/parse.ts", to: "core/catalog", label: "raw tags", dashed: true },\n]} />`,
    aliases: ["Network", "NodeGraph", "DependencyGraph", "CallGraph", "ForceGraph"],
    heavy: true,
  }),
];

export const LIVE_CARDS = [
  component({
    name: "LiveLog",
    group: "Live",
    summary:
      "Tails a log file a running job keeps writing: ANSI colors, error lines marked, scrolls with new output and pauses when you scroll up. Re-reads every 2 s while on screen; start the job writing to a file, then show it.",
    props: {
      file: p.str("The log: run cmd > $BB_THREAD_STORAGE/job.log 2>&1 and point here", { required: true }),
      command: p.str("The command that writes it"),
      title: p.str("Caption, instead of the command"),
      tail: p.num("Most lines kept on screen", { def: 1000 }),
      height: p.num("Pixels", { def: 320 }),
      wrap: p.bool("Wrap long lines instead of scrolling sideways"),
    },
    children: "none",
    example: `<Card title="Release build" icon="hammer" state="live" status="Running">\n  <LiveLog file="$BB_THREAD_STORAGE/build.log" command="npm run build" />\n</Card>`,
    aliases: ["TailLog", "LogTail", "LiveOutput", "Tail"],
  }),
  component({
    name: "LiveProgress",
    group: "Live",
    summary:
      "Progress of a running job read from a JSON file it rewrites: {done, total, label?, eta?} or {tasks: [...]}. Shows the bar, the rate and the time left (computed when eta is missing), and flags a stall.",
    props: {
      file: p.str("The JSON file, e.g. $BB_THREAD_STORAGE/progress.json; or pass value"),
      value: p.any("The progress itself, instead of a file; a load() here refreshes only inside <Card state=\"live\">", { shape: "{done, total, label?, eta?: seconds | ISO time, unit?}" }),
      label: p.str("What is progressing, if the file has no label"),
      unit: p.str("What is counted, e.g. \"tests\""),
      stallAfter: p.num("Seconds without progress before it says stalled", { def: 90 }),
    },
    children: "none",
    example: `<Card title="Migrating photos" icon="images" state="live">\n  <LiveProgress file="$BB_THREAD_STORAGE/progress.json" unit="photos" />\n</Card>`,
    aliases: ["JobProgress", "LiveBar"],
  }),
];
