// Localization review rules that need no browser: reading .xcstrings, .strings,
// .po and JSON files into one table of keys by locale, and flagging what a
// translator or a release would trip on (missing, untranslated, needs review,
// placeholder mismatches, likely truncation).

export const ISSUE_KINDS = ["missing", "untranslated", "review", "placeholders", "long"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export interface StringEntry {
  value: string | null;
  /** The source text the file itself carries (.po msgid, an .xcstrings key). */
  src?: string;
  /** Marked fuzzy (.po) or needs_review / new (.xcstrings). */
  review?: boolean;
  plural?: boolean;
  comment?: string;
}

export interface StringsTable {
  source: string;
  locales: string[];
  keys: string[];
  entries: Record<string, Map<string, StringEntry>>;
  comments: Map<string, string>;
}

// ---------- Readers ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function isXcstrings(v: unknown): v is { sourceLanguage: string; strings: Record<string, unknown> } {
  return isObj(v) && typeof v.sourceLanguage === "string" && isObj(v.strings);
}

function unitValue(loc: unknown): { value: string | null; review: boolean; plural: boolean } {
  if (!isObj(loc)) return { value: null, review: false, plural: false };
  const unit = isObj(loc.stringUnit) ? loc.stringUnit : null;
  if (unit) {
    const state = typeof unit.state === "string" ? unit.state : "translated";
    return { value: typeof unit.value === "string" ? unit.value : null, review: state === "needs_review" || state === "new", plural: false };
  }
  const variations = isObj(loc.variations) ? loc.variations : null;
  if (variations) {
    // A plural or device variation: read its "other" form (or the first one).
    for (const kind of Object.values(variations)) {
      if (!isObj(kind)) continue;
      const pick = kind.other ?? Object.values(kind)[0];
      const r = unitValue(pick);
      return { ...r, plural: true };
    }
  }
  return { value: null, review: false, plural: false };
}

/** A String Catalog: every locale from one file. */
export function readXcstrings(doc: { sourceLanguage: string; strings: Record<string, unknown> }): StringsTable {
  const source = doc.sourceLanguage;
  const entries: Record<string, Map<string, StringEntry>> = Object.create(null);
  entries[source] = new Map();
  const comments = new Map<string, string>();
  const keys: string[] = [];
  for (const [key, raw] of Object.entries(doc.strings)) {
    if (!isObj(raw) || raw.shouldTranslate === false) continue;
    keys.push(key);
    if (typeof raw.comment === "string") comments.set(key, raw.comment);
    const locs = isObj(raw.localizations) ? raw.localizations : {};
    // With no source localization, the key is the source text.
    const src = unitValue(locs[source]);
    entries[source].set(key, { value: src.value ?? key, plural: src.plural });
    for (const [locale, loc] of Object.entries(locs)) {
      if (locale === source) continue;
      const map = (entries[locale] ??= new Map());
      const u = unitValue(loc);
      map.set(key, { value: u.value, review: u.review, plural: u.plural });
    }
  }
  return { source, locales: Object.keys(entries), keys, entries, comments };
}

/** Apple .strings: "key" = "value"; with comments. */
export function parseDotStrings(text: string): { map: Map<string, StringEntry>; error: string | null } {
  const map = new Map<string, StringEntry>();
  let i = 0;
  let comment: string | undefined;
  const n = text.length;
  const lineAt = (k: number) => text.slice(0, k).split("\n").length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        comment = text.slice(i + 2, end < 0 ? n : end).trim();
        i = end < 0 ? n : end + 2;
      } else if (text.startsWith("//", i)) {
        const end = text.indexOf("\n", i);
        comment = text.slice(i + 2, end < 0 ? n : end).trim();
        i = end < 0 ? n : end + 1;
      } else return;
    }
  };
  const word = (): string | null => {
    if (text[i] === '"') {
      let out = "";
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          const c = text[i + 1];
          if (c === "U" || c === "u") {
            const hex = /^[0-9a-fA-F]{4}/.exec(text.slice(i + 2))?.[0];
            if (hex) {
              out += String.fromCharCode(parseInt(hex, 16));
              i += 6;
              continue;
            }
          }
          out += c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c;
          i += 2;
        } else out += text[i++];
      }
      if (i >= n) return null;
      i++;
      return out;
    }
    const m = /^[\w.\-$:/]+/.exec(text.slice(i, i + 400));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  for (;;) {
    skip();
    if (i >= n) break;
    const at = i;
    const note = comment;
    comment = undefined;
    const key = word();
    skip();
    if (key === null || text[i] !== "=") return { map, error: `.strings line ${lineAt(at)}: expected "key" = "value";` };
    i++;
    skip();
    const value = word();
    skip();
    if (value === null || text[i] !== ";") return { map, error: `.strings line ${lineAt(at)}: expected "key" = "value";` };
    i++;
    map.set(key, { value, comment: note });
  }
  return { map, error: null };
}

