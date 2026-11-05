// Charts, diagrams, code and project components.
import { component, p } from "./spec";

export const CHARTS = [
  component({
    name: "Chart",
    group: "Charts",
    summary:
      "Line, area, bar, horizontal bar, pie, donut, scatter and radar charts in the theme's colors, with hover readouts, annotations and a table view.",
    props: {
      type: p.oneOf(["line", "area", "bar", "hbar", "pie", "donut", "scatter", "radar"], "Chart kind", { def: "line" }),
      data: p.list("Rows, one per x value: [{build: 212, p50: 742, p90: 980}]", "object[]"),
      x: p.str("The x key in each row (the category or time)"),
      y: p.any("The y key, or a list of keys for several series"),
      values: p.list("Quick form: numbers for one series, with labels", "number[]"),
      labels: p.list("Quick form: x labels for values", "string[]"),
      series: p.list("Rename or recolor series", "{key, label?, tone?}[]"),
      stacked: p.bool("Stack bars or areas"),
      format: p.fmt("How y values read"),
      xFormat: p.fmt("How x values read"),
      unit: p.str("Short unit shown on the y axis, e.g. \"ms\""),
      height: p.num("Pixels", { def: 220 }),
      annotations: p.list("Marked points or lines", "{x?, y?, label, tone?}[]"),
      highlight: p.any("An x value to call out with a readout"),
      yMin: p.num("Lowest y on the axis; default fits the data"),
      yMax: p.num("Highest y on the axis"),
      legend: p.bool("Show a legend (default: when more than one series)"),
      brush: p.bool("line, area, bar, scatter: drag across x to select a range; double-click clears"),
      bind: p.bind("A <state> the brushed range goes to: {from, to, xs} (x values) or null; filter other parts by it", { required: false }),
      onPointClick: p.on("(point) => ... when a person clicks a point or bar"),
    },
    children: "none",
    example: `<Chart type="line" data={[\n  { build: 212, p50: 742 }, { build: 213, p50: 731 }, { build: 214, p50: 768 }, { build: 215, p50: 702 },\n  { build: 216, p50: 655 }, { build: 217, p50: 641 }, { build: 218, p50: 498 }, { build: 219, p50: 486 },\n]} x="build" y="p50" format="ms" annotations={[{ x: 218, label: "HealthKit setup deferred" }]} />`,
    aliases: ["LineChart", "BarChart", "AreaChart", "PieChart", "Plot"],
  }),
];

export const DIAGRAMS = [
  component({
    name: "Diagram",
    group: "Diagrams",
    summary:
      "A Mermaid diagram (flowchart, sequence, state, class, ER, gantt). Click a node and the agent explains it; give nodes notes to show a detail instead.",
    props: {
      title: p.str("Caption"),
      notes: p.obj("Detail shown when a node is clicked: {nodeId: \"text\"}", "{[nodeId]: string}"),
      explain: p.bool("Clicking a node with no note asks the agent to explain it", { def: true }),
    },
    children: "raw",
    childrenDoc: "Mermaid source, verbatim",
    example: `<Diagram title="Login">\nflowchart LR\n  B[Browser] -->|POST /login| A[loginHandler]\n  A --> V{password ok?}\n  V -->|no| E[401]\n  V -->|yes| S[create session]\n</Diagram>`,
    aliases: ["Mermaid", "Flowchart", "Flow"],
    heavy: true,
  }),
  component({
    name: "Tree",
    group: "Diagrams",
    summary: "A collapsible tree: a file tree, a hierarchy, an outline.",
    props: {
      items: p.list("Slash paths (\"src/app/page.tsx\") or nodes {label, children?, note?, icon?, tone?}", "(string | node)[]", { required: true }),
      open: p.num("Levels open at first", { def: 2 }),
      onClick: p.on("(node) => ... when a leaf is clicked; paths open the file by default"),
    },
    children: "none",
    example: `<Tree items={["src/engine/parse.ts", "src/engine/stream.ts", "src/chrome/export.ts", "README.md"]} />`,
    aliases: ["Outline", "Hierarchy"],
  }),
];

