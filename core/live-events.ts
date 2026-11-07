// Which bb realtime events make a live project card read again. bb announces thread, environment
// and project changes as they happen (`thread:changed`, `environment:changed`, `project:changed`),
// so the cards follow those instead of re-reading on a timer.

/** What one card follows. Every list holds bb ids. */
export interface LiveWatch {
  /** Threads whose status, title, questions, archive state or environment the card shows. */
  threads?: readonly string[];
  /** Read again when any thread or environment is created, moved, archived or deleted (a new subthread, a new worktree). */
  newThreads?: boolean;
  /** Environments whose files, refs or status the card shows. */
  environments?: readonly string[];
  /** Environments whose GitHub pull request the card shows; bb keeps those fresh while it is on screen. */
  pullRequests?: readonly string[];
}

export interface ThreadChange {
  id?: string;
  changes: readonly string[];
  metadata?: { backgroundActivityChanged?: boolean };
}

export interface EnvironmentChange {
  id?: string;
  changes: readonly string[];
}

export interface ProjectChange {
  changes: readonly string[];
}

/** Changes to a thread that a card can show. Streaming output ("events-appended") is not one. */
const THREAD_CHANGES = new Set(["status-changed", "title-changed", "interactions-changed", "archived-changed", "parent-changed", "thread-created", "thread-deleted", "environment-changed"]);
/** Changes that can add a thread to a list or take one out. */
const THREAD_LIST_CHANGES = new Set(["thread-created", "parent-changed", "archived-changed", "thread-deleted"]);
/** Changes to an environment's checkout or state. Branch list changes alone show nowhere. */
const ENVIRONMENT_CHANGES = new Set(["work-status-changed", "git-refs-changed", "status-changed", "metadata-changed", "environment-created", "environment-deleted"]);

export function threadChangeMatters(watch: LiveWatch, e: ThreadChange): boolean {
  if (watch.newThreads && e.changes.some((c) => THREAD_LIST_CHANGES.has(c))) return true;
  if (e.id === undefined || !watch.threads?.includes(e.id)) return false;
  return e.metadata?.backgroundActivityChanged === true || e.changes.some((c) => THREAD_CHANGES.has(c));
}

export function environmentChangeMatters(watch: LiveWatch, e: EnvironmentChange): boolean {
  if (watch.newThreads && e.changes.some((c) => c === "environment-created" || c === "environment-deleted")) return true;
  if (e.id === undefined || !watch.environments?.includes(e.id)) return false;
  return e.changes.some((c) => ENVIRONMENT_CHANGES.has(c));
}

export function projectChangeMatters(watch: LiveWatch, e: ProjectChange): boolean {
  return watch.newThreads === true && e.changes.includes("threads-changed");
}

/** A stable string for a watch, so a card subscribes again only when what it follows changes. */
export function watchKey(watch: LiveWatch): string {
  const sorted = (list: readonly string[] | undefined) => (list ? [...new Set(list)].sort() : []);
  return JSON.stringify([sorted(watch.threads), watch.newThreads === true, sorted(watch.environments), sorted(watch.pullRequests)]);
}
