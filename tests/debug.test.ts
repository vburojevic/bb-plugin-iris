import { describe, expect, it } from "vitest";
import { testHistory } from "../core/testhistory";
import { migrationSteps, schemaDiff, splitStatements, widens } from "../core/schemadiff";
import { flamePath, flameSearch, parseProfile, topSelf } from "../core/flame";
import { bisectState, readBisectLog } from "../core/bisect";
import { blastNodes, blastRadius } from "../core/blast";

describe("TestHistory", () => {
  const vitest = (statuses: Record<string, "passed" | "failed">, startTime: number) => ({
    startTime,
    testResults: [{ name: "/repo/src/cart.test.ts", assertionResults: Object.entries(statuses).map(([title, status]) => ({ title, fullName: title, status, failureMessages: status === "failed" ? ["expected 2, got 3"] : [] })) }],
  });

  it("marks flaky, failing, fixed and passing tests across vitest runs", () => {
    const m = testHistory([
      vitest({ total: "passed", discount: "failed", tax: "passed", ship: "failed" }, Date.UTC(2026, 10, 1, 9)),
      vitest({ total: "passed", discount: "passed", tax: "passed", ship: "failed" }, Date.UTC(2026, 10, 2, 9)),
      vitest({ total: "passed", discount: "failed", tax: "failed", ship: "passed" }, Date.UTC(2026, 10, 3, 9)),
      vitest({ total: "passed", discount: "passed", tax: "failed", ship: "passed" }, Date.UTC(2026, 10, 4, 9)),
    ]);
    expect(m.tests.map((t) => [t.name, t.kind])).toEqual([
      ["discount", "flaky"],
      ["tax", "failing"],
      ["ship", "fixed"],
      ["total", "passing"],
    ]);
    const tax = m.tests[1];
    expect(tax.since).toBe(2);
    expect(tax.failRate).toBe(0.5);
    expect(tax.message).toMatch(/expected 2/);
    expect(m.runs.map((r) => [r.passed, r.failed])).toEqual([[2, 2], [3, 1], [2, 2], [3, 1]]);
    expect(m.tally).toMatchObject({ flaky: 1, failing: 1, fixed: 1, passing: 1 });
  });

  it("reads flat rows, labels runs, and treats a pass on retry as flaky", () => {
    const m = testHistory(
      [
        { test: "login", run: "a1", status: "pass" },
        { test: "login", run: "b2", status: "fail" },
        { test: "login", run: "b2", status: "pass" },
        { test: "logout", run: "b2", status: "skipped" },
      ],
      ["Monday", "Tuesday"],
    );
    expect(m.runs.map((r) => r.label)).toEqual(["Monday", "Tuesday"]);
    expect(m.tests.find((t) => t.name === "login")).toMatchObject({ kind: "flaky", results: ["passed", "passed"] });
    expect(m.tests.find((t) => t.name === "logout")).toMatchObject({ kind: "skipped", results: [null, "skipped"] });
  });

  it("says when the runs hold no tests", () => {
    expect(testHistory([{}, {}]).problems[0]).toMatch(/found no tests/);
  });
});

