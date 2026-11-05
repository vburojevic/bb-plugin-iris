import { describe, expect, it } from "vitest";
import { applySgr, ansi256, parseAnsi } from "../core/ansi";
import { check } from "../core/check";
import { normalizeProcesses, parseLsof, readBytes } from "../core/devservers";
import { applyDecisions, diffTokens, readDecisions, redline, tokenize } from "../core/redline";
import { Terminal, castClock, eventsUntil, parseCast } from "../core/terminal";
import { normalizeTour } from "../core/tour";

const text = (t: Terminal) => t.text();

describe("ANSI", () => {
  it("keeps Logs' parsing and adds backgrounds and 256 colors in theme indexes", () => {
    expect(parseAnsi("\u001b[1;31mfail\u001b[0m ok")).toEqual([{ text: "fail", bold: true, fg: 1 }, { text: " ok" }]);
    expect(applySgr({}, [38, 5, 196]).fg).toBe(9);
    expect(applySgr({}, [48, 2, 0, 200, 0]).bg).toBe(2);
    expect(ansi256(3)).toBe(3);
    expect(ansi256(244)).toBe(8);
  });
});

describe("parseCast", () => {
  it("reads asciinema v2 with markers, resize and idle capping", () => {
    const cast = [
      JSON.stringify({ version: 2, width: 80, height: 24, title: "Demo" }),
      JSON.stringify([0.5, "o", "$ ls\r\n"]),
      JSON.stringify([10.5, "o", "a  b\r\n"]),
      JSON.stringify([10.6, "m", "Listed"]),
      JSON.stringify([11, "i", "x"]),
    ].join("\n");
    const c = parseCast(cast, 2);
    expect(c.cols).toBe(80);
    expect(c.title).toBe("Demo");
    expect(c.events.map((e) => e.t)).toEqual([0.5, 2.5]);
    expect(c.markers).toEqual([{ t: expect.closeTo(2.6, 5), label: "Listed" }]);
    expect(c.problems).toEqual([]);
  });
  it("reads v3 relative times and its exit code", () => {
    const cast = [JSON.stringify({ version: 3, term: { cols: 100, rows: 30 } }), "[0.2, \"o\", \"hi\"]", "[0.3, \"o\", \"!\"]", "[0.1, \"x\", \"2\"]"].join("\n");
    const c = parseCast(cast);
    expect(c.events.map((e) => +e.t.toFixed(2))).toEqual([0.2, 0.5]);
    expect(c.cols).toBe(100);
    expect(c.exit).toBe(2);
  });
  it("reads the list shapes agents write, and escapes they can't type", () => {
    const c = parseCast([{ t: 0, text: "\\u001b[32mok\\u001b[0m\n", marker: "Start" }, [1, "done\n"], { t: 2, marker: "End" }]);
    expect(c.events).toHaveLength(2);
    expect(c.events[0].text).toContain("\u001b[32m");
    expect(c.markers.map((m) => m.label)).toEqual(["Start", "End"]);
    expect(c.duration).toBe(2);
  });
  it("reports what it can't read", () => {
    expect(parseCast(42).problems[0]).toMatch(/needs a recording/);
    expect(parseCast([{ text: "no time" }]).problems[0]).toMatch(/needs a time/);
    expect(parseCast(`${JSON.stringify({ version: 2 })}\nnot json`).problems[0]).toMatch(/line 2/);
  });
  it("plays plain text line by line", () => {
    const c = parseCast("one\ntwo\nthree");
    expect(c.events.map((e) => e.text)).toEqual(["one\n", "two\n", "three"]);
  });
  it("finds how many events have happened", () => {
    const events = [0, 1, 1, 2].map((t) => ({ t, text: "" }));
    expect([eventsUntil(events, -1), eventsUntil(events, 0), eventsUntil(events, 1.5), eventsUntil(events, 9)]).toEqual([0, 1, 3, 4]);
    expect(castClock(65.4, true)).toBe("1:05.4");
  });
  it("caps pauses at the cast's idle_time_limit unless idle is given", () => {
    const cast = [JSON.stringify({ version: 2, idle_time_limit: 0.5 }), "[0, \"o\", \"a\"]", "[9, \"o\", \"b\"]"].join("\n");
    expect(parseCast(cast).duration).toBe(0.5);
    expect(parseCast(cast, 3).duration).toBe(3);
    expect(parseCast([[0, "a"], [9, "b"]]).duration).toBe(2);
  });
});

