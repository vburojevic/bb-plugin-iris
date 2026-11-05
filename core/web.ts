// Web lookups, the pure half: which hosts Iris's server may reach, the exact
// URLs it builds, and how each provider's answer is read. Nothing here does
// I/O; web-source.ts fetches, caps and caches. A block never supplies a URL:
// it names a place or describes a photo, and the server builds the request.

export const USER_AGENT = "Iris/0.1 (bb plugin; https://github.com/vburojevic/bb-plugin-iris)";

/** Every host the server may fetch from, and nothing else. */
export const WEB_HOSTS = ["tile.openstreetmap.org", "photon.komoot.io", "nominatim.openstreetmap.org", "commons.wikimedia.org", "upload.wikimedia.org", "thumb.wikimedia.org"] as const;
export type WebHost = (typeof WEB_HOSTS)[number];

/** The host a URL names, when it is https on the allowlist; null otherwise. */
export function allowedHost(url: string): WebHost | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  return (WEB_HOSTS as readonly string[]).includes(u.hostname) ? (u.hostname as WebHost) : null;
}

export const TILE_MAX_ZOOM = 19;
export const MAX_QUERY = 200;
export const MAX_QUERIES = 25;

/** A tile address the UI asks for, checked: whole numbers inside the zoom's grid. */
export function tileUrl(z: unknown, x: unknown, y: unknown): string | null {
  if (![z, x, y].every((n) => typeof n === "number" && Number.isInteger(n))) return null;
  const [Z, X, Y] = [z, x, y] as number[];
  if (Z < 0 || Z > TILE_MAX_ZOOM) return null;
  const size = 2 ** Z;
  if (X < 0 || Y < 0 || X >= size || Y >= size) return null;
  return `https://tile.openstreetmap.org/${Z}/${X}/${Y}.png`;
}

/** How a query is compared and cached: trimmed, single spaces, lower case. */
export function normalizeQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const t = q.replace(/\s+/g, " ").trim().toLowerCase();
  return t && t.length <= MAX_QUERY ? t : null;
}

export const photonUrl = (q: string) => `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: "1", lang: "en" })}`;
export const nominatimUrl = (q: string) => `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: "jsonv2", limit: "1" })}`;

export interface GeoHit {
  lat: number;
  lng: number;
  label: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max = 300): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export function validLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === "string" ? Number(lat) : lat;
  const b = typeof lng === "string" ? Number(lng) : lng;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
}

/** Photon answers GeoJSON; the first feature wins. */
export function readPhoton(body: unknown): GeoHit | null {
  const features = obj(body).features;
  if (!Array.isArray(features) || !features.length) return null;
  const f = obj(features[0]);
  const coords = obj(f.geometry).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const at = validLatLng(coords[1], coords[0]);
  if (!at) return null;
  const p = obj(f.properties);
  const parts = [text(p.name, 120), text(p.city, 80) ?? text(p.state, 80), text(p.country, 80)].filter((s): s is string => Boolean(s));
  const label = [...new Set(parts)].join(", ");
  return { ...at, label: label || `${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}` };
}

/** Nominatim answers a list; the first result wins. */
export function readNominatim(body: unknown): GeoHit | null {
  if (!Array.isArray(body) || !body.length) return null;
  const r = obj(body[0]);
  const at = validLatLng(r.lat, r.lon);
  if (!at) return null;
  return { ...at, label: text(r.display_name, 300) ?? `${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}` };
}

// ---------- Wikimedia Commons ----------

export const PHOTO_WIDTHS = [480, 800, 1280] as const;

/** The width a request asks for, rounded up to one Commons serves from cache. */
export function photoWidth(w: unknown): number {
  const n = typeof w === "number" && Number.isFinite(w) ? w : 800;
  return PHOTO_WIDTHS.find((x) => x >= n) ?? PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
}

