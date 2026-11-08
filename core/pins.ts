// Pinned cards: the live cards a thread keeps beside its conversation. A pin holds a card's
// source, or the path of a file holding one, so an agent can update a pinned card by rewriting
// the file. Pins belong to one thread; the person and the thread's agent both set them.

export const MAX_PINS = 5;
export const MAX_PIN_SOURCE = 100_000;

export type PinBy = "agent" | "person";

/**
 * A pin's alert: an Iris expression over the card's own names (its lets, states and loads). When it
 * turns true, the pin asks for the person's attention until they dismiss it.
 */
export interface PinAlert {
  when: string;
  /** What the alert says; default the card's title. */
  message?: string;
  /** The condition held at the last check. */
  firing?: boolean;
  /** When it last turned true, ms since the epoch. */
  since?: number;
  /** The person dismissed this firing. A new firing (false, then true again) asks again. */
  seen?: boolean;
}

export const MAX_ALERT_WHEN = 500;

export interface Pin {
  /** Stable within the thread: pinning again with the same id replaces the pin in place. */
  id: string;
  title: string;
  /** The card's Iris markup, when the pin holds it. */
  source?: string;
  /** A workspace or thread storage path whose content is the card, re-read while it shows. */
  file?: string;
  by: PinBy;
  /** When it was pinned or last replaced, ms since the epoch. */
  at: number;
  alert?: PinAlert;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A card's title from its first <Card title="...">, else a fallback. */
export function cardTitle(source: string, fallback = "Iris card"): string {
  return /<Card\b[^>]*?\btitle="([^"]{1,120})"/.exec(source)?.[1] ?? fallback;
}

/** An id from a title: lowercase words joined by dashes, or a short hash of the content. */
export function pinId(title: string, content: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (slug && ID.test(slug)) return slug;
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 0x01000193);
  return `card-${(h >>> 0).toString(36)}`;
}

export function validPinId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

/** A card file's body: the content without a surrounding ```iris fence, if it has one. */
export function cardFromFile(text: string): string {
  const m = /^\s*```[\w-]*[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1] : text;
}

/**
 * The stored pins, cleaned: the list format, or the one pin of Iris 1.x before 1.10 ({source, title}),
 * which reads as the person's pin. Anything malformed is dropped.
 */
export function normalizePins(stored: unknown): Pin[] {
  if (!stored || typeof stored !== "object") return [];
  const o = stored as Record<string, unknown>;
  const raw: unknown[] = Array.isArray(o.pins) ? o.pins : typeof o.source === "string" && o.source ? [{ id: pinId(typeof o.title === "string" ? o.title : "", o.source), title: o.title, source: o.source, by: "person", at: 0 }] : [];
  const out: Pin[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const source = typeof p.source === "string" && p.source.trim() ? p.source.slice(0, MAX_PIN_SOURCE) : undefined;
    const file = typeof p.file === "string" && p.file.trim() ? p.file.trim().slice(0, 2000) : undefined;
    if (!source && !file) continue;
    const id = validPinId(p.id) ? p.id : pinId(typeof p.title === "string" ? p.title : "", source ?? file ?? "");
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id,
      title: typeof p.title === "string" && p.title.trim() ? p.title.trim().slice(0, 120) : source ? cardTitle(source) : (file ?? "Iris card").split("/").pop() ?? "Iris card",
      ...(source ? { source } : { file }),
      by: p.by === "agent" ? "agent" : "person",
      at: typeof p.at === "number" && Number.isFinite(p.at) ? p.at : 0,
      ...(normalizeAlert(p.alert) ? { alert: normalizeAlert(p.alert) } : {}),
    });
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

export type PinChange = { ok: true; pins: Pin[]; replaced: boolean } | { ok: false; error: string };

/** The list with pin added, or replacing the pin with its id in place. A sixth pin is refused. */
export function upsertPin(pins: Pin[], pin: Pin): PinChange {
  const at = pins.findIndex((p) => p.id === pin.id);
  if (at >= 0) {
    const next = pins.slice();
    next[at] = pin;
    return { ok: true, pins: next, replaced: true };
  }
  if (pins.length >= MAX_PINS) return { ok: false, error: `this thread already has ${MAX_PINS} pins: unpin one first (${pins.map((p) => p.id).join(", ")})` };
  return { ok: true, pins: [...pins, pin], replaced: false };
}

/** The list without the pin with that id; ok is false when there was none. */
export function removePin(pins: Pin[], id: string): { ok: boolean; pins: Pin[] } {
  const next = pins.filter((p) => p.id !== id);
  return { ok: next.length !== pins.length, pins: next };
}

/** One thread's pins on bb's home page. */
export interface PinnedThread {
  threadId: string;
  title: string;
  projectId: string | null;
  pins: Pin[];
}

/** Threads with pins, the most recently pinned first, each thread's pins newest first. */
export function newestPinnedFirst(threads: PinnedThread[]): PinnedThread[] {
  const latest = (t: PinnedThread) => Math.max(0, ...t.pins.map((p) => p.at));
  return threads
    .filter((t) => t.pins.length > 0)
    .map((t) => ({ ...t, pins: t.pins.slice().sort((a, b) => b.at - a.at) }))
    .sort((a, b) => latest(b) - latest(a) || a.threadId.localeCompare(b.threadId));
}

function normalizeAlert(stored: unknown): PinAlert | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const a = stored as Record<string, unknown>;
  if (typeof a.when !== "string" || !a.when.trim() || a.when.length > MAX_ALERT_WHEN) return undefined;
  return {
    when: a.when.trim(),
    ...(typeof a.message === "string" && a.message.trim() ? { message: a.message.trim().slice(0, 200) } : {}),
    ...(a.firing === true ? { firing: true } : {}),
    ...(typeof a.since === "number" && Number.isFinite(a.since) ? { since: a.since } : {}),
    ...(a.seen === true ? { seen: true } : {}),
  };
}

/** The pin asks for the person's attention: its alert holds and they haven't dismissed it. */
export const needsAttention = (pin: Pin): boolean => pin.alert?.firing === true && pin.alert.seen !== true;

/** What a pin's alert says. */
export const alertText = (pin: Pin): string => pin.alert?.message ?? pin.title;

/**
 * The alert after a check. held is the condition's value, or null when it couldn't be decided
 * (a source still loading or unreadable), which changes nothing. fired is true only on the turn
 * from false to true.
 */
export function stepAlert(alert: PinAlert, held: boolean | null, now: number): { alert: PinAlert; fired: boolean; changed: boolean } {
  if (held === null) return { alert, fired: false, changed: false };
  if (held && !alert.firing) return { alert: { when: alert.when, ...(alert.message ? { message: alert.message } : {}), firing: true, since: now }, fired: true, changed: true };
  if (!held && alert.firing) return { alert: { when: alert.when, ...(alert.message ? { message: alert.message } : {}) }, fired: false, changed: true };
  return { alert, fired: false, changed: false };
}
