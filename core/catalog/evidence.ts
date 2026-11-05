// Evidence: is it really done, what changed on screen, which build is really where.
import { component, p } from "./spec";

const svg = (body: string) => `data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='220'%3E${body}%3C/svg%3E`;
const box = (x: number, y: number, w: number, h: number, r: number, fill: string) => `%3Crect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' fill='${fill}'/%3E`;
const screen = (title: number, button: [number, number]) =>
  svg(
    box(0, 0, 360, 220, 0, "rgb(244,244,247)") +
      box(30, 28, 300, 164, 14, "white") +
      box(54, 54, title, 14, 7, "rgb(44,44,52)") +
      box(54, 84, 252, 30, 8, "rgb(229,229,235)") +
      box(button[0], 132, button[1], 34, 17, "rgb(72,96,226)"),
  );

export const EVIDENCE = [
  component({
    name: "Acceptance",
    group: "Evidence",
    summary:
      "Is it really done: each criterion with its status, a note and evidence that opens. With columns it is a matrix (platforms, devices, locales). claimed means asserted but not shown; only all passed reads as done.",
    props: {
      criteria: p.list(
        "Status is passed|failed|blocked|untested|claimed. A cell is a status or {status, note?, evidence?}; a criterion with only status fills every column; a missing cell reads as untested. evidence is a workspace path (path:line works), a thread storage path or a URL; it opens on click",
        "{name, status?, note?, evidence?, cells?: {[column]: status | {status, note?, evidence?}}}[]",
        { required: true },
      ),
      columns: p.list("Matrix columns in order, e.g. [\"iPhone\", \"iPad\", \"Mac\"]; default: every column the cells name", "string[]"),
      title: p.str("Caption above the verdict"),
    },
    children: "none",
    example: `<Acceptance columns={["iPhone", "iPad", "Mac"]} criteria={[
  { name: "Sync survives a relaunch", cells: { iPhone: "passed", iPad: "passed", Mac: { status: "failed", note: "The last edit is lost after Quit", evidence: "tests/SyncTests.swift:88" } } },
  { name: "Widget shows today's total", cells: { iPhone: { status: "passed", evidence: "README.md" }, iPad: "claimed", Mac: "untested" } },
  { name: "Export to CSV", status: "blocked", note: "Waits on the file picker fix" },
]} />`,
    aliases: ["AcceptanceCriteria", "Criteria", "DoneCheck"],
  }),
  component({
    name: "Compare",
    group: "Evidence",
    summary:
      "A visual difference between screenshots, reference first: wipe (a draggable divider), side by side, blink, or diff (changed pixels marked, with a count). The person can switch modes.",
    props: {
      images: p.list("Reference first, then the images to compare. src is a workspace or thread storage path, an https URL or a data: image", "(string | {src, label?})[]", { required: true }),
      mode: p.oneOf(["wipe", "side", "blink", "diff"], "First view; default wipe for two images, side for more"),
      threshold: p.num("diff: how far (0-255) a channel must move before a pixel counts as changed", { def: 16 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Compare images={[
  { src: "${screen(150, [54, 110])}", label: "Design" },
  { src: "${screen(118, [196, 110])}", label: "Build 212" },
]} />`,
    aliases: ["ImageDiff", "BeforeAfter", "VisualDiff", "ScreenshotDiff"],
  }),
  component({
    name: "CompareGrid",
    group: "Evidence",
    summary:
      "Many before and after image pairs in a grid, each tile with its changed-pixel count and a status (changed, missing, same); sort and filter by change. A click opens the pair in Compare. Two folders pair up by file name.",
    props: {
      pairs: p.list("src as in Compare; a side left out reads as missing", "{ref, cand, label?}[]"),
      folders: p.obj("Instead of pairs: two folders whose images pair up by path", "{ref, cand}"),
      sort: p.oneOf(["change", "name", "order"], "First order", { def: "change" }),
      filter: p.oneOf(["all", "changed", "missing", "same"], "First filter", { def: "all" }),
      threshold: p.num("As in Compare", { def: 16 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<CompareGrid title="Screens: main against this branch" folders={{ ref: "$BB_THREAD_STORAGE/shots/main", cand: "$BB_THREAD_STORAGE/shots/branch" }} />`,
    aliases: ["ScreenshotGrid", "VisualRegression", "BeforeAfterGrid", "DiffGrid"],
    heavy: true,
  }),
  component({
    name: "Provenance",
    group: "Evidence",
    summary:
      "Which build or revision is really installed or deployed where, from source to live, one stage per step. With expected, any stage whose sha, build or version differs is flagged.",
    props: {
      stages: p.list("Source first, live last", "{name, status?, facts?: {branch?, sha?, build?, version?, device?}}[]", { required: true }),
      expected: p.obj("What every stage should carry; a stage missing a fact is not flagged", "{sha?, build?, version?}"),
      title: p.str("Caption above the stages"),
    },
    children: "none",
    example: `<Provenance expected={{ sha: "4f2c9e1", build: "212" }} stages={[
  { name: "main", status: "merged", facts: { branch: "main", sha: "4f2c9e1a7d03" } },
  { name: "CI", status: "passed", facts: { sha: "4f2c9e1", build: "212", version: "2.4.0" } },
  { name: "TestFlight", status: "processing", facts: { build: "212", version: "2.4.0" } },
  { name: "This iPhone", status: "installed", facts: { build: "211", version: "2.4.0", device: "iPhone 17 Pro" } },
]} />`,
    aliases: ["BuildTrail", "Lineage", "WhereDeployed"],
  }),
];
