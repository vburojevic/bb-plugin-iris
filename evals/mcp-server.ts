// The tools an agent has in bb, served to the eval agent over MCP (stdio, JSON-RPC lines):
// iris_docs and iris_examples look up props and examples, iris_check validates a block, and
// iris_ask and iris_pin stand in for bb's: a picker is answered with its own starting values, a pin
// is checked and kept nowhere. Every call is logged as a JSON line to $IRIS_EVAL_LOG for scoring.
// Files and bb data aren't there in an eval, so load() stays pending, as it does before a
// file exists.
//   npx tsx evals/mcp-server.ts
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { check, formatReport } from "../core/check";
import { CardRuntime, compile, type LoadResult } from "../core/program";
import { docsFor, exampleFamilies, examplesForGroups } from "../core/prompt";

const families = exampleFamilies();

const TOOLS = [
  {
    name: "iris_docs",
    description: 'Returns every prop (type, default, meaning) and a working example for the Iris components you name; "React" gives the iris-react kit, "bb" the bb: live data shapes.',
    inputSchema: { type: "object", properties: { components: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } }, required: ["components"] },
  },
  {
    name: "iris_examples",
    description: "Returns working Iris examples for every component in the families you name; \"Recipes\" gives patterns that combine components and tools (a status card that follows a file, a Variants picker).",
    inputSchema: { type: "object", properties: { families: { type: "array", items: { type: "string", enum: [...families] }, minItems: 1, maxItems: 6 } }, required: ["families"] },
  },
  {
    name: "iris_check",
    description: "Checks an ```iris block before you send it: syntax, unknown components or props, missing required props, and a text outline of what the person will see.",
    inputSchema: { type: "object", properties: { source: { type: "string" } }, required: ["source"] },
  },
  {
    name: "iris_ask",
    description:
      "Asks the person a rich question and waits for the answer: the picker replaces the composer and the thread shows it is waiting on them. Write the picker in Iris markup with <state> for each answer and a <Submit /> button; the answer comes back as JSON of the state values. Use it for picks that need more than a few options: compare designs, tune weights, edit a table, approve a plan. Plain questions go through the host's own ask mode.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, source: { type: "string" }, html: { type: "string" }, react: { type: "string" }, timeoutMinutes: { type: "integer" } }, required: ["title"] },
  },
  {
    name: "iris_pin",
    description:
      "Pins a live Iris card beside this thread's conversation, where it stays in view and keeps refreshing while the chat scrolls on (a build, a fleet's status, a job). Give source (Iris markup) or file (a thread storage or workspace path holding the card, re-read every 3 s, so rewriting the file updates the pin). The card is checked first; one with errors isn't pinned. Pinning again with the same id replaces the pin. At most 5 pins per thread.",
    inputSchema: { type: "object", properties: { source: { type: "string" }, file: { type: "string" }, title: { type: "string" }, id: { type: "string" } } },
  },
];

const pending = { load: () => new Promise<LoadResult>(() => undefined) };

function call(name: string, args: Record<string, unknown>): { text: string; isError?: boolean } {
  if (name === "iris_docs") return { text: docsFor((Array.isArray(args.components) ? args.components : []).map(String)) };
  if (name === "iris_examples") {
    const known = (Array.isArray(args.families) ? args.families : []).map(String).filter((f) => (families as string[]).includes(f));
    return known.length ? { text: examplesForGroups(known) } : { text: `Name one or more families: ${families.join(", ")}`, isError: true };
  }
  if (name === "iris_check") {
    const report = check(String(args.source ?? ""), pending);
    const text = formatReport(report);
    return { text, isError: report.issues.some((i) => i.severity === "error") };
  }
  if (name === "iris_ask") {
    const source = typeof args.source === "string" ? args.source : "";
    if (!source && !args.react && !args.html) return { text: "Pass exactly one of source, react or html", isError: true };
    if (source) {
      const report = check(source, pending);
      if (!report.ok) return { text: `The picker has errors; fix them and ask again.\n${formatReport(report)}`, isError: true };
      // The person submits what the picker starts with.
      const runtime = new CardRuntime(compile(source), pending);
      return { text: JSON.stringify({ outcome: "submitted", value: runtime.answers() }) };
    }
    return { text: JSON.stringify({ outcome: "submitted", value: null }) };
  }
  if (name === "iris_pin") {
    const source = typeof args.source === "string" ? args.source : "";
    const file = typeof args.file === "string" ? args.file : "";
    if (Boolean(source) === Boolean(file)) return { text: "give the card's source or a file holding it, not both", isError: true };
    if (source) {
      const report = check(source, pending);
      if (!report.ok) return { text: `The card has errors, so it wasn't pinned. Fix them and pin again.\n${formatReport(report)}`, isError: true };
    }
    return { text: `Pinned "${typeof args.title === "string" ? args.title : "Iris card"}" beside this thread's conversation, 1 of 5 pins.${file ? ` It re-reads ${file} every 3 seconds while it shows, so rewrite that file to update it.` : ""}` };
  }
  return { text: `No tool ${name}`, isError: true };
}

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // a notification
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "iris", version: "1" } } });
  } else if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === "tools/call") {
    const toolName = String(msg.params?.name);
    const toolArgs = (msg.params?.arguments as Record<string, unknown>) ?? {};
    const r = call(toolName, toolArgs);
    if (process.env.IRIS_EVAL_LOG) appendFileSync(process.env.IRIS_EVAL_LOG, `${JSON.stringify({ name: toolName, args: toolArgs, isError: r.isError ?? false })}\n`);
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: r.text }], isError: r.isError ?? false } });
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  }
});
