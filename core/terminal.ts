// TerminalReplay's model: reading a recorded session (asciinema v1, v2 and v3
// casts, or a plain list of timed output) and a small terminal that replays
// it. The terminal keeps every line as scrollback and understands what
// recorded output really uses: colors, carriage returns and erases (progress
// bars), cursor moves, clear and the alternate screen. Colors stay theme ANSI
// indexes (core/ansi.ts).

import { type AnsiStyle, applySgr, normalizeEscapes } from "./ansi";

export interface CastEvent {
  t: number;
  text: string;
}
export interface CastMarker {
  t: number;
  label: string;
}
export interface Cast {
  events: CastEvent[];
  markers: CastMarker[];
  cols: number | null;
  rows: number | null;
  title: string | null;
  command: string | null;
  exit: number | null;
  duration: number;
  problems: string[];
}

const MAX_EVENTS = 50_000;
const MAX_TEXT = 2_000_000;

const empty = (problems: string[]): Cast => ({ events: [], markers: [], cols: null, rows: null, title: null, command: null, exit: null, duration: 0, problems });

const numOr = (v: unknown, d: number | null = null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
const strOr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * Reads a recording: asciinema cast text (v2 or v3, one JSON value per line),
 * a v1 object, a list of {t, text} (t in seconds from the start), [t, text] or
 * [t, "o", text], or {events, cols, rows, title}. Text with no timing plays
 * line by line. idle caps every pause (seconds); without it, the cast's
 * idle_time_limit, else 2.
 */
export function parseCast(input: unknown, idle?: number): Cast {
  let header: Record<string, unknown> = {};
  let rows: unknown[] = [];
  let relative = false;
  if (typeof input === "string") {
    const text = input.replace(/^﻿/, "");
    const lines = text.split(/\r?\n/);
    const first = lines.find((l) => l.trim());
    let head: unknown = null;
    try {
      head = first ? JSON.parse(first) : null;
    } catch {
      head = null;
    }
    if (head && typeof head === "object" && !Array.isArray(head) && "version" in head) {
      header = head as Record<string, unknown>;
      if (header.version === 1) return fromV1(header, idle);
      relative = header.version === 3;
      const bad: number[] = [];
      lines.slice(lines.indexOf(first!) + 1).forEach((l, k) => {
        if (!l.trim()) return;
        try {
          rows.push(JSON.parse(l));
        } catch {
          bad.push(k + 2);
        }
      });
      if (bad.length) return finish(header, rows, relative, idle, [`line ${bad[0]} of the cast is not JSON${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ""}`]);
    } else {
      // Plain text: a line every 60 ms, so it still reads as a session.
      const out = normalizeEscapes(text).split("\n");
      return finish({}, out.map((l, k) => [k * 0.06, k < out.length - 1 ? `${l}\n` : l]), false, idle, []);
    }
  } else if (Array.isArray(input)) {
    rows = input;
  } else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (o.version === 1) return fromV1(o, idle);
    header = o;
    rows = Array.isArray(o.events) ? o.events : Array.isArray(o.frames) ? o.frames : Array.isArray(o.stdout) ? o.stdout : [];
    relative = o.version === 3;
    if (!rows.length) return empty(["needs events: a list of {t, text}"]);
  } else {
    return empty(["needs a recording: asciinema cast text, or a list of {t, text}"]);
  }
  return finish(header, rows, relative, idle, []);
}

function fromV1(o: Record<string, unknown>, idle: number | undefined): Cast {
  const stdout = Array.isArray(o.stdout) ? o.stdout : [];
  return finish(o, stdout.map((f) => (Array.isArray(f) ? [f[0], "o", f[1]] : f)), true, idle, []);
}