/** gettext .po: msgid is the key and the source text; msgstr the translation. */
export function parsePo(text: string): { map: Map<string, StringEntry>; error: string | null } {
  const map = new Map<string, StringEntry>();
  const unquote = (s: string) => {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  };
  type Entry = { ctxt?: string; id?: string; plural?: string; strs: string[]; fuzzy: boolean; comment?: string };
  let cur: Entry = { strs: [], fuzzy: false };
  let field: { set: (s: string) => void } | null = null;
  const flush = () => {
    if (cur.id !== undefined && cur.id !== "") {
      const key = cur.ctxt ? `${cur.ctxt} | ${cur.id}` : cur.id;
      const forms = cur.strs.filter((s) => s !== undefined);
      const value = cur.plural ? (forms[forms.length - 1] ?? "") : (forms[0] ?? "");
      map.set(key, { value: value === "" ? null : value, src: cur.plural ?? cur.id, review: cur.fuzzy, plural: !!cur.plural, comment: cur.comment });
    }
    cur = { strs: [], fuzzy: false };
    field = null;
  };
  const lines = text.split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("#,")) {
      if (cur.id !== undefined && cur.strs.length) flush();
      if (/\bfuzzy\b/.test(line)) cur.fuzzy = true;
      continue;
    }
    if (line.startsWith("#.")) {
      if (cur.id !== undefined && cur.strs.length) flush();
      cur.comment = (cur.comment ? `${cur.comment} ` : "") + line.slice(2).trim();
      continue;
    }
    if (line.startsWith("#")) continue;
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")$/.exec(line);
    if (m) {
      const [, kw, idx, q] = m;
      if ((kw === "msgid" || kw === "msgctxt") && cur.strs.length) flush();
      const s = unquote(q);
      if (kw === "msgctxt") field = { set: (x) => (cur.ctxt = (cur.ctxt ?? "") + x) };
      else if (kw === "msgid") field = { set: (x) => (cur.id = (cur.id ?? "") + x) };
      else if (kw === "msgid_plural") field = { set: (x) => (cur.plural = (cur.plural ?? "") + x) };
      else {
        const at = idx ? Number(idx) : 0;
        cur.strs[at] = "";
        field = { set: (x) => (cur.strs[at] += x) };
      }
      field.set(s);
      continue;
    }
    if (line.startsWith('"') && field) {
      field.set(unquote(line));
      continue;
    }
    return { map, error: `.po line ${k + 1}: can't read "${line.slice(0, 40)}"` };
  }
  flush();
  return { map, error: null };
}

/** Nested or flat JSON (i18next, ARB, Chrome messages.json) as dotted keys. */
export function flattenJson(v: unknown, prefix = "", out = new Map<string, StringEntry>(), depth = 0): Map<string, StringEntry> {
  if (!isObj(v) || depth > 32) return out;
  for (const [k, x] of Object.entries(v)) {
    if (k.startsWith("@")) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof x === "string") out.set(key, { value: x });
    else if (typeof x === "number" || typeof x === "boolean") out.set(key, { value: String(x) });
    else if (isObj(x) && typeof x.message === "string") out.set(key, { value: x.message, comment: typeof x.description === "string" ? x.description : undefined });
    else if (Array.isArray(x)) x.forEach((y, j) => (typeof y === "string" ? out.set(`${key}.${j}`, { value: y }) : flattenJson(y, `${key}.${j}`, out, depth + 1)));
    else flattenJson(x, key, out, depth + 1);
  }
  return out;
}