describe("SchemaDiff", () => {
  it("splits statements outside strings and dollar bodies", () => {
    expect(splitStatements("insert into t values ('a;b'); -- x;\ncreate function f() returns int as $$ select 1; $$ language sql;")).toHaveLength(2);
  });

  it("flags destructive and risky migration steps", () => {
    const steps = migrationSteps(`
      BEGIN;
      CREATE TABLE invoices (id bigserial primary key, total numeric(10,2) not null);
      ALTER TABLE users ADD COLUMN plan text NOT NULL, DROP COLUMN legacy_flags;
      ALTER TABLE users ALTER COLUMN email TYPE varchar(64);
      ALTER TABLE orders RENAME COLUMN qty TO quantity;
      CREATE INDEX orders_user_idx ON orders (user_id);
      CREATE UNIQUE INDEX CONCURRENTLY users_email_key ON users (email);
      DELETE FROM sessions;
      DROP TABLE IF EXISTS audit_log CASCADE;
      COMMIT;`, [{ name: "users", columns: [{ name: "email", type: "text" }] }]);
    const by = (kind: string) => steps.find((s) => s.kind === kind)!;
    expect(by("create_table")).toMatchObject({ table: "invoices", risk: "safe" });
    expect(steps.find((s) => s.kind === "add_column" && s.table === "users")).toMatchObject({ column: "plan", risk: "risky" });
    expect(by("drop_column")).toMatchObject({ column: "legacy_flags", risk: "destructive" });
    expect(by("alter_type")).toMatchObject({ detail: "Changes email from text to varchar(64)", risk: "destructive" });
    expect(by("rename_column")).toMatchObject({ column: "quantity", risk: "risky" });
    expect(steps.filter((s) => s.kind === "create_index").map((s) => s.risk)).toEqual(["safe", "risky"]);
    expect(steps.find((s) => s.kind === "create_index")?.why).toMatch(/CONCURRENTLY/);
    expect(by("delete")).toMatchObject({ table: "sessions", risk: "destructive", detail: "Deletes every row" });
    expect(by("drop_table")).toMatchObject({ table: "audit_log", risk: "destructive" });
  });

  it("treats a change to text as lossless and reads nested index columns and MySQL ADD INDEX", () => {
    const steps = migrationSteps("CREATE INDEX users_email_lower ON users (lower(email)); ALTER TABLE t ADD INDEX idx_a (a), ADD FULLTEXT KEY ft (body);", [{ name: "t", columns: [{ name: "id", type: "int" }] }]);
    expect(steps[0].detail).toBe("Adds an index users_email_lower on lower(email)");
    expect(steps.slice(1).map((s) => s.kind)).toEqual(["create_index", "create_index"]);
    const toText = migrationSteps("ALTER TABLE t ALTER COLUMN id TYPE text;", [{ name: "t", columns: [{ name: "id", type: "integer" }] }]);
    expect(toText[0].risk).toBe("safe");
  });

  it("knows which type changes widen", () => {
    expect([widens("int", "bigint"), widens("varchar(32)", "varchar(64)"), widens("varchar(64)", "text"), widens("bigint", "int"), widens("text", "integer"), widens("numeric(10,2)", "numeric(12,2)")]).toEqual([true, true, true, false, false, true]);
  });

  it("reads MySQL MODIFY and CHANGE", () => {
    const steps = migrationSteps("CREATE TABLE t (name varchar(100)); ALTER TABLE t MODIFY name varchar(20), CHANGE old_name new_name int;");
    expect(steps.find((s) => s.kind === "alter_type")).toMatchObject({ risk: "destructive" });
    expect(steps.find((s) => s.kind === "rename_column")).toMatchObject({ column: "new_name" });
  });

  it("compares two schemas and groups the changes by table", () => {
    const m = schemaDiff({
      before: "CREATE TABLE users (id int primary key, email text, nick varchar(20)); CREATE TABLE old_stuff (id int);",
      after: "CREATE TABLE users (id bigint primary key, email text not null, nick varchar(40), plan text); CREATE TABLE teams (id int primary key);",
    });
    expect(m.source).toBe("schemas");
    expect(m.tables.map((t) => [t.name, t.status, t.risk])).toEqual([
      ["old_stuff", "dropped", "destructive"],
      ["users", "changed", "risky"],
      ["teams", "added", "safe"],
    ]);
    expect(m.tables[1].columns.map((c) => [c.name, c.status])).toEqual([
      ["id", "changed"],
      ["email", "changed"],
      ["nick", "changed"],
      ["plan", "added"],
    ]);
    expect(m.tally.destructive).toBe(1);
  });

  it("asks for input when given none", () => {
    expect(schemaDiff({}).problems[0]).toMatch(/needs migration SQL/);
  });
});

