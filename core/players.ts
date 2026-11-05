// Rules for VideoPlayer and AudioPlayer: times written the way people write
// them, chapters, timestamped notes, transcripts (lists, WebVTT or SRT) and
// the waveform's peaks. The views live in chunks/players.tsx.

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const MEDIA_EXTENSIONS = {
  video: ["mp4", "m4v", "webm", "mov", "ogv"],
  audio: ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm"],
} as const;

/** Seconds from 83, "83", "1:23", "1:23.5", "01:02:03", "00:01:23,500" (SRT) or "1m 23s". null when unreadable. */
export function parseTime(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (clock) {
    const h = clock[1] ? Number(clock[1]) : 0;
    return h * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  const units = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
  if (units && (units[1] || units[2] || units[3])) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  return null;
}

/** 83.4 → "1:23"; with frames at 24 fps → "1:23:10"; past an hour "1:02:03". */
export function formatTime(seconds: number, opts: { fps?: number; tenths?: boolean } = {}): string {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(t + 1e-6);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  let out = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (opts.fps) out += `:${pad(Math.min(Math.round(opts.fps) - 1, Math.floor((t - whole) * opts.fps + 1e-6)))}`;
  else if (opts.tenths) out += `.${Math.min(9, Math.floor((t - whole) * 10 + 1e-6))}`;
  return out;
}

export interface Chapter {
  at: number;
  title: string;
}

export interface TimedNote {
  at: number;
  text: string;
  tone?: string;
}

export interface TranscriptLine {
  at: number;
  end: number | null;
  text: string;
  speaker?: string;
}

/** An item written as an object, or as an [at, value] pair. */
const pair = (v: unknown, second: string): Record<string, unknown> | null =>
  Array.isArray(v) ? { at: v[0], [second]: v[1] } : v && typeof v === "object" ? (v as Record<string, unknown>) : null;

const textOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Chapters sorted by start; [at, title] pairs work too. Unreadable ones are reported, not dropped silently. */
export function normalizeChapters(v: unknown): { items: Chapter[]; problems: string[] } {
  const items: Chapter[] = [];
  const problems: string[] = [];
  if (v == null) return { items, problems };
  if (!Array.isArray(v)) return { items, problems: ["chapters must be a list"] };
  v.forEach((c, k) => {
    const raw = pair(c, "title");
    const at = parseTime(raw?.at ?? raw?.time ?? raw?.start);
    if (at === null) return problems.push(`chapter ${k + 1} has no readable at`);
    items.push({ at, title: textOf(raw?.title ?? raw?.label).trim() || `Chapter ${k + 1}` });
  });
  items.sort((a, b) => a.at - b.at);
  return { items, problems };
}

export function normalizeNotes(v: unknown): { items: TimedNote[]; problems: string[] } {
  const items: TimedNote[] = [];
  const problems: string[] = [];
  if (v == null) return { items, problems };
  if (!Array.isArray(v)) return { items, problems: ["notes must be a list"] };
  v.forEach((n, k) => {
    const raw = pair(n, "text");
    const at = parseTime(raw?.at ?? raw?.time);
    const text = textOf(raw?.text ?? raw?.note ?? raw?.title).trim();
    if (at === null) return problems.push(`note ${k + 1} has no readable at`);
    if (!text) return problems.push(`note ${k + 1} has no text`);
    items.push({ at, text, tone: typeof raw?.tone === "string" ? raw.tone : undefined });
  });
  items.sort((a, b) => a.at - b.at);
  return { items, problems };
}

/**
 * Transcript lines from a list ({at, end?, text, speaker?} or [at, text]) or
 * from WebVTT or SRT text. A line without an end runs until the next one.
 */
export function normalizeTranscript(v: unknown): { items: TranscriptLine[]; problems: string[] } {
  if (v == null) return { items: [], problems: [] };
  if (typeof v === "string") return parseCaptions(v);
  if (!Array.isArray(v)) return { items: [], problems: ["transcript must be a list or WebVTT/SRT text"] };
  const items: TranscriptLine[] = [];
  const problems: string[] = [];
  v.forEach((l, k) => {
    const raw = pair(l, "text");
    const at = parseTime(raw?.at ?? raw?.start ?? raw?.time);
    const text = textOf(raw?.text).trim();
    if (at === null) return problems.push(`line ${k + 1} has no readable at`);
    if (!text) return problems.push(`line ${k + 1} has no text`);
    const end = parseTime(raw?.end);
    items.push({ at, end: end !== null && end > at ? end : null, text, speaker: textOf(raw?.speaker).trim() || undefined });
  });
  items.sort((a, b) => a.at - b.at);
  return { items, problems };
}

const CUE = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d+)?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d+)?)/;

