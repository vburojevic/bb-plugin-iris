// bb builds the frontend bundle at install time from a git install that skips
// devDependencies, and supplies only "@get-bb/plugin-sdk/app" to it. A runtime
// import of the SDK root from frontend code then fails to resolve, and bb
// refuses the install (Iris 1.10.0 shipped that way). Type-only imports are fine.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const FRONTEND = ["app.tsx", "ui", "chunks", "components", "hooks", "lib", "core"];

function files(path: string): string[] {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return /\.(ts|tsx)$/.test(path) ? [path] : [];
  return readdirSync(full).flatMap((name) => (name === "node_modules" ? [] : files(join(path, name))));
}

describe("frontend imports", () => {
  it("never imports the SDK root at runtime", () => {
    const offenders: string[] = [];
    for (const file of FRONTEND.flatMap((p) => { try { return files(p); } catch { return []; } })) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const m of source.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']@get-bb\/plugin-sdk["']/gm)) {
        offenders.push(`${file}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
