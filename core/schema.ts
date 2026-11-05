// Database schemas read from the text agents have: SQL CREATE TABLE (Postgres,
// MySQL, SQLite), a Prisma schema, or a Convex schema.ts. Every parser is a
// small hand-written scanner; nothing is evaluated. ErDiagram draws the result.

import { toText } from "./evaluate";

export interface ErColumn {
  name: string;
  type: string;
  pk?: boolean;
  nullable?: boolean;
  unique?: boolean;
  indexed?: boolean;
  /** The column this one points at. */
  fk?: { table: string; column: string };
}

export interface ErTable {
  name: string;
  columns: ErColumn[];
}

export interface ErRelation {
  from: { table: string; column: string };
  to: { table: string; column: string };
  /** many: many rows point at one; one: a unique pointer; list: an array of ids (Convex). */
  kind: "many" | "one" | "list";
  label?: string;
}

export interface ErSchema {
  tables: ErTable[];
  relations: ErRelation[];
  format: SchemaFormat | "data";
}

export type SchemaFormat = "sql" | "prisma" | "convex";

export function detectFormat(text: string): SchemaFormat {
  if (/\bdefineTable\s*\(/.test(text)) return "convex";
  if (/^\s*model\s+\w+\s*\{/m.test(text)) return "prisma";
  return "sql";
}

/** Reads schema text (or tables and relations as data) into tables and relations. */
export function parseSchema(input: { schema?: unknown; format?: unknown; tables?: unknown; relations?: unknown }): { schema: ErSchema; problems: string[] } {
  const problems: string[] = [];
  let schema: ErSchema;
  if (typeof input.schema === "string" && input.schema.trim()) {
    const f = input.format === "sql" || input.format === "prisma" || input.format === "convex" ? input.format : detectFormat(input.schema);
    schema = f === "prisma" ? parsePrisma(input.schema) : f === "convex" ? parseConvex(input.schema) : parseSql(input.schema);
    if (!schema.tables.length) problems.push(`found no tables in the ${f === "sql" ? "SQL" : f === "prisma" ? "Prisma schema" : "Convex schema"}`);
  } else {
    schema = fromData(input.tables, input.relations, problems);
    if (!schema.tables.length && input.schema == null && input.tables == null) problems.push("needs schema text or tables");
  }
  // Data relations add to whatever the text gave.
  if (typeof input.schema === "string" && Array.isArray(input.relations)) schema.relations.push(...dataRelations(input.relations, problems));
  resolve(schema, problems);
  return { schema, problems };
}

function resolve(schema: ErSchema, problems: string[]) {
  const byName = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]));
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (!c.fk || schema.relations.some((r) => r.from.table === t.name && r.from.column === c.name)) continue;
      schema.relations.push({ from: { table: t.name, column: c.name }, to: c.fk, kind: c.unique || (c.pk && t.columns.filter((x) => x.pk).length === 1) ? "one" : "many" });
    }
  }
  const kept: ErRelation[] = [];
  for (const r of schema.relations) {
    const target = byName.get(r.to.table.toLowerCase());
    const source = byName.get(r.from.table.toLowerCase());
    if (!target || !source) {
      problems.push(`${r.from.table}.${r.from.column} points at ${r.to.table}, which isn't in the schema`);
      continue;
    }
    r.to.table = target.name;
    r.from.table = source.name;
    if (!r.to.column) r.to.column = target.columns.find((c) => c.pk)?.name ?? "id";
    const col = source.columns.find((c) => c.name === r.from.column);
    if (col && !col.fk) col.fk = r.to;
    if (col?.unique && r.kind === "many") r.kind = "one";
    kept.push(r);
  }
  schema.relations = kept;
}

// ---------- data ----------

function splitRef(v: unknown): { table: string; column: string } | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return o.table ? { table: toText(o.table), column: toText(o.column ?? "") } : null;
  }
  const s = toText(v);
  if (!s) return null;
  const k = s.lastIndexOf(".");
  return k < 0 ? { table: s, column: "" } : { table: s.slice(0, k), column: s.slice(k + 1) };
}