export const CODE = [
  component({
    name: "Code",
    group: "Code",
    summary: "A code block with syntax highlighting in bb's code theme.",
    props: { lang: p.str("Language, e.g. \"ts\", \"swift\", \"bash\""), title: p.str("File name or caption"), lines: p.str("Lines to highlight, e.g. \"3-5\"") },
    children: "raw",
    childrenDoc: "The code, verbatim",
    example: `<Code lang="ts">\nexport const add = (a: number, b: number) => a + b;\n</Code>`,
    aliases: ["Pre", "CodeBlock"],
  }),
  component({
    name: "Snippet",
    group: "Code",
    summary: "Lines of a real file from the workspace, read when the card renders; clicking opens the file.",
    props: {
      path: p.str("Workspace path", { required: true }),
      from: p.num("First line (1-based)"),
      to: p.num("Last line"),
      highlight: p.str("Lines to highlight, e.g. \"42-48\""),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Snippet path="core/parse.ts" from={1} to={12} />`,
    aliases: ["FileLines", "Excerpt"],
  }),
  component({
    name: "Diff",
    group: "Code",
    summary: "A unified diff for one file in bb's diff viewer, unified or split.",
    props: {
      path: p.str("The file the patch applies to", { required: true }),
      view: p.oneOf(["unified", "split"], "Layout", { def: "unified" }),
      patch: p.str("Patch text; or put it between the tags"),
      title: p.str("Caption"),
    },
    children: "raw",
    childrenDoc: "The unified patch, verbatim",
    example: `<Diff path="src/math.ts">\n@@ -1,3 +1,3 @@\n-export const add = (a, b) => a - b;\n+export const add = (a, b) => a + b;\n</Diff>`,
    aliases: ["Patch"],
  }),
  component({
    name: "Logs",
    group: "Code",
    summary: "Command output with real ANSI colors, line numbers, a filter and error lines marked.",
    props: {
      text: p.str("The output; or load it with load(path, {raw: true}), or put it between the tags"),
      command: p.str("The command that produced it"),
      exit: p.num("Exit code; nonzero marks the card as failed"),
      tail: p.num("Show only the last N lines at first", { def: 200 }),
      title: p.str("Caption"),
    },
    children: "raw",
    example: `<Logs command="npm test" exit={1}>\n\u001b[32m✓\u001b[0m parses tags\n\u001b[31m✗\u001b[0m keeps the last good tree\n</Logs>`,
    aliases: ["Log", "Output", "Console", "Terminal"],
  }),
  component({
    name: "StackTrace",
    group: "Code",
    summary: "An error and its stack with your own frames highlighted and clickable; library frames fold away.",
    props: { trace: p.str("The error text with its stack; or put it between the tags"), title: p.str("Caption") },
    children: "raw",
    example: `<StackTrace>\nTypeError: Cannot read properties of undefined (reading 'map')\n    at renderRows (src/table.tsx:42:18)\n    at Table (src/table.tsx:12:3)\n</StackTrace>`,
    aliases: ["Error", "Traceback", "Exception"],
  }),
];

export const PROJECT = [
  component({
    name: "Tests",
    group: "Project",
    summary: "A test run: counts, failures first with messages and file links. Reads vitest, jest, JUnit XML, Swift Testing and similar reports.",
    props: {
      results: p.any("A loaded report (load(\"$BB_THREAD_STORAGE/tests.json\")) or a list of {name, status: passed|failed|skipped, message?, file?, line?, duration?}", { required: true }),
      title: p.str("Caption"),
      show: p.oneOf(["failed", "all"], "Which tests to list", { def: "failed" }),
    },
    children: "none",
    example: `<Tests results={[\n  { name: "parses tags", status: "passed" },\n  { name: "keeps the last good tree", status: "failed", message: "expected 3 nodes, got 2", file: "core/parse.test.ts", line: 88 },\n]} />`,
    aliases: ["TestResults", "TestRun"],
  }),
  component({
    name: "Findings",
    group: "Project",
    summary: "Review, lint or type errors grouped by severity, each with file, line, detail and fix. Reads eslint JSON, tsc output, SARIF and ruff JSON.",
    props: {
      items: p.any("A loaded report, or [{severity: critical|high|medium|low|info, title, file?, line?, detail?, fix?, status?: open|fixed|rejected}]", { required: true }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Findings items={[{ severity: "high", title: "A retry drops the payload", file: "src/queue.ts", line: 88, detail: "requeue() passes only the id", fix: "Pass the payload too" }]} />`,
    aliases: ["Review", "Lint", "Issues", "Problems"],
  }),
  component({
    name: "Coverage",
    group: "Project",
    summary: "Code coverage per file with the weakest files first. Reads lcov.info and coverage-summary.json.",
    props: { report: p.any("A loaded report, or [{file, lines: percent, branches?, functions?}]", { required: true }), threshold: p.num("Below this percent reads as a warning", { def: 80 }) },
    children: "none",
    example: `<Coverage report={[{ file: "core/parse.ts", lines: 92 }, { file: "core/evaluate.ts", lines: 71 }]} />`,
  }),
  component({
    name: "Benchmark",
    group: "Project",
    summary: "Before and after timings with the change and whether it improved. Reads hyperfine JSON.",
    props: {
      results: p.any("[{name, before, after, better?: lower|higher}] or a loaded hyperfine report", { required: true }),
      unit: p.str("Unit of the numbers, e.g. \"ms\"", { def: "ms" }),
      format: p.fmt(),
    },
    children: "none",
    example: `<Benchmark unit="ms" results={[{ name: "Parse 17 KB block", before: 1900, after: 4.2 }, { name: "Cold launch", before: 742, after: 486 }]} />`,
    aliases: ["Timings", "Perf"],
  }),
];
