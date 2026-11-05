import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { KIT, KIT_EXPORTS, checkImports, reactGuide } from "../core/react-kit";
import { docsFor, mainInstructions } from "../core/prompt";
import { CSP, buildHtmlDoc, buildReactDoc } from "../ui/app-doc";

const root = path.resolve(import.meta.dirname, "..");
type Chunk = { runtime: string; css: string; compileApp(s: string): { ok: true; code: string } | { ok: false; problems: { message: string; line?: number }[] } };
async function chunk(): Promise<Chunk> {
  const manifest = JSON.parse(readFileSync(path.join(root, "dist/chunks/manifest.json"), "utf8")) as { entries: Record<string, string> };
  return import(pathToFileURL(path.join(root, "dist/chunks", manifest.entries["react-app"])).href);
}

describe("iris-react kit", () => {
  it("compiles every kit example with the committed chunk", async () => {
    const { compileApp } = await chunk();
    for (const k of KIT) {
      const r = compileApp(k.example);
      expect(r.ok, `${k.name}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("reports syntax errors and bad imports with their line", async () => {
    const { compileApp } = await chunk();
    const syntax = compileApp("export default function App() {\n  return <div>\n    {x</div>;\n}");
    expect(syntax).toMatchObject({ ok: false, problems: [{ line: 3 }] });
    expect(checkImports('import { Card, Heading } from "iris";\nimport _ from "lodash";')).toEqual([
      expect.objectContaining({ line: 1, message: expect.stringContaining("no Heading") }),
      expect.objectContaining({ line: 2, message: expect.stringContaining('"lodash"') }),
    ]);
    expect(checkImports('// was: import { Thing } from "./thing";\nconst s = `import _ from "lodash"`;\nimport { Card } from "iris";')).toEqual([]);
    expect(checkImports('import type { FC } from "react";\nimport { useState } from "react";\nimport { Card as C, type KitProp } from "iris";')).toEqual([]);
  });

  it("flags kit components drawn without an import, and nothing else", async () => {
    const { compileApp } = await chunk();
    expect(compileApp('import { Card } from "iris";\n\nexport default () => (\n  <Card><Text>hi</Text></Card>\n);')).toEqual({ ok: false, problems: [expect.objectContaining({ line: 4, message: expect.stringContaining("<Text> is used but not imported") })] });
    const valid = [
      // A type named like a kit component, a local component, an alias, a namespace import, a tag in a string.
      'import { useState } from "react";\nimport { Button, Stack } from "iris";\ninterface Card { rank: number }\nexport default function App() {\n  const [hand] = useState<Card[]>([]);\n  return <Stack><Button>{hand.length}</Button></Stack>;\n}',
      'import { Card as C } from "iris";\nfunction Text() { return null; }\nexport default () => <C><Text /></C>;',
      'import * as I from "iris";\nexport default () => <I.Card />;',
      'import { Card } from "iris";\nconst SAMPLE = `<Text>hello</Text>`;\nexport default () => <Card>{SAMPLE}</Card>;',
    ];
    for (const src of valid) expect(compileApp(src), src).toMatchObject({ ok: true });
  });

  it("keeps the frame's iris module, the docs and the prompt in step", () => {
    const runtime = readFileSync(path.join(root, "chunks/react-frame/runtime.tsx"), "utf8");
    const block = /const irisModule = esm\(\{([\s\S]*?)\}\);/.exec(runtime)?.[1] ?? "";
    const exported = [...block.matchAll(/(\w+): Kit\.\w+/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual([...KIT_EXPORTS].sort());
    const guide = reactGuide();
    for (const k of KIT) expect(guide).toContain(`<${k.name}>`);
    expect(docsFor(["React"])).toBe(guide);
    for (const k of KIT) expect(mainInstructions("eager")).toContain(k.name);
    expect(mainInstructions("eager")).toContain("```iris-react");
  });
});

describe("app documents", () => {
  const theme = ":root{--foreground:#fff}";
  it("puts the no-network policy before anything the agent wrote", () => {
    for (const doc of [buildHtmlDoc("<html><head><script>fetch('x')</script></head><body></body></html>", theme, {}), buildReactDoc("/*runtime*/", "fetch('x')", theme, {}, "")]) {
      const head = doc.indexOf("<head>") + "<head>".length;
      expect(doc.indexOf('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy"')).toBe(head);
      expect(doc).toContain(`content="${CSP}"`);
      expect(doc.indexOf("fetch('x')")).toBeGreaterThan(doc.indexOf("Content-Security-Policy"));
    }
    expect(CSP).toContain("connect-src 'none'");
    expect(CSP).not.toContain("unsafe-eval");
  });

  it("never lets the app's code close its script element", () => {
    const hostile = 'const s = "</script><script>parent.postMessage(1)</script><!--";\n';
    const doc = buildReactDoc("/*runtime*/", hostile, theme, { k: "</script>" }, "");
    // The bridge, the runtime and the app: three scripts, no more.
    expect(doc.match(/<script>/g)).toHaveLength(3);
    expect(doc.match(/<\/script>/g)).toHaveLength(3);
    expect(doc).not.toContain("<!--");
  });

  it("ships a frame runtime that is safe to inline and needs no eval", async () => {
    const { runtime, css } = await chunk();
    expect(runtime).not.toMatch(/<\/script|<!--/i);
    expect(runtime).not.toMatch(/\beval\(|new Function\(/);
    expect(css).not.toMatch(/<\/style/i);
  });
});

describe("import scan on hostile input", () => {
  it("stays fast on a long unfinished import", () => {
    const src = `import ${" ".repeat(20000)}x\n`.repeat(5);
    const t = performance.now();
    checkImports(src);
    expect(performance.now() - t).toBeLessThan(300);
  });

  it("still reads named, default and side-effect imports", () => {
    expect(checkImports(`import { Card, Nope } from "iris";\nimport "lodash";\nimport type { X } from "nowhere";`).map((p) => p.message)).toEqual([
      expect.stringContaining('"iris" has no Nope'),
      expect.stringContaining('"lodash" isn\'t available'),
    ]);
  });
});
