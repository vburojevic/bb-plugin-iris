// Runs inside the sandboxed iris-react frame, inlined into its srcdoc by the
// parent. It brings the frame's own React, the kit the app imports from
// "iris", a require() for the compiled module, and error reports with the
// app's own line numbers. The parent never runs any of this.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as Kit from "./kit";
import { MODULES } from "../../core/react-kit";

/** The name the app's script carries, so stack frames point at its lines. */
const FILE = "iris-app.tsx";

const esm = (ns: object, def?: unknown) => Object.freeze({ ...ns, default: def ?? ns, __esModule: true });
const irisModule = esm({
  Card: Kit.Card, Row: Kit.Row, Stack: Kit.Stack, Grid: Kit.Grid, Text: Kit.Text, Badge: Kit.Badge, Icon: Kit.Icon, Metric: Kit.Metric, Callout: Kit.Callout,
  Progress: Kit.Progress, Table: Kit.Table, Chart: Kit.Chart, Button: Kit.Button, Slider: Kit.Slider, Toggle: Kit.Toggle, Input: Kit.Input, Select: Kit.Select,
  Segmented: Kit.Segmented, Tabs: Kit.Tabs, useStored: Kit.useStored, useTheme: Kit.useTheme, fmt: Kit.fmt, iris: Kit.iris,
});
const registry: Record<string, unknown> = {
  react: esm(React, React),
  "react/jsx-runtime": esm(JSXRuntime),
  "react/jsx-dev-runtime": esm(JSXRuntime),
  "react-dom": esm(ReactDOM, ReactDOM),
  "react-dom/client": esm(ReactDOMClient, ReactDOMClient),
  iris: irisModule,
  "lucide-react": Kit.lucideReact,
};

function requireModule(name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(registry, name)) return registry[name];
  throw new Error(`"${name}" isn't available: an iris-react app can import only ${MODULES.filter((x) => !x.includes("/")).join(", ")}`);
}

// Forgiving globals: an app that forgot to import React or a hook still runs.
// Kit names stay imports only: some (Text) are already DOM globals and would fail confusingly.
const g = window as unknown as Record<string, unknown>;
g.React = React;
for (const k of ["useState", "useEffect", "useMemo", "useRef", "useCallback", "useReducer", "useLayoutEffect", "useId", "useTransition", "useDeferredValue", "Fragment"] as const) g[k] ??= React[k];

// ---------- errors ----------

// Production React ships error codes, not text. The ones apps hit most:
const REACT_ERRORS: Record<string, string> = {
  "31": "Objects are not valid as a React child (found: %s). Render a string, a number or elements; map an object to elements first.",
  "130": "A component is undefined or not a component (got: %s). Check its import: \"iris\" exports only the kit's names.",
  "185": "Maximum update depth exceeded: a state update runs on every render, or in an effect without the right dependencies.",
  "300": "Rendered fewer hooks than expected: a hook is called conditionally or after an early return.",
  "310": "Rendered more hooks than during the previous render: a hook is called conditionally.",
  "321": "Invalid hook call: hooks run only at the top of a function component.",
};

function messageOf(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(/^Failed to execute '[^']+' on '[^']+': /, "");
  const m = /Minified React error #(\d+);[^?]*\?([^ ]*)/.exec(raw);
  if (!m) return error instanceof Error && error.name && error.name !== "Error" ? `${error.name}: ${raw}` : raw;
  const args = new URLSearchParams(m[2]).getAll("args[]");
  const text = REACT_ERRORS[m[1]];
  if (!text) return `React error #${m[1]}${args.length ? ` (${args.join(", ")})` : ""}`;
  let k = 0;
  return text.replace(/%s/g, () => args[k++] ?? "?");
}

const frameLine = new RegExp(`${FILE.replace(".", "\\.")}:(\\d+)(?::(\\d+))?`);
function lineOf(...stacks: (string | null | undefined)[]): number | undefined {
  for (const s of stacks) {
    const m = s ? frameLine.exec(s) : null;
    if (m) return Number(m[1]);
  }
  return undefined;
}

let reported = 0;
function report(error: unknown, extra?: { stack?: string | null; line?: number }) {
  if (reported++ > 20) return;
  const stack = error instanceof Error ? error.stack : undefined;
  Kit.post("app-error", { message: messageOf(error).slice(0, 2000), line: extra?.line ?? lineOf(stack, extra?.stack) });
}

/** True while the app's script is being inserted: an error then is its parse error, numbered from its own first line. */
let inserting = false;
addEventListener("error", (e) => {
  const line = (inserting || (typeof e.filename === "string" && e.filename.endsWith(FILE))) && e.lineno ? e.lineno : undefined;
  report(e.error ?? e.message, { line });
});
addEventListener("unhandledrejection", (e) => report(e.reason));

addEventListener("message", (e) => {
  if (e.source !== parent || !e.data || typeof e.data !== "object") return;
  const d = e.data as { __irisTheme?: unknown; __irisIcon?: { key?: unknown; node?: unknown } };
  if (d.__irisTheme) requestAnimationFrame(Kit.themeChanged);
  if (d.__irisIcon) Kit.receiveIcon(d.__irisIcon.key, d.__irisIcon.node);
});

// ---------- run and mount ----------

type Factory = (require: (name: string) => unknown, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void;

function isComponent(v: unknown): v is React.ComponentType {
  return typeof v === "function" || (typeof v === "object" && v !== null && "$$typeof" in v);
}

function mount(factory: Factory) {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  try {
    factory(requireModule, module, module.exports);
  } catch (error) {
    report(error);
    return;
  }
  const ex = module.exports;
  const functions = Object.entries(ex).filter(([k, v]) => k !== "__esModule" && isComponent(v));
  const App = (isComponent(ex.default) ? ex.default : isComponent(ex.App) ? ex.App : functions.length === 1 ? functions[0][1] : null) as React.ComponentType | null;
  if (!App) {
    report(new Error("The module has no default export. End it with: export default function App() { ... }"));
    return;
  }
  const el = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  const root = ReactDOMClient.createRoot(el, { onUncaughtError: (error) => report(error) });
  root.render(
    <Kit.Boundary onError={(error, stack) => report(error, { stack })}>
      <App />
    </Kit.Boundary>,
  );
}

g.__irisMount = mount;
/** Runs the compiled module as its own inline script, named so its stack frames carry the app's lines. */
g.__irisRun = (code: string) => {
  const s = document.createElement("script");
  s.textContent = `__irisMount(function (require, module, exports) {${code}\n});\n//# sourceURL=${FILE}`;
  inserting = true;
  try {
    document.body.appendChild(s);
  } finally {
    inserting = false;
  }
};
