// Checks a block the way a person would meet it: every tag known, every
// required prop present, every expression evaluated, and every input moved to
// its extremes. Used by the iris_check tool, `bb iris check`, and tests.

import type { ElementNode, Node } from "./ast";
import { findComponent, ALL_TAG_NAMES, type ComponentSpec, type PropSpec } from "./catalog";
import { IrisError, Scope, isActionValue, isElementValue, isFnValue, isPendingValue, toText } from "./evaluate";
import { FORMAT_NAMES } from "./format";
import { CardRuntime, DECLARATION_TAGS, type Program, type RuntimeOptions, asIrisError, compile, position } from "./program";
import { didYouMean, collapse } from "./text";
import { CONTENT_CHECKS } from "./content-checks";
import { arrangement, normalizeKanban } from "./kanban";

export interface Issue {
  severity: "error" | "warning";
  message: string;
  line: number;
  col: number;
  /** The state values in effect when this showed up (inputs moved), if any. */
  when?: string;
}

export interface CheckReport {
  ok: boolean;
  issues: Issue[];
  /** A text rendering of what the person will see, for the agent. */
  outline: string;
  components: string[];
}

const HTML_HINTS: Record<string, string> = {
  div: "Stack or Row", span: "Text", p: "Text", h1: "Heading", h2: "Heading", h3: "Heading", ul: "List", ol: "List", li: "Item",
  table: "Table", img: "Image", a: "Link", button: "Button", input: "Input", select: "Select", pre: "Code", code: "Code",
  section: "Card", hr: "Divider", label: "Text", strong: "Text with **bold**", b: "Text with **bold**",
};

export function check(source: string, options: RuntimeOptions = {}): CheckReport {
  const program = compile(source);
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], message: string, at: number, when?: string) => {
    const { line, col } = position(source, at);
    const key = `${message}@${line}`;
    if (issues.some((i) => `${i.message}@${i.line}` === key)) return;
    issues.push({ severity, message, line, col, when });
  };
  if (program.error) add("error", program.error.message, program.error.start);
  else if (program.incomplete) add("error", "The block ends before every tag is closed", source.length);

  const used = new Set<string>();
  staticCheck(program.nodes, add, used, program);

  const runtime = new CardRuntime(program, { ...options, now: options.now ?? (() => Date.parse("2026-01-01T12:00:00Z")) });
  for (const [name, err] of runtime.initErrors) add("error", `<state ${name}>: ${err.message}`, err.start ?? 0);
  const outline: string[] = [];
  walk(program.nodes, runtime, runtime.globals, 0, outline, (err) => add("error", err.message, err.start ?? 0));

  // Move every input to its extremes and see what breaks.
  for (const variant of inputVariants(program, runtime)) {
    const r = new CardRuntime(program, { ...options, now: options.now ?? (() => Date.parse("2026-01-01T12:00:00Z")) });
    for (const [k, v] of Object.entries(variant)) r.state.set(k, v);
    const when = Object.entries(variant)
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join(", ");
    walk(program.nodes, r, r.globals, 0, [], (err) => add("error", err.message, err.start ?? 0, when));
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues, outline: outline.join("\n"), components: [...used] };
}

function staticCheck(nodes: Node[], add: (s: Issue["severity"], m: string, at: number) => void, used: Set<string>, program: Program) {
  const stateNames = new Set(program.states.map((s) => s.name));
  const visit = (list: Node[]) => {
    for (const n of list) {
      if (n.kind === "expr") visitExpr(n.expr);
      if (n.kind !== "element") continue;
      if (n.name === "" || DECLARATION_TAGS.has(n.name)) {
        visit(n.children);
        continue;
      }
      const spec = findComponent(n.name);
      if (!spec) {
        const hint = HTML_HINTS[n.name.toLowerCase()] ?? didYouMean(n.name, ALL_TAG_NAMES);
        add("error", `<${n.name}> is not an Iris component${hint ? `. Use ${hint}` : ""}`, n.start);
        visit(n.children);
        continue;
      }
      used.add(spec.name);
      checkProps(n, spec, add, stateNames);
      if (spec.children === "none" && n.children.some((c) => c.kind !== "text" || c.value.trim())) {
        add("warning", `<${spec.name}> ignores children; pass data through its props`, n.start);
      }
      visit(n.children);
      for (const a of n.attrs) if (a.value) visitExpr(a.value);
    }
  };
  const visitExpr = (e: unknown) => {
    // JSX inside expressions: check those tags too.
    if (!e || typeof e !== "object") return;
    const x = e as { t?: string; el?: ElementNode };
    if (x.t === "jsx" && x.el) {
      visit([x.el]);
      return;
    }
    for (const v of Object.values(e)) {
      if (Array.isArray(v)) v.forEach(visitExpr);
      else if (v && typeof v === "object") visitExpr(v);
    }
  };
  visit(nodes);
}

