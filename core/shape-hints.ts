// A Table or Gallery whose data has the shape of a more specific component: before and after values
// (Delta), checks with results (Acceptance), review notes (Findings), colors (Swatches, Variants),
// screenshots by device or theme (Screens), before and after shots (Compare, CompareGrid). Each hint
// names the component and a rewrite built from the card's own column names. Warnings only: a Table
// is never wrong, just often not the best card.

type Col = { key: string; words: string[] };

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|var\(--)/i;

const BEFORE = new Set(["before", "old", "was", "baseline", "previous", "prev"]);
const AFTER = new Set(["after", "new", "now"]);
const CHECK = new Set(["check", "criterion", "criteria", "requirement", "requirements", "acceptance", "claim"]);
const RESULT = new Set(["result", "outcome", "verdict", "pass", "passed"]);
/** A status column counts as a result only when its values read as pass or fail. */
const STATUS = new Set(["status", "state"]);
const PASS_FAIL = /^(pass(ed)?|fail(ed)?|ok|blocked|untested|claimed|yes|no|done|missing)$/i;
const BASIS = new Set(["basis", "evidence", "proof", "how", "source", "note", "notes"]);
const SEVERITY = new Set(["severity", "sev"]);
/** Priority or impact reads as a severity only beside a file or location column. */
const LOOSE_SEVERITY = new Set(["priority", "impact"]);
const WHERE = new Set(["where", "file", "location", "path", "line", "place"]);
const WHAT = new Set(["what", "issue", "finding", "problem", "bug"]);
const COLOR_COL = new Set(["color", "colour", "hex", "background", "bg", "accent", "foreground", "fg", "swatch", "tint"]);
const OPTION_COL = new Set(["palette", "option", "direction", "variant", "scheme", "concept"]);
/** Words in a caption or file name that mark a device, theme or locale column. */
const DEVICE = /\b(iphone|ipad|mac|macos|ios|android|desktop|phone|mobile|tablet|light|dark|high contrast|rtl|ltr|portrait|landscape)\b/gi;
const BEFORE_AFTER = /\b(before|after|baseline)\b/i;

function columns(props: Record<string, unknown>): Col[] {
  const out: Col[] = [];
  const add = (key: string, label?: string) => {
    const words = `${key} ${label ?? ""}`
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    out.push({ key, words });
  };
  if (Array.isArray(props.columns) && props.columns.length) {
    for (const c of props.columns) {
      if (typeof c === "string") add(c);
      else if (c && typeof c === "object" && typeof (c as { key?: unknown }).key === "string") add((c as { key: string }).key, typeof (c as { label?: unknown }).label === "string" ? (c as { label: string }).label : undefined);
    }
    return out;
  }
  const first = Array.isArray(props.rows) ? props.rows.find((r) => r && typeof r === "object" && !Array.isArray(r)) : null;
  if (first) for (const k of Object.keys(first as object)) add(k);
  return out;
}

const find = (cols: Col[], set: Set<string>, not?: Col[]) => cols.find((c) => !not?.includes(c) && c.words.some((w) => set.has(w)));
const field = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `r.${key}` : `r[${JSON.stringify(key)}]`);
const rowsOf = (props: Record<string, unknown>) => (Array.isArray(props.rows) ? props.rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r)) : []);
const mostly = (values: unknown[], test: (v: string) => boolean) => values.length > 0 && values.filter((v) => typeof v === "string" && test(v.trim())).length >= Math.ceil(values.length / 2);

