// Pure logic behind the design review kit: color parsing and WCAG 2.2
// contrast for Swatches, the device frames DeviceFrame draws, and the sizes
// and weights TypeSpecimen renders.

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max = 300): string | undefined =>
  v == null || v === "" ? undefined : typeof v === "string" ? v.trim().slice(0, max) || undefined : typeof v === "number" ? String(v) : undefined;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---------- color ----------

export type Rgb = [number, number, number];

const NAMED: Record<string, Rgb> = { white: [255, 255, 255], black: [0, 0, 0] };

/** Reads #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and hsl()/hsla(), ignoring alpha. Other forms (theme tokens, oklch) return null; the view resolves those in the browser. */
export function parseColor(v: unknown): Rgb | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) return [0, 1, 2].map((k) => parseInt(hex[k] + hex[k], 16)) as Rgb;
    if (hex.length === 6 || hex.length === 8) return [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16)) as Rgb;
    return null;
  }
  const fn = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (fn[1].startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    if (rgb.some((n) => !Number.isFinite(n))) return null;
    return rgb.map((n) => Math.round(Math.max(0, Math.min(255, n)))) as Rgb;
  }
  const h = parseFloat(parts[0]);
  const sat = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (![h, sat, l].every(Number.isFinite)) return null;
  return hslToRgb(((h % 360) + 360) % 360, Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, l)));
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255)) as Rgb;
}

export const toHex = (c: Rgb) => `#${c.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface Grade {
  ratio: number;
  /** Normal text: 4.5 for AA, 7 for AAA. */
  aa: boolean;
  aaa: boolean;
  /** Large text (18pt, or 14pt bold) and UI parts: 3 for AA, 4.5 for AAA. */
  aaLarge: boolean;
  aaaLarge: boolean;
}

/** WCAG compares the unrounded ratio; 4.499 fails AA even though it reads as 4.5. */
export function grade(fg: Rgb, bg: Rgb): Grade {
  const ratio = contrastRatio(fg, bg);
  return { ratio, aa: ratio >= 4.5, aaa: ratio >= 7, aaLarge: ratio >= 3, aaaLarge: ratio >= 4.5 };
}

/** Two decimals, rounded down so a failing ratio never reads as a passing one. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

export interface Swatch {
  name: string;
  value: string;
  note?: string;
}

export interface Background {
  name: string;
  value: string;
}

export const MAX_SWATCHES = 40;

/** Each swatch is a color string or {name?, value, note?}. */
export function normalizeSwatches(v: unknown): Swatch[] {
  const out: Swatch[] = [];
  for (const item of list(v)) {
    const o = typeof item === "string" ? { value: item } : obj(item);
    const value = text(o.value ?? o.color ?? o.hex, 120);
    if (!value) continue;
    out.push({ name: text(o.name ?? o.label, 80) ?? value, value, note: text(o.note ?? o.use) });
    if (out.length >= MAX_SWATCHES) break;
  }
  return out;
}

/** Backgrounds to test against: color strings or {name, value}; default white and black. */
export function normalizeBackgrounds(v: unknown): Background[] {
  const out: Background[] = [];
  for (const item of list(v)) {
    const o = typeof item === "string" ? { value: item } : obj(item);
    const value = text(o.value ?? o.color, 120);
    if (value) out.push({ name: text(o.name ?? o.label, 60) ?? value, value });
    if (out.length >= 6) break;
  }
  return out.length ? out : [
    { name: "White", value: "#FFFFFF" },
    { name: "Black", value: "#000000" },
  ];
}

// ---------- DeviceFrame ----------

export const DEVICES = ["iphone", "ipad", "mac", "browser"] as const;
export type Device = (typeof DEVICES)[number];

export interface DeviceSpec {
  label: string;
  /** Screen width over height, upright. */
  aspect: number;
  /** How wide the frame draws by default, in CSS pixels. */
  width: number;
}

export const DEVICE_SPECS: Record<Device, DeviceSpec> = {
  iphone: { label: "Phone", aspect: 1206 / 2622, width: 280 },
  ipad: { label: "Tablet", aspect: 1668 / 2420, width: 420 },
  mac: { label: "Mac window", aspect: 16 / 10, width: 720 },
  browser: { label: "Browser", aspect: 16 / 10, width: 720 },
};

const DEVICE_WORDS: Record<string, Device> = { iphone: "iphone", phone: "iphone", mobile: "iphone", ipad: "ipad", tablet: "ipad", mac: "mac", macos: "mac", window: "mac", desktop: "mac", browser: "browser", web: "browser", safari: "browser", chrome: "browser" };

export function deviceOf(v: unknown): Device {
  return DEVICE_WORDS[String(v ?? "").trim().toLowerCase()] ?? "iphone";
}

/** The screen's aspect: upright, or turned for landscape on a phone or tablet. */
export function screenAspect(device: Device, landscape: boolean): number {
  const a = DEVICE_SPECS[device].aspect;
  return landscape && (device === "iphone" || device === "ipad") ? 1 / a : a;
}

/** A browser frame shows a host, never a full URL with a query. */
export function displayHost(url: unknown): string | undefined {
  const t = text(url, 500);
  if (!t) return undefined;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 80);
  } catch {
    return t.slice(0, 80);
  }
}

// ---------- TypeSpecimen ----------

export const DEFAULT_SIZES = [12, 14, 17, 22, 28, 34];
export const DEFAULT_WEIGHTS = [400, 600, 700];
const WEIGHT_WORDS: Record<string, number> = { thin: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900 };
export const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra Bold", 900: "Black" };

/** Sizes in px, 6 to 120, deduped and sorted; at most 12. A size may be {size, label?} for a named step. */
export function normalizeSizes(v: unknown): { size: number; label?: string }[] {
  const raw = list(v).length ? list(v) : DEFAULT_SIZES;
  const seen = new Set<number>();
  const out: { size: number; label?: string }[] = [];
  for (const item of raw) {
    const o = typeof item === "object" && item ? obj(item) : { size: item };
    const n = Number(typeof o.size === "string" ? o.size.replace(/px$/, "") : o.size);
    if (!Number.isFinite(n) || n < 6 || n > 120 || seen.has(n)) continue;
    seen.add(n);
    out.push({ size: n, label: text(o.label ?? o.name, 40) });
  }
  return out.sort((a, b) => a.size - b.size).slice(0, 12);
}

/** Weights as numbers 100 to 900, read from numbers or words like "semibold". */
export function normalizeWeights(v: unknown): number[] {
  const raw = list(v).length ? list(v) : DEFAULT_WEIGHTS;
  const out: number[] = [];
  for (const item of raw) {
    const n = typeof item === "number" ? item : WEIGHT_WORDS[String(item).toLowerCase().replace(/[\s-]/g, "")] ?? Number(item);
    if (Number.isFinite(n) && n >= 100 && n <= 900 && !out.includes(Math.round(n / 100) * 100)) out.push(Math.round(n / 100) * 100);
  }
  return out.sort((a, b) => a - b).slice(0, 9);
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"]);

/** A safe CSS font-family list: names quoted, generics kept, nothing that could close the declaration. */
export function fontStack(v: unknown): string {
  const names = (text(v, 300) ?? "system-ui")
    .split(",")
    .map((n) => n.trim().replace(/^['"]|['"]$/g, "").replace(/[^\p{L}\p{N} _-]/gu, ""))
    .filter(Boolean)
    .slice(0, 6);
  const family = names.map((n) => (GENERIC.has(n.toLowerCase()) ? n.toLowerCase() : `"${n}"`));
  if (!family.some((f) => GENERIC.has(f))) family.push("system-ui");
  return family.join(", ");
}
