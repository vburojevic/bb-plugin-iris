// What the live project components show in the gallery, where no thread
// exists to read: a small, believable branch. Marked "Sample" on screen.
import type { ChangesData, CommitsData, EnvironmentsData, PullRequestData, ThreadsData } from "../../core/project";

const MIN = 60_000;

const PARSE_PATCH = `@@ -40,7 +40,9 @@ export function parse(source: string): Program {
   const tokens = lex(source);
-  const nodes = readNodes(tokens, 0);
+  // A half-written tag keeps the last good tree instead of flickering.
+  const nodes = readNodes(tokens, 0, { partial: true });
+  if (!nodes.length && last) return last;
   return { nodes, errors };
 }
`;

const STREAM_PATCH = `@@ -0,0 +1,6 @@
+// Reads a block as it streams and redraws only the tags that closed.
+export function stream(chunks: AsyncIterable<string>) {
+  let source = "";
+  for await (const chunk of chunks) source += chunk;
+  return parse(source);
+}
`;

const VIEW_PATCH = `@@ -12,4 +12,4 @@ export function CardView({ props, children }: ViewProps) {
-  const padded = props.dense ? "p-2" : "p-4";
+  const padded = props.dense ? "p-2.5" : "p-4";
   return <section className={padded}>{children}</section>;
 }
`;

export function sampleChanges(sha: string | null): ChangesData {
  return {
    ok: true,
    scope: sha
      ? { kind: "commit", branch: "streaming-parser", base: "main", onBase: false, noBase: false, sha, subject: "Keep the last good tree while a tag streams" }
      : { kind: "branch", branch: "streaming-parser", base: "main", onBase: false, noBase: false, sha: null, subject: null },
    files: [
      { path: "core/parse.ts", previousPath: null, kind: "modified", additions: 3, deletions: 1, binary: false, untracked: false, tooLarge: false, revision: "a" },
      { path: "core/stream.ts", previousPath: null, kind: "added", additions: 6, deletions: 0, binary: false, untracked: !sha, tooLarge: false, revision: "b" },
      { path: "ui/views/layout.tsx", previousPath: null, kind: "modified", additions: 1, deletions: 1, binary: false, untracked: false, tooLarge: false, revision: "c" },
    ],
    totalFiles: 3,
    truncated: false,
    patches: {
      "core/parse.ts": { path: "core/parse.ts", patch: PARSE_PATCH, truncated: false },
      "core/stream.ts": { path: "core/stream.ts", patch: STREAM_PATCH, truncated: false },
      "ui/views/layout.tsx": { path: "ui/views/layout.tsx", patch: VIEW_PATCH, truncated: false },
    },
  };
}

export function sampleCommits(): CommitsData {
  const now = Date.now();
  return {
    ok: true,
    branch: "streaming-parser",
    base: "main",
    onBase: false,
    noBase: false,
    ahead: 3,
    behind: 1,
    total: 3,
    commits: [
      { sha: "9f3c2a1e0b7d4c6a8e2f1d3b5a7c9e0f2a4b6c8d", shortSha: "9f3c2a1", subject: "Keep the last good tree while a tag streams", author: "Ada Byron", authoredAt: now - 12 * MIN },
      { sha: "4b1e8d2c7a9f0e3b6d5c1a2f8e7d9c0b3a6f5e4d", shortSha: "4b1e8d2", subject: "Read blocks as they stream", author: "Ada Byron", authoredAt: now - 95 * MIN },
      { sha: "c7a05f9e2d1b8c3a4f6e0d9b7c2a1f5e8d3b6c4a", shortSha: "c7a05f9", subject: "Tighten card padding in dense mode", author: "Grace Hopper", authoredAt: now - 26 * 60 * MIN },
    ],
  };
}

export function samplePullRequest(): PullRequestData {
  return {
    ok: true,
    branch: "streaming-parser",
    unavailable: null,
    pullRequest: {
      number: 128,
      title: "Stream Iris blocks as they arrive",
      url: "https://github.com/acme/iris/pull/128",
      state: "open",
      base: "main",
      head: "streaming-parser",
      updatedAt: Date.now() - 8 * MIN,
      autoMerge: false,
      inMergeQueue: false,
      checks: { state: "failing", total: 6, passed: 4, failed: 1, pending: 1 },
      review: { state: "review_requested", requests: 1 },
      mergeability: "mergeable",
      attention: "checks_failed",
    },
  };
}

export function sampleEnvironments(): EnvironmentsData {
  const now = Date.now();
  return {
    ok: true,
    more: 0,
    environments: [
      {
        id: "env_sample1",
        name: "streaming-parser",
        branch: "streaming-parser",
        path: "~/worktrees/iris-streaming",
        isWorktree: true,
        current: true,
        threads: [
          { id: "thr_sample1", title: "Stream Iris blocks", status: "active", needsInput: false },
          { id: "thr_sample2", title: "Review the parser change", status: "idle", needsInput: true },
        ],
        changedFiles: 3,
        ahead: 3,
        pullRequest: { number: 128, state: "open", title: "Stream Iris blocks as they arrive", url: "https://github.com/acme/iris/pull/128", checks: "failing" },
        updatedAt: now - 2 * MIN,
      },
      {
        id: "env_sample2",
        name: "gallery-search",
        branch: "gallery-search",
        path: "~/worktrees/iris-gallery",
        isWorktree: true,
        current: false,
        threads: [{ id: "thr_sample3", title: "Search the gallery", status: "idle", needsInput: false }],
        changedFiles: 0,
        ahead: 2,
        pullRequest: { number: 126, state: "merged", title: "Search the gallery", url: "https://github.com/acme/iris/pull/126", checks: "passing" },
        updatedAt: now - 3 * 60 * MIN,
      },
      { id: "env_sample3", name: null, branch: "main", path: "~/Git/iris", isWorktree: false, current: false, threads: [], changedFiles: 0, ahead: 0, pullRequest: null, updatedAt: now - 30 * 60 * MIN },
    ],
  };
}

export function sampleThreads(): ThreadsData {
  const now = Date.now();
  return {
    ok: true,
    mode: "subthreads",
    truncated: false,
    threads: [
      { found: true, id: "thr_sample2", title: "Review the parser change", status: "idle", needsInput: true, archived: false, branch: "streaming-parser", providerId: "claude-code", background: 0, updatedAt: now - 1 * MIN },
      { found: true, id: "thr_sample1", title: "Stream Iris blocks", status: "active", needsInput: false, archived: false, branch: "streaming-parser", providerId: "claude-code", background: 2, updatedAt: now - 0.2 * MIN },
      { found: true, id: "thr_sample4", title: "Profile the first render", status: "error", needsInput: false, archived: false, branch: "perf-pass", providerId: "claude-code", background: 0, updatedAt: now - 40 * MIN },
      { found: true, id: "thr_sample3", title: "Search the gallery", status: "idle", needsInput: false, archived: true, branch: "gallery-search", providerId: "claude-code", background: 0, updatedAt: now - 3 * 60 * MIN },
    ],
  };
}
