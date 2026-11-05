#!/usr/bin/env node
// Writes the README's feature icons (Lucide, one stroke color per GitHub theme)
// to docs/icons/{dark,light}/<name>.svg.
//   node scripts/readme-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as lucide from "lucide";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The Ayu accent the README pictures use, and a darker amber that keeps 3:1 contrast on white.
const COLORS = { dark: "#e6b450", light: "#a86200" };
const ICONS = ["Presentation", "Blocks", "Palette", "Activity", "MousePointerClick", "AppWindow", "ShieldCheck", "Gauge"];

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(" ");
for (const [theme, color] of Object.entries(COLORS)) {
  const dir = join(root, "docs", "icons", theme);
  mkdirSync(dir, { recursive: true });
  for (const name of ICONS) {
    const node = lucide[name];
    if (!node) throw new Error(`no Lucide icon ${name}`);
    const body = node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join("");
    const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    writeFileSync(join(dir, `${kebab}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="-4 -4 32 32" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`);
  }
}
console.log(`icons: ${ICONS.length} per theme`);
