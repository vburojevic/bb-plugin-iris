// SchemaDiff: a database migration before it runs. Reads migration SQL
// (CREATE, ALTER, DROP, RENAME, TRUNCATE, DELETE, UPDATE, CREATE INDEX;
// Postgres, MySQL and SQLite spellings), or two schemas to compare (SQL,
// Prisma or Convex text, or {tables}, read by core/schema.ts). Every step gets
// a risk: destructive loses data, risky can fail, lock or break running code,
// safe is neither. Nothing is run.

import { parseSchema, parseSql, splitTop, stripComments, type ErColumn, type ErTable } from "./schema";

export type Risk = "destructive" | "risky" | "safe";
export type StepKind =
  | "create_table"
  | "drop_table"
  | "rename_table"
  | "add_column"
  | "drop_column"
  | "rename_column"
  | "alter_type"
  | "set_not_null"
  | "drop_not_null"
  | "set_default"
  | "drop_default"
  | "add_constraint"
  | "drop_constraint"
  | "create_index"
  | "drop_index"
  | "truncate"
  | "delete"
  | "update"
  | "other";

export interface SchemaStep {
  kind: StepKind;
  table: string;
  column?: string;
  /** What the step does, in plain words. */
  detail: string;
  risk: Risk;
  /** Why it is destructive or risky. */
  why?: string;
  sql?: string;
}

export type ChangeStatus = "added" | "dropped" | "changed" | "renamed";

export interface ColumnChange {
  name: string;
  status: ChangeStatus;
  before?: string;
  after?: string;
  risk: Risk;
}

export interface TableChange {
  name: string;
  status: ChangeStatus;
  from?: string;
  columns: ColumnChange[];
  steps: SchemaStep[];
  risk: Risk;
}

export interface SchemaDiffModel {
  source: "migration" | "schemas";
  steps: SchemaStep[];
  tables: TableChange[];
  tally: Record<Risk, number>;
  problems: string[];
}

export const MAX_STEPS = 500;

