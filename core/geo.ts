// GeoHeatmap rules that need no browser: which region each row names (ISO or
// USPS codes, numeric codes or names, in any case and with or without
// accents), the value range, and which ramp step a value falls in.
import { US_REGIONS, WORLD_REGIONS, WORLD_UNDRAWN, type RegionRow } from "./geo-regions";

export const GEO_MAPS = ["world", "us"] as const;
export type GeoMapName = (typeof GEO_MAPS)[number];
export const GEO_SCALES = ["linear", "quantile"] as const;

export interface Region {
  id: string;
  name: string;
  /** False for real places too small for the map: they show in the table only. */
  drawn: boolean;
}

export interface GeoValue {
  region: Region;
  value: number;
  /** The rows that named it (several add up). */
  rows: Record<string, unknown>[];
}

export interface GeoModel {
  map: GeoMapName;
  values: Map<string, GeoValue>;
  /** Keys that name no region. */
  unknown: string[];
  min: number;
  max: number;
  keyField: string;
  valueField: string;
  problems: string[];
}

export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

const indexes = new Map<GeoMapName, Map<string, Region>>();

function index(map: GeoMapName): Map<string, Region> {
  let ix = indexes.get(map);
  if (ix) return ix;
  ix = new Map();
  const add = (rows: readonly RegionRow[], drawn: boolean) => {
    for (const [id, a3, numeric, name, ...names] of rows) {
      const region: Region = { id, name, drawn };
      for (const k of [id, a3, numeric, numeric.replace(/^0+/, ""), name, ...names]) {
        const n = normName(k);
        if (n && !ix!.has(n)) ix!.set(n, region);
      }
    }
  };
  if (map === "us") add(US_REGIONS, true);
  else {
    add(WORLD_REGIONS, true);
    add(WORLD_UNDRAWN, false);
  }
  indexes.set(map, ix);
  return ix;
}

/** The region a code or name means on this map, or null. */
export function findRegion(map: GeoMapName, key: unknown): Region | null {
  if (typeof key !== "string" && typeof key !== "number") return null;
  return index(map).get(normName(String(key))) ?? null;
}

/** Every region the map draws, in name order. */
export function mapRegions(map: GeoMapName): Region[] {
  return (map === "us" ? US_REGIONS : WORLD_REGIONS).map(([id, , , name]) => ({ id, name, drawn: true }));
}

const KEY_FIELDS = ["id", "code", "iso", "iso2", "iso3", "country", "state", "region", "name"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const toNum = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** Reads the rows (or a {region: value} object) an agent passed. */
export function readGeo(data: unknown, opts: { map?: unknown; key?: unknown; value?: unknown; domain?: unknown } = {}): GeoModel {
  const map: GeoMapName = opts.map === "us" ? "us" : "world";
  const problems: string[] = [];
  if (opts.map != null && !GEO_MAPS.includes(opts.map as GeoMapName)) problems.push(`map must be "world" or "us"`);
  let rows: Record<string, unknown>[];
  let keyField = typeof opts.key === "string" ? opts.key : "";
  let valueField = typeof opts.value === "string" ? opts.value : "";
  if (Array.isArray(data)) rows = data.filter(isObj);
  else if (isObj(data)) {
    rows = Object.entries(data).map(([k, v]) => (isObj(v) ? { id: k, ...v } : { id: k, value: v }));
    keyField ||= "id";
  } else {
    rows = [];
    if (data != null) problems.push("data must be rows like [{country: \"DE\", value: 12}] or an object like {DE: 12}");
  }
  const first = rows[0] ?? {};
  if (!keyField) keyField = KEY_FIELDS.find((k) => k in first) ?? Object.keys(first).find((k) => typeof first[k] === "string") ?? "id";
  if (!valueField) valueField = "value" in first ? "value" : (Object.keys(first).find((k) => k !== keyField && Number.isFinite(toNum(first[k]))) ?? "value");

  const values = new Map<string, GeoValue>();
  const unknown: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    const key = row[keyField];
    const region = findRegion(map, key);
    if (!region) {
      if (key != null && key !== "") unknown.push(String(key));
      continue;
    }
    const v = toNum(row[valueField]);
    if (!Number.isFinite(v)) {
      skipped++;
      continue;
    }
    const cur = values.get(region.id);
    if (cur) (cur.value += v), cur.rows.push(row);
    else values.set(region.id, { region, value: v, rows: [row] });
  }
  if (unknown.length) {
    const shown = unknown.slice(0, 6).map((u) => `"${u}"`).join(", ");
    problems.push(`${shown}${unknown.length > 6 ? ` and ${unknown.length - 6} more` : ""} name no ${map === "us" ? "US state" : "country"}; use ${map === "us" ? "USPS codes (CA), FIPS codes or state names" : "ISO codes (DE or DEU) or country names"}`);
  }
  if (skipped) problems.push(`${skipped} row${skipped === 1 ? " has" : "s have"} no number in "${valueField}"`);

  const all = [...values.values()].map((v) => v.value);
  let min = all.length ? Math.min(...all) : 0;
  let max = all.length ? Math.max(...all) : 1;
  if (Array.isArray(opts.domain) && opts.domain.length === 2 && opts.domain.every((d) => Number.isFinite(toNum(d)))) {
    [min, max] = [toNum(opts.domain[0]), toNum(opts.domain[1])];
    if (min >= max) problems.push("domain must be [low, high] with low below high");
  }
  return { map, values, unknown, min, max, keyField, valueField, problems };
}

/**
 * Where each step starts: steps + 1 bounds from min to max. Linear splits the range
 * evenly; quantile puts about the same number of regions in each step.
 */
export function stepBounds(values: number[], min: number, max: number, steps: number, scale: unknown = "linear"): number[] {
  const n = Math.max(2, Math.min(9, Math.round(steps)));
  if (scale === "quantile" && values.length > n) {
    const sorted = [...values].sort((a, b) => a - b);
    const out = [sorted[0]];
    for (let k = 1; k < n; k++) out.push(sorted[Math.min(sorted.length - 1, Math.floor((k * sorted.length) / n))]);
    out.push(sorted[sorted.length - 1]);
    // Ties can repeat a bound; nudge them apart so every step is real.
    for (let k = 1; k < out.length; k++) if (out[k] <= out[k - 1]) out[k] = out[k - 1] + Math.abs(out[k - 1] || 1) * 1e-9;
    return out;
  }
  const span = max - min || 1;
  return Array.from({ length: n + 1 }, (_, k) => min + (span * k) / n);
}

/** The step (0 to bounds.length - 2) a value falls in; values outside the range clamp. */
export function stepOf(value: number, bounds: number[]): number {
  const last = bounds.length - 2;
  for (let k = 0; k < last; k++) if (value < bounds[k + 1]) return k;
  return last;
}
