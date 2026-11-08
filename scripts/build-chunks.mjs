#!/usr/bin/env node
// Builds on-demand chunks into dist/chunks/ with a manifest. Run before
// `bb plugin build` whenever a chunk changes, and commit dist/chunks/: git
// installs never run this script. Chunks live in dist/ because bb's Tailwind
// scan skips it (chunk sources in chunks/ are scanned, so their utility
// classes land in the main app.css).
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist", "chunks");
const ENTRIES = { icons: "chunks/icons.ts", "react-app": "chunks/react-app.ts", katex: "chunks/katex.ts", graph: "chunks/graph.ts", play: "chunks/play.tsx", scene: "chunks/scene.tsx", sheet: "chunks/sheet.tsx", inspect: "chunks/inspect.tsx", codework: "chunks/codework.tsx", board: "chunks/board.tsx", l10n: "chunks/strings.tsx", assets: "chunks/assets.tsx", pdf: "chunks/pdf.tsx", tools: "chunks/tools.tsx", interact: "chunks/interact.tsx", track: "chunks/track.tsx", compare: "chunks/compare.tsx", agents: "chunks/agents.tsx", debug: "chunks/debug.tsx", craft: "chunks/craft.tsx", "geo-world": "assets/geo/world.json", "geo-us": "assets/geo/us.json", "pdf-worker": "node_modules/pdfjs-dist/build/pdf.worker.min.mjs" };

