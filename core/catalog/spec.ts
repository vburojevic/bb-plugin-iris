// One catalog drives everything about a component: the validator, the agent's
// prompt, the iris_docs tool, the gallery and the renderer lookup. A component
// that is not here does not exist.

export type PropType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "list"
  | "object"
  | "any"
  | "element"
  | "handler"
  | "icon"
  | "format"
  | "tone"
  | "color"
  | "state";

export interface PropSpec {
  type: PropType;
  doc: string;
  values?: readonly string[];
  required?: boolean;
  def?: string | number | boolean;
  /** For lists and objects: the item shape, in prompt notation. */
  shape?: string;
}

export type ChildrenKind = "none" | "nodes" | "text" | "markdown" | "raw";

export interface ComponentSpec {
  name: string;
  group: Group;
  summary: string;
  props: Record<string, PropSpec>;
  children: ChildrenKind;
  childrenDoc?: string;
  /** A short working example; the gallery renders it and tests compile it. */
  example: string;
  /** Other names agents reach for; they resolve to this component. */
  aliases?: string[];
  /** Loaded on demand (a chunk) rather than in the main bundle. */
  heavy?: boolean;
  /** Function props check() calls once with these sample arguments, e.g. { animate: [0] }. */
  calls?: Record<string, unknown[]>;
}

export const GROUPS = [
  "Layout",
  "Content",
  "Data",
  "Charts",
  "Diagrams",
  "Code",
  "Project",
  "Evidence",
  "Planning",
  "Inputs",
  "Pickers",
  "Media",
  "Design",
  "Math",
  "Live",
  "Learning",
  "Graphics",
  "Sheets",
  "API",
  "Review",
  "Terminal",
  "Whiteboard",
  "Localization",
  "Files",
  "Compute",
  "Time",
  "Release",
  "Accessibility",
  "Geo",
  "Tracking",
] as const;
export type Group = (typeof GROUPS)[number];

export const TONES = ["neutral", "info", "good", "warn", "bad"] as const;

// Builders keep the catalog files short and uniform.
export const p = {
  str: (doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "string", doc, ...extra }),
  num: (doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "number", doc, ...extra }),
  bool: (doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "boolean", doc, ...extra }),
  oneOf: (values: readonly string[], doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "enum", values, doc, ...extra }),
  list: (doc: string, shape?: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "list", doc, shape, ...extra }),
  obj: (doc: string, shape?: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "object", doc, shape, ...extra }),
  any: (doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "any", doc, ...extra }),
  el: (doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "element", doc, ...extra }),
  on: (doc: string, extra: Partial<PropSpec> = {}): PropSpec => ({ type: "handler", doc, ...extra }),
  icon: (doc = "A Lucide icon name, e.g. \"rocket\"", extra: Partial<PropSpec> = {}): PropSpec => ({ type: "icon", doc, ...extra }),
  fmt: (doc = "How numbers read", extra: Partial<PropSpec> = {}): PropSpec => ({ type: "format", doc, ...extra }),
  tone: (doc = "Color meaning", extra: Partial<PropSpec> = {}): PropSpec => ({ type: "tone", values: TONES, doc, ...extra }),
  bind: (doc = "Name of the <state> this input reads and writes", extra: Partial<PropSpec> = {}): PropSpec => ({
    type: "state",
    doc,
    required: true,
    ...extra,
  }),
};

export function component(spec: ComponentSpec): ComponentSpec {
  return spec;
}
