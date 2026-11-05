// Live data from bb itself, for any card: load("bb:<source>").
//
// The plugin's server reads bb through the plugin SDK, scoped to the card's own
// thread (its project and the threads it spawned), and the card draws it with any
// component. Inside a live card it re-reads every 2 s like a file.

export const BB_DATA_PREFIX = "bb:";

export interface BbSourceSpec {
  name: string;
  /** Whether it needs the card's thread (anything about threads, git or PRs). */
  thread: boolean;
  summary: string;
}

/** Every source, with what it returns, for the prompt, iris_docs and the gallery. */
export const BB_SOURCES: readonly BbSourceSpec[] = [
  { name: "thread", thread: true, summary: "this thread: {id, title, status, waitingOnYou, queued, context: {used, window, percent, model, categories: [{label, tokens}]}, cost: {amount, currency} | null}" },
  { name: "threads", thread: true, summary: "threads this thread started (scope=project: the project's top-level threads; usage=1 adds context and cost): [{id, title, status, waitingOnYou, queuedWork: none|waiting|failed, updatedAt, branch, context?, cost?}]" },
  { name: "usage", thread: false, summary: "plan usage windows per provider: [{provider, plan, label, usedPercent, resetsAt, spentUsd, limitUsd}]" },
  { name: "commits", thread: true, summary: "this branch's commits since its base: {branch, base, ahead, behind, commits: [{sha, subject, author, at}]}" },
  { name: "pr", thread: true, summary: "this branch's pull request: {number, title, url, state, draft, checks: {state, passed, failed, pending}, review, mergeable}" },
  { name: "changes", thread: true, summary: "files changed on this branch, uncommitted included: {files: [{path, status, added, removed}], added, removed}" },
  { name: "environments", thread: true, summary: "the project's worktrees: [{branch, threads, changedFiles, pullRequest}]" },
  { name: "machines", thread: false, summary: "bb machines: [{name, status, lastSeenAt}]" },
  { name: "plugins", thread: false, summary: "installed plugins and their health: [{id, version, status, detail}]" },
];

export function isBbSource(path: string): boolean {
  return path.startsWith(BB_DATA_PREFIX);
}

export function parseBbSource(spec: string): { ok: true; name: string; query: Record<string, string> } | { ok: false; error: string } {
  if (!isBbSource(spec)) return { ok: false, error: "not a bb source" };
  const rest = spec.slice(BB_DATA_PREFIX.length);
  const q = rest.indexOf("?");
  const name = (q >= 0 ? rest.slice(0, q) : rest).trim();
  if (!BB_SOURCES.some((s) => s.name === name)) return { ok: false, error: `"bb:${name}" isn't a bb source; there are ${BB_SOURCES.map((s) => `bb:${s.name}`).join(", ")}` };
  const query: Record<string, string> = {};
  if (q >= 0) {
    for (const pair of rest.slice(q + 1).split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : "1";
      if (!/^[a-z]{1,20}$/.test(k)) return { ok: false, error: `"${k}" isn't an option of bb:${name}` };
      try {
        query[k] = decodeURIComponent(v.replace(/\+/g, " ")).slice(0, 100);
      } catch {
        return { ok: false, error: `the value of "${k}" has a broken escape` };
      }
    }
  }
  return { ok: true, name, query };
}
