#!/usr/bin/env node
// Captures the CSS the playground site needs from a running bb (once per Iris
// release): bb's base stylesheet (tokens, the default light and dark theme,
// shared utilities), Iris's own stylesheet as bb compiled it, and the Ayu
// themes. Saves them to site/css/ so building the site never needs bb.
//   PW=<path to playwright> BB_URL=http://127.0.0.1:38886 node scripts/capture-site-css.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site", "css");
mkdirSync(out, { recursive: true });
const pw = createRequire(import.meta.url)(process.env.PW ?? "playwright");
const base = process.env.BB_URL ?? "http://127.0.0.1:38886";

const browser = await pw.chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`${base}/plugins/iris/gallery`, { waitUntil: "domcontentloaded" });
for (let t = 0; t < 60 && !(await page.$(".iris-gallery")); t++) await page.waitForTimeout(1000);
const sheets = await page.evaluate(() =>
  [...document.styleSheets].map((s) => {
    let text = "";
    try {
      text = [...s.cssRules].map((r) => r.cssText).join("\n");
    } catch {}
    return { href: s.href ?? "", text };
  }),
);
await browser.close();

const bbBase = sheets.find((s) => /\/assets\/index-[^/]+\.css/.test(s.href));
const iris = sheets.find((s) => s.text.includes(".iris-card") && s.text.includes(".iris-edge"));
if (!bbBase || !iris) throw new Error("couldn't find bb's base stylesheet or Iris's stylesheet; is Iris installed and the gallery open?");
// bb's fonts travel with the site: saved beside the CSS, referenced relatively.
mkdirSync(join(out, "fonts"), { recursive: true });
const fontUrls = [...new Set([...bbBase.text.matchAll(/url\("(\/assets\/[^"]+)"\)/g)].map((m) => m[1]))];
for (const u of fontUrls) writeFileSync(join(out, "fonts", u.split("/").pop()), Buffer.from(await (await fetch(base + u)).arrayBuffer()));
writeFileSync(join(out, "bb.css"), bbBase.text.replace(/url\("\/assets\/([^"]+)"\)/g, 'url("fonts/$1")'));
writeFileSync(join(out, "iris.css"), iris.text);

for (const id of ["ayu-dark", "ayu-light", "ayu-mirage"]) {
  const css = execFileSync("bb", ["theme", "show", `plugin:ayu:${id}`, "--css"], { encoding: "utf8" });
  writeFileSync(join(out, `theme-${id}.css`), css);
}
console.log(`saved bb.css (${bbBase.text.length}), iris.css (${iris.text.length}) and 3 themes to site/css/`);
