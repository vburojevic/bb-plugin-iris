// The tools an agent has in bb, served to the eval agent over MCP (stdio, JSON-RPC lines):
// iris_docs and iris_examples look up props and examples, iris_check validates a block.
// Files and bb data aren't there in an eval, so load() stays pending, as it does before a
// file exists.
//   npx tsx evals/mcp-server.ts
import { createInterface } from "node:readline";
import { CATALOG, GROUPS } from "../core/catalog";
import { check, formatReport } from "../core/check";
import type { LoadResult } from "../core/program";
import { docsFor, examplesForGroups } from "../core/prompt";

const families = GROUPS.filter((g) => CATALOG.some((c) => c.group === g));

const TOOLS = [
  {
    name: "iris_docs",
    description: 'Returns every prop (type, default, meaning) and a working example for the Iris components you name; "React" gives the iris-react kit, "bb" the bb: live data shapes.',
    inputSchema: { type: "object", properties: { components: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } }, required: ["components"] },
  },
  {
    name: "iris_examples",
    description: "Returns working Iris examples for every component in the families you name.",
    inputSchema: { type: "object", properties: { families: { type: "array", items: { type: "string", enum: [...families] }, minItems: 1, maxItems: 6 } }, required: ["families"] },
  },
  {
    name: "iris_check",
    description: "Checks an ```iris block before you send it: syntax, unknown components or props, missing required props, and a text outline of what the person will see.",
    inputSchema: { type: "object", properties: { source: { type: "string" } }, required: ["source"] },
  },
];

function call(name: string, args: Record<string, unknown>): { text: string; isError?: boolean } {
  if (name === "iris_docs") return { text: docsFor((Array.isArray(args.components) ? args.components : []).map(String)) };
  if (name === "iris_examples") {
    const known = (Array.isArray(args.families) ? args.families : []).map(String).filter((f) => (families as string[]).includes(f));
    return known.length ? { text: examplesForGroups(known) } : { text: `Name one or more families: ${families.join(", ")}`, isError: true };
  }
  if (name === "iris_check") {
    const report = check(String(args.source ?? ""), { load: () => new Promise<LoadResult>(() => undefined) });
    const text = formatReport(report);
    return { text, isError: report.issues.some((i) => i.severity === "error") };
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
    const r = call(String(msg.params?.name), (msg.params?.arguments as Record<string, unknown>) ?? {});
    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: r.text }], isError: r.isError ?? false } });
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  }
});