function checkProps(n: ElementNode, spec: ComponentSpec, add: (s: Issue["severity"], m: string, at: number) => void, stateNames: Set<string>) {
  const given = new Set(n.attrs.map((a) => a.name));
  const hasSpread = given.has("...");
  for (const a of n.attrs) {
    if (a.name === "..." || a.name === "key") continue;
    const prop = spec.props[a.name];
    if (!prop) {
      const hint = didYouMean(a.name, Object.keys(spec.props));
      add("warning", `<${spec.name}> has no prop "${a.name}"${hint ? `. Did you mean ${hint}?` : `. Props: ${Object.keys(spec.props).join(", ") || "none"}`}`, a.start);
      continue;
    }
    if (a.value?.t === "lit") literalCheck(spec, a.name, prop, a.value.v, a.start, add);
    if (prop.type === "state" && a.value?.t === "lit" && typeof a.value.v === "string" && !stateNames.has(a.value.v)) {
      add("error", `<${spec.name} bind="${a.value.v}">: there is no <state ${a.value.v}={...} />`, a.start);
    }
    if (prop.type === "state" && a.value && a.value.t !== "lit") {
      add("error", `<${spec.name}> bind takes the state's name in quotes: bind="${a.value.t === "id" ? a.value.name : "name"}"`, a.start);
    }
  }
  if (hasSpread) return;
  for (const [name, prop] of Object.entries(spec.props)) {
    if (!prop.required || given.has(name)) continue;
    // Children can stand in for a text prop on raw components.
    if ((spec.children === "raw" || spec.children === "text" || spec.children === "markdown") && n.children.length) continue;
    add("error", `<${spec.name}> needs ${name} (${prop.doc})`, n.start);
  }
}

function literalCheck(spec: ComponentSpec, name: string, prop: PropSpec, v: unknown, at: number, add: (s: Issue["severity"], m: string, at: number) => void) {
  if ((prop.type === "enum" || prop.type === "tone") && prop.values && typeof v === "string" && !prop.values.includes(v)) {
    const hint = didYouMean(v, prop.values);
    add("error", `<${spec.name} ${name}="${v}">: use one of ${prop.values.join(", ")}${hint ? ` (did you mean ${hint}?)` : ""}`, at);
  }
  if (prop.type === "number" && typeof v === "string") {
    add(Number.isNaN(Number(v)) ? "error" : "warning", `<${spec.name}> ${name} is a number: write ${name}={${v}}`, at);
  }
  if (prop.type === "format" && typeof v === "string" && !(FORMAT_NAMES as readonly string[]).includes(v)) {
    add("error", `<${spec.name} ${name}="${v}">: formats are ${FORMAT_NAMES.join(", ")}`, at);
  }
}

/** Evaluates everything the renderer would, writing a readable outline. */
function walk(nodes: Node[], rt: CardRuntime, scope: Scope, depth: number, out: string[], fail: (e: IrisError) => void) {
  const pad = "  ".repeat(depth);
  for (const n of nodes) {
    if (n.kind === "text") {
      const t = collapse(n.value).trim();
      if (t) out.push(`${pad}${t.length > 160 ? `${t.slice(0, 157)}...` : t}`);
      continue;
    }
    if (n.kind === "expr") {
      try {
        rt.interp.steps = 0;
        const v = rt.interp.eval(n.expr, scope);
        renderValue(v, rt, depth, out, fail);
      } catch (cause) {
        fail(asIrisError(cause, n));
      }
      continue;
    }
    if (DECLARATION_TAGS.has(n.name)) {
      if (n.name === "let") {
        for (const a of n.attrs) {
          try {
            rt.getLet(a.name);
          } catch (cause) {
            fail(asIrisError(cause, a));
          }
        }
      }
      continue;
    }
    const spec = findComponent(n.name);
    const { props, errors } = rt.props(n, scope);
    for (const e of errors.values()) fail(e);
    if (n.name === "") {
      walk(n.children, rt, scope, depth, out, fail);
      continue;
    }
    if (!spec) continue;
    out.push(`${pad}${describe(spec, props)}`);
    for (const problem of CONTENT_CHECKS[spec.name]?.(props) ?? []) fail(new IrisError(`<${spec.name}> ${problem}`, n.start, n.end));
    for (const [k, v] of Object.entries(props)) {
      if (isElementValue(v)) renderValue(v, rt, depth + 1, out, fail);
      const sample = spec.calls?.[k];
      if (sample && isFnValue(v)) {
        try {
          rt.interp.steps = 0;
          rt.interp.call(v, sample);
        } catch (cause) {
          const at = n.attrs.find((a) => a.name === k) ?? n;
          fail(new IrisError(`<${spec.name} ${k}> fails when called with (${sample.map((x) => JSON.stringify(x)).join(", ")}): ${cause instanceof Error ? cause.message : String(cause)}`, at.start, at.end));
        }
      }
      if (isFnValue(v) && spec.props[k]?.type !== "handler") {
        // Render functions (Table column render, tone) run per row; try the first row.
      }
    }
    if (spec.children !== "raw") walk(n.children, rt, scope, depth + 1, out, fail);
  }
}