// The iris-react frame runtime: React, react-dom and the kit as one classic
// script, inlined into each app's srcdoc by the react-app chunk.
const frame = await build({
  absWorkingDir: root,
  entryPoints: ["chunks/react-frame/runtime.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022", "chrome110"],
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const runtime = frame.outputFiles[0].text;
// It is inlined into a <script> element, so it must never close or comment one.
if (/<\/script|<!--/i.test(runtime)) throw new Error("frame runtime contains </script or <!--");
if (/\beval\(|new Function\(/.test(runtime)) throw new Error("frame runtime needs eval; the frame's CSP forbids it");
const virtualRuntime = {
  name: "react-frame-runtime",
  setup(b) {
    b.onResolve({ filter: /^virtual:react-frame-runtime$/ }, () => ({ path: "runtime", namespace: "react-frame" }));
    b.onLoad({ filter: /.*/, namespace: "react-frame" }, () => ({ contents: `export default ${JSON.stringify(runtime)};`, loader: "js" }));
  },
};

// React, the SDK and Iris's own UI pieces come from the main bundle, never a
// copy: a second React breaks hooks, a second Iris env is a different context.
// ui/chunks.ts keeps them on globalThis[SHARED_KEY][pluginId].current; each
// shim below finds its plugin id from the chunk's own URL and exports exactly
// the names the chunk sources import (scanned here, so a missing one fails the
// build). Iris and SDK names call through on every use, so a plugin reload
// re-points chunks that were already loaded.
const SHARED_KEY = "__iris_shared_v1";
const SHARED = { react: "react", "react/jsx-runtime": "jsxRuntime", "@get-bb/plugin-sdk/app": "sdk", "@iris/ui": "iris" };
const CALL_THROUGH = new Set(["sdk", "iris"]);
const FORBIDDEN = [/node_modules\/react\//, /node_modules\/react-dom\//, /node_modules\/scheduler\//, /node_modules\/@get-bb\//, /(^|\/)ui\//];

async function importedNames() {
  const { readdir } = await import("node:fs/promises");
  const names = Object.fromEntries(Object.keys(SHARED).map((k) => [k, new Set()]));
  names["react/jsx-runtime"] = new Set(["jsx", "jsxs", "Fragment"]);
  for (const f of await readdir(join(root, "chunks"))) {
    if (!/\.tsx?$/.test(f)) continue;
    const src = await readFile(join(root, "chunks", f), "utf8");
    for (const m of src.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)"/g)) {
      const spec = m[3];
      if (!(spec in SHARED) || m[1]) continue;
      const clause = m[2];
      if (/\*|^\w/.test(clause.trim()) && !clause.trim().startsWith("{")) throw new Error(`chunks/${f}: import named exports from "${spec}" ({ a, b }), not a default or namespace`);
      for (const part of clause.replace(/[{}]/g, "").split(",")) {
        const name = part.trim().replace(/^type\s+/, "");
        if (!name || part.trim().startsWith("type ")) continue;
        names[spec].add(name.split(/\s+as\s+/)[0]);
      }
    }
  }
  return names;
}
const NAMES = await importedNames();

const sharedRuntime = {
  name: "iris-shared-runtime",
  setup(b) {
    const filter = new RegExp(`^(${Object.keys(SHARED).map((s) => s.replace(/[/.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
    b.onResolve({ filter }, (args) => ({ path: args.path, namespace: "iris-shared" }));
    b.onResolve({ filter: /^iris-shared-host$/ }, () => ({ path: "host", namespace: "iris-shared-host" }));
    b.onLoad({ filter: /.*/, namespace: "iris-shared-host" }, () => ({
      loader: "js",
      contents: [
        `const m = /\\/plugins\\/([^/]+)\\/http\\//.exec(new URL(import.meta.url).pathname);`,
        `const id = m ? decodeURIComponent(m[1]) : "iris";`,
        `export function shared(slot) {`,
        `  const v = globalThis[${JSON.stringify(SHARED_KEY)}]?.[id]?.current?.[slot];`,
        `  if (v == null) throw new Error("Iris chunk: " + slot + " comes from the main bundle; load chunks through ui/chunks.ts");`,
        `  return v;`,
        `}`,
      ].join("\n"),
    }));
    b.onLoad({ filter: /.*/, namespace: "iris-shared" }, (args) => {
      const slot = SHARED[args.path];
      const lines = [`import { shared } from "iris-shared-host";`];
      if (CALL_THROUGH.has(slot)) {
        for (const n of NAMES[args.path]) lines.push(`export function ${n}(...a) { return shared(${JSON.stringify(slot)})[${JSON.stringify(n)}](...a); }`);
      } else {
        lines.push(`const s = shared(${JSON.stringify(slot)});`);
        for (const n of NAMES[args.path]) lines.push(`export const ${n} = s[${JSON.stringify(n)}];`);
      }
      return { loader: "js", contents: lines.join("\n") };
    });
  },
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ENTRIES,
  outdir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022", "chrome110"],
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  entryNames: "[name]-[hash]",
  metafile: true,
  logLevel: "warning",
  plugins: [virtualRuntime, sharedRuntime],
});
for (const input of Object.keys(result.metafile.inputs)) {
  if (FORBIDDEN.some((re) => re.test(input))) throw new Error(`a chunk bundled ${input}; map it through the shared runtime instead`);
}
const manifest = { files: {}, entries: {}, styles: {}, samples: {} };
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const [out, meta] of Object.entries(result.metafile.outputs)) {
  const file = basename(out);
  const bytes = await readFile(join(root, out));
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  const gz = gzipSync(bytes, { level: 9 });
  await writeFile(join(outdir, `${file}.br`), br);
  await writeFile(join(outdir, `${file}.gz`), gz);
  manifest.files[file] = bytes.length;
  console.log(`${file.padEnd(28)} ${kb(bytes.length).padStart(10)}  gz ${kb(gz.length).padStart(9)}  br ${kb(br.length).padStart(9)}`);
  if (meta.entryPoint) {
    const name = Object.entries(ENTRIES).find(([, src]) => meta.entryPoint.endsWith(src.replace(/^\.\//, "")))?.[0];
    if (name) manifest.entries[name] = file;
  }
}
// KaTeX's stylesheet and its woff2 fonts, hashed so they can be cached forever.
// Every selector in it starts with .katex, so it can't touch the host's styles.
{
  const katexDir = join(root, "node_modules", "katex", "dist");
  let css = await readFile(join(katexDir, "katex.min.css"), "utf8");
  const fonts = new Map();
  css = css.replace(/src:url\(fonts\/(KaTeX_[\w-]+)\.woff2\) format\("woff2"\)[^;}]*/g, (_, font) => {
    fonts.set(font, true);
    return `src:url(${font}.woff2) format("woff2")`;
  });
  for (const font of fonts.keys()) {
    const bytes = await readFile(join(katexDir, "fonts", `${font}.woff2`));
    const file = `${font}-${hash(bytes)}.woff2`;
    await writeFile(join(outdir, file), bytes);
    manifest.files[file] = bytes.length;
    css = css.replaceAll(`url(${font}.woff2)`, `url(${file})`);
  }
  const file = `katex-${hash(Buffer.from(css))}.css`;
  await writeCompressed(file, Buffer.from(css));
  manifest.styles.katex = file;
}

// The gallery's samples (no thread, no files): a short test clip for VideoPlayer,
// a TrueType font (KaTeX Main, MIT) for FontPreview and a page screenshot for
// AccessibilityAudit.
for (const [name, src] of Object.entries({ clip: "assets/samples/clip.mp4", font: "assets/samples/sample-font.ttf", "a11y-page": "assets/samples/a11y-page.png" })) {
  const bytes = await readFile(join(root, src));
  const [stem, ext] = basename(src).split(/\.(?=[^.]+$)/);
  const file = `${stem}-${hash(bytes)}.${ext}`;
  await writeFile(join(outdir, file), bytes);
  manifest.files[file] = bytes.length;
  manifest.samples[name] = file;
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url").replace(/[-_]/g, "").slice(0, 8).toUpperCase();
}

async function writeCompressed(file, bytes) {
  await writeFile(join(outdir, file), bytes);
  await writeFile(join(outdir, `${file}.br`), brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  await writeFile(join(outdir, `${file}.gz`), gzipSync(bytes, { level: 9 }));
  manifest.files[file] = bytes.length;
}

await writeFile(join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log({ ...manifest, frameRuntime: runtime.length });
