// A compiled Iris block and the runtime one card instance uses: its state,
// its derived values, its file loads, and the interpreter they share.

import type { Attr, ElementNode, Expr, Node, ParseIssue } from "./ast";
import { type Host, Interpreter, IrisError, type PendingValue, Scope, isElementValue, mint } from "./evaluate";
import { parse } from "./parse";
import { createGlobals } from "./stdlib";

/** How many distinct files or plugin feeds one card may read. */
export const MAX_LOADS_PER_CARD = 32;
/** How long a source must go unread before a new one may take its place. */
export const LOAD_IDLE_MS = 5000;

export interface Declaration {
  name: string;
  expr: Expr | null;
  node: ElementNode;
}

export interface Program {
  source: string;
  nodes: Node[];
  states: Declaration[];
  lets: Declaration[];
  error: ParseIssue | null;
  incomplete: boolean;
}

export const DECLARATION_TAGS = new Set(["state", "let"]);

export function compile(source: string): Program {
  const result = parse(source);
  const states: Declaration[] = [];
  const lets: Declaration[] = [];
  const visit = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind !== "element") continue;
      if (n.name === "state" || n.name === "let") {
        // A declaration counts once its tag is complete.
        if (!n.closed && !n.selfClosing) continue;
        for (const a of n.attrs) {
          if (a.name === "...") continue;
          (n.name === "state" ? states : lets).push({ name: a.name, expr: a.value, node: n });
        }
        continue;
      }
      visit(n.children);
    }
  };
  visit(result.nodes);
  return { source, nodes: result.nodes, states, lets, error: result.error, incomplete: result.incomplete };
}

export type LoadResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface RuntimeOptions {
  /** Reads a workspace or thread-storage file; resolves to parsed data, raw text, or with tail the end of a growing text file ({text, size, truncated}). */
  load?: (path: string, raw: boolean, tail?: boolean) => Promise<LoadResult>;
  /** State values saved from an earlier session of this card. */
  saved?: Record<string, unknown>;
  now?: () => number;
  budget?: number;
  /** Files already read (checks run synchronously), keyed like load(): "raw:" + path for raw reads, "tail:" + path for tails. */
  preloaded?: Map<string, LoadResult>;
}

interface LoadEntry {
  status: "loading" | "ok" | "error";
  value?: unknown;
  error?: string;
  /** Set by reloadFiles: fetch again, but keep showing the old value until it arrives. */
  stale?: boolean;
  fetching?: boolean;
  /** When a render last read it (ms). */
  readAt?: number;
  /** When it last read fine (ms). */
  goodAt?: number;
  /** A refresh after a good read failed: the last good value stays, and this says why it's old. */
  retryError?: string;
  /** When the current or last fetch started (ms), so slow sources can be re-read less often. */
  fetchedAt?: number;
}

/** Plugin sources are read from bb's page over HTTP: live cards re-read them at most this often. */
export const PLUGIN_REFRESH_MS = 10_000;

export class CardRuntime implements Host {
  program: Program;
  readonly state = new Map<string, unknown>();
  /** Bumped on every change; the renderer subscribes to it. */
  version = 0;
  readonly interp: Interpreter;
  readonly globals: Scope;
  private letCache = new Map<string, unknown>();
  private letBusy = new Set<string>();
  private letErrors = new Map<string, IrisError>();
  private loads = new Map<string, LoadEntry>();
  /** Files live components read; a block made live only by them re-reads just these. */
  private watched = new Set<string>();
  private listeners = new Set<() => void>();
  readonly initErrors = new Map<string, IrisError>();

  constructor(
    program: Program,
    readonly options: RuntimeOptions = {},
  ) {
    this.program = program;
    this.globals = createGlobals(
      () => this.interp,
      () => this,
    );
    this.interp = new Interpreter(this, this.globals, options.budget);
    this.initStates();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.version++;
    this.letCache.clear();
    this.letErrors.clear();
    for (const fn of this.listeners) fn();
  }

  /** A streaming update: keeps state already set, adds new declarations. */
  update(program: Program) {
    this.program = program;
    this.initStates();
    this.notify();
  }

  private initStates() {
    for (const d of this.program.states) {
      if (this.state.has(d.name)) continue;
      if (this.options.saved && Object.hasOwn(this.options.saved, d.name)) {
        this.state.set(d.name, this.options.saved[d.name]);
        continue;
      }
      try {
        this.interp.steps = 0;
        this.state.set(d.name, d.expr ? this.interp.eval(d.expr, this.globals) : true);
        this.initErrors.delete(d.name);
      } catch (cause) {
        this.state.set(d.name, undefined);
        this.initErrors.set(d.name, asIrisError(cause, d.node));
      }
    }
  }

