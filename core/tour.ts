// CodeTour's model: steps across real files, each a line range and a note.

import { toText } from "./evaluate";
import { lineSpan } from "./learn";

export interface TourStep {
  file: string;
  start: number | null;
  end: number | null;
  title: string;
  note: string | null;
}

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v != null);
const text = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : toText(v));

export function normalizeTour(raw: unknown): { items: TourStep[]; problems: string[] } {
  const items: TourStep[] = [];
  const problems: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) problems.push("steps must be a list of {file, lines, title, note}");
  list.forEach((entry, k) => {
    if (!entry || typeof entry !== "object") {
      if (problems.length < 3) problems.push(`step ${k + 1} is not an object`);
      return;
    }
    const o = entry as Record<string, unknown>;
    const file = text(pick(o, "file", "path")).trim();
    if (!file) {
      if (problems.length < 3) problems.push(`step ${k + 1} needs a file`);
      return;
    }
    const rawLines = pick(o, "lines", "line", "range");
    let span = lineSpan(rawLines);
    const from = Number(pick(o, "from", "start"));
    const to = Number(pick(o, "to", "end"));
    if (!span && from > 0) span = { start: from, end: to >= from ? to : from };
    if (rawLines != null && !span && problems.length < 3) problems.push(`step ${k + 1}: lines must be like "12-20" or 12`);
    items.push({
      file,
      start: span?.start ?? null,
      end: span?.end ?? null,
      title: text(pick(o, "title", "name", "heading")).trim() || `${file.split("/").pop()}${span ? `:${span.start}` : ""}`,
      note: text(pick(o, "note", "body", "text", "detail")).trim() || null,
    });
  });
  if (!items.length && !problems.length) problems.push("has no steps");
  return { items, problems };
}