function dataRelations(raw: unknown[], problems: string[]): ErRelation[] {
  const out: ErRelation[] = [];
  for (const r of raw) {
    const o = (Array.isArray(r) ? { from: r[0], to: r[1] } : r) as Record<string, unknown> | null;
    const from = splitRef(o?.from);
    const to = splitRef(o?.to);
    if (!from || !to) {
      problems.push("each relation needs from and to, like {from: \"posts.author_id\", to: \"users.id\"}");
      continue;
    }
    out.push({ from, to, kind: o?.kind === "one" || o?.kind === "list" ? o.kind : "many", label: o?.label != null ? toText(o.label) : undefined });
  }
  return out;
}

function fromData(tables: unknown, relations: unknown, problems: string[]): ErSchema {
  const out: ErTable[] = [];
  for (const t of Array.isArray(tables) ? tables : []) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const columns = (Array.isArray(o.columns) ? o.columns : []).map((c): ErColumn => {
      if (typeof c === "string") {
        const [name, ...type] = c.trim().split(/\s+/);
        return { name, type: type.join(" "), pk: /^id$/i.test(name) || undefined };
      }
      const x = (c ?? {}) as Record<string, unknown>;
      const fk = x.fk != null ? splitRef(x.fk) : null;
      return { name: toText(x.name ?? ""), type: toText(x.type ?? ""), pk: x.pk === true || undefined, nullable: x.nullable === true || undefined, unique: x.unique === true || undefined, fk: fk ?? undefined };
    });
    out.push({ name: toText(o.name ?? ""), columns });
  }
  return { tables: out, relations: dataRelations(Array.isArray(relations) ? relations : [], problems), format: "data" };
}

// ---------- shared scanning ----------

/** The text between the bracket at `open` and its match; strings and nested brackets are skipped. */
function balanced(text: string, open: number): { inner: string; end: number } | null {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const close = text.indexOf(ch, i + 1);
      if (close < 0) return null;
      i = close;
      continue;
    }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Splits on commas that sit outside brackets and strings. */
