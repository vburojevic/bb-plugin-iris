// Iris eval suite: does an agent with Iris's instructions show things as cards?
//
// Each case is a generic bb moment (a status report, proof that something is
// done, PR or CI state, data to decide on). The agent (Claude Code, headless,
// Opus 5.5) answers with exactly the instructions Iris gives agents in bb, and
// the same Iris tools (iris_docs, iris_examples, iris_check, served by
// evals/mcp-server.ts); no other tools. Every answer is scored:
//   - deterministic (half): Iris is used (an ```iris block, a ::iris{file} card,
//     or an iris_ask or iris_pin call), every card passes check() with no
//     errors, it uses one of the components (and tools) the case expects, and
//     the answer has no markdown table;
//   - judged (half): Opus 5.5 rates from 1 to 5 how well the card fits the moment.
// Each case runs RUNS times (2 by default) and scores the mean of its runs, so one
// unlucky answer moves the suite less. The suite score is the mean over cases, 0 to
// 100. `--gate` compares it with evals/baseline.json and exits 1 when it dropped by
// more than the tolerance, naming the cases that fell most.
//
//   npx tsx evals/run.ts                 run all cases, write evals/results/latest.json
//   npx tsx evals/run.ts --only status   run one category
//   npx tsx evals/run.ts --gate          run, then fail on a drop from the baseline
//   npx tsx evals/run.ts --save-baseline run, then store the score as the new baseline
//   npx tsx evals/run.ts --runs 1        one run per case (faster, noisier)

import { spawn } from "node:child_process";

/**
 * The child claude runs on the person's own login, isolated from their setup: an empty config folder
 * holding only a copy of the login (no CLAUDE.md, settings, hooks, plugins or memory), run in this
 * repo as with --bare (it has no CLAUDE.md or .claude of its own). Inside a bb thread whose provider the host manages, the host's variables would
 * point it elsewhere ("Not logged in"), so they are dropped. Without a login file it falls back to
 * --bare, which needs an API key.
 */
const LOGIN = path.join(os.homedir(), ".claude", ".credentials.json");
let isolated: { config: string } | null | undefined;
function isolation(): { config: string } | null {
  if (isolated !== undefined) return isolated;
  if (!fs.existsSync(LOGIN)) return (isolated = null);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "iris-eval-config-"));
  fs.copyFileSync(LOGIN, path.join(config, ".credentials.json"));
  fs.chmodSync(path.join(config, ".credentials.json"), 0o600);
  process.on("exit", () => fs.rmSync(config, { recursive: true, force: true }));
  return (isolated = { config });
}
/**
 * Inside a bb thread routed through bb's Account Pooler, the child claude runs on the person's
 * pooled subscription accounts: the pool's route stays, and the parent token authenticates it
 * (bb's documented way to route a nested claude). Then --bare keeps it free of local setup.
 */
const POOLED = Boolean(process.env.ANTHROPIC_BASE_URL && process.env.BB_ACCOUNT_POOL_PARENT_TOKEN);
function evalEnv(): NodeJS.ProcessEnv {
  if (POOLED) {
    const env = { ...process.env, ANTHROPIC_AUTH_TOKEN: process.env.BB_ACCOUNT_POOL_PARENT_TOKEN };
    for (const k of ["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
    return env;
  }
  const env = { ...process.env };
  for (const k of ["ANTHROPIC_BASE_URL", "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN"]) delete env[k];
  const iso = isolation();
  if (iso) env.CLAUDE_CONFIG_DIR = iso.config;
  return env;
}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../core/catalog";
import { ASK_INSTRUCTIONS, CODE_WORK_INSTRUCTIONS, indexSections, mainInstructions } from "../core/prompt";
import { type Call, type Case, callsForJudge, score } from "./score";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "claude-opus-5-5";
const TOLERANCE = 3;
const CONCURRENCY = Number(process.env.IRIS_EVAL_CONCURRENCY ?? 4);

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
  tools: string[];
  score: number;
  /** Each run's score, when the case ran more than once. */
  runs?: number[];
  error?: string;
}

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const gate = args.includes("--gate");
const saveBaseline = args.includes("--save-baseline");
const RUNS = Math.max(1, Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : (process.env.IRIS_EVAL_RUNS ?? 2)) || 2);

