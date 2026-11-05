// What the live project components (Changes, Commits, PullRequest,
// Environments, Threads) read from bb, and the pure rules behind them: which
// diff a target names, which paths a filter keeps, how many commits to show.
// The server fills these shapes (project.ts at the root); the views draw them.

export type ProjectFailureReason = "invalid" | "no-thread" | "no-environment" | "not-git" | "not-found" | "unavailable";

export interface ProjectFailure {
  ok: false;
  reason: ProjectFailureReason;
  error: string;
}

export function failure(reason: ProjectFailureReason, error: string): ProjectFailure {
  return { ok: false, reason, error };
}

// ---------- Changes ----------

export type ChangesTarget = { kind: "branch" } | { kind: "uncommitted" } | { kind: "commit"; sha: string };

const SHA = /^[0-9a-f]{4,40}$/i;

/** The target prop: omitted for the branch's work, "uncommitted", or a commit sha. */
export function parseChangesTarget(value: unknown): { ok: true; value: ChangesTarget } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: { kind: "branch" } };
  if (typeof value !== "string") return { ok: false, error: "target is a string: \"uncommitted\" or a commit sha" };
  const v = value.trim();
  if (v === "" || v === "branch" || v === "all") return { ok: true, value: { kind: "branch" } };
  if (v === "uncommitted") return { ok: true, value: { kind: "uncommitted" } };
  if (SHA.test(v)) return { ok: true, value: { kind: "commit", sha: v.toLowerCase() } };
  return { ok: false, error: `target "${v}" is not "uncommitted" or a commit sha` };
}

/** The wire form of a target: null for the branch. */
export function targetKey(target: ChangesTarget): string | null {
  return target.kind === "branch" ? null : target.kind === "uncommitted" ? "uncommitted" : target.sha;
}

export const MAX_PATH_FILTERS = 50;

/** The paths prop: a list of paths, folders or globs; null keeps every file. */
export function parsePathFilter(value: unknown): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || !list.every((p) => typeof p === "string")) return { ok: false, error: "paths is a list of strings" };
  const cleaned = list.map((p) => p.trim().replace(/^\.\//, "")).filter(Boolean);
  if (cleaned.length > MAX_PATH_FILTERS) return { ok: false, error: `paths holds at most ${MAX_PATH_FILTERS} entries` };
  if (cleaned.some((p) => p.length > 512)) return { ok: false, error: "each path in paths is at most 512 characters" };
  return { ok: true, value: cleaned.length ? cleaned : null };
}

type GlobToken = { t: "lit"; c: string } | { t: "one" } | { t: "star" } | { t: "any" } | { t: "dirs" };

/** A glob as tokens: ? is one character, * stays within a folder, ** crosses folders, and ** followed by a slash is any number of folders, including none. */
function globTokens(glob: string): GlobToken[] {
  const out: GlobToken[] = [];
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      let n = 1;
      while (glob[i + n] === "*") n++;
      i += n - 1;
      if (n === 1) out.push({ t: "star" });
      else if (glob[i + 1] === "/") {
        out.push({ t: "dirs" });
        i += 1;
      } else out.push({ t: "any" });
      // Repeated wildcards add nothing, so they collapse to one.
      const last = out[out.length - 1];
      const prev = out[out.length - 2];
      if (prev && prev.t === last.t && last.t !== "lit" && last.t !== "one") out.pop();
    } else if (ch === "?") out.push({ t: "one" });
    else out.push({ t: "lit", c: ch });
  }
  return out;
}

/**
 * Matches a path against a glob by stepping a set of positions through it, one character at a time:
 * linear in the path for any glob, so a filter full of wildcards can't make the server backtrack.
 */
function globMatch(tokens: readonly GlobToken[], path: string): boolean {
  const close = (set: Set<number>) => {
    for (const i of set) {
      const tok = tokens[i];
      if (tok && (tok.t === "star" || tok.t === "any" || tok.t === "dirs")) set.add(i + 1);
    }
    return set;
  };
  let at = close(new Set([0]));
  for (let k = 0; k < path.length; k++) {
    const ch = path[k];
    const next = new Set<number>();
    for (const i of at) {
      const tok = tokens[i];
      if (!tok) continue;
      if (tok.t === "lit") {
        if (tok.c === ch) next.add(i + 1);
      } else if (tok.t === "one") {
        if (ch !== "/") next.add(i + 1);
      } else if (tok.t === "star") {
        if (ch !== "/") next.add(i);
      } else if (tok.t === "any") next.add(i);
      else {
        // ** then a slash: any characters, ending with a folder's slash.
        next.add(i);
        if (ch === "/") next.add(i + 1);
      }
    }
    if (!next.size) return false;
    at = close(next);
  }
  return at.has(tokens.length);
}