function finish(header: Record<string, unknown>, rows: unknown[], relative: boolean, idle: number | undefined, problems: string[]): Cast {
  const term = header.term && typeof header.term === "object" ? (header.term as Record<string, unknown>) : {};
  let cols = numOr(header.width ?? header.cols ?? term.cols);
  const height = numOr(header.height ?? header.rows ?? term.rows);
  const limit = idle ?? numOr(header.idle_time_limit) ?? 2;
  const events: CastEvent[] = [];
  const markers: CastMarker[] = [];
  let exit: number | null = numOr(header.exit);
  let clock = 0; // the recording's time
  let shown = 0; // time after idle capping
  let prev = 0;
  let size = 0;
  let skipped = 0;
  rows.forEach((r, k) => {
    let t: number | null = null;
    let code = "o";
    let data: unknown;
    let label: string | null = null;
    if (Array.isArray(r)) {
      t = numOr(r[0]);
      if (r.length >= 3) {
        code = String(r[1]);
        data = r[2];
      } else data = r[1];
    } else if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      t = numOr(o.t ?? o.time ?? o.at);
      data = o.text ?? o.data ?? o.output;
      label = strOr(o.marker) ?? strOr(o.label);
      if (label && data == null) {
        code = "m";
        data = label;
        label = null;
      }
    } else {
      skipped++;
      return;
    }
    if (t == null || t < 0) {
      if (problems.length < 3) problems.push(`event ${k + 1} needs a time t in seconds`);
      return;
    }
    clock = relative ? clock + t : t;
    let gap = Math.max(0, clock - prev);
    prev = clock;
    if (limit != null && limit > 0) gap = Math.min(gap, limit);
    shown += gap;
    if (code === "o") {
      if (typeof data !== "string") {
        skipped++;
        return;
      }
      if (events.length >= MAX_EVENTS || size + data.length > MAX_TEXT) return;
      size += data.length;
      events.push({ t: shown, text: normalizeEscapes(data) });
      if (label) markers.push({ t: shown, label });
    } else if (code === "m") markers.push({ t: shown, label: typeof data === "string" && data.trim() ? data : `Marker ${markers.length + 1}` });
    else if (code === "r" && typeof data === "string") {
      const m = /^(\d+)x(\d+)$/.exec(data.trim());
      if (m) cols = Number(m[1]);
    } else if (code === "x") exit = numOr(data);
  });
  if (skipped && problems.length < 3) problems.push(`${skipped} event${skipped === 1 ? "" : "s"} had no text`);
  if (!events.length && !problems.length) problems.push("has no output events");
  const duration = Math.max(events.length ? events[events.length - 1].t : 0, markers.length ? markers[markers.length - 1].t : 0);
  return {
    events,
    markers,
    cols: cols && cols >= 10 && cols <= 500 ? Math.round(cols) : null,
    rows: height && height >= 2 && height <= 300 ? Math.round(height) : null,
    title: strOr(header.title),
    command: strOr(header.command),
    exit,
    duration,
    problems,
  };
}

