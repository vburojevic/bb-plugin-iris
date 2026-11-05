// DevServers' model: the processes and ports an agent reports, from a JSON
// file it rewrites ([{name, pid, port, status, ...}]) or the text of
// `lsof -nP -iTCP -sTCP:LISTEN`.

export type ProcStatus = "running" | "starting" | "stopped" | "crashed";

export interface Proc {
  name: string;
  pid: number | null;
  ports: number[];
  url: string | null;
  status: ProcStatus;
  command: string | null;
  cwd: string | null;
  cpu: number | null;
  mem: number | null;
  started: number | null;
  log: string | null;
  note: string | null;
}

const STATUS: Record<string, ProcStatus> = {
  running: "running", up: "running", listening: "running", ready: "running", ok: "running", healthy: "running", live: "running",
  starting: "starting", booting: "starting", building: "starting", pending: "starting", restarting: "starting",
  stopped: "stopped", exited: "stopped", down: "stopped", done: "stopped", idle: "stopped",
  crashed: "crashed", failed: "crashed", error: "crashed", dead: "crashed", unhealthy: "crashed",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

const UNITS: Record<string, number> = { b: 1, k: 1024, kb: 1024, kib: 1024, m: 1024 ** 2, mb: 1024 ** 2, mib: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, gib: 1024 ** 3 };

/** Bytes from 123456, "120 MB" or "1.2G". */
export function readBytes(v: unknown): number | null {
  const n = num(v);
  if (n != null) return n;
  const t = typeof v === "string" && v.length <= 32 ? v.trim() : null;
  const m = t !== null ? /^([\d.]{1,16})\s*([a-z]{0,4})$/i.exec(t) : null;
  if (!m) return null;
  const unit = UNITS[(m[2] || "b").toLowerCase()];
  return unit ? Number(m[1]) * unit : null;
}

/** Epoch ms from an ISO date, epoch seconds or epoch ms. */
export function readTime(v: unknown): number | null {
  const n = num(v);
  if (n != null) return n < 1e12 ? n * 1000 : n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function readPorts(v: unknown): number[] {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  const out: number[] = [];
  for (const p of list) {
    const t = typeof p === "string" ? p.trim().slice(-32) : null;
    const n = num(t !== null ? (/(\d+)$/.exec(t)?.[1] ?? t) : p);
    if (n != null && Number.isInteger(n) && n > 0 && n < 65536 && !out.includes(n)) out.push(n);
  }
  return out;
}

export function normalizeProcesses(input: unknown, now = Date.now()): { items: Proc[]; problems: string[] } {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return normalizeProcesses(JSON.parse(trimmed), now);
      } catch {
        return { items: [], problems: ["the file is not valid JSON"] };
      }
    }
    return parseLsof(input);
  }
  let list: unknown[] | null = null;
  if (Array.isArray(input)) list = input;
  else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const inner = o.processes ?? o.servers ?? o.items ?? o.services;
    if (Array.isArray(inner)) list = inner;
    else if (o.name || o.pid || o.port) list = [o];
  }
  if (!list) return { items: [], problems: ["needs a list of processes: [{name, pid, port, status}]"] };
  const items: Proc[] = [];
  const problems: string[] = [];
  list.forEach((raw, k) => {
    if (!raw || typeof raw !== "object") {
      if (problems.length < 3) problems.push(`process ${k + 1} is not an object`);
      return;
    }
    const o = raw as Record<string, unknown>;
    const ports = readPorts(o.ports ?? o.port);
    const url = str(o.url ?? o.address);
    const name = str(o.name ?? o.label ?? o.title) ?? (str(o.command)?.split(/\s+/)[0] ?? null) ?? (ports[0] ? `:${ports[0]}` : null);
    if (!name) {
      if (problems.length < 3) problems.push(`process ${k + 1} needs a name, command or port`);
      return;
    }
    const rawStatus = str(o.status ?? o.state)?.toLowerCase() ?? null;
    const exit = num(o.exit ?? o.exitCode);
    const status: ProcStatus = rawStatus ? (STATUS[rawStatus] ?? "running") : exit != null ? (exit === 0 ? "stopped" : "crashed") : "running";
    const uptime = num(o.uptime);
    items.push({
      name,
      pid: num(o.pid),
      ports,
      url: url ?? (ports[0] && status !== "stopped" && status !== "crashed" ? `http://localhost:${ports[0]}` : null),
      status,
      command: str(o.command ?? o.cmd),
      cwd: str(o.cwd ?? o.dir),
      cpu: num(o.cpu),
      mem: readBytes(o.mem ?? o.memory ?? o.rss),
      started: readTime(o.started ?? o.startedAt ?? o.since) ?? (uptime != null ? now - uptime * 1000 : null),
      log: str(o.log ?? o.logFile),
      note: str(o.note ?? o.error ?? o.message),
    });
  });
  return { items, problems };
}

/** `lsof -nP -iTCP -sTCP:LISTEN` text: one process per pid with its ports. */
export function parseLsof(text: string): { items: Proc[]; problems: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { items: [], problems: [] };
  const header = lines[0].trim().split(/\s+/);
  if (header[0] !== "COMMAND" || header[1] !== "PID") return { items: [], problems: ["text must be lsof -nP -iTCP -sTCP:LISTEN output, or use JSON"] };
  const byPid = new Map<number, Proc>();
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    const pid = Number(cols[1]);
    if (!Number.isInteger(pid)) continue;
    const name = cols[0].replace(/\\x20/g, " ");
    const port = cols.map((c) => /:(\d+)$/.exec(c)?.[1]).find(Boolean);
    const proc = byPid.get(pid) ?? { name, pid, ports: [], url: null, status: "running" as const, command: null, cwd: null, cpu: null, mem: null, started: null, log: null, note: null };
    if (port && !proc.ports.includes(Number(port))) proc.ports.push(Number(port));
    byPid.set(pid, proc);
  }
  const items = [...byPid.values()].map((p) => ({ ...p, ports: p.ports.sort((a, b) => a - b), url: p.ports.length ? `http://localhost:${Math.min(...p.ports)}` : null }));
  return { items: items.sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0)), problems: [] };
}

/** "3 h 12 min", "4 min", "12 s". */
export function uptime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d`;
}