const RANK: Record<Risk, number> = { safe: 0, risky: 1, destructive: 2 };
const worst = (a: Risk, b: Risk): Risk => (RANK[a] >= RANK[b] ? a : b);
const unq = (s: string) => s.trim().replace(/^["`[]|["`\]]$/g, "");
/** auth.users reads as users when it is the only one; the schema stays when given. */
const tableName = (q: string) => q.split(/\s*\.\s*/).map(unq).join(".");
const IDENT = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;

// ---------- types ----------

const ALIASES: Record<string, string> = {
  int: "integer", int4: "integer", int8: "bigint", int2: "smallint", serial: "integer", bigserial: "bigint", smallserial: "smallint",
  float4: "real", float8: "double precision", float: "double precision", double: "double precision",
  bool: "boolean", "character varying": "varchar", character: "char", decimal: "numeric", timestamptz: "timestamp with time zone",
  "timestamp without time zone": "timestamp", string: "varchar",
};
const INTS = ["tinyint", "smallint", "mediumint", "integer", "bigint"];

function typeParts(t: string): { base: string; args: number[] } {
  const s = t.toLowerCase().replace(/\s+using\s[\s\S]*$/, "").replace(/\s+/g, " ").trim().replace(/\[\]$/, "");
  const m = /^([a-z ]+?)\s*(?:\(([^)]*)\))?(?:\s+(?:unsigned|zerofill|collate\s+\S+))*$/.exec(s);
  const base = (m ? m[1] : s).trim();
  return { base: (Object.hasOwn(ALIASES, base) ? ALIASES[base] : undefined) ?? base, args: m?.[2] ? m[2].split(",").map((x) => Number(x.trim())).filter(Number.isFinite) : [] };
}

/** Whether a column can change from type a to b without losing or rejecting values. */
export function widens(a: string, b: string): boolean {
  const x = typeParts(a);
  const y = typeParts(b);
  // Any value has a text form: text, citext and varchar with no length hold them all.
  if (["text", "citext"].includes(y.base) || (y.base === "varchar" && !y.args.length)) return true;
  if (x.base === y.base) {
    if (!y.args.length) return true;
    if (!x.args.length) return false;
    return y.args.every((n, k) => n >= (x.args[k] ?? 0)) && (x.base !== "numeric" || y.args[0] - (y.args[1] ?? 0) >= x.args[0] - (x.args[1] ?? 0));
  }
  if (INTS.includes(x.base) && INTS.includes(y.base)) return INTS.indexOf(y.base) >= INTS.indexOf(x.base);
  if (INTS.includes(x.base) && (y.base === "numeric" || y.base === "double precision") && !y.args.length) return true;
  if (x.base === "real" && y.base === "double precision") return true;
  if ((x.base === "varchar" || x.base === "char") && (y.base === "text" || (y.base === "varchar" && (!y.args.length || y.args[0] >= (x.args[0] ?? Infinity))))) return true;
  if (x.base === "timestamp" && y.base === "timestamp with time zone") return true;
  if (y.base === "text" && ["varchar", "char", "uuid", "citext"].includes(x.base)) return true;
  if (x.base === "json" && y.base === "jsonb") return true;
  return false;
}

// ---------- migration SQL ----------

/** Statements split on semicolons outside strings and $$ bodies, comments removed. */
export function splitStatements(sql: string): string[] {
  const text = stripComments(sql, "--");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += 1;
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[\w]*\$/.exec(text.slice(i))?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        const j = end < 0 ? text.length : end + tag.length;
        cur += text.slice(i, j);
        i = j - 1;
        continue;
      }
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.replace(/\s+/g, " "));
}

interface Known {
  /** Columns of tables the migration or the before schema knows: table -> column -> type. */
  types: Map<string, Map<string, string>>;
  created: Set<string>;
}

const key = (t: string) => t.toLowerCase();

function columnDef(def: string): { name: string; type: string; notNull: boolean; hasDefault: boolean; pk: boolean } {
  const m = new RegExp(String.raw`^(${IDENT})\s+([\s\S]*)$`).exec(def.trim());
  const name = m ? unq(m[1]) : def.trim();
  const rest = m ? m[2] : "";
  const words = rest.split(/\s+/);
  const typeWords: string[] = [];
  for (const w of words) {
    if (/^(constraint|primary|not|null|unique|references|default|check|generated|collate|auto_increment|autoincrement|identity|on|comment|as|first|after)$/i.test(w)) break;
    typeWords.push(w);
  }
  return {
    name,
    type: typeWords.join(" ").toLowerCase(),
    notNull: /\bnot\s+null\b/i.test(rest) || /\bprimary\s+key\b/i.test(rest),
    hasDefault: /\bdefault\b/i.test(rest) || /\b(generated|identity|auto_?increment|serial|bigserial)\b/i.test(rest),
    pk: /\bprimary\s+key\b/i.test(rest),
  };
}

function alterActions(table: string, actions: string, sql: string, known: Known): SchemaStep[] {
  const steps: SchemaStep[] = [];
  const isNew = known.created.has(key(table));
  const typeOf = (c: string) => known.types.get(key(table))?.get(key(c));
  const setType = (c: string, t: string) => {
    const m = known.types.get(key(table)) ?? new Map<string, string>();
    m.set(key(c), t);
    known.types.set(key(table), m);
  };
  for (const raw of splitTop(actions)) {
    const a = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = new RegExp(String.raw`^rename\s+to\s+(${QNAME})$`, "i").exec(a))) {
      const to = tableName(m[1]);
      steps.push({ kind: "rename_table", table, detail: `Renames the table to ${to}`, risk: "risky", why: "code still using the old name breaks until it ships", sql });
      known.types.set(key(to), known.types.get(key(table)) ?? new Map());
      continue;
    }
    if ((m = new RegExp(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})$`, "i").exec(a))) {
      steps.push({ kind: "rename_column", table, column: unq(m[2]), detail: `Renames ${unq(m[1])} to ${unq(m[2])}`, risk: "risky", why: "code reading the old name breaks until it ships", sql });
      continue;
    }
    if ((m = /^add\s+(constraint\s+\S+\s+)?(primary\s+key|foreign\s+key|unique|check|exclude)\b([\s\S]*)$/i.exec(a))) {
      const what = m[2].toLowerCase().replace(/\s+/g, " ");
      steps.push({ kind: "add_constraint", table, detail: `Adds a ${what} constraint${m[1] ? ` ${unq(m[1].trim().split(/\s+/)[1])}` : ""}`, risk: isNew ? "safe" : "risky", why: isNew ? undefined : "checks every existing row and fails if one breaks it", sql });
      continue;
    }
    if ((m = /^add\s+(unique\s+)?(?:(?:fulltext|spatial)\s+)?(?:index|key)\b\s*([^\s(]*)\s*\(([\s\S]*)\)\s*$/i.exec(a))) {
      const unique = !!m[1];
      steps.push({ kind: "create_index", table, detail: `Adds ${unique ? "a unique" : "an"} index${m[2] ? ` ${unq(m[2])}` : ""} on ${m[3].trim()}`, risk: unique && !isNew ? "risky" : "safe", why: unique && !isNew ? "fails if existing rows have duplicates" : undefined, sql });
      continue;
    }
    if ((m = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(a))) {
      const c = columnDef(m[1]);
      setType(c.name, c.type);
      const fails = c.notNull && !c.hasDefault && !isNew;
      steps.push({ kind: "add_column", table, column: c.name, detail: `Adds ${c.name} ${c.type}${c.notNull ? " not null" : ""}`, risk: fails ? "risky" : "safe", why: fails ? "not null with no default fails on a table that has rows" : undefined, sql });
      continue;
    }
    if ((m = new RegExp(String.raw`^drop\s+constraint\s+(?:if\s+exists\s+)?(${IDENT})`, "i").exec(a))) {
      steps.push({ kind: "drop_constraint", table, detail: `Drops the constraint ${unq(m[1])}`, risk: "safe", sql });
      continue;
    }
    if ((m = /^drop\s+(?:primary\s+key|foreign\s+key\s+\S+|index\s+\S+|key\s+\S+)/i.exec(a))) {
      steps.push({ kind: "drop_constraint", table, detail: `Drops ${m[0].slice(5).trim()}`, risk: "safe", sql });
      continue;
    }
    if ((m = new RegExp(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`, "i").exec(a))) {
      const col = unq(m[1]);
      steps.push({ kind: "drop_column", table, column: col, detail: `Drops ${col}${typeOf(col) ? ` ${typeOf(col)}` : ""}`, risk: "destructive", why: "deletes the column and every value in it", sql });
      continue;
    }
    // MySQL: MODIFY col type / CHANGE old new type
    if ((m = new RegExp(String.raw`^(?:modify|change)\s+(?:column\s+)?(${IDENT})\s+(?:(${IDENT})\s+(?=\S))?([\s\S]+)$`, "i").exec(a)) && /^change/i.test(a) && m[2]) {
      const from = unq(m[1]);
      const c = columnDef(`${m[2]} ${m[3]}`);
      if (key(from) !== key(c.name)) steps.push({ kind: "rename_column", table, column: c.name, detail: `Renames ${from} to ${c.name}`, risk: "risky", why: "code reading the old name breaks until it ships", sql });
      steps.push(typeStep(table, c.name, typeOf(from), c.type, sql));
      setType(c.name, c.type);
      continue;
    }
    if ((m = new RegExp(String.raw`^modify\s+(?:column\s+)?([\s\S]+)$`, "i").exec(a))) {
      const c = columnDef(m[1]);
      steps.push(typeStep(table, c.name, typeOf(c.name), c.type, sql));
      setType(c.name, c.type);
      continue;
    }
    if ((m = new RegExp(String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+([\s\S]+)$`, "i").exec(a))) {
      const col = unq(m[1]);
      const what = m[2];
      let t: RegExpExecArray | null;
      if ((t = /^(?:set\s+data\s+)?type\s+([\s\S]+)$/i.exec(what))) {
        const to = t[1].replace(/\s+using\s[\s\S]*$/i, "").replace(/\s+collate\s+\S+/i, "").trim().toLowerCase();
        steps.push(typeStep(table, col, typeOf(col), to, sql));
        setType(col, to);
      } else if (/^set\s+not\s+null/i.test(what))
        steps.push({ kind: "set_not_null", table, column: col, detail: `Makes ${col} required`, risk: isNew ? "safe" : "risky", why: isNew ? undefined : "fails if any row has no value; scans the table under a lock", sql });
      else if (/^drop\s+not\s+null/i.test(what)) steps.push({ kind: "drop_not_null", table, column: col, detail: `Lets ${col} be empty`, risk: "safe", sql });
      else if ((t = /^set\s+default\s+([\s\S]+)$/i.exec(what))) steps.push({ kind: "set_default", table, column: col, detail: `Defaults ${col} to ${t[1].slice(0, 60)}`, risk: "safe", sql });
      else if (/^drop\s+default/i.test(what)) steps.push({ kind: "drop_default", table, column: col, detail: `Removes the default of ${col}`, risk: "safe", sql });
      else steps.push({ kind: "other", table, column: col, detail: `Alters ${col}: ${what.slice(0, 80)}`, risk: "safe", sql });
      continue;
    }
    steps.push({ kind: "other", table, detail: a.slice(0, 100), risk: "safe", sql });
  }
  return steps;
}

