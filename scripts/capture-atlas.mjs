#!/usr/bin/env node
// Screenshots every component's preview from the built playground site, in Ayu
// Dark and Ayu Light (themes with a colored accent), as WebP in docs/atlas/<theme>/<Name>.webp for the README.
//   (serve site-dist/ first) PW=<playwright> SITE=http://127.0.0.1:8765/ node scripts/capture-atlas.mjs [Name...]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pw = createRequire(import.meta.url)(process.env.PW ?? "playwright");
const site = process.env.SITE ?? "http://127.0.0.1:8765/";
const only = process.argv.slice(2);

const browser = await pw.chromium.launch();
const problems = [];
for (const [theme, label] of [["dark", "Ayu Dark"], ["light", "Ayu Light"]]) {
  const dir = join(root, "docs", "atlas", theme);
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript((t) => localStorage.setItem("iris-site-theme", t), label);
  const page = await ctx.newPage();
  await page.goto(`${site}#/components`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".iris-gallery", { timeout: 60_000 });
  const names = only.length ? only : await page.$$eval(".iris-gallery [data-entry]", (els) => els.map((e) => e.getAttribute("data-entry")).filter((n) => n && !n.startsWith("react-")));
  for (const name of names) {
    await page.evaluate((n) => { location.hash = `#/${n}`; }, name);
    const stage = await page.waitForSelector("[data-iris-stage]", { timeout: 30_000 });
    await page.waitForTimeout(800);
    for (let t = 0; t < 30; t++) {
      if (!(await page.$("[data-iris-stage] .iris-shimmer"))) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1800);
    const text = await stage.evaluate((e) => e.innerText);
    if (/load inside a bb thread|only inside a thread|inside bb|can't|couldn't|Error/i.test(text)) problems.push(`${theme} ${name}: ${text.replace(/\s+/g, " ").slice(0, 140)}`);
    const box = await stage.boundingBox();
    const png = join(dir, `${name}.png`);
    await page.screenshot({ path: png, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1100) } });
    execFileSync("cwebp", ["-quiet", "-q", "82", png, "-o", join(dir, `${name}.webp`)]);
    rmSync(png);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(root, "docs", "atlas", "problems.txt"), problems.join("\n") + "\n");
console.log(`done; ${problems.length} previews mention a problem (docs/atlas/problems.txt)`);