describe("Terminal", () => {
  it("rewrites a progress bar on carriage return and erase", () => {
    const t = new Terminal();
    t.write("Downloading 10%\r");
    t.write("Downloading 100%\r\n\u001b[32mdone\u001b[0m");
    expect(text(t)).toBe("Downloading 100%\ndone");
    expect(t.lines()[1]).toEqual([{ fg: 2, text: "done" }]);
  });
  it("moves the cursor up to redraw lines and erases them", () => {
    const t = new Terminal();
    t.write("a 1\nb 1\n\u001b[2A\u001b[2Ka 2\n\u001b[2Kb 2\n");
    expect(text(t)).toBe("a 2\nb 2");
  });
  it("keeps escapes split across events", () => {
    const t = new Terminal();
    t.write("x\u001b[3");
    t.write("1my");
    expect(t.lines()[0]).toEqual([{ text: "x" }, { fg: 1, text: "y" }]);
  });
  it("wraps at the recording's width, clears, and restores the main screen", () => {
    const t = new Terminal(10, 5);
    t.write("0123456789ab");
    expect(text(t)).toBe("0123456789\nab");
    t.write("\u001b[?1049hfull screen app\u001b[?1049l");
    expect(text(t)).toBe("0123456789\nab");
    t.write("\u001b[2J\u001b[Hclean");
    expect(text(t)).toBe("clean");
  });
  it("keeps hostile cursor moves and scrollback bounded", () => {
    const t = new Terminal();
    const start = Date.now();
    t.write("\u001b[50000000Cx\u001b[200000B\u001b[9999;9999Hy");
    for (let k = 0; k < 6000; k++) t.write("line\n");
    expect(Date.now() - start).toBeLessThan(1500);
    expect(t.rows.length).toBeLessThanOrEqual(5000);
    expect(Math.max(...t.rows.map((r) => r.chars.length))).toBeLessThanOrEqual(1000);
  });
  it("skips OSC titles, backspaces and tabs", () => {
    const t = new Terminal();
    t.write("\u001b]0;title\u0007ab\bc\td");
    expect(text(t)).toBe("ac      d");
  });
});

describe("redline", () => {
  it("tokenizes words, punctuation and spaces", () => {
    expect(tokenize("It's done, ok.\n")).toEqual(["It's", " ", "done", ",", " ", "ok", ".", "\n"]);
  });
  it("diffs tokens minimally", () => {
    const ops = diffTokens(tokenize("a b c"), tokenize("a x c"));
    expect(ops.filter((o) => o.op !== "eq")).toEqual([{ op: "del", text: "b" }, { op: "ins", text: "x" }]);
  });
  it("merges changes split only by spaces, never across lines", () => {
    const segs = redline("the quick fox\nleaps", "a fast fox\njumps");
    expect(segs.filter((s) => s.kind === "change")).toEqual([
      { kind: "change", id: 0, del: "the quick", ins: "a fast" },
      { kind: "change", id: 1, del: "leaps", ins: "jumps" },
    ]);
  });
  it("produces the text the decisions ask for", () => {
    const before = "Our app helps teams to quickly ship software.";
    const after = "Iris helps teams ship better software.";
    const segs = redline(before, after);
    const n = segs.filter((s) => s.kind === "change").length;
    expect(applyDecisions(segs, {})).toBe(after);
    const allReject = Object.fromEntries([...Array(n).keys()].map((k) => [k, "reject" as const]));
    expect(applyDecisions(segs, allReject)).toBe(before);
    expect(applyDecisions(segs, { 0: "reject" })).toMatch(/^Our app helps teams/);
  });
  it("applies whitespace-only edits without asking", () => {
    const segs = redline("a  b", "a b");
    expect(segs).toEqual([{ kind: "same", text: "a b" }]);
  });
  it("shows a full rewrite as one change, quickly", () => {
    const a = Array.from({ length: 8000 }, (_, k) => `old${k}`).join(" ");
    const b = Array.from({ length: 8000 }, (_, k) => `new${k}`).join(" ");
    const start = Date.now();
    const segs = redline(a, b);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(segs).toEqual([{ kind: "change", id: 0, del: a, ins: b }]);
  });
  it("reads saved decisions safely", () => {
    expect(readDecisions({ 0: "accept", 1: "nope", 7: "reject", x: "accept" }, 3)).toEqual({ 0: "accept" });
  });
  it("handles long texts", () => {
    const a = Array.from({ length: 3000 }, (_, k) => `word${k}`).join(" ");
    const b = a.replace("word1500", "changed").replace("word10 ", "");
    const segs = redline(a, b);
    expect(applyDecisions(segs, {})).toBe(b);
    expect(segs.filter((s) => s.kind === "change")).toHaveLength(2);
  });
});