/** WebVTT or SRT cues. A "<v Name>" voice tag or a leading "Name:" becomes the speaker. */
export function parseCaptions(text: string): { items: TranscriptLine[]; problems: string[] } {
  const items: TranscriptLine[] = [];
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => CUE.test(l));
    if (i < 0) continue;
    const m = CUE.exec(lines[i])!;
    const at = parseTime(m[1]);
    const end = parseTime(m[2]);
    let body = lines
      .slice(i + 1)
      .join(" ")
      .trim();
    let speaker: string | undefined;
    body = body.slice(0, 4000);
    const voice = /^<v(?:\.[\w.-]{1,40})?\s([^>]{1,200})>/.exec(body);
    if (voice) speaker = voice[1].trim();
    body = body.replace(/<[^<>]{0,200}>/g, "").replace(/\s+/g, " ").trim();
    if (!speaker) {
      const named = /^([A-Z][\w .'-]{0,30}):\s+(.+)$/.exec(body);
      if (named) [speaker, body] = [named[1], named[2]];
    }
    if (at === null || !body) continue;
    items.push({ at, end: end !== null && end > at ? end : null, text: body, speaker });
  }
  items.sort((a, b) => a.at - b.at);
  return { items, problems: items.length ? [] : ["the transcript text has no WebVTT or SRT cues"] };
}

/** The item playing at t: the last one starting at or before t, unless its own end has passed. -1 when none. */
export function activeIndex(list: readonly { at: number; end?: number | null }[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at <= t + 1e-3) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found >= 0) {
    const end = list[found].end;
    if (end != null && t > end + 1e-3) return -1;
  }
  return found;
}

/** Chapter spans over a known duration, for the scrubber's segments. */
export function chapterSpans(chapters: readonly Chapter[], duration: number): { from: number; to: number; title: string }[] {
  if (!(duration > 0)) return [];
  const inside = chapters.filter((c) => c.at < duration);
  return inside.map((c, k) => ({ from: c.at / duration, to: (k + 1 < inside.length ? inside[k + 1].at : duration) / duration, title: c.title }));
}

/** The time one frame away, landing on a frame boundary so repeated steps don't drift. */
export function stepFrame(t: number, fps: number, direction: 1 | -1, duration: number): number {
  const f = fps > 0 ? fps : 30;
  const frame = Math.max(0, Math.floor(t * f + 1e-3) + direction);
  // A hair past the boundary, so the decoder shows this frame and not the one before.
  const next = frame / f + 1e-3;
  return Number.isFinite(duration) && duration > 0 ? Math.min(duration, next) : next;
}

/** Nearest offered speed, so a prop of 1.3 lands on 1.25. */
export function snapSpeed(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/x$/i, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 1;
  return SPEEDS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1);
}

/**
 * Peaks for a waveform: for each of `buckets` slices, the largest absolute
 * sample across channels, scaled so the loudest bar is 1. Silence stays 0.
 */
export function computePeaks(channels: readonly ArrayLike<number>[], buckets: number): number[] {
  const n = Math.max(1, Math.floor(buckets));
  const length = channels.length ? Math.min(...channels.map((c) => c.length)) : 0;
  const out = new Array<number>(n).fill(0);
  if (!length) return out;
  const size = length / n;
  for (let b = 0; b < n; b++) {
    const from = Math.floor(b * size);
    const to = Math.max(from + 1, Math.floor((b + 1) * size));
    // Long slices are sampled, not scanned: a waveform needs the shape, not every sample.
    const stride = Math.max(1, Math.floor((to - from) / 2048));
    let peak = 0;
    for (const ch of channels) {
      for (let i = from; i < to && i < length; i += stride) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
      }
    }
    out[b] = peak;
  }
  const max = Math.max(...out);
  return max > 0 ? out.map((p) => p / max) : out;
}

/** A file name to show for a path or URL. */
export function mediaName(src: string): string {
  const clean = src.replace(/[?#].*$/, "");
  const last = clean.split(/[\\/]/).filter(Boolean).pop() ?? src;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function extensionOf(path: string): string {
  return /\.([^./\\]+)$/.exec(path.replace(/[?#].*$/, ""))?.[1]?.toLowerCase() ?? "";
}

/** A sample clip's chapter marks and notes, for the gallery. */
export const SAMPLE_CLIP = { duration: 12, fps: 24 };
