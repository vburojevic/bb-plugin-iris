// Reads a card's own thread's project state from bb for the live project
// components. Git comes from the bundled Git plugin (bb--git) and pull
// requests from GitHub PR Status (bb--github-pr-status), both through
// sdk.plugins.callRpc; threads and environments from the SDK. Every read acts
// for one thread: it sees that thread's environment and its project only.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  MAX_ENVIRONMENTS,
  epochMs,
  failure,
  matchesPathFilter,
  pullRequestInfo,
  sortEnvironments,
  sortThreads,
  type ChangedFile,
  type ChangesResult,
  type ChangesScope,
  type ChangesTarget,
  type CommitsResult,
  type EnvironmentInfo,
  type EnvironmentsResult,
  type FilePatch,
  type PatchResult,
  type ProjectFailure,
  type PullRequestResult,
  type ThreadInfo,
  type ThreadRow,
  type ThreadStatus,
  type ThreadsResult,
} from "./core/project";

// ---------- the parts of bb--git and bb--github-pr-status Iris reads ----------

const gitFailure = z.union([
  z.object({ outcome: z.literal("not_applicable"), message: z.string() }),
  z.object({ outcome: z.literal("unavailable"), failure: z.object({ code: z.string(), message: z.string() }) }),
  z.object({ outcome: z.literal("failed"), message: z.string() }),
]);

const checkout = z.union([
  z.object({ kind: z.literal("branch"), branchName: z.string(), headSha: z.string().nullable() }),
  z.object({ kind: z.literal("detached"), headSha: z.string().nullable() }),
  z.object({ kind: z.literal("unborn"), branchName: z.string().nullable() }),
  z.object({ kind: z.literal("unknown"), reason: z.string() }),
]);

const fileList = z.array(z.object({ path: z.string() }));

const workspace = z.object({
  workingTree: z.object({ fileCount: z.number(), files: fileList, hasUncommittedChanges: z.boolean() }),
  checkout,
  branch: z.object({ currentBranch: z.string().nullable(), defaultBranch: z.string() }),
  mergeBase: z
    .object({
      fileCount: z.number(),
      files: fileList,
      mergeBaseBranch: z.string(),
      aheadCount: z.number(),
      behindCount: z.number(),
      commits: z.array(z.object({ sha: z.string(), shortSha: z.string(), subject: z.string(), authorName: z.string(), authoredAt: z.number() })),
    })
    .nullable(),
});
type Workspace = z.infer<typeof workspace>;

const statusRow = z.union([z.object({ outcome: z.literal("available"), workspace }), gitFailure]);
const statusOutput = z.record(z.string(), statusRow);

const gitTarget = z.union([
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string() }),
  z.object({ type: z.literal("commit"), sha: z.string() }),
]);
type GitTarget = z.infer<typeof gitTarget>;

const patch = z.object({ path: z.string(), patch: z.string(), truncated: z.boolean() });

const filesOutput = z.union([
  z.object({
    outcome: z.literal("available"),
    files: z.array(
      z.object({
        path: z.string(),
        previousPath: z.string().nullable(),
        changeKind: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
        additions: z.number(),
        deletions: z.number(),
        binary: z.boolean(),
        origin: z.enum(["tracked", "untracked"]),
        loadMode: z.enum(["auto", "on_demand", "too_large"]),
        revision: z.string(),
      }),
    ),
    truncated: z.boolean(),
    initialPatches: z.array(patch),
  }),
  gitFailure,
]);

const patchesOutput = z.record(z.string(), z.union([z.object({ outcome: z.literal("available"), patch }), gitFailure]));