describe("Flamegraph", () => {
  it("reads a V8 cpuprofile, attributing each delta to the sample before it", () => {
    const m = parseProfile({
      nodes: [
        { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1 }, children: [2] },
        { id: 2, callFrame: { functionName: "main", url: "file:///app/src/main.js", lineNumber: 0 }, children: [3, 4] },
        { id: 3, callFrame: { functionName: "parse", url: "file:///app/src/parse.js", lineNumber: 9 } },
        { id: 4, callFrame: { functionName: "", url: "file:///app/src/render.js", lineNumber: 3 } },
      ],
      startTime: 0,
      endTime: 4000,
      samples: [3, 3, 4, 2],
      timeDeltas: [0, 1000, 1000, 1000],
    });
    expect(m.format).toBe("cpuprofile");
    expect(m.unit).toBe("ms");
    const main = m.root.children[0];
    expect(main).toMatchObject({ name: "main", file: "src/main.js", line: 1 });
    expect(main.children.map((c) => [c.name, c.total])).toEqual([
      ["parse", 2],
      ["(anonymous)", 1],
    ]);
    // The last sample has no delta after it and takes the typical one.
    expect(m.total).toBe(4);
  });

  it("reads folded stacks, merges paths and searches without double counting", () => {
    const m = parseProfile("main;parse;lex 30\nmain;parse 10\nmain;render;lex 20\n");
    expect(m.format).toBe("folded");
    expect(m.total).toBe(60);
    const s = flameSearch(m.root, "LEX");
    expect(s.hits.size).toBe(2);
    expect(s.total).toBe(50);
    expect(flameSearch(m.root, "main").total).toBe(60);
    const lex = m.root.children[0].children[0].children[0];
    expect(flamePath(m.root, lex).map((n) => n.name)).toEqual(["all", "main", "parse", "lex"]);
    expect(topSelf(m.root)[0]).toMatchObject({ name: "lex", self: 50 });
  });

  it("reads Chrome trace duration events with self time", () => {
    const m = parseProfile({
      traceEvents: [
        { ph: "X", name: "Task", ts: 0, dur: 100, pid: 1, tid: 1 },
        { ph: "X", name: "Layout", ts: 10, dur: 30, pid: 1, tid: 1 },
        { ph: "B", name: "Paint", ts: 50, pid: 1, tid: 1 },
        { ph: "E", ts: 70, pid: 1, tid: 1 },
        { ph: "X", name: "Idle", ts: 0, dur: 5, pid: 1, tid: 2 },
      ],
    });
    expect(m.format).toBe("chrome-trace");
    const task = m.root.children[0];
    expect(task.name).toBe("Task");
    expect(task.total).toBeCloseTo(0.1);
    expect(task.self).toBeCloseTo(0.05);
    expect(task.children.map((c) => c.name)).toEqual(["Layout", "Paint"]);
  });

  it("reads speedscope evented and sampled profiles", () => {
    const ev = parseProfile({
      $schema: "https://www.speedscope.app/file-format-schema.json",
      shared: { frames: [{ name: "a" }, { name: "b" }] },
      profiles: [{ type: "evented", unit: "microseconds", startValue: 0, endValue: 3000, events: [{ type: "O", frame: 0, at: 0 }, { type: "O", frame: 1, at: 1000 }, { type: "C", frame: 1, at: 3000 }, { type: "C", frame: 0, at: 3000 }] }],
    });
    expect(ev.root.children[0]).toMatchObject({ name: "a", total: 3, self: 1 });
    const sm = parseProfile({ shared: { frames: [{ name: "a" }, { name: "b" }] }, profiles: [{ type: "sampled", unit: "none", samples: [[0, 1], [0]], weights: [3, 1] }] });
    expect(sm.root.children[0].children[0]).toMatchObject({ name: "b", total: 3 });
    expect(sm.unit).toBe("samples");
  });

  it("cuts very deep stacks instead of overflowing", () => {
    const m = parseProfile(`${Array.from({ length: 20000 }, () => "a").join(";")} 1\n`);
    expect(m.depth).toBe(400);
    expect(m.total).toBe(1);
    expect(flameSearch(m.root, "a").total).toBe(1);
    expect(m.problems.join()).toMatch(/deeper than 400/);
    expect(() => parseProfile({ shared: { frames: [] }, profiles: [{ type: "sampled", unit: "constructor", samples: [] }] })).not.toThrow();
  });

  it("reads a nested tree and rejects what it can't read", () => {
    const m = parseProfile({ name: "root", value: 10, children: [{ name: "x", value: 6 }] });
    expect(m.root.children[0]).toMatchObject({ name: "root", self: 4, total: 10 });
    expect(parseProfile({ hello: 1 }).problems[0]).toMatch(/not a profile/);
  });
});

