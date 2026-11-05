// Iris's colors come only from the person's bb theme, and follow it live.
//
// - The accent is the theme's own primary color, exactly: edges, rings, focus,
//   sliders and (when the primary has color) single-series charts use it.
// - Series for multi-series charts share one lightness and chroma band in OKLCH,
//   with hues spread from the accent. They read as one family, never a rainbow,
//   and the band adapts to light and dark themes.
// - Tones (good, warn, bad) keep the theme's own hues for success, warning and
//   destructive, pulled into the same band so they sit calmly beside the series.
// - When the theme changes, every card recomputes within a frame.

import { normalizeTone } from "../core/tones";
import { useEffect, useState } from "react";

export type Tone = "neutral" | "info" | "good" | "warn" | "bad";

export interface Palette {
  /** The theme's primary color, exactly. */
  accent: string;
  /** The accent at low strength, for fills behind accented content. */
  accentSoft: string;
  /** Chart series: the accent first (when it has color), the rest in one calm band. */
  series: string[];
  tone: Record<Tone, string>;
  /** Kept for older code: the accent, never a gradient. */
  spectrum: string;
  dark: boolean;
}

// ---------- color math (sRGB <-> OKLab) ----------

type RGB = [number, number, number];

let canvas: HTMLCanvasElement | null = null;
/** Any CSS color (hex, rgb, hsl, oklch, color-mix) to 0-255 sRGB, via a 1px canvas. */
export function rgb(color: string): RGB | null {
  if (!color) return null;
  try {
    canvas ??= document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? null : [r, g, b];
  } catch {
    return null;
  }
}

const lin = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const gam = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

interface LCH {
  l: number;
  c: number;
  h: number;
}

function toOklch([r8, g8, b8]: RGB): LCH {
  const [r, g, b] = [lin(r8), lin(g8), lin(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function fromOklch({ l, c, h }: LCH): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** An OKLCH color as hex, lowering chroma until it fits in sRGB. */
function hex(lch: LCH): string {
  let c = lch.c;
  for (let k = 0; k < 24; k++) {
    const rgbLin = fromOklch({ ...lch, c });
    if (rgbLin.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return `#${rgbLin.map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("")}`;
    }
    c *= 0.9;
  }
  const g = Math.round(Math.min(1, Math.max(0, gam(lch.l ** 3))) * 255).toString(16).padStart(2, "0");
  return `#${g}${g}${g}`;
}

// ---------- the palette ----------

/** Hue steps from the accent: far apart first, so two or three series never look alike. */
const STEPS = [0, 150, 250, 50, 200, 300, 100, 340];
/** Hue used when a theme's primary is a neutral (black, white or gray). */
const NEUTRAL_FALLBACK_HUE = 255;

export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const accent = v("--primary") || v("--ring") || "#3b82f6";
  const bg = rgb(v("--canvas") || v("--background") || v("--card"));
  const dark = bg ? toOklch(bg).l < 0.55 : document.documentElement.classList.contains("dark");
  const a = rgb(accent);
  let base: LCH = a ? toOklch(a) : { l: 0.6, c: 0.12, h: NEUTRAL_FALLBACK_HUE };
  if (base.c < 0.04) {
    // A neutral primary: borrow the theme's own link or file accent for the hue.
    const borrowed = [v("--file-accent"), v("--ansi-12"), v("--ansi-4")].map(rgb).find((x) => x && toOklch(x).c >= 0.05);
    base = borrowed ? toOklch(borrowed) : { ...base, h: NEUTRAL_FALLBACK_HUE };
  }
  const band = { l: dark ? 0.74 : 0.57, c: Math.min(0.15, Math.max(0.085, base.c)) };
  const hueOf = (name: string, fallbackHue: number) => {
    const x = rgb(v(name));
    return x && toOklch(x).c > 0.03 ? toOklch(x).h : fallbackHue;
  };
  const gap = (x: number, y: number) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y));
  // Tones keep the theme's hues but stay clearly apart: failure deeper, warning brighter and warmer.
  const badH = hueOf("--destructive", 25);
  let warnH = hueOf("--warning", 75);
  if (gap(warnH, badH) < 40) warnH = (badH + 45) % 360;
  const goodH = hueOf("--success", 150);
  const toneC = Math.max(band.c, 0.12);
  const tone: Record<Tone, string> = {
    neutral: v("--muted-foreground") || "currentColor",
    info: "",
    good: hex({ l: band.l, c: toneC, h: goodH }),
    warn: hex({ l: band.l + (dark ? 0.06 : 0.08), c: toneC, h: warnH }),
    bad: hex({ l: band.l - (dark ? 0.04 : 0.06), c: toneC + 0.02, h: badH }),
  };
  // Series hues step away from the accent and steer clear of the tone hues, so an
  // untoned series never reads as "failed" or "warning".
  const toneHues = [badH, warnH, goodH];
  const chosen: number[] = [];
  const series = STEPS.map((step, k) => {
    let h = (base.h + step) % 360;
    const crowded = (x: number) => toneHues.some((t) => gap(x, t) < 20) || chosen.some((c) => gap(x, c) < 32);
    if (k > 0) for (let n = 0; n < 14 && crowded(h); n++) h = (h + 13) % 360;
    chosen.push(h);
    return hex({ l: band.l, c: band.c, h });
  });
  // A colored primary is the first series exactly, so single-series charts wear the theme's own accent.
  if (a && toOklch(a).c >= 0.04) series[0] = accent;
  // Info is the first series (the accent when it has color), unless that sits on a status
  // color (an amber primary next to warning, or a borrowed green hue next to success):
  // then info takes the next series, which is kept clear of them.
  const first = rgb(series[0]);
  const firstH = first ? toOklch(first).h : base.h;
  const onStatus = toneHues.some((t) => gap(firstH, t) < 35) || [tone.good, tone.warn, tone.bad].some((t) => tooClose(t, series[0]));
  tone.info = onStatus ? series[1] : series[0];
  return { accent, accentSoft: `color-mix(in oklab, ${accent} 12%, transparent)`, series, tone, spectrum: accent, dark };
}

