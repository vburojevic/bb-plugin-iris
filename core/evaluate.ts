// A tree-walking interpreter for Iris expressions. It never calls eval or
// Function, never exposes globals, and reads only plain data: own properties of
// plain objects and arrays, and a fixed list of array, string and number
// methods. Every evaluation runs under a step budget.

import type { ElementNode, Expr, Param, SpreadExpr, Stmt } from "./ast";
import { didYouMean } from "./text";

export const STEP_BUDGET = 250_000;

export class IrisError extends Error {
  constructor(
    message: string,
    readonly start?: number,
    readonly end?: number,
  ) {
    super(message);
  }
}

/** A JSX element captured with the scope it was written in. */
export interface ElementValue {
  $iris: "element";
  node: ElementNode;
  scope: Scope;
}

export interface FnValue {
  $iris: "fn";
  params: Param[];
  body: Expr | Stmt[];
  scope: Scope;
}

export type ActionKind = "send" | "insert" | "copy" | "openUrl" | "openFile" | "set" | "toggle" | "submit" | "explain";

/** What an action builtin returns. Handlers run it; it never runs while rendering. */
export interface ActionValue {
  $iris: "action";
  kind: ActionKind;
  args: unknown[];
}

/** A value whose data is still loading (load()). Components show a placeholder. */
export interface PendingValue {
  $iris: "pending";
  path: string;
}

// Values the interpreter itself made. The $iris tag alone proves nothing: loaded JSON, a plugin
// feed or restored state can carry the same field, and data must never become a component,
// a function or a click action. Membership here can't be forged from data. The set is shared
// through the realm's symbol registry because the main bundle and each lazy chunk carry their
// own copy of this module, and a value made in one must pass the checks in another. Only
// trusted code runs in this realm (card expressions have no globals; apps run in sandboxed frames).
const MINTED_KEY = Symbol.for("bb-plugin-iris.minted");
const realm = globalThis as unknown as Record<symbol, WeakSet<object> | undefined>;
const MINTED: WeakSet<object> = (realm[MINTED_KEY] ??= new WeakSet<object>());

/** Marks a value as made by the interpreter (an element, function, action or pending load). */
export function mint<T extends ElementValue | FnValue | ActionValue | PendingValue>(v: T): T {
  MINTED.add(v);
  return v;
}

const minted = (v: unknown, tag: string): boolean => typeof v === "object" && v !== null && MINTED.has(v) && (v as { $iris?: unknown }).$iris === tag;

export const isElementValue = (v: unknown): v is ElementValue => minted(v, "element");
export const isFnValue = (v: unknown): v is FnValue => minted(v, "fn");
export const isActionValue = (v: unknown): v is ActionValue => minted(v, "action");
export const isPendingValue = (v: unknown): v is PendingValue => minted(v, "pending");

/** Everything the interpreter needs from the card it runs in. */
export interface Host {
  /** State declared with <state>. */
  hasState(name: string): boolean;
  getState(name: string): unknown;
  setState(name: string, value: unknown): void;
  /** Values declared with <let>, computed on demand. */
  hasLet(name: string): boolean;
  getLet(name: string): unknown;
  /** Data from a file: the parsed value, a PendingValue while loading, or a thrown IrisError. */
  load(path: string, options?: { raw?: boolean; tail?: boolean; fallback?: unknown }): unknown;
  /** Seconds-resolution clock for live cards. */
  now(): number;
}

export class Scope {
  readonly vars = new Map<string, unknown>();
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): { found: boolean; value: unknown; scope: Scope | null } {
    for (let s: Scope | null = this; s; s = s.parent) {
      if (s.vars.has(name)) return { found: true, value: s.vars.get(name), scope: s };
    }
    return { found: false, value: undefined, scope: null };
  }
  names(): string[] {
    const out = new Set<string>();
    for (let s: Scope | null = this; s; s = s.parent) for (const k of s.vars.keys()) out.add(k);
    return [...out];
  }
}