function typeStep(table: string, column: string, from: string | undefined, to: string, sql: string): SchemaStep {
  if (!from) return { kind: "alter_type", table, column, detail: `Changes ${column} to ${to}`, risk: "risky", why: "rewrites the column; values that don't convert make it fail", sql };
  if (typeParts(from).base === typeParts(to).base && typeParts(from).args.join() === typeParts(to).args.join()) return { kind: "alter_type", table, column, detail: `Keeps ${column} ${to}`, risk: "safe", sql };
  const ok = widens(from, to);
  return { kind: "alter_type", table, column, detail: `Changes ${column} from ${from} to ${to}`, risk: ok ? "safe" : "destructive", why: ok ? undefined : "narrows the type: values that don't fit are cut or make it fail", sql };
}

/** The text inside the parenthesis that opens at `open`, nested ones included. */
function parenBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function statementSteps(stmt: string, known: Known): SchemaStep[] {
  const sql = stmt.length > 400 ? `${stmt.slice(0, 400)}...` : stmt;
  let m: RegExpExecArray | null;
  if (/^create\s+(?:or\s+replace\s+)?(?:(?:global\s+|local\s+)?temp(?:orary)?\s+|unlogged\s+)?table\b/i.test(stmt)) {
    const t = parseSql(stmt).tables[0];
    if (!t) return [{ kind: "other", table: "", detail: stmt.slice(0, 100), risk: "safe", sql }];
    const name = tableName(new RegExp(String.raw`table\s+(?:if\s+not\s+exists\s+)?(${QNAME})`, "i").exec(stmt)?.[1] ?? t.name);
    known.created.add(key(name));
    known.types.set(key(name), new Map(t.columns.map((c) => [key(c.name), c.type])));
    const steps: SchemaStep[] = [{ kind: "create_table", table: name, detail: `Creates ${name} with ${t.columns.length} ${t.columns.length === 1 ? "column" : "columns"}`, risk: "safe", sql }];
    for (const c of t.columns) steps.push({ kind: "add_column", table: name, column: c.name, detail: `${c.name} ${c.type}${c.nullable === false ? " not null" : ""}`, risk: "safe" });
    return steps;
  }
  if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i.exec(stmt))) {
    const cascade = /\bcascade\s*$/i.test(stmt);
    return splitTop(m[1]).map((t) => ({ kind: "drop_table" as const, table: tableName(t), detail: `Drops ${tableName(t)}${cascade ? " and everything that depends on it" : ""}`, risk: "destructive" as const, why: "deletes the table and all its rows", sql }));
  }
  if ((m = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+([\s\S]+)$`, "i").exec(stmt))) return alterActions(tableName(m[1]), m[2], sql, known);
  if ((m = new RegExp(String.raw`^rename\s+table\s+(${QNAME})\s+to\s+(${QNAME})`, "i").exec(stmt))) return [{ kind: "rename_table", table: tableName(m[1]), detail: `Renames the table to ${tableName(m[2])}`, risk: "risky", why: "code still using the old name breaks until it ships", sql }];
  if ((m = new RegExp(String.raw`^create\s+(unique\s+)?index\s+(concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:(${QNAME})\s+)?on\s+(?:only\s+)?(${QNAME})\s*(?:using\s+\w+\s*)?\(`, "i").exec(stmt))) {
    m[5] = parenBody(stmt, m.index + m[0].length - 1);
    const table = tableName(m[4]);
    const isNew = known.created.has(key(table));
    const unique = !!m[1];
    const lock = !m[2] && !isNew;
    return [
      {
        kind: "create_index",
        table,
        detail: `Adds ${unique ? "a unique" : "an"} index${m[3] ? ` ${unq(m[3])}` : ""} on ${m[5].trim()}`,
        risk: unique && !isNew ? "risky" : "safe",
        why: unique && !isNew ? "fails if existing rows have duplicates" : lock ? "blocks writes while it builds (Postgres: add CONCURRENTLY)" : undefined,
        sql,
      },
    ];
  }
  if ((m = new RegExp(String.raw`^drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(${QNAME})(?:\s+on\s+(${QNAME}))?`, "i").exec(stmt))) return [{ kind: "drop_index", table: m[2] ? tableName(m[2]) : "", detail: `Drops the index ${tableName(m[1])}`, risk: "safe", why: "queries that used it may slow down", sql }];
  if ((m = /^truncate\s+(?:table\s+)?(?:only\s+)?([\s\S]+?)(?:\s+(?:restart|continue)\s+identity)?(?:\s+(?:cascade|restrict))?$/i.exec(stmt))) return splitTop(m[1]).map((t) => ({ kind: "truncate" as const, table: tableName(t), detail: `Empties ${tableName(t)}`, risk: "destructive" as const, why: "deletes every row", sql }));
  if ((m = new RegExp(String.raw`^delete\s+from\s+(?:only\s+)?(${QNAME})([\s\S]*)$`, "i").exec(stmt))) {
    const where = /\bwhere\b/i.test(m[2]);
    return [{ kind: "delete", table: tableName(m[1]), detail: where ? "Deletes the rows that match" : "Deletes every row", risk: "destructive", why: where ? "deletes rows" : "no WHERE: deletes every row", sql }];
  }
  if ((m = new RegExp(String.raw`^update\s+(?:only\s+)?(${QNAME})\s+set\s+([\s\S]*)$`, "i").exec(stmt))) {
    const where = /\bwhere\b/i.test(m[2]);
    return [{ kind: "update", table: tableName(m[1]), detail: where ? "Rewrites the rows that match" : "Rewrites every row", risk: "risky", why: "overwrites existing values; a long update holds row locks", sql }];
  }
  if ((m = /^drop\s+(schema|database)\s+(?:if\s+exists\s+)?(\S+)/i.exec(stmt))) return [{ kind: "drop_table", table: unq(m[2]), detail: `Drops the ${m[1].toLowerCase()} ${unq(m[2])}`, risk: "destructive", why: "deletes everything in it", sql }];
  return [{ kind: "other", table: "", detail: stmt.length > 100 ? `${stmt.slice(0, 100)}...` : stmt, risk: "safe", sql }];
}

export function migrationSteps(sql: string, before?: ErTable[]): SchemaStep[] {
  const known: Known = { types: new Map(), created: new Set() };
  for (const t of before ?? []) known.types.set(key(t.name), new Map(t.columns.map((c) => [key(c.name), c.type])));
  const out: SchemaStep[] = [];
  for (const stmt of splitStatements(sql)) {
    if (/^(begin|commit|start\s+transaction|rollback|set\s|pragma\s)/i.test(stmt)) continue;
    out.push(...statementSteps(stmt, known));
    if (out.length >= MAX_STEPS) break;
  }
  return out.slice(0, MAX_STEPS);
}

// ---------- two schemas ----------

function colType(c: ErColumn): string {
  return `${c.type || "?"}${c.nullable === false && !c.pk ? " not null" : ""}`;
}

export function schemaSteps(a: ErTable[], b: ErTable[]): SchemaStep[] {
  const out: SchemaStep[] = [];
  const before = new Map(a.map((t) => [key(t.name), t]));
  const after = new Map(b.map((t) => [key(t.name), t]));
  for (const t of a) if (!after.has(key(t.name))) out.push({ kind: "drop_table", table: t.name, detail: `Drops ${t.name}`, risk: "destructive", why: "deletes the table and all its rows" });
  for (const t of b) {
    const old = before.get(key(t.name));
    if (!old) {
      out.push({ kind: "create_table", table: t.name, detail: `Creates ${t.name} with ${t.columns.length} ${t.columns.length === 1 ? "column" : "columns"}`, risk: "safe" });
      for (const c of t.columns) out.push({ kind: "add_column", table: t.name, column: c.name, detail: `${c.name} ${colType(c)}`, risk: "safe" });
      continue;
    }
    const oldCols = new Map(old.columns.map((c) => [key(c.name), c]));
    const newCols = new Map(t.columns.map((c) => [key(c.name), c]));
    for (const c of old.columns) if (!newCols.has(key(c.name))) out.push({ kind: "drop_column", table: t.name, column: c.name, detail: `Drops ${c.name} ${c.type}`, risk: "destructive", why: "deletes the column and every value in it" });
    for (const c of t.columns) {
      const o = oldCols.get(key(c.name));
      if (!o) {
        const req = c.nullable === false && !c.pk;
        out.push({ kind: "add_column", table: t.name, column: c.name, detail: `Adds ${c.name} ${colType(c)}`, risk: req ? "risky" : "safe", why: req ? "required: existing rows need a default" : undefined });
        continue;
      }
      if (o.type && c.type && typeParts(o.type).base + typeParts(o.type).args.join() !== typeParts(c.type).base + typeParts(c.type).args.join()) {
        const ok = widens(o.type, c.type);
        out.push({ kind: "alter_type", table: t.name, column: c.name, detail: `Changes ${c.name} from ${o.type} to ${c.type}`, risk: ok ? "safe" : "destructive", why: ok ? undefined : "narrows the type: values that don't fit are cut or make it fail" });
      }
      if (o.nullable !== false && c.nullable === false && !c.pk) out.push({ kind: "set_not_null", table: t.name, column: c.name, detail: `Makes ${c.name} required`, risk: "risky", why: "fails if any row has no value" });
      if (o.nullable === false && c.nullable !== false && !o.pk) out.push({ kind: "drop_not_null", table: t.name, column: c.name, detail: `Lets ${c.name} be empty`, risk: "safe" });
    }
  }
  return out.slice(0, MAX_STEPS);
}

function schemaOf(v: unknown, problems: string[], which: string): ErTable[] {
  if (v == null) return [];
  const input = typeof v === "string" ? { schema: v } : v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : Array.isArray(v) ? { tables: v } : {};
  const { schema, problems: p } = parseSchema(input);
  for (const x of p) if (!/points at/.test(x)) problems.push(`${which}: ${x}`);
  return schema.tables;
}

// ---------- the model ----------

function group(steps: SchemaStep[]): TableChange[] {
  const tables = new Map<string, TableChange>();
  for (const s of steps) {
    const name = s.table || "Other statements";
    let t = tables.get(key(name));
    if (!t) {
      t = { name, status: "changed", columns: [], steps: [], risk: "safe" };
      tables.set(key(name), t);
    }
    t.steps.push(s);
    t.risk = worst(t.risk, s.risk);
    if (s.kind === "create_table") t.status = "added";
    else if (s.kind === "drop_table") t.status = "dropped";
    else if (s.kind === "rename_table" && t.status === "changed") t.status = "renamed";
    if (s.column && s.kind !== "create_table") {
      const status: ChangeStatus = s.kind === "add_column" ? "added" : s.kind === "drop_column" ? "dropped" : s.kind === "rename_column" ? "renamed" : "changed";
      const existing = t.columns.find((c) => key(c.name) === key(s.column as string));
      if (existing) existing.risk = worst(existing.risk, s.risk);
      else t.columns.push({ name: s.column, status, risk: s.risk });
    }
  }
  return [...tables.values()].sort((a, b) => RANK[b.risk] - RANK[a.risk]);
}

export function schemaDiff(input: { sql?: unknown; before?: unknown; after?: unknown }): SchemaDiffModel {
  const problems: string[] = [];
  const sql = typeof input.sql === "string" && input.sql.trim() ? input.sql : null;
  let steps: SchemaStep[];
  let source: SchemaDiffModel["source"];
  if (sql) {
    source = "migration";
    steps = migrationSteps(sql, input.before != null ? schemaOf(input.before, problems, "before") : undefined);
    if (!steps.length) problems.push("found no SQL statements in the migration");
  } else if (input.before != null || input.after != null) {
    source = "schemas";
    const a = schemaOf(input.before, problems, "before");
    const b = schemaOf(input.after, problems, "after");
    if (input.before == null || input.after == null) problems.push("comparing schemas needs both before and after");
    steps = schemaSteps(a, b);
  } else {
    source = "migration";
    steps = [];
    problems.push("needs migration SQL (sql, or between the tags) or before and after schemas");
  }
  const tally: Record<Risk, number> = { destructive: 0, risky: 0, safe: 0 };
  for (const s of steps) tally[s.risk] += 1;
  return { source, steps, tables: group(steps), tally, problems };
}