/** How many events have happened by time t (events are in time order). */
export function eventsUntil(events: CastEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------- the terminal ----------

export interface TermSpan extends AnsiStyle {
  text: string;
}

const MAX_LINES = 5000;
/** Line width when the recording names none; longer lines wrap. */
const MAX_COLS = 1000;
const BLANK: AnsiStyle = {};

interface Row {
  chars: string[];
  styles: AnsiStyle[];
}

const newRow = (): Row => ({ chars: [], styles: [] });

/** A scrollback terminal: write() recorded output, read lines() back as styled spans. */
export class Terminal {
  rows: Row[] = [newRow()];
  row = 0;
  col = 0;
  style: AnsiStyle = BLANK;
  private saved: { row: number; col: number } | null = null;
  private main: { rows: Row[]; row: number; col: number } | null = null;
  private pending = "";
  /** Lines dropped off the top once the scrollback is full. */
  dropped = 0;

  constructor(
    readonly cols: number | null = null,
    readonly height: number | null = null,
  ) {}

  write(input: string): void {
    const s = this.pending + input;
    this.pending = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\u001b") {
        const used = this.escape(s, i);
        if (used === 0) {
          this.pending = s.slice(i);
          return;
        }
        i += used;
        continue;
      }
      i++;
      if (ch === "\n") this.lineFeed();
      else if (ch === "\r") this.col = 0;
      else if (ch === "\b") this.col = Math.max(0, this.col - 1);
      else if (ch === "\t") this.col = Math.min((Math.floor(this.col / 8) + 1) * 8, this.width() - 1);
      else if (ch === "\u0007" || ch < " ") continue;
      else this.put(ch);
    }
  }

  private put(ch: string) {
    if (this.col >= this.width()) this.lineFeed();
    const r = this.at(this.row);
    while (r.chars.length < this.col) {
      r.chars.push(" ");
      r.styles.push(BLANK);
    }
    r.chars[this.col] = ch;
    r.styles[this.col] = this.style;
    this.col++;
  }

  private lineFeed() {
    this.row++;
    this.col = 0;
    this.at(this.row);
  }

  /** The row, created if needed; the scrollback keeps its last MAX_LINES rows. */
  private at(row: number): Row {
    while (this.rows.length <= row) this.rows.push(newRow());
    if (this.rows.length > MAX_LINES) {
      const cut = this.rows.length - MAX_LINES;
      this.rows.splice(0, cut);
      this.row = Math.max(0, this.row - cut);
      this.dropped += cut;
      return this.rows[Math.max(0, row - cut)];
    }
    return this.rows[row];
  }

  private width(): number {
    return this.cols ?? MAX_COLS;
  }

  /** Cursor moves stay on the screen: inside the width, and no lower than a screen below its top. */
  private clampCursor() {
    this.col = Math.max(0, Math.min(this.col, this.width() - 1));
    this.row = Math.max(0, Math.min(this.row, this.top() + this.screen() - 1));
    this.at(this.row);
  }

  /** Rows on screen: the recording's height, else a tall stand-in. */
  private screen(): number {
    return this.height ?? 200;
  }

  /** The first row of what a real screen would show. */
  private top(): number {
    return Math.max(0, this.rows.length - this.screen());
  }

  /** Handles an escape at s[i]; returns how many characters it used, 0 if cut off. */
  private escape(s: string, i: number): number {
    const next = s[i + 1];
    if (next === undefined) return 0;
    if (next === "[") {
      let j = i + 2;
      while (j < s.length && !/[@-~]/.test(s[j])) j++;
      if (j >= s.length) return s.length - i > 64 ? s.length - i : 0;
      this.csi(s.slice(i + 2, j), s[j]);
      return j - i + 1;
    }
    if (next === "]") {
      // OSC (window title, links): skip to BEL or ESC \.
      for (let j = i + 2; j < s.length; j++) {
        if (s[j] === "\u0007") return j - i + 1;
        if (s[j] === "\u001b" && s[j + 1] === "\\") return j - i + 2;
      }
      return s.length - i > 512 ? s.length - i : 0;
    }
    if (next === "7") this.saved = { row: this.row, col: this.col };
    else if (next === "8" && this.saved) ({ row: this.row, col: this.col } = this.saved);
    else if (next === "(" || next === ")") return s[i + 2] === undefined ? 0 : 3;
    else if (next === "c") this.clear();
    return 2;
  }

  private csi(body: string, final: string) {
    const priv = body.startsWith("?");
    const params = (priv ? body.slice(1) : body).split(";").map((x) => (x === "" ? NaN : Number(x)));
    const n = (k: number, d = 1) => (Number.isFinite(params[k]) && params[k] > 0 ? params[k] : d);
    if (priv) {
      if ((final === "h" || final === "l") && (params[0] === 1049 || params[0] === 47 || params[0] === 1047)) this.altScreen(final === "h");
      return;
    }
    this.move(final, n, params);
  }

  private move(final: string, n: (k: number, d?: number) => number, params: number[]) {
    switch (final) {
      case "m":
        this.style = applySgr(this.style, params.map((x) => (Number.isFinite(x) ? x : 0)));
        if (!Object.keys(this.style).some((k) => this.style[k as keyof AnsiStyle] !== undefined && this.style[k as keyof AnsiStyle] !== false)) this.style = BLANK;
        break;
      case "A":
        this.row = Math.max(this.top(), this.row - n(0));
        break;
      case "B":
        this.row += n(0);
        break;
      case "C":
        this.col += n(0);
        break;
      case "D":
        this.col = Math.max(0, this.col - n(0));
        break;
      case "E":
        this.row += n(0);
        this.col = 0;
        break;
      case "F":
        this.row = Math.max(this.top(), this.row - n(0));
        this.col = 0;
        break;
      case "G":
        this.col = n(0) - 1;
        break;
      case "H":
      case "f":
        this.row = this.top() + n(0) - 1;
        this.col = n(1) - 1;
        break;
      case "K": {
        const r = this.at(this.row);
        const mode = Number.isFinite(params[0]) ? params[0] : 0;
        if (mode === 0) {
          r.chars.length = Math.min(r.chars.length, this.col);
          r.styles.length = r.chars.length;
        } else if (mode === 1) for (let k = 0; k <= this.col && k < r.chars.length; k++) r.chars[k] = " ";
        else this.rows[this.row] = newRow();
        break;
      }
      case "J": {
        const mode = Number.isFinite(params[0]) ? params[0] : 0;
        if (mode === 2 || mode === 3) this.clear();
        else if (mode === 0) {
          const r = this.at(this.row);
          r.chars.length = Math.min(r.chars.length, this.col);
          r.styles.length = r.chars.length;
          this.rows.length = this.row + 1;
        }
        break;
      }
      case "s":
        this.saved = { row: this.row, col: this.col };
        break;
      case "u":
        if (this.saved) ({ row: this.row, col: this.col } = this.saved);
        break;
    }
    if ("ABCDEFGHfu".includes(final)) this.clampCursor();
  }

  private clear() {
    this.rows = [newRow()];
    this.row = 0;
    this.col = 0;
  }

  private altScreen(on: boolean) {
    if (on && !this.main) {
      this.main = { rows: this.rows, row: this.row, col: this.col };
      this.clear();
    } else if (!on && this.main) {
      ({ rows: this.rows, row: this.row, col: this.col } = this.main);
      this.main = null;
    }
  }

  /** Every line as styled spans, trailing empty lines kept up to the cursor. */
  lines(): TermSpan[][] {
    return this.rows.map((r) => {
      const out: TermSpan[] = [];
      for (let k = 0; k < r.chars.length; k++) {
        const st = r.styles[k] ?? BLANK;
        const last = out[out.length - 1];
        if (last && sameStyle(last, st)) last.text += r.chars[k];
        else out.push({ ...st, text: r.chars[k] });
      }
      return out;
    });
  }

  /** Plain text of the screen, for copy. */
  text(): string {
    return this.rows.map((r) => r.chars.join("").trimEnd()).join("\n").replace(/\n+$/, "");
  }
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold && !!a.dim === !!b.dim && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.inverse === !!b.inverse;
}

/** "1:05" or "0:07.4" style clock for the scrubber. */
export function castClock(seconds: number, tenths = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const sec = `${m}:${String(whole).padStart(2, "0")}`;
  return tenths ? `${sec}.${Math.floor((rest - whole) * 10)}` : sec;
}