/**
 * Native functions the interpreter may call: Iris's own builtins and the method
 * wrappers it creates. Anything else (a host constructor reached by accident)
 * is refused, so one missed guard can't become code execution.
 */
const SAFE_NATIVE = new WeakSet<object>();
export function markSafe<T extends (...a: never[]) => unknown>(fn: T): T {
  SAFE_NATIVE.add(fn);
  return fn;
}

/** A data read for helpers like sum(list, "key"): own fields of plain objects and arrays only. */
export function readField(obj: unknown, key: unknown): unknown {
  const k = String(key);
  if (BLOCKED.has(k)) return undefined;
  if (Array.isArray(obj)) return k === "length" ? obj.length : /^\d+$/.test(k) ? obj[Number(k)] : undefined;
  if (typeof obj === "string") return k === "length" ? obj.length : undefined;
  if (!obj || typeof obj !== "object") return undefined;
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return undefined;
  return Object.hasOwn(obj, k) ? (obj as Record<string, unknown>)[k] : undefined;
}

const BLOCKED = new Set(["__proto__", "prototype", "constructor", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

class ReturnSignal {
  constructor(readonly value: unknown) {}
}

export class Interpreter {
  steps = 0;
  /** Actions produced by expression statements while a handler runs. */
  collected: ActionValue[] | null = null;

  constructor(
    readonly host: Host,
    readonly globals: Scope,
    readonly budget = STEP_BUDGET,
  ) {}

  tick(e?: { start: number; end: number }) {
    if (++this.steps > this.budget) {
      throw new IrisError(`This card does too much work (over ${this.budget.toLocaleString("en-US")} steps). Use less data or simpler loops.`, e?.start, e?.end);
    }
  }

  /** Runs a handler value (function, action, or list of actions) and returns the actions it produced. */
  runHandler(handler: unknown, args: unknown[] = []): ActionValue[] {
    const out: ActionValue[] = [];
    const take = (v: unknown) => {
      if (isActionValue(v)) out.push(v);
      else if (Array.isArray(v)) v.forEach(take);
    };
    if (isFnValue(handler)) {
      const prev = this.collected;
      this.collected = out;
      try {
        take(this.call(handler, args));
      } finally {
        this.collected = prev;
      }
    } else take(handler);
    return out;
  }

  eval(e: Expr, scope: Scope): unknown {
    this.tick(e);
    switch (e.t) {
      case "lit":
        return e.v;
      case "id":
        return this.ident(e.name, scope, e);
      case "arr": {
        const out: unknown[] = [];
        for (const item of e.items) {
          if (item.t === "spread") {
            const v = this.eval(item.arg, scope);
            if (v == null) continue;
            if (!Array.isArray(v)) throw new IrisError("Only a list can be spread into a list", item.start, item.end);
            out.push(...v);
          } else out.push(this.eval(item, scope));
        }
        return out;
      }
      case "obj": {
        const out: Record<string, unknown> = {};
        for (const p of e.props) {
          if (p.kind === "spread") {
            const v = this.eval(p.arg, scope);
            if (v != null && typeof v === "object") Object.assign(out, plainCopy(v));
            continue;
          }
          const key = p.computed ? String(this.eval(p.key as Expr, scope)) : (p.key as string);
          if (BLOCKED.has(key)) throw new IrisError(`"${key}" can't be used as a key`, e.start, e.end);
          out[key] = this.eval(p.value, scope);
        }
        return out;
      }
      case "tpl": {
        let out = e.quasis[0];
        for (let k = 0; k < e.exprs.length; k++) out += toText(this.eval(e.exprs[k], scope)) + e.quasis[k + 1];
        return out;
      }
      case "un": {
        const v = this.eval(e.arg, scope);
        switch (e.op) {
          case "!":
            return !v;
          case "-":
            return -(v as number);
          case "+":
            return Number(v);
          case "typeof":
            return isFnValue(v) ? "function" : Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
        }
        return undefined;
      }
      case "bin":
        return binary(e.op, this.eval(e.l, scope), this.eval(e.r, scope));
      case "log": {
        const l = this.eval(e.l, scope);
        if (e.op === "&&") return l ? this.eval(e.r, scope) : l;
        if (e.op === "||") return l ? l : this.eval(e.r, scope);
        return l ?? this.eval(e.r, scope);
      }
      case "cond":
        return this.eval(e.test, scope) ? this.eval(e.then, scope) : this.eval(e.else, scope);
      case "mem": {
        const obj = this.eval(e.obj, scope);
        if (obj == null) {
          if (e.optional) return undefined;
          throw new IrisError(`Can't read ${describeProp(e, this, scope)} of ${obj === null ? "null" : "undefined"} (${exprName(e.obj)} is ${obj === null ? "null" : "undefined"})`, e.start, e.end);
        }
        const key = e.computed ? this.eval(e.prop, scope) : (e.prop as { v: string }).v;
        return getMember(obj, key, e, this);
      }
      case "call":
        return this.callExpr(e, scope);
      case "arrow":
        return mint({ $iris: "fn", params: e.params, body: e.body, scope } satisfies FnValue);
      case "assign":
        return this.assign(e, scope);
      case "update": {
        const before = Number(this.eval(e.target, scope));
        const after = e.op === "++" ? before + 1 : before - 1;
        this.store(e.target, after, scope);
        return e.prefix ? after : before;
      }
      case "jsx":
        return mint({ $iris: "element", node: e.el, scope } satisfies ElementValue);
      case "seq": {
        let last: unknown;
        for (const x of e.list) last = this.eval(x, scope);
        return last;
      }
    }
  }

  ident(name: string, scope: Scope, e: { start: number; end: number }): unknown {
    const local = scope.lookup(name);
    if (local.found) return local.value;
    if (this.host.hasState(name)) return this.host.getState(name);
    if (this.host.hasLet(name)) return this.host.getLet(name);
    const g = this.globals.lookup(name);
    if (g.found) return g.value;
    const hint = didYouMean(name, [...scope.names(), ...this.globals.names()]);
    throw new IrisError(`${name} is not defined${hint ? `. Did you mean ${hint}?` : ". Declare it with <state> or <let>."}`, e.start, e.end);
  }

  assign(e: Extract<Expr, { t: "assign" }>, scope: Scope): unknown {
    let value: unknown;
    if (e.op === "=") value = this.eval(e.value, scope);
    else {
      const current = this.eval(e.target, scope);
      if (e.op === "??=") value = current ?? this.eval(e.value, scope);
      else if (e.op === "||=") value = current || this.eval(e.value, scope);
      else if (e.op === "&&=") value = current && this.eval(e.value, scope);
      else value = binary(e.op.slice(0, -1), current, this.eval(e.value, scope));
    }
    this.store(e.target, value, scope);
    return value;
  }

  /** Writes to a state name, a local const, or a field inside a state value (copy on write). */
  store(target: Expr, value: unknown, scope: Scope) {
    const path: unknown[] = [];
    let root: Expr = target;
    while (root.t === "mem") {
      path.unshift(root.computed ? this.eval(root.prop, scope) : (root.prop as { v: string }).v);
      root = root.obj;
    }
    if (root.t !== "id") throw new IrisError("Only a state name or one of its fields can be assigned", target.start, target.end);
    const name = root.name;
    const local = scope.lookup(name);
    if (local.found && local.scope && local.scope !== this.globals) {
      if (path.length === 0) {
        local.scope.vars.set(name, value);
        return;
      }
      local.scope.vars.set(name, setPath(local.value, path, value, target));
      return;
    }
    if (!this.host.hasState(name)) {
      throw new IrisError(`${name} is not state, so it can't change. Declare it with <state ${name}={...} />.`, target.start, target.end);
    }
    this.host.setState(name, path.length === 0 ? value : setPath(this.host.getState(name), path, value, target));
  }

  callExpr(e: Extract<Expr, { t: "call" }>, scope: Scope): unknown {
    let callee: unknown;
    let self: unknown;
    if (e.callee.t === "mem") {
      self = this.eval(e.callee.obj, scope);
      if (self == null) {
        if (e.callee.optional || e.optional) return undefined;
        throw new IrisError(`Can't call ${exprName(e.callee)} on ${self === null ? "null" : "undefined"}`, e.start, e.end);
      }
      const key = e.callee.computed ? this.eval(e.callee.prop, scope) : (e.callee.prop as { v: string }).v;
      callee = getMember(self, key, e.callee, this);
    } else callee = this.eval(e.callee, scope);
    if (callee == null && e.optional) return undefined;
    const args = this.args(e.args, scope);
    return this.call(callee, args, e);
  }

  args(list: (Expr | SpreadExpr)[], scope: Scope): unknown[] {
    const out: unknown[] = [];
    for (const a of list) {
      if (a.t === "spread") {
        const v = this.eval(a.arg, scope);
        if (Array.isArray(v)) out.push(...v);
      } else out.push(this.eval(a, scope));
    }
    return out;
  }

  call(callee: unknown, args: unknown[], at?: { start: number; end: number }): unknown {
    this.tick(at);
    if (isFnValue(callee)) {
      const local = new Scope(callee.scope);
      callee.params.forEach((p, k) => bindParam(this, p, args[k], local));
      if (Array.isArray(callee.body)) {
        try {
          this.block(callee.body, local);
        } catch (signal) {
          if (signal instanceof ReturnSignal) return signal.value;
          throw signal;
        }
        return undefined;
      }
      return this.eval(callee.body, local);
    }
    // Data still loading flows through calls: load(p).filter(...).map(...) and
    // sum(load(p), "ms") stay pending until the file arrives, instead of failing.
    if (isPendingValue(callee)) return callee;
    if (typeof callee === "function") {
      if (!SAFE_NATIVE.has(callee)) throw new IrisError("That function can't be called from Iris", at?.start, at?.end);
      const pending = args.find(isPendingValue);
      if (pending) return pending;
      return (callee as (...a: unknown[]) => unknown)(...args);
    }
    throw new IrisError(`${at ? "This" : "That"} is not a function`, at?.start, at?.end);
  }

  block(stmts: Stmt[], scope: Scope) {
    for (const st of stmts) {
      this.tick();
      switch (st.s) {
        case "expr": {
          const v = this.eval(st.expr, scope);
          if (this.collected) {
            if (isActionValue(v)) this.collected.push(v);
            else if (Array.isArray(v)) v.filter(isActionValue).forEach((a) => this.collected!.push(a));
          }
          break;
        }
        case "return":
          throw new ReturnSignal(st.expr ? this.eval(st.expr, scope) : undefined);
        case "const":
          scope.vars.set(st.name, this.eval(st.value, scope));
          break;
        case "if":
          if (this.eval(st.test, scope)) this.block(st.then, new Scope(scope));
          else if (st.else) this.block(st.else, new Scope(scope));
          break;
      }
    }
  }

  /** Wraps an Iris function so native code (Array.prototype.map) can call it. */
  toJs(fn: unknown, what: string): (...a: unknown[]) => unknown {
    if (isFnValue(fn)) return (...a: unknown[]) => this.call(fn, a);
    if (typeof fn === "function" && SAFE_NATIVE.has(fn)) return fn as (...a: unknown[]) => unknown;
    throw new IrisError(`${what} needs a function, like (item) => item.name`);
  }
}

function bindParam(it: Interpreter, p: Param, arg: unknown, scope: Scope) {
  if (p.kind === "name") {
    scope.vars.set(p.name, arg === undefined && p.def ? it.eval(p.def, scope) : arg);
  } else if (p.kind === "obj") {
    const o = (arg ?? {}) as Record<string, unknown>;
    for (const n of p.names) {
      const v = typeof o === "object" && Object.hasOwn(o, n.key) ? o[n.key] : undefined;
      scope.vars.set(n.local, v === undefined && n.def ? it.eval(n.def, scope) : v);
    }
  } else {
    const a = Array.isArray(arg) ? arg : [];
    p.names.forEach((n, k) => {
      if (n) scope.vars.set(n, a[k]);
    });
  }
}

export function binary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case "+":
      if (typeof l === "string" || typeof r === "string") return toText(l) + toText(r);
      return (l as number) + (r as number);
    case "-":
      return (l as number) - (r as number);
    case "*":
      return (l as number) * (r as number);
    case "/":
      return (l as number) / (r as number);
    case "%":
      return (l as number) % (r as number);
    case "**":
      return (l as number) ** (r as number);
    case "==":
    case "===":
      return l === r || (l == null && r == null) || (typeof l !== typeof r && (typeof l === "number" || typeof r === "number") && String(l) === String(r));
    case "!=":
    case "!==":
      return !binary("==", l, r);
    case "<":
      return (l as number) < (r as number);
    case ">":
      return (l as number) > (r as number);
    case "<=":
      return (l as number) <= (r as number);
    case ">=":
      return (l as number) >= (r as number);
  }
  throw new IrisError(`Unknown operator ${op}`);
}