describe("dev servers", () => {
  it("reads the JSON shapes agents write", () => {
    const now = 1_700_000_000_000;
    const { items, problems } = normalizeProcesses(
      { processes: [{ name: "web", pid: 1, port: "3000", status: "up", mem: "120 MB", uptime: 60 }, { command: "tsx watch a.ts", exit: 1 }, { nope: true }, 3] },
      now,
    );
    expect(items[0]).toMatchObject({ name: "web", ports: [3000], url: "http://localhost:3000", status: "running", mem: 120 * 1024 ** 2, started: now - 60_000 });
    expect(items[1]).toMatchObject({ name: "tsx", status: "crashed", url: null });
    expect(problems).toEqual(["process 3 needs a name, command or port", "process 4 is not an object"]);
  });
  it("reads lsof output, one row per process", () => {
    const lsof = [
      "COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
      "node    48211 ved   23u  IPv6 0xabc      0t0  TCP *:3000 (LISTEN)",
      "node    48211 ved   24u  IPv4 0xabd      0t0  TCP 127.0.0.1:3000 (LISTEN)",
      "node    48211 ved   25u  IPv4 0xabe      0t0  TCP 127.0.0.1:9229 (LISTEN)",
      "Python   5100 ved    4u  IPv4 0xabf      0t0  TCP [::1]:8000 (LISTEN)",
    ].join("\n");
    const { items } = parseLsof(lsof);
    expect(items.map((p) => [p.name, p.pid, p.ports])).toEqual([
      ["node", 48211, [3000, 9229]],
      ["Python", 5100, [8000]],
    ]);
    expect(normalizeProcesses(lsof).items).toHaveLength(2);
    expect(normalizeProcesses("hello").problems[0]).toMatch(/lsof/);
    expect(readBytes("1.5G")).toBe(1.5 * 1024 ** 3);
  });
});

describe("code tour", () => {
  it("reads steps and reports the broken ones", () => {
    const { items, problems } = normalizeTour([{ file: "a.ts", lines: "3-5", note: "**x**" }, { path: "b.ts", from: 9 }, { lines: 3 }, { file: "c.ts", lines: "x" }]);
    expect(items.map((s) => [s.file, s.start, s.end, s.title])).toEqual([
      ["a.ts", 3, 5, "a.ts:3"],
      ["b.ts", 9, 9, "b.ts:9"],
      ["c.ts", null, null, "c.ts"],
    ]);
    expect(problems).toEqual(["step 3 needs a file", 'step 4: lines must be like "12-20" or 12']);
  });
});

describe("check()", () => {
  it("reports bad data in the new components", () => {
    const errors = (src: string) => check(src).issues.filter((i) => i.severity === "error").map((i) => i.message);
    expect(errors(`<CodeTour steps={[{ lines: 3 }]} />`).join()).toMatch(/needs a file/);
    expect(errors(`<TerminalReplay cast={[{ text: "x" }]} />`).join()).toMatch(/needs a time/);
    expect(errors(`<DevServers processes={[4]} />`).join()).toMatch(/not an object/);
    expect(errors(`<Redline before="a" after="b" />`)).toEqual([]);
  });
});