const checksState = z.enum(["passing", "failing", "pending", "no_checks", "unknown"]);
const prRow = z.union([
  z.object({
    outcome: z.literal("available"),
    pullRequest: z.object({
      number: z.number(),
      title: z.string(),
      state: z.enum(["draft", "open", "merged", "closed"]),
      url: z.string(),
      baseRefName: z.string(),
      headRefName: z.string(),
      updatedAt: z.string(),
      autoMerge: z.boolean(),
      inMergeQueue: z.boolean().nullable(),
      checks: z.object({ state: checksState, totalCount: z.number(), passedCount: z.number(), failedCount: z.number(), pendingCount: z.number() }),
      review: z.object({ state: z.enum(["approved", "changes_requested", "review_required", "review_requested", "none"]), reviewRequestCount: z.number() }),
      mergeability: z.object({ state: z.enum(["mergeable", "conflicts", "blocked", "draft", "unknown"]) }),
      attention: z.string(),
    }),
  }),
  z.object({ outcome: z.literal("absent") }),
  z.object({ outcome: z.literal("unavailable"), message: z.string() }),
]);
const prOutput = z.record(z.string(), prRow);

// ---------- helpers ----------

const PATCH_BATCH = 25;
const MAX_SUBTHREADS = 200;
const MAX_PROJECT_THREADS = 500;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function gitProblem(row: z.infer<typeof gitFailure>): ProjectFailure {
  if (row.outcome === "not_applicable") return failure("not-git", "This thread's environment isn't a git checkout");
  if (row.outcome === "failed") return failure("unavailable", row.message);
  const code = row.failure.code;
  if (code === "not_git_repo" || code === "workspace_type_mismatch") return failure("not-git", "This thread's environment isn't a git checkout");
  return failure("unavailable", row.failure.message || "bb couldn't read the checkout");
}

/** bb's patch key: the files read's environment, target, whitespace flag, path and revision. */
export function gitPatchKey(environmentId: string, target: GitTarget, path: string, revision: string): string {
  return JSON.stringify([environmentId, target, false, path, revision]);
}

/** A path from a files read: repository-relative, never absolute or climbing out. */
export function isRepositoryPath(path: string): boolean {
  return path !== "" && path.length <= 1024 && !path.startsWith("/") && !path.split("/").includes("..") && !path.includes("\0");
}

function branchOf(ws: Workspace): string | null {
  return ws.checkout.kind === "branch" ? ws.checkout.branchName : ws.checkout.kind === "unborn" ? ws.checkout.branchName : null;
}

