// ThemePreview: a mock UI drawn only from its own CSS variables, so a theme
// can be tried before it ships. Values usually come from Iris inputs
// (ColorInput, Slider, Select) and follow them live. Every value is checked
// before it reaches CSS: no url(), no escapes, nothing that ends the
// declaration. A token that isn't given falls back to bb's own theme.

export const THEME_TOKENS = ["primary", "primaryForeground", "background", "foreground", "card", "muted", "mutedForeground", "border", "accent", "radius", "font", "mono"] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

/** What a token falls back to: the surrounding bb theme. */
export const THEME_FALLBACK: Record<ThemeToken, string> = {
  primary: "var(--primary)",
  primaryForeground: "",
  background: "var(--background)",
  foreground: "var(--foreground)",
  card: "var(--card, var(--background))",
  muted: "var(--muted)",
  mutedForeground: "var(--muted-foreground)",
  border: "var(--border)",
  accent: "",
  radius: "10px",
  font: "inherit",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export interface ThemeValue {
  token: ThemeToken;
  value: string;
  /** Given by the agent or an input, not the fallback. */
  given: boolean;
}

export interface ThemeModel {
  values: Record<ThemeToken, ThemeValue>;
  /** Keys that were not tokens, or values that were refused. */
  problems: string[];
}

const ALIASES: Record<string, ThemeToken> = {
  primary: "primary", brand: "primary", tint: "primary",
  primaryforeground: "primaryForeground", onprimary: "primaryForeground", primaryink: "primaryForeground",
  background: "background", bg: "background", surface: "background",
  foreground: "foreground", fg: "foreground", text: "foreground", ink: "foreground",
  card: "card", panel: "card", raised: "card",
  muted: "muted", subtle: "muted",
  mutedforeground: "mutedForeground", secondarytext: "mutedForeground", textmuted: "mutedForeground",
  border: "border", line: "border", stroke: "border",
  accent: "accent", secondary: "accent", highlight: "accent",
  radius: "radius", rounding: "radius", cornerradius: "radius",
  font: "font", fontfamily: "font", sans: "font", typeface: "font",
  mono: "mono", fontmono: "mono", code: "mono",
};

const squash = (k: string) => k.toLowerCase().replace(/^-+/, "").replace(/[^a-z]/g, "");

const SAFE_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "light-dark", "var", "calc", "min", "max", "clamp"]);

/** A CSS value that can't leave its declaration or fetch anything. */
export function safeCss(v: string): boolean {
  if (v.length > 200) return false;
  if (/[;{}<>\\]|\/\*|url\s*\(|image\s*\(|image-set|@import|expression\s*\(|attr\s*\(|env\s*\(/i.test(v)) return false;
  // Only color and math functions: nothing that loads (url, image, src) or reads outside (attr, env).
  for (const m of v.matchAll(/([a-z-]+)\s*\(/gi)) if (!SAFE_FUNCTIONS.has(m[1].toLowerCase())) return false;
  // Parentheses and quotes must balance, or the value spills into the next one.
  let depth = 0;
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0 && (v.match(/"/g)?.length ?? 0) % 2 === 0 && (v.match(/'/g)?.length ?? 0) % 2 === 0;
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|inherit|initial)$/i;

/** "Inter" or "Inter, sans-serif": names with spaces get quotes; a generic family follows. */
export function fontStack(v: string, mono = false): string {
  const parts = v.split(",").map((p) => p.trim()).filter(Boolean);
  const quoted = parts.map((p) => (/^["']/.test(p) || GENERIC.test(p) || !/\s/.test(p) ? p : `"${p}"`));
  if (!quoted.some((p) => GENERIC.test(p))) quoted.push(mono ? "ui-monospace, monospace" : "system-ui, sans-serif");
  return quoted.join(", ");
}

export function readTheme(vars: unknown): ThemeModel {
  const problems: string[] = [];
  const values = Object.fromEntries(THEME_TOKENS.map((t) => [t, { token: t, value: THEME_FALLBACK[t], given: false }])) as Record<ThemeToken, ThemeValue>;
  if (vars != null && (typeof vars !== "object" || Array.isArray(vars))) problems.push("vars should be an object like {primary: \"#4F46E5\", radius: 10}");
  const entries = vars && typeof vars === "object" && !Array.isArray(vars) ? Object.entries(vars as Record<string, unknown>) : [];
  for (const [k, raw] of entries) {
    const token = Object.hasOwn(ALIASES, squash(k)) ? ALIASES[squash(k)] : undefined;
    if (!token) {
      problems.push(`${k} isn't a theme token; use ${THEME_TOKENS.join(", ")}`);
      continue;
    }
    if (raw == null || raw === "") continue;
    let value = typeof raw === "number" && Number.isFinite(raw) ? (token === "radius" ? `${Math.max(0, Math.min(64, raw))}px` : String(raw)) : typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    if (!safeCss(value)) {
      problems.push(`${k}: "${value.slice(0, 40)}" isn't a plain CSS value, so it was left out`);
      continue;
    }
    if (token === "font" || token === "mono") value = fontStack(value, token === "mono");
    if (token === "radius" && /^\d+(\.\d+)?$/.test(value)) value = `${value}px`;
    values[token] = { token, value, given: true };
  }
  return { values, problems };
}

/** The tokens as custom properties for a style attribute, all prefixed so nothing outside reads them. */
export function themeStyle(m: ThemeModel, ink: (color: string) => string | null): Record<string, string> {
  const v = m.values;
  const out: Record<string, string> = {};
  for (const t of THEME_TOKENS) if (v[t].value) out[`--tp-${t.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v[t].value;
  // Text on the primary color: given, else whichever of black and white reads on it.
  if (!v.primaryForeground.given) out["--tp-primary-foreground"] = (v.primary.given ? ink(v.primary.value) : null) ?? "var(--primary-foreground)";
  if (!v.accent.given) out["--tp-accent"] = "var(--tp-primary)";
  return out;
}
