#!/usr/bin/env node
// Builds the public playground into site-dist/: the real gallery and a live
// editor, with bb's SDK swapped for site/sdk-shim.tsx, the plugin's own chunks
// copied beside it, and bb's captured CSS (scripts/capture-site-css.mjs).
//   node scripts/build-site.mjs
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site-dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: { app: "site/main.tsx" },
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["es2022", "chrome110", "safari16"],
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  loader: { ".css": "text", ".json": "json" },
  alias: { "@get-bb/plugin-sdk/app": "./site/sdk-shim.tsx", sonner: "./site/sonner-shim.ts" },
  define: { __BB_PLUGIN_ID__: '"iris"', "process.env.NODE_ENV": '"production"' },
  chunkNames: "js/[name]-[hash]",
  logLevel: "warning",
});

await cp(join(root, "dist", "chunks"), join(out, "c"), { recursive: true });
const css = (name) => readFile(join(root, "site", "css", name), "utf8");
await writeFile(join(out, "bb.css"), await css("bb.css"));
await cp(join(root, "site", "css", "fonts"), join(out, "fonts"), { recursive: true });
await writeFile(join(out, "iris.css"), await css("iris.css"));
await writeFile(join(out, "site.css"), await readFile(join(root, "site", "site.css"), "utf8"));
await cp(join(root, "assets", "icon.svg"), join(out, "icon.svg"));
await cp(join(root, "site", "samples"), join(out, "samples"), { recursive: true });
await cp(join(root, "core", "parse.ts"), join(out, "samples", "parse.ts"));
await cp(join(root, "docs", "social-preview.png"), join(out, "social-preview.png"));
await mkdir(join(out, "media"), { recursive: true });
await cp(join(root, "docs", "demo.webp"), join(out, "media", "demo.webp"));

// Before first paint: the saved (or default) theme's CSS and light or dark, so a visit never flashes
// bb's neutral palette before the site's own. Same names and defaults as site/themes.ts.
const themeCss = {
  "Ayu Dark": [await css("theme-ayu-dark.css"), true],
  "Ayu Mirage": [await css("theme-ayu-mirage.css"), true],
  "Ayu Light": [await css("theme-ayu-light.css"), false],
  "bb Dark": ["", true],
  "bb Light": ["", false],
};
const prePaint = `(function () {
  var themes = ${JSON.stringify(themeCss).replace(/</g, "\\u003c")};
  var name = null;
  try { name = localStorage.getItem("iris-site-theme"); } catch (e) {}
  if (!name || !Object.prototype.hasOwnProperty.call(themes, name)) name = matchMedia("(prefers-color-scheme: light)").matches ? "Ayu Light" : "Ayu Dark";
  document.getElementById("bb-app-theme").textContent = themes[name][0];
  document.documentElement.classList.toggle("dark", themes[name][1]);
  document.documentElement.style.colorScheme = themes[name][1] ? "dark" : "light";
})();`;
const title = "Iris: live, interactive UI for bb chat";
const description = "120 components agents draw as live cards in bb: charts, tables, plans, diffs, test runs, pickers and small apps, in your theme. Try every one here.";
await writeFile(
  join(out, "index.html"),
  `<!doctype html>
<html lang="en" class="bb-app-shell-root dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="social-preview.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="bb.css">
<style id="bb-app-theme"></style>
<script>${prePaint}</script>
<link rel="stylesheet" href="iris.css">
<link rel="stylesheet" href="site.css">
<script>window.__IRIS_CHUNK_BASE__ = new URL("./c/", location.href).href; window.__IRIS_DEMO_THREAD__ = "thr_playground";</script>
</head>
<body>
<div id="root" data-bb-plugin="iris" data-bb-plugin-root></div>
<script type="module" src="app.js"></script>
</body>
</html>
`,
);
await writeFile(join(out, ".nojekyll"), "");
console.log("built site-dist/");