/** Strips the remote from the base ("origin/main" reads as "main") for display. */
function baseName(ws: Workspace): string {
  const b = ws.mergeBase?.mergeBaseBranch ?? ws.branch.defaultBranch;
  return b.replace(/^origin\//, "");
}

/** Files the branch changed, committed or not, each counted once (what Changes lists). */
export function changedFileCount(ws: { workingTree: { fileCount: number; files: { path: string }[] }; mergeBase: { fileCount: number; files: { path: string }[] } | null }): number {
  const committed = ws.mergeBase?.files ?? [];
  // bb can stop listing paths before it stops counting; fall back to the larger count.
  const listed = new Set([...ws.workingTree.files, ...committed].map((f) => f.path)).size;
  return Math.max(listed, ws.workingTree.fileCount, ws.mergeBase?.fileCount ?? 0);
}

function threadTitle(t: { title: string | null; titleFallback: string | null }): string {
  return t.title?.trim() || t.titleFallback?.trim() || "Untitled thread";
}

// ---------- the source ----------

export interface ProjectSource {
  changes(threadId: string, target: ChangesTarget, paths: string[] | null): Promise<ChangesResult>;
  patch(threadId: string, target: ChangesTarget, path: string, revision: string): Promise<PatchResult>;
  commits(threadId: string): Promise<CommitsResult>;
  pullRequest(threadId: string): Promise<PullRequestResult>;
  environments(threadId: string): Promise<EnvironmentsResult>;
  threads(threadId: string, ids: string[] | null): Promise<ThreadsResult>;
}

export function createProjectSource(bb: BbPluginApi): ProjectSource {
  const sdk = bb.sdk;

  async function thread(threadId: string) {
    try {
      const t = await sdk.threads.get({ threadId });
      if (t.deletedAt !== null) return failure("not-found", "This thread was deleted");
      return { ok: true as const, thread: t };
    } catch {
      return failure("no-thread", "bb has no such thread");
    }
  }

  async function environmentOf(threadId: string) {
    const t = await thread(threadId);
    if (!t.ok) return t;
    if (t.thread.environmentId === null) return failure("no-environment", "This thread has no environment");
    return { ok: true as const, environmentId: t.thread.environmentId, projectId: t.thread.projectId };
  }

  async function status(environmentIds: string[]) {
    if (!environmentIds.length) return {};
    return sdk.plugins.callRpc({ pluginId: "bb--git", method: "status", input: { keys: environmentIds }, outputSchema: statusOutput });
  }

  async function workspaceOf(environmentId: string) {
    const row = (await status([environmentId]))[environmentId];
    if (!row) return failure("unavailable", "bb returned no git status for this environment");
    if (row.outcome !== "available") return gitProblem(row);
    return { ok: true as const, workspace: row.workspace };
  }

  /** The git target and how the card names it. */
  function resolve(target: ChangesTarget, ws: Workspace): { git: GitTarget; scope: ChangesScope } | ProjectFailure {
    const branch = branchOf(ws);
    const base = baseName(ws);
    if (target.kind === "commit") {
      const known = ws.mergeBase?.commits.find((c) => c.sha.startsWith(target.sha)) ?? null;
      return { git: { type: "commit", sha: target.sha }, scope: { kind: "commit", branch, base, onBase: false, noBase: false, sha: known?.sha ?? target.sha, subject: known?.subject ?? null } };
    }
    if (ws.checkout.kind === "unknown") return failure("unavailable", `bb can't tell what is checked out: ${ws.checkout.reason}`);
    const onBase = branch !== null && branch === base;
    if (target.kind === "uncommitted" || ws.checkout.kind === "unborn" || onBase || !ws.mergeBase) {
      const noBase = target.kind === "branch" && !onBase && ws.checkout.kind !== "unborn" && !ws.mergeBase;
      return { git: { type: "uncommitted" }, scope: { kind: target.kind === "uncommitted" ? "uncommitted" : "branch", branch, base, onBase, noBase, sha: null, subject: null } };
    }
    return { git: { type: "all", mergeBaseBranch: ws.mergeBase.mergeBaseBranch }, scope: { kind: "branch", branch, base, onBase: false, noBase: false, sha: null, subject: null } };
  }

  async function resolveFor(threadId: string, target: ChangesTarget) {
    const env = await environmentOf(threadId);
    if (!env.ok) return env;
    const ws = await workspaceOf(env.environmentId);
    if (!ws.ok) return ws;
    const r = resolve(target, ws.workspace);
    if ("ok" in r) return r;
    return { ok: true as const, environmentId: env.environmentId, ...r };
  }

  async function pullRequests(environmentIds: string[]) {
    if (!environmentIds.length) return {};
    return sdk.plugins.callRpc({ pluginId: "bb--github-pr-status", method: "pullRequests", input: { keys: environmentIds }, outputSchema: prOutput });
  }

  function threadInfo(t: {
    id: string;
    title: string | null;
    titleFallback: string | null;
    runtime: { displayStatus: ThreadStatus };
    archivedAt: number | null;
    hasPendingInteraction: boolean;
    environmentBranchName: string | null;
    environmentId: string | null;
    providerId: string;
    activity: { activeBackgroundAgentCount: number; activeBackgroundCommandCount: number; activeWorkflowCount: number };
    latestAttentionAt: number;
    updatedAt: number;
  }): ThreadInfo {
    return {
      found: true,
      id: t.id,
      title: threadTitle(t),
      status: t.runtime.displayStatus,
      needsInput: t.hasPendingInteraction,
      archived: t.archivedAt !== null,
      branch: t.environmentBranchName,
      environmentId: t.environmentId,
      providerId: t.providerId,
      background: t.activity.activeBackgroundAgentCount + t.activity.activeBackgroundCommandCount + t.activity.activeWorkflowCount,
      updatedAt: Math.max(t.updatedAt, t.latestAttentionAt),
    };
  }

  return {
    async changes(threadId, target, paths) {
      try {
        const r = await resolveFor(threadId, target);
        if (!r.ok) return r;
        const answer = await sdk.plugins.callRpc({ pluginId: "bb--git", method: "files", input: { environmentId: r.environmentId, target: r.git, ignoreWhitespace: false }, outputSchema: filesOutput });
        if (answer.outcome !== "available") return gitProblem(answer);
        const all: ChangedFile[] = answer.files.map((f) => ({
          path: f.path,
          previousPath: f.previousPath,
          kind: f.changeKind,
          additions: f.additions,
          deletions: f.deletions,
          binary: f.binary,
          untracked: f.origin === "untracked",
          tooLarge: f.loadMode === "too_large",
          revision: f.revision,
        }));
        const files = all.filter((f) => matchesPathFilter(f.path, paths) || (f.previousPath !== null && matchesPathFilter(f.previousPath, paths)));
        const shown = new Set(files.map((f) => f.path));
        const patches: Record<string, FilePatch> = {};
        for (const p of answer.initialPatches) if (shown.has(p.path)) patches[p.path] = p;
        return { ok: true, environmentId: r.environmentId, scope: r.scope, files, totalFiles: all.length, truncated: answer.truncated, patches };
      } catch (cause) {
        return failure("unavailable", `bb couldn't read the changes: ${message(cause)}`);
      }
    },

    async patch(threadId, target, path, revision) {
      if (!isRepositoryPath(path)) return failure("invalid", "That isn't a path of a changed file");
      try {
        const r = await resolveFor(threadId, target);
        if (!r.ok) return r;
        const key = gitPatchKey(r.environmentId, r.git, path, revision);
        const answer = await sdk.plugins.callRpc({ pluginId: "bb--git", method: "patches", input: { keys: [key] }, outputSchema: patchesOutput });
        const row = answer[key];
        if (!row) return failure("unavailable", "bb returned no patch for this file");
        if (row.outcome !== "available") return gitProblem(row);
        return { ok: true, patch: row.patch };
      } catch (cause) {
        return failure("unavailable", `bb couldn't read the diff: ${message(cause)}`);
      }
    },

    async commits(threadId) {
      try {
        const env = await environmentOf(threadId);
        if (!env.ok) return env;
        const ws = await workspaceOf(env.environmentId);
        if (!ws.ok) return ws;
        const w = ws.workspace;
        if (w.checkout.kind === "unknown") return failure("unavailable", `bb can't tell what is checked out: ${w.checkout.reason}`);
        const branch = branchOf(w);
        const base = baseName(w);
        // bb lists the branch's commits oldest first; Commits shows newest first.
        const commits = (w.mergeBase?.commits ?? [])
          .map((c) => ({ sha: c.sha, shortSha: c.shortSha, subject: c.subject, author: c.authorName, authoredAt: epochMs(c.authoredAt) }))
          .reverse();
        return { ok: true, environmentId: env.environmentId, branch, base, onBase: branch === base, noBase: !w.mergeBase && branch !== base, ahead: w.mergeBase?.aheadCount ?? null, behind: w.mergeBase?.behindCount ?? null, commits, total: commits.length };
      } catch (cause) {
        return failure("unavailable", `bb couldn't read the commits: ${message(cause)}`);
      }
    },

    async pullRequest(threadId) {
      try {
        const env = await environmentOf(threadId);
        if (!env.ok) return env;
        const [rows, ws] = await Promise.all([pullRequests([env.environmentId]), workspaceOf(env.environmentId).catch(() => null)]);
        const row = rows[env.environmentId];
        const branch = ws && ws.ok ? branchOf(ws.workspace) : null;
        const environmentId = env.environmentId;
        if (!row || row.outcome === "absent") return { ok: true, environmentId, branch, pullRequest: null, unavailable: null };
        if (row.outcome === "unavailable") return { ok: true, environmentId, branch, pullRequest: null, unavailable: row.message };
        return { ok: true, environmentId, branch, pullRequest: pullRequestInfo(row.pullRequest), unavailable: null };
      } catch (cause) {
        return failure("unavailable", `bb couldn't read the pull request: ${message(cause)}`);
      }
    },

    async environments(threadId) {
      try {
        const t = await thread(threadId);
        if (!t.ok) return t;
        const { projectId, environmentId: currentId } = t.thread;
        const [envs, threads] = await Promise.all([
          sdk.environments.list({ projectId }),
          sdk.threads.list({ projectId, archived: false, limit: MAX_PROJECT_THREADS }),
        ]);
        const active = envs.filter((e) => e.status !== "destroyed" && e.lifecycle.phase === "active");
        const byEnv = new Map<string, typeof threads>();
        for (const th of threads) {
          if (th.deletedAt !== null || th.environmentId === null || th.visibility === "hidden") continue;
          const list = byEnv.get(th.environmentId) ?? [];
          list.push(th);
          byEnv.set(th.environmentId, list);
        }
        const rows: EnvironmentInfo[] = active.map((e) => {
          const own = (byEnv.get(e.id) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
          return {
            id: e.id,
            name: e.name,
            branch: e.branchName,
            path: e.path,
            isWorktree: e.isWorktree,
            current: e.id === currentId,
            threads: own.map((th) => ({ id: th.id, title: threadTitle(th), status: th.runtime.displayStatus, needsInput: th.hasPendingInteraction })),
            changedFiles: null,
            ahead: null,
            pullRequest: null,
            updatedAt: Math.max(e.updatedAt, ...own.map((th) => Math.max(th.updatedAt, th.latestAttentionAt))),
          };
        });
        const shown = sortEnvironments(rows).slice(0, MAX_ENVIRONMENTS);
        const gitIds = shown.filter((r) => active.find((e) => e.id === r.id)?.isGitRepo).map((r) => r.id);
        const [git, prs] = await Promise.all([status(gitIds).catch(() => ({}) as z.infer<typeof statusOutput>), pullRequests(gitIds).catch(() => ({}) as z.infer<typeof prOutput>)]);
        for (const r of shown) {
          const g = git[r.id];
          if (g?.outcome === "available") {
            const w = g.workspace;
            r.branch = branchOf(w) ?? r.branch;
            r.changedFiles = changedFileCount(w);
            r.ahead = w.mergeBase?.aheadCount ?? null;
          }
          const p = prs[r.id];
          if (p?.outcome === "available") {
            const pr = p.pullRequest;
            r.pullRequest = { number: pr.number, state: pr.state, title: pr.title, url: pr.url, checks: pr.checks.state };
          }
        }
        return { ok: true, environments: shown, more: active.length - shown.length };
      } catch (cause) {
        return failure("unavailable", `bb couldn't read the environments: ${message(cause)}`);
      }
    },

    async threads(threadId, ids) {
      try {
        const own = await thread(threadId);
        if (!own.ok) return own;
        if (ids === null) {
          const listed = await sdk.threads.list({ parentThreadId: threadId, limit: MAX_SUBTHREADS + 1 });
          const children = listed.filter((th) => th.deletedAt === null && th.projectId === own.thread.projectId);
          return { ok: true, mode: "subthreads", threads: sortThreads(children.slice(0, MAX_SUBTHREADS).map(threadInfo)), truncated: children.length > MAX_SUBTHREADS };
        }
        const listed = await sdk.threads.list({ threadIds: ids, projectId: own.thread.projectId, includeHidden: true });
        // An archived thread is still a thread worth showing; list it from the archive too.
        const archived = listed.length < ids.length ? await sdk.threads.list({ threadIds: ids, projectId: own.thread.projectId, archived: true, includeHidden: true }).catch(() => []) : [];
        const found = new Map([...listed, ...archived].filter((th) => th.deletedAt === null).map((th) => [th.id, th]));
        const rows: ThreadRow[] = ids.map((id) => {
          const th = found.get(id);
          // Another project's thread is as invisible here as an unknown one.
          return th ? threadInfo(th) : { found: false, id };
        });
        return { ok: true, mode: "ids", threads: rows, truncated: false };
      } catch (cause) {
        return failure("unavailable", `bb couldn't read the threads: ${message(cause)}`);
      }
    },
  };
}
