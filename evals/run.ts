// Iris eval suite: does an agent with Iris's instructions show things as cards?
//
// Each case is a generic bb moment (a status report, proof that something is
// done, PR or CI state, data to decide on). The agent (Claude Code, headless,
// Opus 5.5) answers with exactly the instructions Iris gives agents in bb, and
// the same Iris tools (iris_docs, iris_examples, iris_check, served by
// evals/mcp-server.ts); no other tools. Every answer is scored:
//   - deterministic (half): an ```iris block is present, it passes check()
//     with no errors, it uses one of the components the case expects, and the
//     answer has no markdown table;
//   - judged (half): Opus 5.5 rates from 1 to 5 how well the card fits the moment.
// The suite score is the mean, 0 to 100. `--gate` compares it with
// evals/baseline.json and exits 1 when it dropped by more than the tolerance.
//
//   npx tsx evals/run.ts                 run all cases, write evals/results/latest.json
//   npx tsx evals/run.ts --only status   run one category
//   npx tsx evals/run.ts --gate          run, then fail on a drop from the baseline
//   npx tsx evals/run.ts --save-baseline run, then store the score as the new baseline

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../core/catalog";
import { check } from "../core/check";
import type { LoadResult } from "../core/program";
import { CODE_WORK_INSTRUCTIONS, indexSections, mainInstructions } from "../core/prompt";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "claude-opus-5-5";
const TOLERANCE = 3;
const CONCURRENCY = Number(process.env.IRIS_EVAL_CONCURRENCY ?? 3);

interface Case {
  id: string;
  category: string;
  prompt: string;
  expect: string[];
}

interface Result {
  id: string;
  category: string;
  hasIris: boolean;
  checkClean: boolean;
  expected: boolean;
  noTable: boolean;
  judge: number;
  judgeWhy: string;
  components: string[];
  score: number;
  error?: string;
}

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const gate = args.includes("--gate");
const saveBaseline = args.includes("--save-baseline");

/** The instructions an agent gets from Iris in bb, in the order bb gives them. */
function systemPrompt(): string {
  return [mainInstructions("eager"), ...indexSections().map((s) => s.text), CODE_WORK_INSTRUCTIONS].join("\n\n");
}

const TSX = path.join(here, "..", "node_modules", ".bin", "tsx");
const MCP_CONFIG = JSON.stringify({ mcpServers: { iris: { command: TSX, args: [path.join(here, "mcp-server.ts")] } } });
const IRIS_TOOLS = ["mcp__iris__iris_docs", "mcp__iris__iris_examples", "mcp__iris__iris_check"].join(",");

function claude(prompt: string, system: string, timeoutMs = 300_000, withIris = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-eval-"));
    const sysFile = path.join(dir, "system.md");
    fs.writeFileSync(sysFile, system, { flag: "wx" });
    // No tools and no MCP servers: the agent can only answer in text.
    // Built-in tools off; the agent gets only Iris's own tools, the judge none.
    const iris = withIris ? ["--mcp-config", MCP_CONFIG, "--allowedTools", IRIS_TOOLS] : [];
    const child = spawn("claude", ["-p", "--bare", "--strict-mcp-config", ...iris, "--model", MODEL, "--append-system-prompt-file", sysFile, "--tools", "", "--output-format", "json", "--no-session-persistence"], { stdio: ["pipe", "pipe", "pipe"] });
    child.on("error", (e) => {
      fs.rmSync(dir, { recursive: true, force: true });
      reject(e);
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 400)}`));
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (j.is_error) return reject(new Error(String(j.result).slice(0, 400)));
        resolve(String(j.result ?? ""));
      } catch {
        resolve(out);
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
  });
}

const FENCE = /```(iris(?:-app|-react)?)[ \t]*\n([\s\S]*?)```/g;

/** A markdown table: a header row followed by a |---| separator row. */
function hasMarkdownTable(text: string): boolean {
  const outside = text.replace(FENCE, "");
  return /^\s*\|.*\|\s*\n\s*\|[\s:|-]*-[\s:|-]*\|\s*$/m.test(outside);
}

function score(c: Case, answer: string, judge: number) {
  const blocks = [...answer.matchAll(FENCE)];
  const hasIris = blocks.length > 0;
  const components = new Set<string>();
  let checkClean = hasIris;
  for (const [, lang, body] of blocks) {
    if (lang !== "iris") continue;
    const report = check(body, { load: () => new Promise<LoadResult>(() => undefined) });
    report.components.forEach((n) => components.add(n));
    if (report.issues.some((i) => i.severity === "error")) checkClean = false;
  }
  const expected = c.expect.some((n) => components.has(n));
  const noTable = !hasMarkdownTable(answer);
  const deterministic = [hasIris, checkClean, expected, noTable].filter(Boolean).length / 4;
  return { hasIris, checkClean, expected, noTable, components: [...components], score: Math.round((deterministic * 0.5 + (judge / 5) * 0.5) * 1000) / 10 };
}

async function judgeAnswer(c: Case, answer: string): Promise<{ score: number; why: string }> {
  const rubric = `You grade how well an AI agent in a chat app answered with live UI cards. The app renders \`\`\`iris blocks (JSX-like components; every one that exists: ${CATALOG.map((x) => x.name).join(", ")}) as interactive cards. Do not mark down an answer for using any of these. Threads, Changes, Commits, PullRequest, Environments and Pipeline (without data props) and load("bb:...") read the chat app's live data when rendered, so they are not empty.

The user's request:
<request>
${c.prompt}
</request>

The agent's answer:
<answer>
${answer.replace(/&/g, "&amp;").replace(/</g, "&lt;")}
</answer>

Score from 1 to 5:
5 = the card is exactly the right shape for this moment (the component that fits the data, data loaded by reference when it is in a file, short prose that gives the answer first), nothing retyped as markdown that a card shows.
4 = a good card with a small miss (a weaker component choice, a little redundancy).
3 = a card, but a clearly better component existed, or important facts are missing.
2 = mostly prose or markdown with a token card.
1 = no card, or a broken one.
Answer with JSON only: {"score": <1-5>, "why": "<one sentence>"}`;
  const text = await claude(rubric, "You are a strict, fair grader. Reply with JSON only.");
  const m = /\{[\s\S]*\}/.exec(text);
  const j = m ? (JSON.parse(m[0]) as { score?: number; why?: string }) : {};
  const s = Math.max(1, Math.min(5, Number(j.score) || 1));
  return { score: s, why: String(j.why ?? "") };
}