/** A path matches a filter entry exactly, as a folder prefix, or as a glob. */
const tokenCache = new Map<string, GlobToken[]>();
const tokensOf = (glob: string) => {
  let t = tokenCache.get(glob);
  if (!t) {
    t = globTokens(glob);
    if (tokenCache.size > 200) tokenCache.clear();
    tokenCache.set(glob, t);
  }
  return t;
};

export function matchesPathFilter(path: string, filters: readonly string[] | null): boolean {
  if (!filters) return true;
  return filters.some((f) => {
    if (/[*?]/.test(f)) return globMatch(tokensOf(f), path);
    const folder = f.endsWith("/") ? f : `${f}/`;
    return path === f || path.startsWith(folder);
  });
}

export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  /** Too large for bb to diff. */
  tooLarge: boolean;
  /** bb's revision for this file, used to ask for its patch. */
  revision: string;
}

export interface FilePatch {
  path: string;
  patch: string;
  truncated: boolean;
}

export interface ChangesScope {
  kind: "branch" | "uncommitted" | "commit";
  branch: string | null;
  /** The branch the work is measured against. */
  base: string | null;
  /** On the base branch itself the branch's work is its uncommitted work. */
  onBase: boolean;
  /** bb found no merge base (the base branch isn't fetched): only uncommitted work is shown. */
  noBase: boolean;
  sha: string | null;
  subject: string | null;
}

export interface ChangesData {
  ok: true;
  scope: ChangesScope;
  files: ChangedFile[];
  /** Files before the paths filter. */
  totalFiles: number;
  /** bb cut the list short. */
  truncated: boolean;
  /** Patches bb sent with the list (small files), by path. */
  patches: Record<string, FilePatch>;
}

export type ChangesResult = ChangesData | ProjectFailure;
export type PatchResult = { ok: true; patch: FilePatch } | ProjectFailure;

// ---------- Commits ----------

export const DEFAULT_COMMITS = 20;
export const MAX_COMMITS = 200;

export function parseCommitLimit(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_COMMITS;
  return Math.max(1, Math.min(MAX_COMMITS, Math.floor(n)));
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** Epoch ms. */
  authoredAt: number;
}

export interface CommitsData {
  ok: true;
  branch: string | null;
  base: string | null;
  onBase: boolean;
  /** bb found no merge base, so the branch's own commits are unknown. */
  noBase: boolean;
  ahead: number | null;
  behind: number | null;
  /** Newest first. */
  commits: CommitInfo[];
  total: number;
}

export type CommitsResult = CommitsData | ProjectFailure;

/** bb's authoredAt can be seconds or milliseconds; Iris uses milliseconds. */
export function epochMs(value: number): number {
  return value > 0 && value < 1e11 ? value * 1000 : value;
}

// ---------- PullRequest ----------

export type ChecksState = "passing" | "failing" | "pending" | "no_checks" | "unknown";
export type ReviewState = "approved" | "changes_requested" | "review_required" | "review_requested" | "none";

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: "draft" | "open" | "merged" | "closed";
  base: string;
  head: string;
  updatedAt: number | null;
  autoMerge: boolean;
  inMergeQueue: boolean;
  checks: { state: ChecksState; total: number; passed: number; failed: number; pending: number };
  review: { state: ReviewState; requests: number };
  mergeability: "mergeable" | "conflicts" | "blocked" | "draft" | "unknown";
  attention: string;
}

export interface PullRequestData {
  ok: true;
  branch: string | null;
  /** null when the branch has no pull request. */
  pullRequest: PullRequestInfo | null;
  /** Why bb couldn't ask GitHub, when it couldn't. */
  unavailable: string | null;
}

export type PullRequestResult = PullRequestData | ProjectFailure;