describe("Bisect", () => {
  const log = `git bisect start
# status: waiting for both good and bad commits
# bad: [e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4] Cache the session token
git bisect bad e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4
# good: [a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0] Release 2.3.0
git bisect good a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
# good: [c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2] Bump the parser
git bisect good c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2`;
  const commits = `e5f6a7b Cache the session token
d4e5f6a Retry failed uploads
c3d4e5f Bump the parser
b2c3d4e Faster cold start
a1b2c3d Release 2.3.0`;

  it("reads git bisect log verdicts and subjects", () => {
    const r = readBisectLog(log);
    expect(r.marks.map((m) => [m.sha.slice(0, 7), m.verdict, m.subject])).toEqual([
      ["e5f6a7b", "bad", "Cache the session token"],
      ["a1b2c3d", "good", "Release 2.3.0"],
      ["c3d4e5f", "good", "Bump the parser"],
    ]);
  });

  it("narrows the range from git log text and the log", () => {
    const m = bisectState({ commits, log, current: "d4e5f6a" });
    expect(m.commits.map((c) => [c.sha, c.verdict, c.inRange, c.current])).toEqual([
      ["e5f6a7b", "bad", true, false],
      ["d4e5f6a", null, true, true],
      ["c3d4e5f", "good", false, false],
      ["b2c3d4e", null, false, false],
      ["a1b2c3d", "good", false, false],
    ]);
    expect(m).toMatchObject({ good: "c3d4e5f", bad: "e5f6a7b", remaining: 1, steps: 1, suspect: "d4e5f6a", found: null });
  });

  it("reads a real good..bad list, which leaves the good commit out, without a false problem", () => {
    const range = commits.split("\n").slice(0, 4).join("\n");
    const m = bisectState({ commits: range, log });
    expect(m.problems).toEqual([]);
    expect(m.commits.filter((c) => c.inRange).map((c) => c.sha)).toEqual(["e5f6a7b", "d4e5f6a"]);
    const done = bisectState({ commits: "e5f6a7b Cache the session token", log });
    expect(done.found).toBe("e5f6a7b");
  });

  it("finds the first bad commit once the range is one commit", () => {
    const m = bisectState({ commits: [{ sha: "e5f6a7b", verdict: "bad" }, { sha: "d4e5f6a", verdict: "bad" }, { sha: "c3d4e5f", verdict: "good" }] });
    expect(m.found).toBe("d4e5f6a");
    expect(m.remaining).toBe(0);
  });

  it("accepts an oldest-first list and picks the middle as the next to test", () => {
    const list = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"].map((s, k) => ({ sha: `${s}aaaa`, verdict: k === 0 ? "good" : k === 6 ? "bad" : undefined }));
    const m = bisectState({ commits: list });
    expect(m.commits[0].sha).toBe("a6aaaa");
    expect(m.remaining).toBe(5);
    expect(m.steps).toBe(3);
    expect(m.suspect).toBe("a3aaaa");
  });

  it("reads the first bad commit line from the log alone", () => {
    const m = bisectState({ log: `${log}\n# first bad commit: [e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4] Cache the session token` });
    expect(m.found).toBe("e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4");
  });
});

describe("BlastRadius", () => {
  const imports = {
    "src/app.tsx": ["src/cart/total.ts", "src/ui/button.tsx"],
    "src/cart/checkout.ts": ["src/cart/total.ts"],
    "src/pages/checkout.tsx": ["src/cart/checkout.ts"],
    "src/cart/total.test.ts": ["src/cart/total.ts"],
    "tests/e2e/checkout.spec.ts": ["src/pages/checkout.tsx"],
    "src/ui/button.tsx": [],
  };

  it("walks importers breadth first and finds the tests that reach a change", () => {
    const m = blastRadius({ changed: ["src/cart/total.ts"], imports, depth: 3 });
    expect(blastNodes(m.roots).map((n) => [n.path, n.distance])).toEqual([
      ["src/cart/total.ts", 0],
      ["src/cart/checkout.ts", 1],
      ["src/pages/checkout.tsx", 2],
      ["tests/e2e/checkout.spec.ts", 3],
      ["src/app.tsx", 1],
      ["src/cart/total.test.ts", 1],
    ]);
    expect(m.affected).toBe(5);
    expect(m.tests).toEqual(["src/cart/total.test.ts", "tests/e2e/checkout.spec.ts"]);
    expect(m.truncated).toBe(false);
  });

  it("stops at the depth and says so", () => {
    const m = blastRadius({ changed: "src/cart/total.ts\n", imports, depth: 1 });
    expect(m.tests).toEqual(["src/cart/total.test.ts"]);
    expect(m.truncated).toBe(true);
  });

  it("reads edges, git name-status lines, short paths and a covers map", () => {
    const m = blastRadius({
      changed: ["M\tlib/a.ts", "./b.ts"],
      imports: [["lib/c.ts", "lib/a.ts"], { from: "lib/c.ts", to: "lib/b.ts" }],
      tests: { "test/smoke.ts": ["lib/c.ts"], "test/other.ts": ["lib/z.ts"] },
    });
    expect(m.roots.map((r) => r.path)).toEqual(["lib/a.ts", "lib/b.ts"]);
    expect(m.roots[0].children.map((c) => c.path)).toEqual(["lib/c.ts"]);
    expect(m.covered).toEqual(["test/smoke.ts"]);
  });
});