  /** Puts every state back to its declared starting value. */
  reset() {
    this.state.clear();
    this.options.saved = undefined;
    this.initStates();
    this.notify();
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.state);
  }

  /** What a picker answers with: the <state> values, without components' own "@" progress. */
  answers(): Record<string, unknown> {
    return Object.fromEntries([...this.state].filter(([k]) => !k.startsWith("@")));
  }

  // ---- Host ----
  hasState(name: string) {
    return this.state.has(name);
  }
  getState(name: string) {
    return this.state.get(name);
  }
  setState(name: string, value: unknown) {
    if (Object.is(this.state.get(name), value)) return;
    this.state.set(name, value);
    this.notify();
  }
  hasLet(name: string) {
    return this.program.lets.some((d) => d.name === name);
  }
  getLet(name: string): unknown {
    if (this.letCache.has(name)) return this.letCache.get(name);
    const known = this.letErrors.get(name);
    if (known) throw known;
    const d = this.program.lets.find((x) => x.name === name);
    if (!d) return undefined;
    if (this.letBusy.has(name)) throw new IrisError(`${name} depends on itself`, d.node.start, d.node.end);
    this.letBusy.add(name);
    try {
      const v = d.expr ? this.interp.eval(d.expr, this.globals) : true;
      this.letCache.set(name, v);
      return v;
    } catch (cause) {
      const err = asIrisError(cause, d.node);
      this.letErrors.set(name, err);
      throw err;
    } finally {
      this.letBusy.delete(name);
    }
  }
  now() {
    return (this.options.now ?? Date.now)();
  }
  load(path: string, options?: { raw?: boolean; tail?: boolean; fallback?: unknown }): unknown {
    const tail = options?.tail === true;
    const raw = !tail && options?.raw === true;
    // With a fallback, a source that can't be read gives that value instead of an error, so a card
    // can say "slow to answer" in its own words.
    const hasFallback = options !== undefined && options !== null && Object.prototype.hasOwnProperty.call(options, "fallback");
    const key = `${tail ? "tail:" : raw ? "raw:" : ""}${path}`;
    const pre = this.options.preloaded?.get(key);
    if (pre) {
      if (pre.ok) return pre.value;
      if (hasFallback) return options?.fallback;
      throw new IrisError(`load("${path}"): ${pre.error}`);
    }
    const entry = this.loads.get(key);
    // A card holds at most MAX_LOADS_PER_CARD sources. A new one may replace only a source
    // nothing read for LOAD_IDLE_MS, however often or in whatever order the card renders; a card
    // that keeps more than the cap in use gets an error, never a cycle of dropping and refetching.
    const now = this.now();
    if (entry) entry.readAt = now;
    else if (this.loads.size >= MAX_LOADS_PER_CARD) {
      const old = [...this.loads].find(([, e]) => (e.readAt ?? 0) < now - LOAD_IDLE_MS);
      if (!old) throw new IrisError(`load("${path}"): a card reads at most ${MAX_LOADS_PER_CARD} files or feeds at once`);
      this.loads.delete(old[0]);
    }
    if (!entry || (entry.stale && !entry.fetching)) this.fetch(key, path, raw, tail, entry);
    if (entry?.status === "ok") return entry.value;
    if (entry?.status === "error") {
      if (hasFallback) return options?.fallback;
      throw new IrisError(`load("${path}"): ${entry.error}`);
    }
    return mint({ $iris: "pending", path } satisfies PendingValue);
  }
  private fetch(key: string, path: string, raw: boolean, tail: boolean, previous: LoadEntry | undefined) {
    if (!this.options.load) {
      this.loads.set(key, { status: "error", error: "files can't be read here" });
      return;
    }
    // A live re-read keeps the entry's last read time: only a render reading it counts as use.
    const started = this.now();
    this.loads.set(key, previous ? { ...previous, fetching: true, stale: false, fetchedAt: started } : { status: "loading", fetching: true, readAt: started, fetchedAt: started });
    const failed = (error: string) => {
      if (!this.loads.has(key)) return;
      const before = this.loads.get(key);
      // A refresh that fails after a good read keeps the good value on screen and says it's old;
      // only a source that never read fine shows an error. One slow answer never breaks a card.
      if (before?.status === "ok") {
        const changed = before.retryError !== error;
        this.loads.set(key, { ...before, fetching: false, retryError: error });
        if (changed) this.notify();
        return;
      }
      this.loads.set(key, { status: "error", error, readAt: before?.readAt, fetchedAt: before?.fetchedAt });
      this.notify();
    };
    this.options.load(path, raw, tail).then(
      (r) => {
        if (!this.loads.has(key)) return; // dropped while it was in flight
        if (!r.ok) return failed(r.error);
        const before = this.loads.get(key);
        const goodAt = this.now();
        const same = before !== undefined && before.status === "ok" && !before.retryError && JSON.stringify(before.value) === JSON.stringify(r.value);
        // A live refresh that changed nothing keeps the old value, so views keep
        // their memos (a 20,000-row grid doesn't re-index), and doesn't re-render.
        this.loads.set(key, same ? { status: "ok", value: before.value, readAt: before.readAt, goodAt, fetchedAt: before.fetchedAt } : { status: "ok", value: r.value, readAt: before?.readAt, goodAt, fetchedAt: before?.fetchedAt });
        if (!same) this.notify();
      },
      (cause: unknown) => failed(cause instanceof Error ? cause.message : String(cause)),
    );
  }

  /** load() for a live component: the file is re-read even when no Card is live. */
  loadLive(path: string, options?: { raw?: boolean; tail?: boolean }): unknown {
    const tail = options?.tail === true;
    this.watched.add(`${tail ? "tail:" : !tail && options?.raw === true ? "raw:" : ""}${path}`);
    return this.load(path, options);
  }

  /** Whether a live component has read a file through loadLive. */
  isWatching(): boolean {
    return this.watched.size > 0;
  }

  /**
   * Re-reads loaded files (live cards), keeping old values on screen until new
   * ones arrive. "watched" re-reads only the files live components asked for.
   */
  reloadFiles(which: "all" | "watched" = "all") {
    const now = this.now();
    for (const [key, entry] of this.loads) {
      if (entry.fetching) continue;
      if (which === "watched" && !this.watched.has(key)) continue;
      const raw = key.startsWith("raw:");
      const tail = key.startsWith("tail:");
      const path = raw ? key.slice(4) : tail ? key.slice(5) : key;
      // Another plugin's data costs bb an HTTP round trip: it refreshes every PLUGIN_REFRESH_MS, not every tick.
      if (path.startsWith("plugin:") && entry.fetchedAt !== undefined && now - entry.fetchedAt < PLUGIN_REFRESH_MS) continue;
      this.fetch(key, path, raw, tail, entry);
    }
  }

  /** When some source failed its last refresh: the oldest last-good time among them, and why. */
  staleness(): { since: number; error: string } | null {
    let out: { since: number; error: string } | null = null;
    for (const e of this.loads.values()) {
      if (e.status !== "ok" || !e.retryError) continue;
      const since = e.goodAt ?? 0;
      if (!out || since < out.since) out = { since, error: e.retryError };
    }
    return out;
  }
  loadedPaths(): string[] {
    return [...new Set([...this.loads.keys()].map((k) => k.replace(/^(raw|tail):/, "")))];
  }

  /** Evaluates one attribute in the scope an element was written in. */
  attr(a: Attr, scope: Scope): unknown {
    if (a.value === null) return true;
    this.interp.steps = 0;
    return this.interp.eval(a.value, scope);
  }

  /** All attributes of an element as props; spread attributes merge in. */
  props(el: ElementNode, scope: Scope): { props: Record<string, unknown>; errors: Map<string, IrisError> } {
    const props: Record<string, unknown> = {};
    const errors = new Map<string, IrisError>();
    for (const a of el.attrs) {
      try {
        const v = this.attr(a, scope);
        if (a.name === "...") {
          if (v && typeof v === "object" && !Array.isArray(v) && !isElementValue(v)) Object.assign(props, v);
        } else props[a.name] = v;
      } catch (cause) {
        errors.set(a.name, asIrisError(cause, a));
      }
    }
    return { props, errors };
  }
}

export function asIrisError(cause: unknown, at: { start: number; end: number }): IrisError {
  if (cause instanceof IrisError) return cause.start === undefined ? new IrisError(cause.message, at.start, at.end) : cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof RangeError) return new IrisError(`This card recursed too deeply (${message})`, at.start, at.end);
  return new IrisError(message, at.start, at.end);
}

/** Line and column of an offset, 1-based. */
export function position(source: string, offset: number): { line: number; col: number } {
  const before = source.slice(0, offset);
  return { line: before.split("\n").length, col: offset - before.lastIndexOf("\n") };
}