/** bb's GitHub PR Status row as Iris shows it. */
export function pullRequestInfo(pr: {
  number: number;
  title: string;
  url: string;
  state: PullRequestInfo["state"];
  baseRefName: string;
  headRefName: string;
  updatedAt: string;
  autoMerge: boolean;
  inMergeQueue: boolean | null;
  checks: { state: ChecksState; totalCount: number; passedCount: number; failedCount: number; pendingCount: number };
  review: { state: ReviewState; reviewRequestCount: number };
  mergeability: { state: PullRequestInfo["mergeability"] };
  attention: string;
}): PullRequestInfo {
  const updated = Date.parse(pr.updatedAt);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    base: pr.baseRefName,
    head: pr.headRefName,
    updatedAt: Number.isFinite(updated) ? updated : null,
    autoMerge: pr.autoMerge,
    inMergeQueue: pr.inMergeQueue === true,
    checks: { state: pr.checks.state, total: pr.checks.totalCount, passed: pr.checks.passedCount, failed: pr.checks.failedCount, pending: pr.checks.pendingCount },
    review: { state: pr.review.state, requests: pr.review.reviewRequestCount },
    mergeability: pr.mergeability.state,
    attention: pr.attention,
  };
}

// ---------- Threads ----------

export type ThreadStatus = "waiting-for-host" | "active" | "error" | "idle" | "pending" | "provisioning" | "starting" | "stopping";

/** Statuses that mean the thread is doing something now. */
export const RUNNING: Record<ThreadStatus, boolean> = {
  "waiting-for-host": true,
  active: true,
  error: false,
  idle: false,
  pending: true,
  provisioning: true,
  starting: true,
  stopping: true,
};

export interface ThreadInfo {
  found: true;
  id: string;
  title: string;
  status: ThreadStatus;
  needsInput: boolean;
  archived: boolean;
  branch: string | null;
  providerId: string;
  /** Background agents, commands and workflows running in it. */
  background: number;
  updatedAt: number;
}

export type ThreadRow = ThreadInfo | { found: false; id: string };

export interface ThreadsData {
  ok: true;
  mode: "subthreads" | "ids";
  threads: ThreadRow[];
  truncated: boolean;
}

export type ThreadsResult = ThreadsData | ProjectFailure;

export const MAX_THREAD_IDS = 100;
export const THREAD_ID = /^thr_[a-z0-9_-]{4,60}$/i;

/** The ids prop: thread ids, or null for this thread's subthreads. */
export function parseThreadIds(value: unknown): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || !list.every((p) => typeof p === "string")) return { ok: false, error: "ids is a list of thread ids" };
  const ids = [...new Set(list.map((s) => s.trim().replace(/^@?thread:/, "").replace(/#.*$/, "")).filter(Boolean))];
  if (ids.length > MAX_THREAD_IDS) return { ok: false, error: `ids holds at most ${MAX_THREAD_IDS} threads` };
  const bad = ids.find((id) => !THREAD_ID.test(id));
  if (bad) return { ok: false, error: `"${bad}" is not a thread id (thr_...)` };
  return { ok: true, value: ids };
}

/** Threads that need the person first, then running ones, then by latest activity. */
export function sortThreads<T extends ThreadRow>(rows: T[]): T[] {
  const rank = (r: ThreadRow) => (!r.found ? 4 : r.needsInput ? 0 : RUNNING[r.status] ? 1 : r.status === "error" ? 2 : r.archived ? 5 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (b.found && a.found ? b.updatedAt - a.updatedAt : 0));
}

// ---------- Environments ----------

export interface EnvironmentThread {
  id: string;
  title: string;
  status: ThreadStatus;
  needsInput: boolean;
}

export interface EnvironmentInfo {
  id: string;
  name: string | null;
  branch: string | null;
  path: string | null;
  isWorktree: boolean;
  /** The environment this card's thread runs in. */
  current: boolean;
  threads: EnvironmentThread[];
  /** null when git couldn't be read (not a checkout, the machine is asleep). */
  changedFiles: number | null;
  ahead: number | null;
  pullRequest: { number: number; state: PullRequestInfo["state"]; title: string; url: string; checks: ChecksState } | null;
  updatedAt: number;
}

export interface EnvironmentsData {
  ok: true;
  environments: EnvironmentInfo[];
  /** Active environments left out past the cap. */
  more: number;
}

export type EnvironmentsResult = EnvironmentsData | ProjectFailure;

export const MAX_ENVIRONMENTS = 40;

/** The current environment first, then ones with threads by latest activity, then the rest. */
export function sortEnvironments(list: EnvironmentInfo[]): EnvironmentInfo[] {
  return [...list].sort((a, b) => Number(b.current) - Number(a.current) || Number(b.threads.length > 0) - Number(a.threads.length > 0) || b.updatedAt - a.updatedAt);
}