function splitTop(text: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const close = text.indexOf(ch, i + 1);
      const j = close < 0 ? text.length - 1 : close;
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------- SQL ----------

const IDENT = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;
const unquote = (s: string) => s.trim().replace(/^["`[]|["`\]]$/g, "");
const parts = (q: string) => q.split(/\s*\.\s*(?=["`[\w$])/).map(unquote);
/** auth.users stays qualified; it is shortened after parsing when the short name is unique. */
const qualified = (q: string) => parts(q).join(".");
const short = (q: string) => q.slice(q.lastIndexOf(".") + 1);
const names = (list: string) => splitTop(list).map(unquote);

/** Removes comments, leaving quoted strings alone: DEFAULT '--' and "https://x" survive. */
function stripComments(text: string, line: string, block = true): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" && ch !== "'" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (block && ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      out += " ";
      continue;
    }
    if (text.startsWith(line, i)) {
      const end = text.indexOf("\n", i);
      i = (end < 0 ? text.length : end) - 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Short names where they are unique, schema-qualified ones where two schemas share a name; references follow. */
function shortenNames(tables: ErTable[], relations: ErRelation[]) {
  const shorts = new Map<string, number>();
  for (const t of tables) shorts.set(short(t.name).toLowerCase(), (shorts.get(short(t.name).toLowerCase()) ?? 0) + 1);
  const display = new Map<string, string>();
  for (const t of tables) display.set(t.name.toLowerCase(), shorts.get(short(t.name).toLowerCase())! > 1 ? t.name : short(t.name));
  const find = (ref: string): string => {
    const exact = display.get(ref.toLowerCase());
    if (exact) return exact;
    const same = tables.filter((t) => short(t.name).toLowerCase() === short(ref).toLowerCase());
    const pick = same.find((t) => !t.name.includes(".") || t.name.toLowerCase().startsWith("public.")) ?? same[0];
    return pick ? display.get(pick.name.toLowerCase())! : ref;
  };
  for (const r of relations) {
    r.from.table = find(r.from.table);
    r.to.table = find(r.to.table);
  }
  for (const t of tables) for (const c of t.columns) if (c.fk) c.fk.table = find(c.fk.table);
  for (const t of tables) t.name = display.get(t.name.toLowerCase())!;
}

const CONSTRAINT_WORDS = /^(constraint|primary|not|null|unique|references|default|check|generated|collate|auto_increment|autoincrement|identity|on|comment|as)$/i;

export function parseSql(text: string): ErSchema {
  const sql = stripComments(text, "--");
  const tables: ErTable[] = [];
  const relations: ErRelation[] = [];
  const create = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:(?:global\s+|local\s+)?temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QNAME})\s*\(`, "gi");
  for (let m = create.exec(sql); m; m = create.exec(sql)) {
    const body = balanced(sql, m.index + m[0].length - 1);
    if (!body) break;
    create.lastIndex = body.end;
    const table: ErTable = { name: qualified(m[1]), columns: [] };
    const pks: string[] = [];
    for (let item of splitTop(body.inner)) {
      item = item.replace(/^constraint\s+\S+\s+/i, "");
      let k: RegExpExecArray | null;
      if ((k = /^primary\s+key\s*\(([^)]*)\)/i.exec(item))) {
        pks.push(...names(k[1]));
        continue;
      }
      if ((k = new RegExp(String.raw`^foreign\s+key\s*\(([^)]*)\)\s*references\s+(${QNAME})\s*(?:\(([^)]*)\))?`, "i").exec(item))) {
        const from = names(k[1]);
        const to = k[3] ? names(k[3]) : [];
        from.forEach((c, n) => relations.push({ from: { table: table.name, column: c }, to: { table: qualified(k![2]), column: to[n] ?? "" }, kind: "many" }));
        continue;
      }
      if ((k = /^unique\s*(?:key|index)?\s*(?:\S+\s*)?\(([^)]*)\)/i.exec(item))) {
        const cols = names(k[1]);
        if (cols.length === 1) table.columns.forEach((c) => c.name === cols[0] && (c.unique = true));
        continue;
      }
      if (/^(check|exclude|index|key|fulltext|spatial|period)\b/i.test(item)) continue;
      const col = new RegExp(String.raw`^(${IDENT})\s+([\s\S]*)$`).exec(item);
      if (!col) continue;
      const words = col[2].split(/\s+/);
      const typeWords: string[] = [];
      for (const w of words) {
        if (CONSTRAINT_WORDS.test(w)) break;
        typeWords.push(w);
      }
      const rest = words.slice(typeWords.length).join(" ");
      const c: ErColumn = { name: unquote(col[1]), type: typeWords.join(" ").replace(/\s+\(/g, "(").toLowerCase() };
      if (/\bprimary\s+key\b/i.test(rest)) c.pk = true;
      if (/\bnot\s+null\b/i.test(rest) || c.pk) c.nullable = false;
      else c.nullable = true;
      if (/\bunique\b/i.test(rest)) c.unique = true;
      const ref = new RegExp(String.raw`\breferences\s+(${QNAME})\s*(?:\(([^)]*)\))?`, "i").exec(rest);
      if (ref) c.fk = { table: qualified(ref[1]), column: ref[2] ? unquote(ref[2]) : "" };
      table.columns.push(c);
    }
    for (const p of pks) table.columns.forEach((c) => c.name === p && ((c.pk = true), (c.nullable = false)));
    tables.push(table);
  }
  const alter = new RegExp(String.raw`alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(${QNAME})\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(${QNAME})\s*(?:\(([^)]*)\))?`, "gi");
  for (let m = alter.exec(sql); m; m = alter.exec(sql)) {
    const from = names(m[2]);
    const to = m[4] ? names(m[4]) : [];
    from.forEach((c, n) => relations.push({ from: { table: qualified(m![1]), column: c }, to: { table: qualified(m![3]), column: to[n] ?? "" }, kind: "many" }));
  }
  shortenNames(tables, relations);
  return { tables, relations, format: "sql" };
}

// ---------- Prisma ----------

export function parsePrisma(text: string): ErSchema {
  const src = stripComments(text, "//", false);
  const blocks: { name: string; body: string }[] = [];
  const re = /^\s*model\s+(\w+)\s*\{/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const b = balanced(src, m.index + m[0].length - 1);
    if (!b) break;
    blocks.push({ name: m[1], body: b.inner });
    re.lastIndex = b.end;
  }
  const models = new Set(blocks.map((b) => b.name));
  const tables: ErTable[] = [];
  const relations: ErRelation[] = [];
  for (const { name, body } of blocks) {
    const table: ErTable = { name, columns: [] };
    const fks: { fields: string[]; refs: string[]; target: string }[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let k: RegExpExecArray | null;
      if ((k = /^@@id\s*\(\s*(?:fields\s*:\s*)?\[([^\]]*)\]/.exec(line))) {
        for (const f of names(k[1])) table.columns.forEach((c) => c.name === f && (c.pk = true));
        continue;
      }
      if ((k = /^@@unique\s*\(\s*(?:fields\s*:\s*)?\[([^\]]*)\]/.exec(line))) {
        const f = names(k[1]);
        if (f.length === 1) table.columns.forEach((c) => c.name === f[0] && (c.unique = true));
        continue;
      }
      if ((k = /^@@index\s*\(\s*(?:fields\s*:\s*)?\[([^\]]*)\]/.exec(line))) {
        const first = names(k[1])[0]?.replace(/\(.*$/, "");
        table.columns.forEach((c) => c.name === first && (c.indexed = true));
        continue;
      }
      if (line.startsWith("@@")) continue;
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!f) continue;
      const [, field, type, list, optional, attrs] = f;
      if (models.has(type)) {
        const rel = /@relation\s*\(([^)]*)\)/.exec(attrs);
        if (rel) {
          const fields = /fields\s*:\s*\[([^\]]*)\]/.exec(rel[1]);
          const refs = /references\s*:\s*\[([^\]]*)\]/.exec(rel[1]);
          if (fields) fks.push({ fields: names(fields[1]), refs: refs ? names(refs[1]) : [], target: type });
        }
        continue;
      }
      table.columns.push({
        name: field,
        type: `${type}${list ? "[]" : ""}`,
        pk: /@id\b/.test(attrs) || undefined,
        unique: /@unique\b/.test(attrs) || undefined,
        nullable: Boolean(optional),
      });
    }
    for (const fk of fks) {
      fk.fields.forEach((field, n) => {
        const col = table.columns.find((c) => c.name === field);
        const kind = col?.unique || (col?.pk && table.columns.filter((c) => c.pk).length === 1) ? "one" : "many";
        relations.push({ from: { table: name, column: field }, to: { table: fk.target, column: fk.refs[n] ?? "" }, kind });
      });
    }
    tables.push(table);
  }
  return { tables, relations, format: "prisma" };
}

// ---------- Convex ----------

function convexType(v: string): { type: string; optional: boolean; ids: { table: string; list: boolean }[] } {
  const ids: { table: string; list: boolean }[] = [];
  const walk = (s: string, inList: boolean): string => {
    const m = /^v\.(\w+)\s*\(/.exec(s.trim());
    if (!m) return s.trim().slice(0, 24);
    const open = s.indexOf("(", s.indexOf(m[0]) + m[0].length - 1);
    const args = balanced(s, open)?.inner ?? "";
    switch (m[1]) {
      case "id": {
        const t = args.trim().replace(/^["'`]|["'`]$/g, "");
        ids.push({ table: t, list: inList });
        return `Id<${t}>`;
      }
      case "optional":
        return walk(args, inList);
      case "array":
        return `${walk(args, true)}[]`;
      case "literal":
        return args.trim();
      case "union": {
        const parts = splitTop(args).map((p) => walk(p, inList));
        const text = parts.join(" | ");
        return text.length > 28 ? `union of ${parts.length}` : text;
      }
      case "object":
        return "object";
      case "record":
        return "record";
      case "float64":
        return "number";
      default:
        return m[1];
    }
  };
  const optional = /^v\.optional\s*\(/.test(v.trim());
  const type = walk(v, false);
  return { type, optional, ids };
}

