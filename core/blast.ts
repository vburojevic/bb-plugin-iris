// BlastRadius: changed files, the files that import them (and those that
// import those, up to a depth), and the tests that reach them. Imports come as
// madge --json ({file: [imports]}), edges [[from, to]] where from imports to,
// or [{from, to}]. Tests are files named *.test.* / *.spec.* / __tests__ that
// the walk reaches, a list of test files, or {test: [files it covers]}.

export interface BlastNode {
  path: string;
  /** 0 for a changed file. */
  distance: number;
  changed: boolean;
  test: boolean;
  /** Importers reached first through this file. */
  children: BlastNode[];
  /** How many files import this one in all, reached or not. */
  importers: number;
}

export interface BlastModel {
  roots: BlastNode[];
  /** Files reached, changed ones left out. */
  affected: number;
  tests: string[];
  /** Tests reached through a covers map rather than imports. */
  covered: string[];
  /** The walk stopped at the depth with more importers beyond it. */
  truncated: boolean;
  problems: string[];
}

export const MAX_BLAST_FILES = 3000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const TEST = /(^|\/)(__tests__|tests?)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|^test_[^/]*\.py$|\/test_[^/]*\.py$/;

/** A path in one spelling: forward slashes, no leading ./ */
export const normPath = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
export const isTestFile = (p: string) => TEST.test(p);

function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(/\r?\n/).map(normPath).filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map(normPath) : [];
}

/** file -> the files that import it. */
function importersOf(imports: unknown, problems: string[]): Map<string, Set<string>> {
  const by = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    const set = by.get(to) ?? new Set<string>();
    set.add(from);
    by.set(to, set);
  };
  if (isObj(imports)) {
    for (const [file, deps] of Object.entries(imports)) for (const d of strings(deps)) add(normPath(file), d);
  } else if (Array.isArray(imports)) {
    for (const e of imports) {
      if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string") add(normPath(e[0]), normPath(e[1]));
      else if (isObj(e) && typeof e.from === "string" && typeof e.to === "string") add(normPath(e.from), normPath(e.to));
      else if (isObj(e) && typeof (e.source ?? e.file) === "string" && Array.isArray(e.dependencies)) {
        // dependency-cruiser: {source, dependencies: [{resolved}]}
        for (const d of e.dependencies) if (isObj(d) && typeof (d.resolved ?? d.module) === "string") add(normPath(String(e.source ?? e.file)), normPath(String(d.resolved ?? d.module)));
      }
    }
  } else if (imports != null) problems.push("imports should be {file: [imports]} (madge --json) or [[from, to]] edges");
  return by;
}

/** Changed files may be given as short paths; match them to graph paths that end the same way. */
function resolveChanged(changed: string[], known: Set<string>): string[] {
  return changed.map((c) => {
    if (known.has(c)) return c;
    const hit = [...known].filter((k) => k.endsWith(`/${c}`) || c.endsWith(`/${k}`));
    return hit.length === 1 ? hit[0] : c;
  });
}

export function blastRadius(input: { changed?: unknown; imports?: unknown; tests?: unknown; depth?: unknown }): BlastModel {
  const problems: string[] = [];
  const importers = importersOf(input.imports, problems);
  const known = new Set<string>([...importers.keys(), ...[...importers.values()].flatMap((s) => [...s])]);
  const changedRaw = strings(input.changed);
  // git diff --name-status lines: "M\tpath" or "R100\told\tnew"
  const changedList = changedRaw.map((p) => (/^[AMDRCTU]\d*\s/.test(p) ? p.split(/\s+/).at(-1) as string : p));
  const changed = [...new Set(resolveChanged(changedList, known))];
  if (!changed.length) problems.push("needs changed: the files that changed (git diff --name-only)");
  const depthIn = typeof input.depth === "number" && Number.isFinite(input.depth) ? input.depth : 3;
  const depth = Math.max(1, Math.min(10, Math.round(depthIn)));

  const testList = strings(input.tests);
  const coversMap = isObj(input.tests) ? input.tests : null;
  const testSet = new Set(testList);
  const isTest = (p: string) => testSet.has(p) || isTestFile(p);

  const seen = new Map<string, BlastNode>();
  let truncated = false;
  let capped = false;
  const roots: BlastNode[] = changed.map((p) => {
    const n: BlastNode = { path: p, distance: 0, changed: true, test: isTest(p), children: [], importers: importers.get(p)?.size ?? 0 };
    seen.set(p, n);
    return n;
  });
  // Breadth first, so each file sits under the changed file nearest to it.
  let frontier = roots;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: BlastNode[] = [];
    for (const parent of frontier) {
      for (const imp of [...(importers.get(parent.path) ?? [])].sort()) {
        if (seen.has(imp)) continue;
        if (seen.size >= MAX_BLAST_FILES) {
          capped = true;
          break;
        }
        const n: BlastNode = { path: imp, distance: d, changed: false, test: isTest(imp), children: [], importers: importers.get(imp)?.size ?? 0 };
        seen.set(imp, n);
        parent.children.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  for (const n of frontier) if ([...(importers.get(n.path) ?? [])].some((p) => !seen.has(p))) truncated = true;
  if (capped) problems.push(`stopped after ${MAX_BLAST_FILES} files`);
  // Files that others import first, tests (leaves) last, then by name.
  const sortTree = (n: BlastNode) => {
    n.children.sort((a, b) => Number(a.test) - Number(b.test) || b.importers - a.importers || a.path.localeCompare(b.path));
    n.children.forEach(sortTree);
  };
  roots.forEach(sortTree);

  const reached = [...seen.values()].filter((n) => n.test).map((n) => n.path);
  const covered: string[] = [];
  if (coversMap) {
    const changedSet = new Set(changed);
    for (const [test, files] of Object.entries(coversMap)) {
      const t = normPath(test);
      if (strings(files).some((f) => changedSet.has(f) || seen.has(f)) && !reached.includes(t) && !covered.includes(t)) covered.push(t);
    }
  }
  // A test file named in tests that the walk never reached is left out: nothing it imports changed.
  return { roots, affected: seen.size - roots.length, tests: [...new Set(reached)].sort(), covered: covered.sort(), truncated, problems };
}

/** Every node, depth first. */
export function blastNodes(roots: BlastNode[]): BlastNode[] {
  const out: BlastNode[] = [];
  const walk = (n: BlastNode) => (out.push(n), n.children.forEach(walk));
  roots.forEach(walk);
  return out;
}
