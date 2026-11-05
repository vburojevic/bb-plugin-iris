// Pure logic behind the media components: Gallery, Hotspots, Map and
// PhotoSearch. The views draw what these return, so the judgments (what a
// place is, where it lands on the map, which tiles to ask for) are tested
// without a browser.
import { MAX_QUERIES, TILE_MAX_ZOOM, validLatLng } from "./web";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max = 2000): string | undefined =>
  v == null || v === "" ? undefined : typeof v === "string" ? v.slice(0, max) : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const finite = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// ---------- Gallery ----------

export const MAX_GALLERY = 60;

export interface GalleryImage {
  src: string;
  caption?: string;
  alt: string;
}

/** Each image is a path, a URL or {src, caption?, alt?}; anything without a src is dropped. */
export function normalizeGallery(v: unknown): GalleryImage[] {
  const out: GalleryImage[] = [];
  for (const item of list(v)) {
    const o = typeof item === "string" ? { src: item } : obj(item);
    const src = text(o.src ?? o.path ?? o.url)?.trim();
    if (!src) continue;
    const caption = text(o.caption ?? o.title ?? o.label);
    out.push({ src, caption, alt: text(o.alt) ?? caption ?? fileLabel(src) });
    if (out.length >= MAX_GALLERY) break;
  }
  return out;
}