function renderValue(v: unknown, rt: CardRuntime, depth: number, out: string[], fail: (e: IrisError) => void) {
  if (Array.isArray(v)) {
    for (const x of v) renderValue(x, rt, depth, out, fail);
    return;
  }
  if (isElementValue(v)) {
    walk([v.node], rt, v.scope, depth, out, fail);
    return;
  }
  if (v == null || typeof v === "boolean" || isActionValue(v) || isFnValue(v)) return;
  if (isPendingValue(v)) {
    out.push(`${"  ".repeat(depth)}(loading ${v.path})`);
    return;
  }
  const t = toText(v);
  if (t) out.push(`${"  ".repeat(depth)}${t.length > 160 ? `${t.slice(0, 157)}...` : t}`);
}

function describe(spec: ComponentSpec, props: Record<string, unknown>): string {
  const bits: string[] = [];
  for (const key of ["title", "label", "name", "value", "type", "status", "path", "command"]) {
    const v = props[key];
    if (v == null || typeof v === "object" || typeof v === "function") continue;
    bits.push(`${key}: ${String(v).slice(0, 60)}`);
  }
  for (const key of ["rows", "data", "items", "steps", "options", "values", "results", "events", "tasks", "parts"]) {
    const v = props[key];
    if (Array.isArray(v)) bits.push(`${v.length} ${key}`);
    else if (isPendingValue(v)) bits.push(`${key} loading`);
  }
  return `${spec.name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** A brushed Chart's range over its first two x values, as the view writes it. */
function brushVariant(props: Record<string, unknown>): { from: unknown; to: unknown; xs: unknown[] }[] {
  let xs: unknown[] = [];
  if (Array.isArray(props.values)) xs = Array.isArray(props.labels) ? props.labels : props.values.map((_, k) => k + 1);
  else if (Array.isArray(props.data)) {
    const rows = props.data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    const x = typeof props.x === "string" ? props.x : rows[0] ? Object.keys(rows[0])[0] : "x";
    xs = rows.map((r) => r[x]);
  }
  return xs.length > 1 ? [{ from: xs[0], to: xs[1], xs: xs.slice(0, 2) }] : [];
}

/** Each input's extremes, one variant per value, capped. */
function inputVariants(program: Program, rt: CardRuntime): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind !== "element") continue;
      const spec = findComponent(n.name);
      const bind = n.attrs.find((a) => a.name === "bind");
      if (spec && bind?.value?.t === "lit" && typeof bind.value.v === "string") {
        const name = bind.value.v;
        const { props } = rt.props(n, rt.globals);
        switch (spec.name) {
          case "Slider":
          case "Stepper":
          case "Rating": {
            const min = Number(props.min ?? (spec.name === "Rating" ? 1 : 0));
            const max = Number(props.max ?? (spec.name === "Rating" ? 5 : spec.name === "Slider" ? 100 : min + 10));
            if (Number.isFinite(min)) out.push({ [name]: min });
            if (Number.isFinite(max)) out.push({ [name]: max });
            break;
          }
          case "Toggle":
            out.push({ [name]: true }, { [name]: false });
            break;
          case "Segmented":
          case "Select":
          case "Radio":
            if (Array.isArray(props.options)) for (const o of props.options.slice(0, 8)) out.push({ [name]: typeof o === "object" && o ? (o as { value?: unknown }).value ?? (o as { label?: unknown }).label : o });
            break;
          case "Checklist":
            out.push({ [name]: [] });
            if (Array.isArray(props.options)) out.push({ [name]: props.options.map((o) => (typeof o === "object" && o ? (o as { value?: unknown }).value ?? (o as { label?: unknown }).label : o)) });
            break;
          case "Input":
          case "TextArea":
            out.push({ [name]: "" });
            break;
          case "Chart":
            if (props.brush === true) out.push({ [name]: null }, ...brushVariant(props).map((v) => ({ [name]: v })));
            break;
          case "Board":
            out.push({ [name]: arrangement(normalizeKanban(props.items, props.columns).board) });
            break;
        }
      }
      visit(n.children);
    }
  };
  visit(program.nodes);
  return out.slice(0, 40);
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  if (report.ok && report.issues.length === 0) lines.push("No problems found.");
  for (const i of report.issues) {
    lines.push(`${i.severity === "error" ? "Error" : "Warning"} at line ${i.line}:${i.col}: ${i.message}${i.when ? ` (when ${i.when})` : ""}`);
  }
  if (report.outline) lines.push("", "What the person will see:", report.outline);
  return lines.join("\n");
}
