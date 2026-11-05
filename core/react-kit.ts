// ```iris-react blocks: a TSX module whose default export is a React
// component, run in the same sandboxed frame as ```iris-app with Iris's own
// primitives. This file is the single description of that kit: the agent's
// docs, the gallery, the import check and the tests all read it, and the
// frame runtime (chunks/react-frame) implements exactly these names.

export interface KitProp {
  /** TypeScript-ish type, as agents read it. */
  type: string;
  doc: string;
  required?: boolean;
  def?: string | number | boolean;
}

export interface KitSpec {
  name: string;
  summary: string;
  props: Record<string, KitProp>;
  /** A complete module; the gallery runs it and the tests compile it. */
  example: string;
}

const TONE = '"neutral" | "info" | "good" | "warn" | "bad"';
const FORMAT = '"number" | "integer" | "percent" | "usd" | "eur" | "bytes" | "duration" | "ms" | "compact" | "date"';
const GAP = '"none" | "sm" | "md" | "lg"';

const app = (imports: string, body: string, hooks = "") =>
  `import { ${imports} } from "iris";${hooks ? `\nimport { ${hooks} } from "react";` : ""}\n\nexport default function App() {\n${body}\n}`;

export const KIT: readonly KitSpec[] = [
  {
    name: "Card",
    summary: "The house card: raised surface, optional header with icon, title, subtitle and status. One per idea.",
    props: {
      title: { type: "string", doc: "Header title" },
      subtitle: { type: "string", doc: "Muted line under the title" },
      icon: { type: "string", doc: 'Lucide icon name, e.g. "rocket"' },
      tone: { type: TONE, doc: "Tints the icon and the top edge" },
      status: { type: "string", doc: "Short status text at the right of the header" },
      live: { type: "boolean", doc: "Lights the animated edge, for something still running", def: false },
      footer: { type: "ReactNode", doc: "Muted row under the content" },
      children: { type: "ReactNode", doc: "Content, stacked with even gaps" },
    },
    example: app("Card, Text", '  return (\n    <Card title="Release 2.4" subtitle="Ships Thursday" icon="rocket" status="On track">\n      <Text>Everything below is drawn by your app.</Text>\n    </Card>\n  );'),
  },
  {
    name: "Row",
    summary: "Lays children out side by side and wraps on narrow screens.",
    props: {
      gap: { type: GAP, doc: "Space between children", def: "md" },
      align: { type: '"start" | "center" | "end" | "stretch"', doc: "Cross-axis alignment", def: "center" },
      justify: { type: '"start" | "center" | "end" | "between"', doc: "Main-axis distribution", def: "start" },
      wrap: { type: "boolean", doc: "Wrap to the next line when out of room", def: true },
      children: { type: "ReactNode", doc: "Items" },
    },
    example: app("Card, Row, Badge", '  return (\n    <Card title="Labels">\n      <Row gap="sm">\n        <Badge tone="good">passing</Badge>\n        <Badge tone="warn">2 flaky</Badge>\n        <Badge>v2.4.0</Badge>\n      </Row>\n    </Card>\n  );'),
  },
  {
    name: "Stack",
    summary: "Stacks children vertically with an even gap.",
    props: {
      gap: { type: GAP, doc: "Space between children", def: "md" },
      align: { type: '"start" | "center" | "end" | "stretch"', doc: "Cross-axis alignment", def: "stretch" },
      children: { type: "ReactNode", doc: "Items" },
    },
    example: app("Card, Stack, Text", '  return (\n    <Card title="Notes">\n      <Stack gap="sm">\n        <Text>First line</Text>\n        <Text muted>Second line, muted</Text>\n      </Stack>\n    </Card>\n  );'),
  },
  {
    name: "Grid",
    summary: "Even columns that drop to fewer on narrow screens; good for metric tiles.",
    props: {
      min: { type: "number", doc: "Smallest column width in px before a column drops", def: 150 },
      cols: { type: "number", doc: "Fixed column count instead of auto-fit" },
      gap: { type: GAP, doc: "Space between cells", def: "md" },
      children: { type: "ReactNode", doc: "Cells" },
    },
    example: app("Card, Grid, Metric", '  return (\n    <Card title="This week">\n      <Grid>\n        <Metric label="Users" value={12840} format="compact" delta={0.12} deltaFormat="percent" />\n        <Metric label="Revenue" value={48210} format="usd" delta={-0.03} deltaFormat="percent" />\n        <Metric label="p95" value={182} format="ms" />\n      </Grid>\n    </Card>\n  );'),
  },
  {
    name: "Text",
    summary: "A paragraph or inline text in the house type scale.",
    props: {
      size: { type: '"sm" | "md" | "lg" | "xl"', doc: "Type size", def: "md" },
      muted: { type: "boolean", doc: "Secondary color", def: false },
      bold: { type: "boolean", doc: "Semibold weight", def: false },
      mono: { type: "boolean", doc: "Monospace font", def: false },
      tone: { type: TONE, doc: "Colors the text by meaning" },
      as: { type: '"p" | "span" | "div" | "h2" | "h3"', doc: "Element to render", def: "p" },
      children: { type: "ReactNode", doc: "The text" },
    },
    example: app("Card, Text", '  return (\n    <Card>\n      <Text size="xl" bold>42 tests</Text>\n      <Text muted>All passed in 3.1 s</Text>\n      <Text mono size="sm">npm test -- --run</Text>\n    </Card>\n  );'),
  },
  {
    name: "Badge",
    summary: "A small chip with a tone; for status, counts and labels.",
    props: {
      tone: { type: TONE, doc: "Color meaning" },
      variant: { type: '"soft" | "solid" | "outline"', doc: "Fill style", def: "soft" },
      icon: { type: "string", doc: "Lucide icon name" },
      children: { type: "ReactNode", doc: "Label" },
    },
    example: app("Card, Row, Badge", '  return (\n    <Card title="Badges">\n      <Row gap="sm">\n        <Badge tone="good" icon="check">soft</Badge>\n        <Badge tone="info" variant="solid">solid</Badge>\n        <Badge tone="bad" variant="outline">outline</Badge>\n      </Row>\n    </Card>\n  );'),
  },
  {
    name: "Icon",
    summary: "Any Lucide icon by name, in the current text color unless toned.",
    props: {
      name: { type: "string", doc: 'Lucide name: "rocket", "triangle-alert", "git-branch"', required: true },
      size: { type: "number", doc: "Pixel size", def: 16 },
      tone: { type: TONE, doc: "Color meaning" },
      color: { type: "string", doc: 'A CSS color, e.g. "var(--iris-2)"' },
    },
    example: app("Card, Row, Icon", '  return (\n    <Card title="Icons">\n      <Row>\n        <Icon name="rocket" size={20} />\n        <Icon name="circle-check" tone="good" size={20} />\n        <Icon name="triangle-alert" tone="warn" size={20} />\n        <Icon name="flame" color="var(--iris-3)" size={20} />\n      </Row>\n    </Card>\n  );'),
  },
  {
    name: "Metric",
    summary: "A headline number with label, change and an optional sparkline.",
    props: {
      label: { type: "string", doc: "What the number is", required: true },
      value: { type: "number | string", doc: "The number", required: true },
      format: { type: FORMAT, doc: "How the value reads" },
      unit: { type: "string", doc: "Unit after the value" },
      delta: { type: "number", doc: "Change since before; drawn with an arrow" },
      deltaFormat: { type: FORMAT, doc: "How the change reads", def: "number" },
      better: { type: '"up" | "down"', doc: "Which direction is good, so the change is colored right", def: "up" },
      tone: { type: TONE, doc: "Colors the value" },
      note: { type: "string", doc: "Muted line under the value" },
      trend: { type: "number[]", doc: "Values for a sparkline" },
    },
    example: app("Card, Metric", '  return (\n    <Card>\n      <Metric label="Build time" value={94} format="duration" delta={-0.18} deltaFormat="percent" better="down" trend={[130, 122, 118, 110, 101, 94]} note="Last 6 builds" />\n    </Card>\n  );'),
  },
  {
    name: "Callout",
    summary: "A tinted note for a warning, a tip or a result.",
    props: {
      tone: { type: TONE, doc: "Color and default icon", def: "info" },
      title: { type: "string", doc: "Bold first line" },
      icon: { type: "string", doc: "Lucide icon name instead of the tone's" },
      children: { type: "ReactNode", doc: "The note" },
    },
    example: app("Card, Callout", '  return (\n    <Card>\n      <Callout tone="warn" title="Two tests are flaky">They pass on retry. Worth a look before release.</Callout>\n    </Card>\n  );'),
  },
  {
    name: "Progress",
    summary: "A bar toward a total.",
    props: {
      value: { type: "number", doc: "Current amount", required: true },
      max: { type: "number", doc: "Total; without it value is a 0..1 ratio" },
      label: { type: "string", doc: "Label above the bar" },
      tone: { type: TONE, doc: "Bar color; the accent by default" },
      showValue: { type: "boolean", doc: "Show the amount at the right", def: true },
    },
    example: app("Card, Stack, Progress", '  return (\n    <Card title="Migration">\n      <Stack>\n        <Progress label="Tables" value={18} max={24} />\n        <Progress label="Rows" value={0.42} tone="warn" />\n      </Stack>\n    </Card>\n  );'),
  },
  {
    name: "Table",
    summary: "Rows in columns, sortable by clicking a header, with formats and clickable rows.",
    props: {
      rows: { type: "object[]", doc: "One object per row", required: true },
      columns: { type: "(string | { key: string; label?: string; align?: \"left\" | \"right\" | \"center\"; format?: Format; render?: (row) => ReactNode })[]", doc: "Columns in order; default: the first row's keys" },
      onRowClick: { type: "(row) => void", doc: "Makes rows clickable" },
      dense: { type: "boolean", doc: "Tighter rows", def: false },
      maxRows: { type: "number", doc: "Rows per page; pages appear past it", def: 50 },
    },
    example: app(
      "Card, Table, Badge",
      '  const rows = [\n    { name: "api", p95: 182, errors: 0.004, state: "good" },\n    { name: "web", p95: 96, errors: 0.012, state: "warn" },\n    { name: "jobs", p95: 640, errors: 0.031, state: "bad" },\n  ];\n  return (\n    <Card title="Services">\n      <Table\n        rows={rows}\n        columns={[\n          "name",\n          { key: "p95", label: "p95", align: "right", format: "ms" },\n          { key: "errors", align: "right", format: "percent" },\n          { key: "state", label: "", render: (r) => <Badge tone={r.state}>{r.state}</Badge> },\n        ]}\n      />\n    </Card>\n  );',
    ),
  },
  {
    name: "Chart",
    summary: "Line, area or bar chart over rows of data in the theme's series colors, with hover values.",
    props: {
      data: { type: "object[]", doc: "One object per x value", required: true },
      x: { type: "string", doc: "Key of the x value", required: true },
      y: { type: "string | string[]", doc: "Key or keys of the plotted values, one series each", required: true },
      type: { type: '"line" | "area" | "bar"', doc: "Chart kind", def: "line" },
      stacked: { type: "boolean", doc: "Stack bar or area series", def: false },
      height: { type: "number", doc: "Pixel height of the plot", def: 180 },
      format: { type: FORMAT, doc: "How y values read" },
      labels: { type: "Record<string, string>", doc: "Legend names for y keys" },
    },
    example: app(
      "Card, Chart",
      '  const data = [\n    { day: "Mon", web: 120, api: 80 },\n    { day: "Tue", web: 160, api: 95 },\n    { day: "Wed", web: 140, api: 130 },\n    { day: "Thu", web: 210, api: 120 },\n    { day: "Fri", web: 190, api: 150 },\n  ];\n  return (\n    <Card title="Requests" subtitle="Thousands per day">\n      <Chart type="area" data={data} x="day" y={["web", "api"]} format="compact" />\n    </Card>\n  );',
    ),
  },
  {
    name: "Button",
    summary: "A pill button. Primary for the main action, secondary by default.",
    props: {
      onClick: { type: "() => void", doc: "What it does" },
      variant: { type: '"primary" | "secondary" | "ghost" | "destructive"', doc: "Emphasis", def: "secondary" },
      size: { type: '"sm" | "md"', doc: "Height", def: "md" },
      icon: { type: "string", doc: "Lucide icon name before the label" },
      disabled: { type: "boolean", doc: "Greys it out", def: false },
      children: { type: "ReactNode", doc: "Label" },
    },
    example: app("Card, Row, Button, Text", '  const [n, setN] = useState(0);\n  return (\n    <Card title="Counter">\n      <Text size="xl" bold>{n}</Text>\n      <Row gap="sm">\n        <Button variant="primary" icon="plus" onClick={() => setN(n + 1)}>Add</Button>\n        <Button variant="ghost" onClick={() => setN(0)}>Reset</Button>\n      </Row>\n    </Card>\n  );', "useState"),
  },
  {
    name: "Slider",
    summary: "A range input with its value shown at the right of the label.",
    props: {
      value: { type: "number", doc: "Controlled value; omit it and pass defaultValue for an uncontrolled slider" },
      defaultValue: { type: "number", doc: "Starting value when uncontrolled" },
      onChange: { type: "(value: number) => void", doc: "Called as it moves" },
      min: { type: "number", doc: "Lowest value", def: 0 },
      max: { type: "number", doc: "Highest value", def: 100 },
      step: { type: "number", doc: "Increment", def: 1 },
      label: { type: "string", doc: "Label above" },
      format: { type: FORMAT, doc: "How the value reads" },
    },
    example: app("Card, Slider, Metric", '  const [seats, setSeats] = useState(10);\n  return (\n    <Card title="Estimate" icon="calculator">\n      <Slider label="Seats" min={1} max={50} value={seats} onChange={setSeats} />\n      <Metric label="Per month" value={seats * 29} format="usd" />\n    </Card>\n  );', "useState"),
  },
  {
    name: "Toggle",
    summary: "An on and off switch with a label and detail.",
    props: {
      checked: { type: "boolean", doc: "Controlled state" },
      defaultChecked: { type: "boolean", doc: "Starting state when uncontrolled" },
      onChange: { type: "(checked: boolean) => void", doc: "Called on flip" },
      label: { type: "string", doc: "What it turns on" },
      detail: { type: "string", doc: "Muted line under the label" },
    },
    example: app("Card, Toggle, Text", '  const [on, setOn] = useState(true);\n  return (\n    <Card title="Settings">\n      <Toggle label="Run tests on save" detail="Uses vitest --changed" checked={on} onChange={setOn} />\n      <Text muted size="sm">{on ? "Tests run on every save." : "Tests run on demand."}</Text>\n    </Card>\n  );', "useState"),
  },
  {
    name: "Input",
    summary: "A text field with a label.",
    props: {
      value: { type: "string", doc: "Controlled text" },
      defaultValue: { type: "string", doc: "Starting text when uncontrolled" },
      onChange: { type: "(value: string) => void", doc: "Called on each keystroke" },
      onEnter: { type: "(value: string) => void", doc: "Called when Enter is pressed" },
      label: { type: "string", doc: "Label above" },
      placeholder: { type: "string", doc: "Hint when empty" },
      type: { type: '"text" | "number" | "email" | "search"', doc: "Keyboard kind", def: "text" },
    },
    example: app("Card, Input, Text", '  const [name, setName] = useState("");\n  return (\n    <Card title="Greeting">\n      <Input label="Name" placeholder="Ada" value={name} onChange={setName} />\n      <Text>{name ? `Hello, ${name}.` : "Type a name."}</Text>\n    </Card>\n  );', "useState"),
  },
  {
    name: "Select",
    summary: "A dropdown of options.",
    props: {
      options: { type: "(string | { value: string; label: string })[]", doc: "Choices", required: true },
      value: { type: "string", doc: "Controlled value" },
      defaultValue: { type: "string", doc: "Starting value when uncontrolled" },
      onChange: { type: "(value: string) => void", doc: "Called on pick" },
      label: { type: "string", doc: "Label above" },
    },
    example: app("Card, Select, Text", '  const [region, setRegion] = useState("eu");\n  return (\n    <Card title="Region">\n      <Select label="Deploy to" value={region} onChange={setRegion} options={[{ value: "eu", label: "Europe" }, { value: "us", label: "United States" }]} />\n      <Text muted size="sm">Picked: {region}</Text>\n    </Card>\n  );', "useState"),
  },
  {
    name: "Segmented",
    summary: "A small row of exclusive choices.",
    props: {
      options: { type: "(string | { value: string; label: string; icon?: string })[]", doc: "Choices", required: true },
      value: { type: "string", doc: "Controlled value" },
      defaultValue: { type: "string", doc: "Starting value when uncontrolled" },
      onChange: { type: "(value: string) => void", doc: "Called on pick" },
    },
    example: app("Card, Segmented, Text", '  const [view, setView] = useState("Week");\n  return (\n    <Card title="Range">\n      <Segmented options={["Day", "Week", "Month"]} value={view} onChange={setView} />\n      <Text muted size="sm">Showing one {view.toLowerCase()}.</Text>\n    </Card>\n  );', "useState"),
  },
  {
    name: "Tabs",
    summary: "Tabs over panels; only the active panel renders.",
    props: {
      tabs: { type: "{ label: string; icon?: string; badge?: string | number; content: ReactNode }[]", doc: "One entry per tab", required: true },
      value: { type: "number", doc: "Controlled active index" },
      defaultValue: { type: "number", doc: "Starting index when uncontrolled", def: 0 },
      onChange: { type: "(index: number) => void", doc: "Called on switch" },
    },
    example: app("Card, Tabs, Text", '  return (\n    <Card>\n      <Tabs\n        tabs={[\n          { label: "Summary", icon: "list", content: <Text>Three services, one alert.</Text> },\n          { label: "Alerts", badge: 1, content: <Text tone="bad">jobs: error rate 3.1%</Text> },\n        ]}\n      />\n    </Card>\n  );'),
  },
];