/** How a value reads as text inside prose or a template string. */
export function toText(v: unknown): string {
  if (v == null || v === false || v === true) return v === true ? "true" : v === false ? "false" : "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(toText).join(", ");
  if (isElementValue(v)) return `<${v.node.name}>`;
  if (isFnValue(v)) return "(function)";
  if (isPendingValue(v)) return "…";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function plainCopy(v: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) if (!BLOCKED.has(k)) out[k] = (v as Record<string, unknown>)[k];
  return out;
}

function setPath(base: unknown, path: unknown[], value: unknown, at: { start: number; end: number }): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const key = String(head);
  if (BLOCKED.has(key)) throw new IrisError(`"${key}" can't be assigned`, at.start, at.end);
  if (Array.isArray(base)) {
    const copy = base.slice();
    const k = Number(head);
    if (!Number.isInteger(k) || k < 0 || k > 100_000) throw new IrisError("A list index must be a whole number", at.start, at.end);
    copy[k] = setPath(copy[k], rest, value, at);
    return copy;
  }
  const obj = base && typeof base === "object" ? plainCopy(base) : {};
  obj[key] = setPath(obj[key], rest, value, at);
  return obj;
}

const exprName = (e: Expr): string => {
  if (e.t === "id") return e.name;
  if (e.t === "mem" && !e.computed) return `${exprName(e.obj)}.${(e.prop as { v: string }).v}`;
  if (e.t === "mem") return `${exprName(e.obj)}[…]`;
  if (e.t === "call") return `${exprName(e.callee)}(…)`;
  return "the value";
};

