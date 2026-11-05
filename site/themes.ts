// Themes the playground offers: bb's default light and dark (from bb's own
// stylesheet, switched with the dark class) and the Ayu themes bb ships.
// swatch is only for the theme menu: the page itself reads the theme's CSS.
import ayuDark from "./css/theme-ayu-dark.css";
import ayuLight from "./css/theme-ayu-light.css";
import ayuMirage from "./css/theme-ayu-mirage.css";

export const THEMES = {
  "Ayu Dark": { css: ayuDark, dark: true, swatch: ["#10141c", "#e6b450"] },
  "Ayu Mirage": { css: ayuMirage, dark: true, swatch: ["#242936", "#ffcc66"] },
  "Ayu Light": { css: ayuLight, dark: false, swatch: ["#fcfcfc", "#f29718"] },
  "bb Dark": { css: "", dark: true, swatch: ["oklch(18% 0 0)", "oklch(82% 0 0)"] },
  "bb Light": { css: "", dark: false, swatch: ["oklch(100% 0 0)", "oklch(27% 0 0)"] },
} as const;

export type ThemeName = keyof typeof THEMES;

/** The theme a first visit gets: Ayu, whose colored accent shows how cards take on a theme. */
export function defaultTheme(): ThemeName {
  return matchMedia("(prefers-color-scheme: light)").matches ? "Ayu Light" : "Ayu Dark";
}