export function commonsSearchUrl(q: string, width: number): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiextmetadatafilter: "Artist|Credit|LicenseShortName|LicenseUrl|ObjectName|ImageDescription",
    iiurlwidth: String(width),
  });
  return `https://commons.wikimedia.org/w/api.php?${params}`;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", middot: "·", hellip: "…",
  ndash: "-", mdash: "-", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', szlig: "ß",
};
// Accented Latin letters: &eacute; &Ntilde; &ouml; and the like.
const MARKS: Record<string, string> = { acute: "\u0301", grave: "\u0300", circ: "\u0302", tilde: "\u0303", uml: "\u0308", ring: "\u030A", cedil: "\u0327", caron: "\u030C" };
function entity(name: string): string | undefined {
  if (ENTITIES[name.toLowerCase()]) return ENTITIES[name.toLowerCase()];
  const m = /^([a-zA-Z])(acute|grave|circ|tilde|uml|ring|cedil|caron)$/.exec(name);
  return m ? `${m[1]}${MARKS[m[2]]}`.normalize("NFC") : undefined;
}

/** Commons metadata is HTML; Iris shows it as plain text. */
export function plainText(html: unknown, max = 240): string | undefined {
  if (typeof html !== "string") return undefined;
  const t = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return entity(e) ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export interface CommonsPick {
  /** The thumbnail on upload.wikimedia.org or thumb.wikimedia.org the server fetches next. */
  thumb: string;
  mime: string;
  width: number;
  height: number;
  title: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  /** The file's page on Commons, where the full credit lives. */
  page: string;
}

const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];

/** The best-ranked bitmap a Commons search returned, with its credit. */
export function readCommons(body: unknown): CommonsPick | null {
  const pages = obj(obj(body).query).pages;
  if (!Array.isArray(pages)) return null;
  const ranked = pages.map(obj).sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  for (const page of ranked) {
    const info = Array.isArray(page.imageinfo) ? obj(page.imageinfo[0]) : {};
    const mime = text(info.mime);
    const thumb = text(info.thumburl, 2000);
    const pageUrl = text(info.descriptionurl, 2000);
    const thumbHost = thumb ? allowedHost(thumb) : null;
    if (!mime || !PHOTO_MIMES.includes(mime) || !thumb || (thumbHost !== "upload.wikimedia.org" && thumbHost !== "thumb.wikimedia.org")) continue;
    if (!pageUrl || allowedHost(pageUrl) !== "commons.wikimedia.org") continue;
    const meta = obj(info.extmetadata);
    const field = (k: string) => obj(meta[k]).value;
    // Commons often lists licenses over http; bb opens only https links.
    const licenseUrl = text(field("LicenseUrl"), 500)?.replace(/^http:\/\//i, "https://");
    const title = plainText(field("ObjectName"), 160) ?? (text(page.title, 300) ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    return {
      thumb,
      mime,
      width: Number(info.thumbwidth) || 0,
      height: Number(info.thumbheight) || 0,
      title,
      author: plainText(field("Artist"), 160) ?? plainText(field("Credit"), 160),
      license: plainText(field("LicenseShortName"), 80),
      licenseUrl: licenseUrl && /^https:\/\//.test(licenseUrl) ? licenseUrl : undefined,
      page: pageUrl,
    };
  }
  return null;
}

// ---------- results on the wire ----------

export type WebFailureCode = "off" | "invalid" | "not_found" | "failed" | "busy";
export interface WebFailure {
  ok: false;
  code: WebFailureCode;
  error: string;
}
export const webFailure = (code: WebFailureCode, error: string): WebFailure => ({ ok: false, code, error });
export const LOOKUPS_OFF = "Web lookups are off in Iris's settings";

export interface Photo {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  page: string;
}

export type TileResult = { ok: true; dataUrl: string } | WebFailure;
export type GeocodeResult = { ok: true; results: (GeoHit | null)[] } | WebFailure;
export type PhotoResult = { ok: true; photo: Photo } | WebFailure;
