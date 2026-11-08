// ToolCall: one tool or MCP call with its arguments, result, timing and
// retries. Arguments may be JSON text; an MCP result ({content: [{type: "text",
// text}], isError, structuredContent}) reads as its text, parsed when it is
// JSON. A name like mcp__github__create_issue splits into server and tool.

export type CallStatus = "ok" | "error" | "running";

export interface CallAttempt {
  n: number;
  ms: number | null;
  error: string | null;
}

export interface ToolCallModel {
  name: string;
  server?: string;
  status: CallStatus;
  args: unknown;
  /** The result as data (JSON parsed when it was text). */
  result: unknown;
  /** The result's text, when it is text and not JSON. */
  resultText?: string;
  error: string | null;
  ms: number | null;
  attempts: CallAttempt[];
  /** A one-line preview of the arguments: path: "src/a.ts", line: 4. */
  preview: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const numberOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** JSON text as data; anything else as it is. */
export function maybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!/^[[{]/.test(t) || t.length > 500_000) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

function errorText(v: unknown): string | null {
  if (v == null || v === false) return null;
  if (typeof v === "string") return v.trim() ? v.trim().slice(0, 4000) : null;
  if (v === true) return "failed";
  if (isObj(v)) return (text(v.message) ?? JSON.stringify(v)).slice(0, 4000);
  return String(v);
}

function splitName(raw: string, server?: string): { name: string; server?: string } {
  const m = /^mcp__([^_](?:[^_]|_(?!_))*)__(.+)$/.exec(raw);
  if (m && !server) return { server: m[1], name: m[2] };
  return { name: raw, server };
}

function previewOf(args: unknown): string {
  if (args == null) return "";
  if (!isObj(args)) return typeof args === "string" ? JSON.stringify(args.length > 60 ? `${args.slice(0, 57)}...` : args) : Array.isArray(args) ? `${args.length} items` : String(args);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const shown = typeof v === "string" ? JSON.stringify(v.length > 40 ? `${v.slice(0, 37)}...` : v) : typeof v === "number" || typeof v === "boolean" || v === null ? String(v) : Array.isArray(v) ? `[${v.length}]` : "{...}";
    parts.push(`${k}: ${shown}`);
    if (parts.join(", ").length > 90) break;
  }
  return parts.join(", ");
}

export function normalizeToolCall(props: Obj): ToolCallModel {
  const call = isObj(props.call) ? props.call : {};
  const params = isObj(call.params) ? call.params : call;
  const rawName = text(props.name) ?? text(params.name) ?? text(call.tool) ?? "tool";
  const { name, server } = splitName(rawName, text(props.server));
  const args = maybeJson(props.args ?? props.input ?? params.arguments ?? params.args ?? params.input);
  let result = maybeJson(props.result ?? props.output ?? call.result);
  let resultText: string | undefined;
  let error = errorText(props.error);
  // MCP: {content: [{type: "text", text}], isError, structuredContent}
  if (isObj(result) && Array.isArray(result.content)) {
    const texts = result.content.filter(isObj).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string);
    if (result.isError === true && !error) error = texts.join("\n").slice(0, 4000) || "the tool reported an error";
    if (result.structuredContent != null) result = result.structuredContent;
    else if (texts.length) {
      const joined = texts.join("\n");
      const parsed = maybeJson(joined);
      result = parsed;
      if (typeof parsed === "string") resultText = parsed;
    }
  } else if (typeof result === "string") resultText = result;
  const attemptsIn = Array.isArray(props.attempts) ? props.attempts : [];
  const attempts: CallAttempt[] = attemptsIn.slice(0, 50).map((a, k) => (isObj(a) ? { n: k + 1, ms: numberOf(a.ms ?? a.duration), error: errorText(a.error) } : { n: k + 1, ms: numberOf(a), error: null }));
  // retries counts the tries before the last: each failed, then the last ended as the call did.
  const retries = numberOf(props.retries);
  if (!attempts.length && retries != null && retries > 0) {
    for (let k = 0; k < Math.min(49, Math.round(retries)); k++) attempts.push({ n: k + 1, ms: null, error: "failed" });
    attempts.push({ n: attempts.length + 1, ms: null, error });
  }
  const explicit = text(props.status)?.toLowerCase();
  const status: CallStatus = explicit && /run|pending|progress|wait/.test(explicit) ? "running" : error || (explicit && /error|fail/.test(explicit)) ? "error" : "ok";
  const ms = numberOf(props.ms ?? props.duration) ?? (attempts.some((t) => t.ms != null) ? attempts.reduce((a, t) => a + (t.ms ?? 0), 0) : null);
  return { name: name.slice(0, 160), server, status, args, result, resultText, error: status === "error" ? (error ?? "failed") : null, ms, attempts, preview: previewOf(args) };
}