/** A case that crashed or timed out (the machine, not the answer) gets two more tries. */
async function runCase(c: Case, system: string): Promise<Result> {
  let last: Result | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await runOnce(c, system);
    if (!last.error) return last;
  }
  return last as Result;
}

async function runOnce(c: Case, system: string): Promise<Result> {
  try {
    const answer = await claude(c.prompt, system, 300_000, true);
    fs.mkdirSync(path.join(here, "results", "answers"), { recursive: true });
    fs.writeFileSync(path.join(here, "results", "answers", `${c.id}.md`), answer);
    const j = await judgeAnswer(c, answer);
    return { id: c.id, category: c.category, ...score(c, answer, j.score), judge: j.score, judgeWhy: j.why };
  } catch (e) {
    return { id: c.id, category: c.category, hasIris: false, checkClean: false, expected: false, noTable: false, judge: 0, judgeWhy: "", components: [], score: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const cases = (JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8")) as Case[]).filter((c) => !only || c.category === only || c.id === only);
  const system = systemPrompt();
  const results: Result[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
      while (next < cases.length) {
        const c = cases[next++];
        const r = await runCase(c, system);
        results.push(r);
        console.log(`${r.score.toFixed(1).padStart(5)}  ${c.id}${r.error ? `  ERROR ${r.error}` : `  judge ${r.judge}  ${r.components.join(",")}`}`);
      }
    }),
  );
  results.sort((a, b) => a.id.localeCompare(b.id));
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  const rate = (k: keyof Result) => Math.round((results.filter((r) => r[k] === true).length / (results.length || 1)) * 100);
  const summary = {
    at: new Date().toISOString(),
    model: MODEL,
    cases: results.length,
    // A case that still errored after its retries is the machine's failure, not the answer's: reported, never scored.
    score: mean(results.filter((r) => !r.error).map((r) => r.score)),
    errored: results.filter((r) => r.error).map((r) => r.id),
    rates: { hasIris: rate("hasIris"), checkClean: rate("checkClean"), expected: rate("expected"), noTable: rate("noTable") },
    byCategory: Object.fromEntries([...new Set(results.map((r) => r.category))].map((cat) => [cat, mean(results.filter((r) => r.category === cat).map((r) => r.score))])),
    results,
  };
  fs.mkdirSync(path.join(here, "results"), { recursive: true });
  fs.writeFileSync(path.join(here, "results", "latest.json"), JSON.stringify(summary, null, 2));
  console.log(`\nscore ${summary.score} over ${summary.cases} cases  ${JSON.stringify(summary.rates)}  ${JSON.stringify(summary.byCategory)}`);

  const baselineFile = path.join(here, "baseline.json");
  if (saveBaseline) {
    fs.writeFileSync(baselineFile, `${JSON.stringify({ at: summary.at, model: MODEL, cases: summary.cases, score: summary.score, rates: summary.rates, byCategory: summary.byCategory }, null, 2)}\n`);
    console.log(`baseline saved: ${summary.score}`);
  }
  if (gate) {
    if (only) throw new Error("--gate runs the whole suite; drop --only");
    const base = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as { score: number };
    const drop = Math.round((base.score - summary.score) * 10) / 10;
    if (summary.errored.length > Math.floor(summary.cases * 0.1)) {
      console.error(`GATE FAILED: ${summary.errored.length} cases errored (${summary.errored.join(", ")}); too few scored to certify`);
      process.exit(1);
    }
    if (drop > TOLERANCE) {
      console.error(`GATE FAILED: score ${summary.score} is ${drop} below the baseline ${base.score} (tolerance ${TOLERANCE})`);
      process.exit(1);
    }
    console.log(`gate passed: ${summary.score} against baseline ${base.score}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