/** The instructions an agent gets from Iris in bb, in the order bb gives them. */
function systemPrompt(): string {
  return [mainInstructions("eager"), ...indexSections().map((s) => s.text), CODE_WORK_INSTRUCTIONS, ASK_INSTRUCTIONS].join("\n\n");
}

const TSX = path.join(here, "..", "node_modules", ".bin", "tsx");
/** The Iris tools over MCP, logging every call to `log`. */
const mcpConfig = (log: string) => JSON.stringify({ mcpServers: { iris: { command: TSX, args: [path.join(here, "mcp-server.ts")], env: { IRIS_EVAL_LOG: log } } } });
const IRIS_TOOLS = ["iris_docs", "iris_examples", "iris_check", "iris_ask", "iris_pin"].map((t) => `mcp__iris__${t}`).join(",");

function claude(prompt: string, system: string, timeoutMs = 300_000, log: string | null = null): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-eval-"));
    const sysFile = path.join(dir, "system.md");
    fs.writeFileSync(sysFile, system, { flag: "wx" });
    // No tools and no MCP servers: the agent can only answer in text.
    // Built-in tools off; the agent gets only Iris's own tools, the judge none.
    const iris = log ? ["--mcp-config", mcpConfig(log), "--allowedTools", IRIS_TOOLS] : [];
    const iso = POOLED ? null : isolation();
    const child = spawn("claude", ["-p", ...(iso ? [] : ["--bare"]), "--strict-mcp-config", ...iris, "--model", MODEL, "--append-system-prompt-file", sysFile, "--tools", "", "--output-format", "json", "--no-session-persistence"], { stdio: ["pipe", "pipe", "pipe"], env: evalEnv() });
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

async function judgeAnswer(c: Case, answer: string, calls: Call[]): Promise<{ score: number; why: string }> {
  const tools = callsForJudge(calls);
  const rubric = `You grade how well an AI agent in a chat app answered with live UI cards. The app renders \`\`\`iris blocks (JSX-like components; every one that exists: ${CATALOG.map((x) => x.name).join(", ")}) as interactive cards. Do not mark down an answer for using any of these. Threads, Changes, Commits, PullRequest, Environments and Pipeline (without data props) and load("bb:...") read the chat app's live data when rendered, so they are not empty. A line ::iris{file="..."} draws the card held in that file, live; the agent may not see the file's content. The agent can also call tools: iris_ask shows the person a picker (written in the same markup) and waits for their answer, and iris_pin keeps a card in view beside the conversation. Those calls are part of the answer.

The user's request:
<request>
${c.prompt}
</request>

The agent's answer:
<answer>
${answer.replace(/&/g, "&amp;").replace(/</g, "&lt;")}
</answer>
${tools ? `\nThe agent's tool calls:\n<tools>\n${tools.replace(/&/g, "&amp;").replace(/</g, "&lt;")}\n</tools>\n` : ""}
Score from 1 to 5:
5 = the card is exactly the right shape for this moment (the component that fits the data, data loaded by reference when it is in a file, a picker through iris_ask when the person must choose, short prose that gives the answer first), nothing retyped as markdown that a card shows.
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
async function runAttempt(c: Case, system: string, run: number): Promise<Result> {
  let last: Result | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await runOnce(c, system, run);
    if (!last.error) return last;
  }
  return last as Result;
}

/** RUNS runs of a case: its score is their mean, and its details those of the run nearest that mean. */
async function runCase(c: Case, system: string): Promise<Result> {
  const runs: Result[] = [];
  for (let run = 0; run < RUNS; run++) runs.push(await runAttempt(c, system, run));
  const ok = runs.filter((r) => !r.error);
  if (!ok.length) return runs[runs.length - 1];
  const mean = Math.round((ok.reduce((a, r) => a + r.score, 0) / ok.length) * 10) / 10;
  const typical = [...ok].sort((a, b) => Math.abs(a.score - mean) - Math.abs(b.score - mean))[0];
  return { ...typical, score: mean, runs: ok.map((r) => r.score) };
}