/** Non-component exports of "iris". */
export const KIT_HELPERS = {
  useStored: "useStored(key, initial): like useState, but the value is saved with the card and comes back when the chat reloads.",
  useTheme: "useTheme(): { series: string[] (chart colors), tone: { neutral, info, good, warn, bad }, dark: boolean }, live with the theme.",
  fmt: 'fmt(value, format): formats a number the way the components do, e.g. fmt(0.42, "percent").',
  iris: "iris.insert(text) / iris.send(text) / iris.copy(text) / iris.openUrl(url) / iris.submit(value): the bridge; each works only from a click.",
} as const;

export const KIT_EXPORTS: readonly string[] = [...KIT.map((k) => k.name), ...Object.keys(KIT_HELPERS)];

/** What the frame's require() resolves; anything else fails with a readable error. */
export const MODULES = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "iris", "lucide-react"] as const;

export interface AppProblem {
  message: string;
  line?: number;
}

/**
 * Import mistakes sucrase can't see: a module the frame doesn't have, or a
 * name "iris" doesn't export. Pure text scan, run before compiling.
 */
export function checkImports(source: string): AppProblem[] {
  const out: AppProblem[] = [];
  // Line numbers counted forward once: imports come in order, so the scan never re-reads the start.
  let counted = 0;
  let line = 1;
  const lineAt = (i: number) => {
    for (let k = source.indexOf("\n", counted); k !== -1 && k < i; k = source.indexOf("\n", k + 1)) line++;
    counted = Math.max(counted, i);
    return line;
  };
  // Only statements that start a line: an import quoted in a string or a comment is not one.
  // Each statement is read with simple, non-overlapping steps, so a long or unfinished import line
  // can't make the scan backtrack.
  const starts = /^[ \t]*import\b/gm;
  for (let start = starts.exec(source); start && out.length < 20; start = starts.exec(source)) {
    // One statement: up to the next line that starts another import, at most 4000 characters.
    const window = source.slice(start.index, start.index + 4000);
    const nextImport = /\n[ \t]*import\b/.exec(window.slice(1));
    const text = nextImport ? window.slice(0, nextImport.index + 1) : window;
    const head = /^[ \t]*import/.exec(text)?.[0].length ?? 0;
    const rest = text.slice(head);
    // import.meta and import() are expressions, not import statements.
    if (/^\s*[.(]/.test(rest)) continue;
    let clause: string | undefined;
    let mod: string | undefined;
    const bare = /^\s*["']([^"'\n]+)["']/.exec(rest);
    if (bare) mod = bare[1];
    else {
      const from = /\bfrom\s*["']([^"'\n]+)["']/.exec(rest);
      if (!from) continue;
      clause = rest.slice(0, from.index);
      // A semicolon or a quote before "from" means this "from" belongs to something else.
      if (/[;"'`]/.test(clause)) continue;
      mod = from[1];
    }
    if (clause !== undefined && /^\s+type\b/.test(clause)) continue;
    const m = { index: start.index, 1: clause?.replace(/^\s+(?:type\s+)?/, "").trim() };
    if (!(MODULES as readonly string[]).includes(mod)) {
      out.push({ message: `"${mod}" isn't available: an iris-react app can import only ${MODULES.filter((x) => !x.includes("/")).join(", ")}`, line: lineAt(m.index) });
      continue;
    }
    if (mod === "iris" && m[1]) {
      const named = /\{([\s\S]*)\}/.exec(m[1])?.[1] ?? "";
      for (const part of named.split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (!name || part.trim().startsWith("type ")) continue;
        if (!KIT_EXPORTS.includes(name)) out.push({ message: `"iris" has no ${name}. It exports ${KIT_EXPORTS.join(", ")}`, line: lineAt(m.index) });
      }
    }
  }
  return out;
}

/**
 * Kit components drawn without an import, read from sucrase's output (types
 * gone, strings still strings, lines unchanged). An imported kit name compiles
 * to _iris.Card; a bare one would reach a DOM global like Text, or nothing.
 */
export function missingKitImports(compiled: string): AppProblem[] {
  const out: AppProblem[] = [];
  const seen = new Set<string>();
  for (const m of compiled.matchAll(/\bjsxs?\.call\(void 0, ([A-Z][A-Za-z0-9]*)(?![\w.])/g)) {
    const name = m[1];
    if (seen.has(name) || !KIT.some((k) => k.name === name)) continue;
    seen.add(name);
    if (new RegExp(`\\b(function|class|const|let|var)\\s+${name}\\b`).test(compiled)) continue;
    out.push({ message: `<${name}> is used but not imported: add it to the import from "iris"`, line: compiled.slice(0, m.index).split("\n").length });
  }
  return out;
}

function kitReference(k: KitSpec): string {
  const props = Object.entries(k.props).map(([n, p]) => `${n}${p.required ? "*" : ""}: ${p.type}${p.def !== undefined ? ` = ${JSON.stringify(p.def)}` : ""}. ${p.doc}`);
  return `<${k.name}> ${k.summary}\n  ${props.join("\n  ")}`;
}

/** iris_docs(["React"]): everything an agent needs to write an iris-react app. */
export function reactGuide(fence = "iris-react"): string {
  const example = KIT.find((k) => k.name === "Slider")!.example;
  return `# \`\`\`${fence}: React apps with Iris inside
A \`\`\`${fence} block holds one TSX module. Its default export is a React component; Iris compiles and runs it in a sandboxed frame with no network, in the person's theme. Use it when an app needs real state or logic (games, simulators, editors, calculators with many parts); plain cards stay \`\`\`iris and canvas or WebGL pages stay \`\`\`iris-app.

## Rules
- Imports: hooks from "react", components and helpers from "iris", icons from "lucide-react" (any Lucide name, drawn in Iris's style). Nothing else loads: no fetch, no npm packages, no external CSS or fonts.
- TypeScript and JSX are fine; types are stripped, not checked.
- Style with the components first; they match the native Iris cards. For your own elements use inline styles with the theme's CSS variables: --background --foreground --card --muted --muted-foreground --border --primary --radius --font-sans --font-mono, series colors --iris-1..8, tones --iris-good --iris-warn --iris-bad --iris-info.
- State lives in useState; useStored(key, initial) keeps it with the card across reloads.
- A compile or runtime error shows under the app with its line and an Ask to fix button.

## Helpers from "iris"
${Object.values(KIT_HELPERS).map((h) => `- ${h}`).join("\n")}

## Components from "iris" (* marks a required prop)
${KIT.map(kitReference).join("\n")}

## Example
\`\`\`${fence}
${example}
\`\`\``;
}