/** A readable name for an image from its path or URL. */
export function fileLabel(src: string): string {
  if (src.startsWith("data:")) return "Image";
  const last = src.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? src;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The index after moving by step, wrapping at both ends. */
export function wrapIndex(i: number, step: number, length: number): number {
  if (length <= 0) return 0;
  return (((i + step) % length) + length) % length;
}

// ---------- Hotspots and Annotate ----------

export const clampPercent = (n: number) => Math.max(0, Math.min(100, n));

/** Reads 40, "40", "40%" and 0.4 (a fraction) the same way. */
export function percent(v: unknown): number | undefined {
  const raw = typeof v === "string" ? v.trim().replace(/%$/, "") : v;
  const n = finite(raw);
  if (n === undefined) return undefined;
  const asPercent = typeof v === "number" && n > 0 && n < 1 && !Number.isInteger(n) ? n * 100 : n;
  return clampPercent(asPercent);
}

export interface Hotspot {
  n: number;
  x: number;
  y: number;
  title: string;
  text?: string;
  tone?: string;
}

export function normalizeHotspots(v: unknown): Hotspot[] {
  const out: Hotspot[] = [];
  for (const item of list(v)) {
    const o = obj(item);
    const x = percent(o.x);
    const y = percent(o.y);
    if (x === undefined || y === undefined) continue;
    out.push({ n: out.length + 1, x, y, title: text(o.title ?? o.label, 200) ?? `Point ${out.length + 1}`, text: text(o.text ?? o.detail ?? o.note), tone: text(o.tone) });
  }
  return out;
}

export interface Callout {
  n: number;
  /** A box when w and h are given, else a pin at x, y. */
  box: { x: number; y: number; w: number; h: number } | null;
  x: number;
  y: number;
  label: string;
  text?: string;
  tone?: string;
}

/** Callouts: {x, y, w?, h?, label, text?, tone?} in percent of the image. A box never spills past the edge. */
export function normalizeCallouts(v: unknown): Callout[] {
  const out: Callout[] = [];
  for (const item of list(v)) {
    const o = obj(item);
    const x = percent(o.x);
    const y = percent(o.y);
    if (x === undefined || y === undefined) continue;
    const w = percent(o.w ?? o.width);
    const h = percent(o.h ?? o.height);
    const box = w !== undefined && h !== undefined && w > 0 && h > 0 ? { x, y, w: Math.min(w, 100 - x), h: Math.min(h, 100 - y) } : null;
    const n = out.length + 1;
    out.push({ n, box, x, y, label: text(o.label ?? o.title, 200) ?? `Note ${n}`, text: text(o.text ?? o.detail ?? o.note), tone: text(o.tone) });
  }
  return out;
}

// ---------- Map ----------

export const MAX_PLACES = MAX_QUERIES;

export interface Place {
  n: number;
  name: string;
  /** What to search for when there are no coordinates. */
  query?: string;
  at: { lat: number; lng: number } | null;
  note?: string;
  tone?: string;
}

/** A place is a name to look up, {name, lat, lng}, or [lat, lng]. Coordinates given win over a lookup. */
export function normalizePlaces(v: unknown): Place[] {
  const out: Place[] = [];
  for (const item of list(v)) {
    if (out.length >= MAX_PLACES) break;
    const n = out.length + 1;
    if (typeof item === "string") {
      const name = item.trim().slice(0, 200);
      if (name) out.push({ n, name, query: name, at: null });
      continue;
    }
    if (Array.isArray(item)) {
      const at = validLatLng(item[0], item[1]);
      if (at) out.push({ n, name: `${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`, at });
      continue;
    }
    const o = obj(item);
    const at = validLatLng(o.lat ?? o.latitude, o.lng ?? o.lon ?? o.long ?? o.longitude);
    const name = text(o.name ?? o.title ?? o.label, 200)?.trim();
    const query = text(o.query ?? o.address, 200)?.trim() || name;
    if (!at && !query) continue;
    out.push({ n, name: name || query || `${at!.lat.toFixed(4)}, ${at!.lng.toFixed(4)}`, query: at ? undefined : query, at, note: text(o.note ?? o.text ?? o.detail), tone: text(o.tone) });
  }
  return out;
}

export const TILE = 256;

/** World pixel position at zoom z (Web Mercator, as OSM tiles are drawn). */
export function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const scale = TILE * 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

export interface MapView {
  z: number;
  /** The center in world pixels at z. */
  cx: number;
  cy: number;
}

export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 18;
export const SINGLE_PLACE_ZOOM = 14;

/** The closest whole zoom that shows every point inside width by height with padding, centered on their bounds. */
export function fitView(points: { lat: number; lng: number }[], width: number, height: number, padding = 40, maxZoom = 16): MapView {
  if (!points.length) return { z: 1, cx: TILE, cy: TILE };
  const top = Math.min(maxZoom, MAP_MAX_ZOOM, TILE_MAX_ZOOM);
  const w = Math.max(1, width - padding * 2);
  const h = Math.max(1, height - padding * 2);
  let z = points.length === 1 ? Math.min(SINGLE_PLACE_ZOOM, top) : top;
  for (; z > MAP_MIN_ZOOM; z--) {
    const px = points.map((p) => project(p.lat, p.lng, z));
    const xs = px.map((p) => p.x);
    const ys = px.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w && Math.max(...ys) - Math.min(...ys) <= h) break;
  }
  const px = points.map((p) => project(p.lat, p.lng, z));
  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);
  return { z, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** The view after zooming by step around its center, keeping the same spot in the middle. */
export function zoomView(v: MapView, step: number): MapView {
  const z = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, v.z + step));
  const f = 2 ** (z - v.z);
  return { z, cx: v.cx * f, cy: v.cy * f };
}

export interface TileSpot {
  key: string;
  z: number;
  x: number;
  y: number;
  /** Left and top inside the frame, in CSS pixels. */
  left: number;
  top: number;
}

/** The tiles that cover a width by height frame, wrapping around the date line; at most 64. */
export function visibleTiles(v: MapView, width: number, height: number): TileSpot[] {
  const n = 2 ** v.z;
  const x0 = v.cx - width / 2;
  const y0 = v.cy - height / 2;
  const out: TileSpot[] = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + height - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + width - 1) / TILE); tx++) {
      const x = ((tx % n) + n) % n;
      out.push({ key: `${v.z}/${tx}/${ty}`, z: v.z, x, y: ty, left: tx * TILE - x0, top: ty * TILE - y0 });
      if (out.length >= 64) return out;
    }
  }
  return out;
}

/** Where a place sits inside the frame, in CSS pixels. */
export function placeOnFrame(at: { lat: number; lng: number }, v: MapView, width: number, height: number): { left: number; top: number } {
  const p = project(at.lat, at.lng, v.z);
  return { left: p.x - (v.cx - width / 2), top: p.y - (v.cy - height / 2) };
}

/** Great-circle distance in kilometers. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}
