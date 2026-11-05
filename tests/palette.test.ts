import { beforeAll, describe, expect, it } from "vitest";

// The palette reads CSS colors through a 1px canvas. Node has none, so this stub
// paints hex colors exactly and hands the palette the theme tokens under test.
let vars: Record<string, string> = {};
type PaletteModule = typeof import("../ui/palette");
let P: PaletteModule;

const hexRgb = (c: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: { classList: { contains: () => false } },
    createElement: () => ({
      getContext: () => {
        let fill = [0, 0, 0, 0];
        return {
          clearRect() {},
          fillRect() {},
          set fillStyle(v: string) {
            const rgb = hexRgb(v);
            fill = rgb ? [...rgb, 255] : [0, 0, 0, 0];
          },
          getImageData: () => ({ data: fill }),
        };
      },
    }),
  };
  g.getComputedStyle = () => ({ getPropertyValue: (n: string) => vars[n] ?? "" });
  P = await import("../ui/palette");
});

const THEMES: Record<string, Record<string, string>> = {
  "ayu dark (amber primary)": { "--primary": "#e6b450", "--canvas": "#0d1017", "--success": "#7fd962", "--warning": "#ffb454", "--destructive": "#d95757" },
  "ayu light (orange primary)": { "--primary": "#f29718", "--canvas": "#fcfcfc", "--success": "#6cbf43", "--warning": "#fa8d3e", "--destructive": "#e65050" },
  "green primary": { "--primary": "#22a06b", "--canvas": "#111111", "--success": "#3fb950", "--warning": "#d29922", "--destructive": "#f85149" },
  "nord (blue primary)": { "--primary": "#5e81ac", "--canvas": "#eceff4", "--success": "#a3be8c", "--warning": "#ebcb8b", "--destructive": "#bf616a" },
  "neutral primary borrowing green": { "--primary": "#333333", "--canvas": "#ffffff", "--success": "#2da44e", "--warning": "#bf8700", "--destructive": "#cf222e", "--file-accent": "#2da44e" },
  "neutral primary": { "--primary": "#333333", "--canvas": "#ffffff", "--success": "#2da44e", "--warning": "#bf8700", "--destructive": "#cf222e", "--ansi-12": "#2666b0" },
};

describe("palette", () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    it(`keeps every tone apart in ${name}`, () => {
      vars = tokens;
      const p = P.readPalette({} as Element);
      const tones = [p.tone.info, p.tone.good, p.tone.warn, p.tone.bad];
      for (let i = 0; i < tones.length; i++) for (let j = i + 1; j < tones.length; j++) expect(P.tooClose(tones[i], tones[j]), `${tones[i]} vs ${tones[j]}`).toBe(false);
    });
  }

  it("uses the theme's own primary as the accent and the first series", () => {
    vars = THEMES["ayu dark (amber primary)"];
    const p = P.readPalette({} as Element);
    expect(p.accent).toBe("#e6b450");
    expect(p.series[0]).toBe("#e6b450");
  });

  it("never gives an untoned series a color that looks like a toned one in the same chart", () => {
    vars = THEMES["ayu dark (amber primary)"];
    const p = P.readPalette({} as Element);
    // Untoned first, then warn: the amber accent would match warn, so the untoned series moves on.
    const [plain, warn] = P.assignColors(p, [undefined, "warn"]);
    expect(warn).toBe(p.tone.warn);
    expect(P.tooClose(plain, warn)).toBe(false);
    // With no tones, series keep their order.
    expect(P.assignColors(p, [undefined, undefined, undefined])).toEqual(p.series.slice(0, 3));
  });

  it("keeps tone look-alikes out even when a chart has more series than colors", () => {
    vars = THEMES["ayu dark (amber primary)"];
    const p = P.readPalette({} as Element);
    const colors = P.assignColors(p, ["warn", ...Array(8).fill(undefined)]);
    for (const c of colors.slice(1)) expect(P.tooClose(c, p.tone.warn), c).toBe(false);
  });
});

describe("sequential ramp", () => {
  for (const name of ["ayu dark (amber primary)", "nord (blue primary)", "neutral primary"]) {
    it(`is one hue in even lightness steps in ${name}`, () => {
      vars = THEMES[name];
      const p = P.readPalette({} as Element);
      const ramp = P.sequentialRamp(p, 5);
      expect(ramp).toHaveLength(5);
      const ls = ramp.map((c) => P.lightness(c)!);
      // Faint to strong against the card: up in dark themes, down in light ones.
      for (let k = 1; k < ls.length; k++) expect(p.dark ? ls[k] - ls[k - 1] : ls[k - 1] - ls[k]).toBeGreaterThan(0.08);
      for (let k = 1; k < ramp.length; k++) expect(P.tooClose(ramp[k], ramp[k - 1]), `${ramp[k - 1]} vs ${ramp[k]}`).toBe(false);
    });
  }

  it("clamps steps to 2-9", () => {
    vars = THEMES["nord (blue primary)"];
    const p = P.readPalette({} as Element);
    expect(P.sequentialRamp(p, 1)).toHaveLength(2);
    expect(P.sequentialRamp(p, 20)).toHaveLength(9);
  });
});
