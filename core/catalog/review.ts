// Code tours and prose redlines (Review), and terminal sessions and dev
// servers (Terminal). All four views load on demand (chunk "code").
import { component, p } from "./spec";

export const REVIEW = [
  component({
    name: "CodeTour",
    group: "Review",
    summary: "A guided walk across real files: each step highlights lines in a workspace file with a markdown note. Arrow keys or the step list move between steps; Open in editor jumps to the lines.",
    props: {
      steps: p.list("file is a workspace path; lines \"12-20\" or 12; note is markdown", "{file, lines?, title?, note?}[]", { required: true }),
      title: p.str("Caption above the tour"),
      start: p.num("First step shown (1-based)", { def: 1 }),
      height: p.num("Code height in px", { def: 280 }),
    },
    children: "none",
    example: `<Card title="How a block renders">
<CodeTour steps={[
  { file: "core/parse.ts", lines: "1-12", title: "Parse", note: "The block is read into **elements**." },
  { file: "core/evaluate.ts", lines: "20-34", title: "Evaluate", note: "Attributes run in a sandbox, never eval." },
  { file: "ui/render.tsx", lines: 40, title: "Render" },
]} />
</Card>`,
    aliases: ["CodeWalkthrough", "GuidedTour", "FileTour"],
    heavy: true,
  }),
  component({
    name: "Redline",
    group: "Review",
    summary: "A word-level redline of prose (docs, copy, specs): deletions struck, insertions marked inline. The person accepts or rejects each change (click, or A and R on a focused change), then inserts the result into the composer.",
    props: {
      before: p.str("The original text", { required: true }),
      after: p.str("The proposed text", { required: true }),
      title: p.str("Caption"),
      onApply: p.on("Runs with (text) instead of inserting the result into the composer"),
    },
    children: "none",
    example: `<Card title="Pricing page copy">
<Redline before="Our app helps teams to quickly ship better software, faster than ever before." after="Iris helps teams ship better software in less time." />
</Card>`,
    aliases: ["ProseDiff", "TrackChanges", "WordDiff", "Redlines"],
    heavy: true,
  }),
];

export const TERMINAL = [
  component({
    name: "TerminalReplay",
    group: "Terminal",
    summary: "Replays a recorded terminal session with its timing and real ANSI colors: play, pause, speed, scrub and markers. Reads asciinema casts (v1 to v3) or a list of timed output. Space plays, arrows seek.",
    props: {
      cast: p.any("load(path, {raw: true}) of an asciinema .cast, or [{t, text, marker?}] with t in seconds from the start", { required: true }),
      title: p.str("Caption; default the cast's title"),
      command: p.str("Shown as $ command"),
      speed: p.num("Starting speed", { def: 1 }),
      idle: p.num("Longest pause in seconds; longer gaps shrink to it. Default the cast's idle_time_limit, else 2"),
      autoplay: p.bool("Play when it appears", { def: false }),
      loop: p.bool("Start over at the end", { def: false }),
      height: p.num("Screen height in px", { def: 300 }),
    },
    children: "none",
    example: `<Card title="Test run" icon="square-terminal">
<TerminalReplay command="npm test" cast={[
  { t: 0, text: "\\u001b[2m> vitest run\\u001b[0m\\n" },
  { t: 0.8, text: "\\u001b[32m✓\\u001b[0m parse.test.ts (81)\\n", marker: "Tests start" },
  { t: 1.5, text: "\\u001b[31m✗\\u001b[0m live.test.ts > tails a log\\n" },
  { t: 2.4, text: "\\u001b[1mTests\\u001b[0m \\u001b[31m1 failed\\u001b[0m | \\u001b[32m81 passed\\u001b[0m\\n" },
]} />
</Card>`,
    aliases: ["Asciinema", "Cast", "TerminalSession", "Replay", "Recording"],
    heavy: true,
  }),
  component({
    name: "DevServers",
    group: "Terminal",
    summary: "Live list of running dev servers and their ports: status, port links, pid, CPU, memory, uptime and log. Reads a file you rewrite as things change, every 2 s while on screen.",
    props: {
      file: p.str("JSON you keep current, or the text of lsof -nP -iTCP -sTCP:LISTEN"),
      processes: p.list("Inline instead of a file; status running|starting|stopped|crashed, mem in bytes, started ISO or epoch, log a file path", "{name, pid?, port?, url?, status?, command?, cpu?, mem?, started?, log?, note?}[]"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Card title="Dev servers" icon="server">
<DevServers file="$BB_THREAD_STORAGE/servers.json" />
</Card>`,
    aliases: ["Processes", "Ports", "ProcessList", "Servers"],
    heavy: true,
  }),
];