async function runOnce(c: Case, system: string, run: number): Promise<Result> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-eval-log-"));
  const log = path.join(dir, "calls.jsonl");
  try {
    const answer = await claude(c.prompt, system, 300_000, log);
    const calls: Call[] = fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Call)
      : [];
    fs.mkdirSync(path.join(here, "results", "answers"), { recursive: true });
    const tools = callsForJudge(calls);
    fs.writeFileSync(path.join(here, "results", "answers", `${c.id}${run ? `.${run + 1}` : ""}.md`), tools ? `${answer}\n\n<!-- tool calls -->\n${tools}\n` : answer);
    const j = await judgeAnswer(c, answer, calls);
    return { id: c.id, category: c.category, ...score(c, answer, calls, j.score), judge: j.score, judgeWhy: j.why };
  } catch (e) {
    return { id: c.id, category: c.category, hasIris: false, checkClean: false, expected: false, noTable: false, judge: 0, judgeWhy: "", components: [], tools: [], score: 0, error: e instanceof Error ? e.message : String(e) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
        console.log(`${r.score.toFixed(1).padStart(5)}  ${c.id}${r.error ? `  ERROR ${r.error}` : `${r.runs && r.runs.length > 1 ? `  runs ${r.runs.join("/")}` : ""}  judge ${r.judge}  ${[...r.components, ...r.tools].join(",")}`}`);
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
    runs: RUNS,
    // A case that still errored after its retries is the machine's failure, not the answer's: reported, never scored.
    score: mean(results.filter((r) => !r.error).map((r) => r.score)),
    errored: results.filter((r) => r.error).map((r) => r.id),
    rates: { hasIris: rate("hasIris"), checkClean: rate("checkClean"), expected: rate("expected"), noTable: rate("noTable") },
    byCategory: Object.fromEntries([...new Set(results.map((r) => r.category))].map((cat) => [cat, mean(results.filter((r) => r.category === cat).map((r) => r.score))])),
    results,
  };
  fs.mkdirSync(path.join(here, "results"), { recursive: true });
  fs.writeFileSync(path.join(here, "results", "latest.json"), JSON.stringify(summary, null, 2));
  console.log(`\nscore ${summary.score} over ${summary.cases} cases, ${RUNS} run${RUNS === 1 ? "" : "s"} each  ${JSON.stringify(summary.rates)}  ${JSON.stringify(summary.byCategory)}`);

  const baselineFile = path.join(here, "baseline.json");
  if (saveBaseline) {
    const byCase = Object.fromEntries(results.filter((r) => !r.error).map((r) => [r.id, r.score]));
    fs.writeFileSync(baselineFile, `${JSON.stringify({ at: summary.at, model: MODEL, cases: summary.cases, runs: RUNS, score: summary.score, rates: summary.rates, byCategory: summary.byCategory, byCase }, null, 2)}\n`);
    console.log(`baseline saved: ${summary.score}`);
  }
  if (gate) {
    if (only) throw new Error("--gate runs the whole suite; drop --only");
    const base = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as { score: number; byCase?: Record<string, number> };
    const drop = Math.round((base.score - summary.score) * 10) / 10;
    if (summary.errored.length > Math.floor(summary.cases * 0.1)) {
      console.error(`GATE FAILED: ${summary.errored.length} cases errored (${summary.errored.join(", ")}); too few scored to certify`);
      process.exit(1);
    }
    if (drop > TOLERANCE) {
      console.error(`GATE FAILED: score ${summary.score} is ${drop} below the baseline ${base.score} (tolerance ${TOLERANCE})`);
      const fell = results
        .filter((r) => !r.error && base.byCase?.[r.id] !== undefined)
        .map((r) => ({ id: r.id, drop: Math.round(((base.byCase?.[r.id] ?? 0) - r.score) * 10) / 10, why: r.judgeWhy }))
        .filter((r) => r.drop > 0)
        .sort((a, b) => b.drop - a.drop)
        .slice(0, 5);
      for (const f of fell) console.error(`  ${f.id} fell ${f.drop}: ${f.why}`);
      process.exit(1);
    }
    console.log(`gate passed: ${summary.score} against baseline ${base.score}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
