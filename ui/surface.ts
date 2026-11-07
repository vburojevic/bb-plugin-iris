// The color actually behind an element: every translucent layer above it down to the first
// opaque one, as a CSS background. bb's panels are often a tint over the page, so a single
// color (or a guessed token) would let content show through.

/** The alpha of a computed CSS color: rgb(), rgba(), or the "/ a" form of oklab, oklch and color(). */
export function alpha(color: string): number {
  if (!color || color === "transparent") return 0;
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = color.match(/^rgba\(.*,\s*([\d.]+)\s*\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

/** The layered background behind el (its parents' backgrounds), or null when none is found. */
export function surfaceBehind(el: HTMLElement): string | null {
  const layers: string[] = [];
  for (let up = el.parentElement; up; up = up.parentElement) {
    const bg = getComputedStyle(up).backgroundColor;
    const a = alpha(bg);
    if (a <= 0) continue;
    layers.push(a >= 1 ? bg : `linear-gradient(${bg}, ${bg})`);
    if (a >= 1) break;
  }
  return layers.length ? layers.join(", ") : null;
}