function tableHint(props: Record<string, unknown>): string | null {
  const cols = columns(props);
  if (cols.length < 2) return null;
  const rows = rowsOf(props);
  const values = (c: Col) => rows.slice(0, 20).map((r) => r[c.key]);
  const label = (except: Col[]) => cols.find((c) => !except.includes(c));
  const names = cols.map((c) => c.key).join(", ");

  const before = find(cols, BEFORE);
  const after = before ? find(cols, AFTER, [before]) : undefined;
  if (before && after) {
    if (mostly(values(before), (v) => IMAGE.test(v))) {
      const lab = label([before, after]);
      return `holds before and after screenshots (${names}): <CompareGrid pairs={rows.map((r) => ({ ref: ${field(before.key)}, cand: ${field(after.key)}${lab ? `, label: ${field(lab.key)}` : ""} }))} /> shows each pair with its changed pixels, and <Compare images={[before, after]} /> one pair with a wipe.`;
    }
    const lab = label([before, after]);
    return `reads as before and after (${names}): <Delta rows={rows.map((r) => ({ label: ${lab ? field(lab.key) : '"?"'}, before: ${field(before.key)}, after: ${field(after.key)} }))} /> adds each change and its percent; give better="up" or "down" (per row or for all) when you know which way is good, and it tallies better and worse.`;
  }

  const strict = find(cols, SEVERITY);
  const sev = strict ?? find(cols, LOOSE_SEVERITY);
  const where = find(cols, WHERE, sev ? [sev] : []);
  const what = find(cols, WHAT, [sev, where].filter(Boolean) as Col[]);
  if (sev && (strict ? where || what : where)) {
    const parts = [`severity: ${field(sev.key)}`, what ? `title: ${field(what.key)}` : "", where ? `file: ${field(where.key)}` : ""].filter(Boolean).join(", ");
    return `reads as review findings (${names}): <Findings items={rows.map((r) => ({ ${parts} }))} /> groups them by severity, with file, line and fix.`;
  }

  const crit = find(cols, CHECK);
  const status = crit ? find(cols, STATUS, [crit]) : undefined;
  const result = crit ? (find(cols, RESULT, [crit]) ?? (status && mostly(values(status), (v) => PASS_FAIL.test(v)) ? status : undefined)) : undefined;
  if (crit && result) {
    const basis = find(cols, BASIS, [crit, result]);
    return `reads as acceptance checks (${names}): <Acceptance criteria={rows.map((r) => ({ name: ${field(crit.key)}, status: ${field(result.key)}${basis ? `, note: ${field(basis.key)}` : ""} }))} /> gives the verdict, with status passed, failed, blocked, untested or claimed.`;
  }

  const colorCols = cols.filter((c) => c.words.some((w) => COLOR_COL.has(w)) || mostly(values(c), (v) => COLOR.test(v)));
  if (colorCols.length >= 2 || (colorCols.length === 1 && mostly(values(colorCols[0]), (v) => COLOR.test(v)))) {
    const option = find(cols, OPTION_COL, colorCols);
    if (option && rows.length > 1)
      return `holds color options (${names}): to choose one, <Variants bind="pick"> with a <Variant value={...} label={...} colors={[...]}> per ${option.key}, each holding <Swatches>; to show contrast, <Swatches colors={[...]} backgrounds={[...]} />. iris_examples(["Recipes"]) has a Variants picker.`;
    return `holds colors (${names}): <Swatches colors={[{ name, value }]} backgrounds={[{ name, value }]} /> draws each with its WCAG contrast on every background.`;
  }
  return null;
}

function galleryHint(props: Record<string, unknown>): string | null {
  if (!Array.isArray(props.images) || props.images.length < 2) return null;
  const texts = props.images.map((im) => {
    if (typeof im === "string") return im.split("/").pop() ?? im;
    if (im && typeof im === "object") {
      const o = im as { src?: unknown; caption?: unknown; alt?: unknown };
      return [o.caption, o.alt, typeof o.src === "string" && !o.src.startsWith("data:") ? o.src.split("/").pop() : ""].filter((x) => typeof x === "string").join(" ");
    }
    return "";
  });
  const words = (re: RegExp) => texts.filter((t) => re.test(t.replace(/[-_.]/g, " "))).length;
  if (words(BEFORE_AFTER) >= Math.ceil(texts.length / 2))
    return `shows before and after shots: <Compare images={[before, after]} /> puts one pair under a draggable wipe with changed pixels counted, and <CompareGrid pairs={[{ ref, cand, label }]} /> (or folders={{ ref, cand }}) lays out many.`;
  // Two different device or theme words across the set (iPhone and iPad, light and dark), not one word that happens to match.
  const tokens = new Set(texts.flatMap((t) => [...t.replace(/[-_.]/g, " ").matchAll(DEVICE)].map((m) => m[0].toLowerCase())));
  if (tokens.size >= 2 && words(new RegExp(DEVICE.source, "i")) >= Math.ceil(texts.length / 2))
    return `captions name devices, themes or locales: <Screens shots={[{ screen: "Home", column: "Dark", src }]} /> puts one row per screen and one column per device or theme, so a missing shot shows.`;
  return null;
}

/** A rewrite hint for a component whose data fits a more specific one, or null. */
export function shapeHint(name: string, props: Record<string, unknown>): string | null {
  if (name === "Table" || name === "DataGrid") return tableHint(props);
  if (name === "Gallery") return galleryHint(props);
  return null;
}