/** One locale's file, whatever it is: .strings or .po text, or JSON. */
export function readLocaleFile(v: unknown): { map: Map<string, StringEntry>; error: string | null } {
  if (typeof v === "string") {
    if (/^[ \t]*msgid[ \t]+"/m.test(v)) return parsePo(v);
    if (/"\s*=\s*"/.test(v) || !v.trim()) return parseDotStrings(v);
    const t = v.trim();
    if (t.startsWith("{")) {
      try {
        return { map: flattenJson(JSON.parse(t)), error: null };
      } catch {
        // Fall through.
      }
    }
    return { map: new Map(), error: "not a .strings, .po or JSON file" };
  }
  if (isObj(v)) return { map: flattenJson(v), error: null };
  return { map: new Map(), error: "not a .strings, .po or JSON file" };
}

/**
 * Builds the table from what the agent passed: one .xcstrings catalog, or
 * locale → file. The source locale is the catalog's, the one named, "en" if
 * present, or the first.
 */
export function readStrings(input: unknown, opts: { source?: string; locales?: string[] } = {}): { table: StringsTable; problems: string[] } {
  const problems: string[] = [];
  let table: StringsTable;
  if (isXcstrings(input)) table = readXcstrings(input);
  else if (isObj(input)) {
    const files = Object.entries(input);
    // No prototype: locale names come from files ("__proto__", "constructor").
    const entries: Record<string, Map<string, StringEntry>> = Object.create(null);
    const comments = new Map<string, string>();
    for (const [locale, file] of files) {
      if (isXcstrings(file)) {
        const t = readXcstrings(file);
        for (const [l, m] of Object.entries(t.entries)) entries[l] = m;
        for (const [k, c] of t.comments) comments.set(k, c);
        continue;
      }
      const { map, error } = readLocaleFile(file);
      if (error) problems.push(`${locale}: ${error}`);
      entries[locale] = map;
      for (const [k, e] of map) if (e.comment && !comments.has(k)) comments.set(k, e.comment);
    }
    const locales = Object.keys(entries);
    // Every file a .po: they carry the source text, so none of them is the source.
    const allPo = locales.length > 0 && locales.every((l) => [...entries[l].values()].some((e) => e.src !== undefined));
    const source = opts.source ?? (locales.includes("en") ? "en" : allPo ? "en" : (locales[0] ?? "en"));
    table = { source, locales, keys: [], entries, comments };
  } else {
    return { table: { source: "en", locales: [], keys: [], entries: {}, comments: new Map() }, problems: ["strings must be an .xcstrings catalog or { locale: file }"] };
  }
  if (opts.source && opts.source !== table.source && table.entries[opts.source]) table.source = opts.source;
  else if (opts.source && !table.entries[opts.source] && isXcstrings(input)) problems.push(`No strings for source locale ${opts.source}`);
  // A .po locale with no source file still knows its source text.
  if (!table.entries[table.source]) {
    const derived = new Map<string, StringEntry>();
    for (const m of Object.values(table.entries)) for (const [k, e] of m) if (e.src !== undefined && !derived.has(k)) derived.set(k, { value: e.src });
    if (!derived.size) problems.push(`No file for source locale ${table.source}`);
    table.entries[table.source] = derived;
    table.locales = [table.source, ...table.locales];
  }
  const keys = new Set(table.keys);
  for (const k of table.entries[table.source].keys()) keys.add(k);
  for (const m of Object.values(table.entries)) for (const k of m.keys()) keys.add(k);
  table.keys = [...keys];
  const order = opts.locales?.length ? opts.locales.filter((l) => l !== table.source) : table.locales.filter((l) => l !== table.source);
  for (const l of opts.locales ?? []) if (!table.entries[l]) problems.push(`No file for locale ${l}`);
  table.locales = [table.source, ...order.filter((l) => table.entries[l])];
  return { table, problems };
}

// ---------- Checks ----------

// Flags, width and precision can't overlap (a zero is a flag, a width starts at 1-9), so a long
// run of digits or flags is read once instead of backtracking.
const PRINTF = /%(?:([1-9]\d{0,2})\$)?[-+#0]{0,4}(?:[1-9]\d{0,4}|\*)?(?:\.(?:\d{1,5}|\*))?(?:hh|h|ll|l|q|L|z|j|t)?([@dDiuUxXoOfFeEgGcCsSpaA%])/g;
const NAMED = /\{\{\s*([\w.]+)\s*\}\}|\{([\w.]+)\s*(?=[},])/g;

/** Placeholders as a sorted list: printf types (%1$@ reads as %@) and {named} ones. */
export function placeholders(s: string): string[] {
  const out: string[] = [];
  for (const m of s.slice(0, 20_000).matchAll(PRINTF)) {
    const t = m[2];
    if (t === "%") continue;
    const kind = /[diuUD]/.test(t) ? "d" : /[fFeEgGaA]/.test(t) ? "f" : /[sS@]/.test(t) ? "@" : t;
    out.push(`%${kind}`);
  }
  for (const m of s.matchAll(NAMED)) out.push(`{${m[1] ?? m[2]}}`);
  return out.sort();
}

function diffPlaceholders(src: string[], got: string[]): string {
  const left = [...got];
  const missing: string[] = [];
  for (const p of src) {
    const k = left.indexOf(p);
    if (k < 0) missing.push(p);
    else left.splice(k, 1);
  }
  return [missing.length ? `missing ${missing.join(" ")}` : "", left.length ? `extra ${left.join(" ")}` : ""].filter(Boolean).join(", ");
}

export const length = (s: string) => Array.from(s).length;

export interface CellIssue {
  kind: IssueKind;
  detail: string;
}

export interface StringsCell {
  value: string | null;
  issues: CellIssue[];
  plural?: boolean;
}

export interface StringsRow {
  key: string;
  source: string | null;
  comment?: string;
  cells: Record<string, StringsCell>;
  issues: number;
}

export interface LocaleSummary {
  locale: string;
  total: number;
  translated: number;
  counts: Record<IssueKind, number>;
}

export interface CheckOptions {
  /** Flag a translation longer than source × growth (and at least 8 characters longer). */
  growth?: number;
  /** Most characters any value may take, or per key. */
  limits?: number | Record<string, number>;
  /** Keys whose value may equal the source (brand names, "OK"). */
  same?: string[];
}

function limitFor(limits: CheckOptions["limits"], key: string): number | null {
  if (typeof limits === "number" && limits > 0) return limits;
  if (isObj(limits) && typeof limits[key] === "number") return limits[key] as number;
  return null;
}

export function reviewStrings(table: StringsTable, opts: CheckOptions = {}): { rows: StringsRow[]; summary: LocaleSummary[] } {
  const growth = opts.growth && opts.growth > 1 ? opts.growth : 1.5;
  const same = new Set(opts.same ?? []);
  const src = table.entries[table.source] ?? new Map<string, StringEntry>();
  const targets = table.locales.filter((l) => l !== table.source);
  const summary: LocaleSummary[] = targets.map((locale) => ({ locale, total: 0, translated: 0, counts: { missing: 0, untranslated: 0, review: 0, placeholders: 0, long: 0 } }));
  const rows: StringsRow[] = table.keys.map((key) => {
    const s = src.get(key)?.value ?? null;
    const sp = s === null ? [] : placeholders(s);
    const limit = limitFor(opts.limits, key);
    const cells: Record<string, StringsCell> = {};
    let count = 0;
    if (s !== null) cells[table.source] = { value: s, issues: limit !== null && length(s) > limit ? [{ kind: "long", detail: `${length(s)} of ${limit} characters` }] : [], plural: src.get(key)?.plural };
    targets.forEach((locale, k) => {
      const e = table.entries[locale]?.get(key);
      const v = e?.value ?? null;
      const issues: CellIssue[] = [];
      if (s !== null) {
        summary[k].total++;
        if (v === null || v.trim() === "") issues.push({ kind: "missing", detail: e ? "empty" : "no entry" });
        else {
          const letters = /\p{L}{2}/u.test(s);
          if (v.trim() === s.trim() && letters && !same.has(key)) issues.push({ kind: "untranslated", detail: "same as source" });
          if (e?.review) issues.push({ kind: "review", detail: "marked for review" });
          const d = diffPlaceholders(sp, placeholders(v));
          if (d) issues.push({ kind: "placeholders", detail: d });
          const lv = length(v);
          const ls = length(s);
          if (limit !== null && lv > limit) issues.push({ kind: "long", detail: `${lv} of ${limit} characters` });
          else if (limit === null && lv > ls * growth && lv - ls >= 8) issues.push({ kind: "long", detail: `+${Math.round((lv / ls - 1) * 100)}% longer` });
        }
        if (!issues.some((x) => x.kind === "missing" || x.kind === "untranslated")) summary[k].translated++;
        for (const x of issues) summary[k].counts[x.kind]++;
      }
      count += issues.length;
      cells[locale] = { value: v, issues, plural: e?.plural };
    });
    return { key, source: s, comment: table.comments.get(key), cells, issues: count };
  });
  return { rows, summary };
}
