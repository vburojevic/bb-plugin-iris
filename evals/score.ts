// How an eval answer is scored, apart from the judge: Iris used (a block, a ::iris{file} card, or
// an iris_ask or iris_pin call), every card clean, the expected component and tool, no markdown table.
import { check } from "../core/check";
import type { LoadResult } from "../core/program";

export interface Case {
  id: string;
  category: string;
  prompt: string;
  /** Components of which the answer should use at least one; empty when only the tool matters. */
  expect: string[];
  /** Ways of showing it of which the answer should use at least one: iris_ask, iris_pin or directive (::iris{file}). */
  tools?: string[];
}

/** A tool call the eval agent made, as evals/mcp-server.ts logs it. */
export interface Call {
  name: string;
  args: Record<string, unknown>;
  isError: boolean;
}

const FENCE = /```(iris(?:-app|-react)?)[ \t]*\n([\s\S]*?)```/g;

/** A markdown table: a header row followed by a |---| separator row. */
export function hasMarkdownTable(text: string): boolean {
  const outside = text.replace(FENCE, "");
  return /^\s*\|.*\|\s*\n\s*\|[\s:|-]*-[\s:|-]*\|\s*$/m.test(outside);
}

const DIRECTIVE = /^[ \t]*::iris\{file="[^"]+"\}[ \t]*$/m;

/** The cards the agent sent through tools that accepted them: iris_ask pickers and pins. */
function toolCards(calls: Call[]): { tool: string; source: string | null }[] {
  return calls.filter((c) => !c.isError && (c.name === "iris_ask" || c.name === "iris_pin")).map((c) => ({ tool: c.name, source: typeof c.args.source === "string" ? c.args.source : null }));
}

export function score(c: Case, answer: string, calls: Call[], judge: number) {
  const blocks = [...answer.matchAll(FENCE)];
  const sent = toolCards(calls);
  const used = new Set<string>(sent.map((t) => t.tool));
  // A directive written inside a code block is an example, not a card.
  if (DIRECTIVE.test(answer.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, ""))) used.add("directive");
  const hasIris = blocks.length > 0 || used.size > 0;
  const components = new Set<string>();
  let checkClean = hasIris;
  const bodies = [...blocks.filter(([, lang]) => lang === "iris").map(([, , body]) => body), ...sent.map((t) => t.source).filter((x): x is string => !!x)];
  for (const body of bodies) {
    const report = check(body, { load: () => new Promise<LoadResult>(() => undefined) });
    report.components.forEach((n) => components.add(n));
    if (report.issues.some((i) => i.severity === "error")) checkClean = false;
  }
  const expected = (!c.expect.length || c.expect.some((n) => components.has(n))) && (!c.tools?.length || c.tools.some((t) => used.has(t)));
  const noTable = !hasMarkdownTable(answer);
  const deterministic = [hasIris, checkClean, expected, noTable].filter(Boolean).length / 4;
  return { hasIris, checkClean, expected, noTable, components: [...components], tools: [...used], score: Math.round((deterministic * 0.5 + (judge / 5) * 0.5) * 1000) / 10 };
}

/** The tool calls the person would see as cards or waits, for the judge. */
export function callsForJudge(calls: Call[]): string {
  const shown = calls.filter((c) => !c.isError && (c.name === "iris_ask" || c.name === "iris_pin"));
  return shown.map((c) => `${c.name}(${JSON.stringify(c.args, null, 1)})`).join("\n\n");
}