function describeProp(e: Extract<Expr, { t: "mem" }>, it: Interpreter, scope: Scope): string {
  if (!e.computed) return `"${(e.prop as { v: string }).v}"`;
  try {
    return `[${JSON.stringify(it.eval(e.prop, scope))}]`;
  } catch {
    return "a field";
  }
}

const ARRAY_METHODS = new Set([
  "map", "filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "reduce", "reduceRight", "slice", "concat",
  "join", "includes", "indexOf", "lastIndexOf", "flat", "flatMap", "at", "sort", "reverse", "forEach", "entries", "keys", "values",
]);
const STRING_METHODS = new Set([
  "toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd", "split", "slice", "substring", "includes", "startsWith", "endsWith",
  "indexOf", "lastIndexOf", "replace", "replaceAll", "padStart", "padEnd", "repeat", "at", "charAt", "localeCompare", "toString", "concat",
]);
const NUMBER_METHODS = new Set(["toFixed", "toPrecision", "toLocaleString", "toString"]);
const FN_ARG_METHODS = new Set(["map", "filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "reduce", "reduceRight", "flatMap", "forEach", "sort"]);

function getMember(obj: unknown, keyRaw: unknown, at: { start: number; end: number }, it: Interpreter): unknown {
  const key = typeof keyRaw === "number" ? keyRaw : String(keyRaw);
  if (typeof key === "string" && BLOCKED.has(key)) throw new IrisError(`"${key}" can't be read`, at.start, at.end);
  if (Array.isArray(obj)) {
    if (key === "length") return obj.length;
    if (typeof key === "number" || /^\d+$/.test(key)) return obj[Number(key)];
    if (typeof key === "string" && ARRAY_METHODS.has(key)) return arrayMethod(obj, key, it);
    return undefined;
  }
  if (typeof obj === "string") {
    if (key === "length") return obj.length;
    if (typeof key === "number" || /^\d+$/.test(key)) return obj[Number(key)];
    if (typeof key === "string" && STRING_METHODS.has(key)) {
      return markSafe((...args: unknown[]) => {
        if ((key === "replace" || key === "replaceAll" || key === "split") && args.some((a) => a instanceof RegExp)) {
          throw new IrisError("Patterns are plain text in Iris");
        }
        return (String.prototype[key as keyof string] as (...a: unknown[]) => unknown).apply(obj, args.map((a) => (isFnValue(a) ? it.toJs(a, key) : a)));
      });
    }
    return undefined;
  }
  if (typeof obj === "number") {
    if (typeof key === "string" && NUMBER_METHODS.has(key)) {
      return markSafe((...args: unknown[]) => (Number.prototype[key as keyof number] as (...a: unknown[]) => unknown).apply(obj, args));
    }
    return undefined;
  }
  if (typeof obj === "object" && obj !== null) {
    if (isElementValue(obj) || isFnValue(obj) || isActionValue(obj)) return undefined;
    if (isPendingValue(obj)) return obj;
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      // Host-provided namespaces (Math) are frozen plain objects too; anything else is opaque.
      return undefined;
    }
    return Object.hasOwn(obj, key) ? (obj as Record<string, unknown>)[key as string] : undefined;
  }
  return undefined;
}

function arrayMethod(arr: unknown[], key: string, it: Interpreter): (...a: unknown[]) => unknown {
  return markSafe((...args: unknown[]) => {
    const a = args.map((x, k) => (k === 0 && FN_ARG_METHODS.has(key) ? it.toJs(x, `${key}()`) : isFnValue(x) ? it.toJs(x, key) : x));
    switch (key) {
      case "sort":
        return arr.slice().sort((a[0] as ((x: unknown, y: unknown) => number) | undefined) ?? defaultCompare);
      case "reverse":
        return arr.slice().reverse();
      case "entries":
        return arr.map((v, k) => [k, v]);
      case "keys":
        return arr.map((_, k) => k);
      case "values":
        return arr.slice();
      case "map":
      case "filter":
      case "find":
      case "findIndex":
      case "findLast":
      case "findLastIndex":
      case "some":
      case "every":
      case "flatMap":
      case "forEach": {
        const fn = a[0] as (v: unknown, k: number) => unknown;
        // Pass (item, index) only: the third array argument would leak a mutable array.
        return (arr as unknown as Record<string, (f: unknown) => unknown>)[key]((v: unknown, k: number) => fn(v, k));
      }
      default:
        return (Array.prototype[key as keyof unknown[]] as (...x: unknown[]) => unknown).apply(arr, a);
    }
  });
}

export function defaultCompare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return toText(a).localeCompare(toText(b), undefined, { numeric: true });
}
