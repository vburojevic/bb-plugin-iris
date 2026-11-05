// Parses a loaded file by its extension: JSON, JSON Lines, CSV and TSV become
// data; everything else (logs, XML reports, lcov, tsc output) stays text.

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

export function parseDataFile(path: string, text: string): Parsed {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  try {
    switch (ext) {
      case "json":
      case "sarif":
        return { ok: true, value: JSON.parse(body) };
      case "jsonl":
      case "ndjson":
        return { ok: true, value: body.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) };
      case "csv":
        return { ok: true, value: delimited(body, ",") };
      case "tsv":
        return { ok: true, value: delimited(body, "\t") };
      default: {
        const t = body.trim();
        if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
          try {
            return { ok: true, value: JSON.parse(t) };
          } catch {
            // Not JSON after all: text.
          }
        }
        return { ok: true, value: body };
      }
    }
  } catch (cause) {
    return { ok: false, error: `${path} is not valid ${ext.toUpperCase()}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/** RFC 4180 CSV with quoted fields; numbers and booleans become values. */
export function delimited(text: string, sep: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...rest] = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!header) return [];
  return rest.map((r) => Object.fromEntries(header.map((h, k) => [h.trim(), cell(r[k] ?? "")])));
}

function cell(v: string): unknown {
  const t = v.trim();
  if (t === "") return null;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  return v;
}