export function parseConvex(text: string): ErSchema {
  const src = stripComments(text, "//");
  const tables: ErTable[] = [];
  const relations: ErRelation[] = [];
  // const users = defineTable(...) then defineSchema({ people: users }) names it "people".
  const aliases = new Map<string, string>();
  const schemaCall = /defineSchema\s*\(/.exec(src);
  if (schemaCall) {
    const obj = balanced(src, src.indexOf("{", schemaCall.index));
    if (obj) for (const part of splitTop(obj.inner)) {
      const m = /^(\w+)\s*:\s*(\w+)\s*$/.exec(part) ?? /^(\w+)\s*$/.exec(part);
      if (m) aliases.set(m[2] ?? m[1], m[1]);
    }
  }
  const re = /(?:(\w+)|["'](\w+)["'])\s*(?::|=)\s*defineTable\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const call = balanced(src, m.index + m[0].length - 1);
    if (!call) break;
    re.lastIndex = call.end;
    const raw = m[1] ?? m[2];
    const name = aliases.get(raw) ?? raw;
    let inner = call.inner.trim();
    const wrapped = /^v\.object\s*\(/.exec(inner);
    if (wrapped) inner = balanced(inner, inner.indexOf("("))?.inner.trim() ?? inner;
    const obj = inner.startsWith("{") ? balanced(inner, 0)?.inner ?? "" : "";
    const table: ErTable = { name, columns: [{ name: "_id", type: `Id<${name}>`, pk: true, nullable: false }] };
    for (const part of splitTop(obj)) {
      const f = /^["']?(\w+)["']?\s*:\s*([\s\S]+)$/.exec(part);
      if (!f) continue;
      const t = convexType(f[2]);
      const col: ErColumn = { name: f[1], type: t.type, nullable: t.optional };
      table.columns.push(col);
      for (const id of t.ids) relations.push({ from: { table: name, column: f[1] }, to: { table: id.table, column: "_id" }, kind: id.list ? "list" : "many" });
    }
    // Indexes chained after the table: .index("by_author", ["authorId", ...])
    let tail = src.slice(call.end);
    const stop = tail.search(/\n\s*(?:\w+|["']\w+["'])\s*(?::|=)\s*defineTable\s*\(|defineSchema\s*\(/);
    if (stop >= 0) tail = tail.slice(0, stop);
    for (const ix of tail.matchAll(/\.index\s*\(\s*["'][^"']*["']\s*,\s*\[\s*["'](\w+)["']/g)) {
      const c = table.columns.find((x) => x.name === ix[1]);
      if (c) c.indexed = true;
    }
    tables.push(table);
  }
  return { tables, relations, format: "convex" };
}

// ---------- layout ----------

/**
 * Columns of tables for a left-to-right drawing: tables others point at sit
 * to the left of the tables that point at them. Cycles are broken where found.
 */
export function rankTables(schema: ErSchema): string[][] {
  const parents = new Map<string, Set<string>>(schema.tables.map((t) => [t.name, new Set()]));
  for (const r of schema.relations) if (r.from.table !== r.to.table) parents.get(r.from.table)?.add(r.to.table);
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (t: string): number => {
    const known = rank.get(t);
    if (known !== undefined) return known;
    if (visiting.has(t)) return 0;
    visiting.add(t);
    let r = 0;
    for (const p of parents.get(t) ?? []) r = Math.max(r, visit(p) + 1);
    visiting.delete(t);
    rank.set(t, r);
    return r;
  };
  schema.tables.forEach((t) => visit(t.name));
  const cols: string[][] = [];
  for (const t of schema.tables) (cols[rank.get(t.name)!] ??= []).push(t.name);
  const placed = cols.filter(Boolean);
  // Order each column by where its parents sit, so lines cross less.
  const pos = new Map<string, number>();
  placed.forEach((col, k) => {
    if (k > 0) {
      const at = (t: string) => {
        const ps = [...(parents.get(t) ?? [])].map((p) => pos.get(p)).filter((x): x is number => x !== undefined);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
      };
      const order = new Map(col.map((t, n) => [t, n]));
      col.sort((a, b) => at(a) - at(b) || order.get(a)! - order.get(b)!);
    }
    col.forEach((t, n) => pos.set(t, n));
  });
  return placed;
}