const FALLBACK: Palette = {
  accent: "#3b82f6",
  accentSoft: "color-mix(in oklab, #3b82f6 12%, transparent)",
  series: ["#4c8dff", "#22b07d", "#b06cf0", "#e0a03a", "#20a8c4", "#e0607e"],
  tone: { neutral: "currentColor", info: "#4c8dff", good: "#22b07d", warn: "#e0a03a", bad: "#e0607e" },
  spectrum: "#3b82f6",
  dark: false,
};

let cached: Palette | null = null;
let signature = "";
const subscribers = new Set<(p: Palette) => void>();
let watching = false;

function themeSignature(el: Element): string {
  const css = getComputedStyle(el);
  return ["--primary", "--canvas", "--background", "--card", "--foreground", "--success", "--warning", "--destructive", "--muted-foreground", "--file-accent", "--ansi-12", "--ansi-4"].map((n) => css.getPropertyValue(n).trim()).join("|");
}

function recompute(force = false) {
  if (typeof document === "undefined") return;
  const el = document.querySelector("[data-iris-root]") ?? document.body;
  const sig = themeSignature(el);
  if (!force && sig === signature && cached) return;
  signature = sig;
  cached = readPalette(el);
  for (const fn of subscribers) fn(cached);
}

/** Recomputes when bb swaps its theme: class or style changes, a new or edited stylesheet, or a system light/dark switch. */
function watchTheme() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  let pending = 0;
  const schedule = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => recompute());
  };
  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-mode"] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    if (document.head) mo.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", schedule);
  // A cheap safety net for theme changes no observer sees: compare a few computed tokens.
  window.setInterval(() => {
    if (subscribers.size && document.visibilityState === "visible") recompute();
  }, 1500);
}

/** The live theme palette; every Iris card shares one and re-renders when the theme changes. */
export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => cached ?? FALLBACK);
  useEffect(() => {
    subscribers.add(setPalette);
    if (!cached) recompute(true);
    else setPalette(cached);
    watchTheme();
    return () => {
      subscribers.delete(setPalette);
    };
  }, []);
  return palette;
}

const labCache = new Map<string, [number, number, number] | null>();
function lab(color: string): [number, number, number] | null {
  if (!labCache.has(color)) {
    const x = rgb(color);
    const o = x ? toOklch(x) : null;
    labCache.set(color, o ? [o.l, o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)] : null);
  }
  return labCache.get(color) ?? null;
}

/** True when two colors are hard to tell apart side by side (OKLab distance under 0.07). */
export function tooClose(a: string, b: string): boolean {
  if (a === b) return true;
  const x = lab(a);
  const y = lab(b);
  return Boolean(x && y && Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 0.07);
}

/**
 * Colors for a set of series where some carry a tone: toned ones keep their tone color,
 * untoned ones take series colors in order, skipping any that look like a color already used.
 */
export function assignColors(p: Palette, tones: (unknown | undefined)[]): string[] {
  const fixed = tones.map((t) => toneColor(p, t));
  const used = fixed.filter((c): c is string => Boolean(c));
  let next = 0;
  return fixed.map((c) => {
    if (c) return c;
    // First choice: a series color unlike every color used so far.
    for (let tries = 0; tries < p.series.length; tries++) {
      const candidate = p.series[next++ % p.series.length];
      if (!used.some((u) => tooClose(u, candidate))) return used.push(candidate), candidate;
    }
    // More series than colors: reuse one, but never one that looks like a tone in this chart.
    const safe = p.series.filter((s) => !fixed.some((f) => f && tooClose(f, s)));
    const pick = (safe.length ? safe : p.series)[next++ % (safe.length || p.series.length)];
    used.push(pick);
    return pick;
  });
}

export function toneColor(p: Palette, tone: unknown): string | undefined {
  const t = normalizeTone(tone);
  return t && t in p.tone ? p.tone[t as Tone] : undefined;
}

const rampCache = new Map<string, string[]>();

/**
 * A sequential ramp of n steps for heatmaps: one hue (the accent's, or the series hue a
 * neutral primary borrows) in lightness steps, from faint to strong against the card.
 */
export function sequentialRamp(p: Palette, n: number): string[] {
  const steps = Math.max(2, Math.min(9, Math.round(n)));
  const key = `${p.accent}|${p.series[0]}|${p.dark}|${steps}`;
  const hit = rampCache.get(key);
  if (hit) return hit;
  const a = rgb(p.accent);
  let base = a ? toOklch(a) : null;
  if (!base || base.c < 0.04) {
    const s = rgb(p.series[0]);
    base = s ? toOklch(s) : { l: 0.6, c: 0.12, h: NEUTRAL_FALLBACK_HUE };
  }
  const c = Math.min(0.16, Math.max(0.08, base.c));
  // Light themes go from near white to deep; dark themes from near the card to bright.
  const [l0, l1] = p.dark ? [0.43, 0.87] : [0.92, 0.42];
  const out = Array.from({ length: steps }, (_, k) => {
    const t = k / (steps - 1);
    return hex({ l: l0 + (l1 - l0) * t, c: 0.04 + (c - 0.04) * t, h: base.h });
  });
  rampCache.set(key, out);
  return out;
}

/** OKLCH lightness of a color (0-1), or null when it can't be read. */
export function lightness(color: string): number | null {
  const x = rgb(color);
  return x ? toOklch(x).l : null;
}
