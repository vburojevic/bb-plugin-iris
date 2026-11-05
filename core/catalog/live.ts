// Live project components: they read this thread's checkout, branch, pull
// request, environments and threads from bb when the card renders, and keep
// reading while it is on screen. Agents never retype what bb already knows.
import { component, p } from "./spec";

export const LIVE_PROJECT = [
  component({
    name: "Changes",
    group: "Project",
    summary: "Files changed in this thread's checkout with +/- counts; each expands to its diff. Live: reads bb's git state, never retyped.",
    props: {
      target: p.str("Omit for the branch's work including uncommitted, \"uncommitted\" for only uncommitted work, or a commit sha"),
      paths: p.list("Only these files: paths, folders (\"core/\") or globs (\"**/*.test.ts\")", "string[]"),
      title: p.str("Caption"),
      open: p.bool("Open every diff at first (default: only when one file changed)"),
    },
    children: "none",
    example: `<Changes paths={["core/", "ui/views/"]} />`,
    aliases: ["ChangedFiles", "WorkingTree", "GitDiff"],
  }),
  component({
    name: "Commits",
    group: "Project",
    summary: "This branch's commits since the default branch, newest first; each opens its changes. Live.",
    props: {
      limit: p.num("Most commits shown at first", { def: 20 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Commits limit={10} />`,
    aliases: ["CommitLog", "GitLog"],
  }),
  component({
    name: "PullRequest",
    group: "Project",
    summary: "This branch's pull request: state, checks, review status, mergeability and a link. Live.",
    props: {},
    children: "none",
    example: `<PullRequest />`,
    aliases: ["PR", "PullRequestStatus"],
  }),
  component({
    name: "Environments",
    group: "Project",
    summary: "This project's worktrees: branch, threads in each, changed file count and pull request. Live.",
    props: { title: p.str("Caption") },
    children: "none",
    example: `<Environments />`,
    aliases: ["Worktrees", "Checkouts"],
  }),
  component({
    name: "Threads",
    group: "Project",
    summary: "Live status of bb threads: running, waiting on the person, done, failed. Omit ids for this thread's subthreads. Click one to open it.",
    props: {
      ids: p.list("Thread ids (thr_...); omit for this thread's subthreads", "string[]"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Threads />`,
    aliases: ["Subthreads", "Workers", "Agents"],
  }),
  component({
    name: "Pipeline",
    group: "Project",
    summary: "A CI run: runs, jobs and steps with status and duration, failures open. Reads `gh run view --json name,displayTitle,status,conclusion,jobs,url`.",
    props: {
      run: p.any("[{name, status, url?, jobs?: [{name, status, steps?: [{name, status}]}]}], one such run, or a loaded gh run view object", { required: true }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Pipeline run={[{ name: "CI", status: "failed", url: "https://github.com/acme/app/actions/runs/1", jobs: [\n  { name: "Typecheck", status: "passed", duration: 41000 },\n  { name: "Tests", status: "failed", duration: 96000, steps: [{ name: "npm ci", status: "passed" }, { name: "npm test", status: "failed" }] },\n  { name: "Build", status: "skipped" },\n] }]} />`,
    aliases: ["CI", "Workflow", "Build", "Checks"],
  }),
];
