// What every Iris component can reach: the card's runtime, the theme palette,
// and a way to run actions (put text in the composer, send it, open a file).

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { experimental_copyToClipboard, useBbNavigate, useComposers, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ActionValue } from "../core/evaluate";
import { IrisError } from "../core/evaluate";
import type { CardRuntime } from "../core/program";
import type { RpcContract } from "../shared/rpc";
import type { Palette } from "./palette";

export type IrisMode = "fence" | "picker" | "gallery" | "panel";

export interface IrisEnv {
  runtime: CardRuntime;
  palette: Palette;
  mode: IrisMode;
  threadId: string | null;
  /** The whole block's source, for "view source" and error context. */
  source: string;
  streaming: boolean;
  /** Runs a handler value (function, action, or list) from a click. */
  run(handler: unknown, args?: unknown[]): void;
  /** Runs actions that are already built. */
  perform(actions: ActionValue[]): void;
  /** Only in a waiting picker: answers the agent. */
  submit?: (value: unknown) => void;
  /** Reports an error to the person, with a way to hand it to the agent. */
  report(error: unknown, where?: string): void;
}

export const EnvContext = createContext<IrisEnv | null>(null);

export function useEnv(): IrisEnv {
  const env = useContext(EnvContext);
  if (!env) throw new Error("Iris component outside a card");
  return env;
}

export interface ThreadFiles {
  environmentId: string | null;
  hostId: string | null;
  workspacePath: string | null;
  storagePath: string | null;
}

const threadInfoCache = new Map<string, Promise<ThreadFiles>>();

/** Builds the action runner for one card. */
export function useActions(opts: {
  runtime: CardRuntime;
  threadId: string | null;
  submit?: (value: unknown) => void;
}): Pick<IrisEnv, "run" | "perform" | "report"> {
  const composers = useComposers();
  const navigate = useBbNavigate();
  const rpc = useRpc<RpcContract>();
  const ref = useRef({ composers, navigate, rpc, ...opts });
  ref.current = { composers, navigate, rpc, ...opts };

  const composer = useCallback(() => {
    const { composers, threadId } = ref.current;
    return composers.find((c) => c.scope.kind === "thread" && c.scope.threadId === threadId) ?? composers.find((c) => c.scope.kind === "thread") ?? null;
  }, []);

  const threadFiles = useCallback((): Promise<ThreadFiles> | null => {
    const { threadId, rpc } = ref.current;
    if (!threadId) return null;
    let p = threadInfoCache.get(threadId);
    if (!p) {
      p = rpc.call("thread_info", { threadId });
      threadInfoCache.set(threadId, p);
      p.catch(() => threadInfoCache.delete(threadId));
    }
    return p;
  }, []);

  const openFile = useCallback(
    async (path: string, line: number | null) => {
      const { threadId, navigate } = ref.current;
      if (/^https:\/\//.test(path)) {
        navigate.openUrl(path);
        return;
      }
      const files = await threadFiles();
      if (!files || !threadId) throw new IrisError("Files open only inside a thread");
      const location = line ? ({ kind: "line", line, column: null } as const) : null;
      if (path.startsWith("$BB_THREAD_STORAGE/") || (files.storagePath && path.startsWith(`${files.storagePath}/`))) {
        const rel = path.startsWith("$BB_THREAD_STORAGE/") ? path.slice("$BB_THREAD_STORAGE/".length) : path.slice(files.storagePath!.length + 1);
        navigate.experimental_openFilePreview({ target: { kind: "thread-storage", threadId, path: rel }, location });
        return;
      }
      if (files.environmentId) {
        const rel = files.workspacePath && path.startsWith(`${files.workspacePath}/`) ? path.slice(files.workspacePath.length + 1) : path;
        navigate.experimental_openFilePreview({ target: { kind: "workspace", environmentId: files.environmentId, path: rel }, location });
        return;
      }
      if (files.hostId && path.startsWith("/")) {
        navigate.experimental_openFilePreview({ target: { kind: "host", hostId: files.hostId, path }, location });
        return;
      }
      throw new IrisError(`Can't open ${path} here`);
    },
    [threadFiles],
  );

  const report = useCallback(
    (error: unknown, where?: string) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(where ? `${where}: ${message}` : message, {
        action: {
          label: "Ask to fix",
          onClick: () => {
            const c = composer();
            c?.insert(`The Iris card failed${where ? ` (${where})` : ""}: ${message}. Please fix the block.`, { at: "end", block: true });
            c?.focus();
          },
        },
      });
    },
    [composer],
  );

  const perform = useCallback(
    (actions: ActionValue[]) => {
      const { runtime } = ref.current;
      for (const a of actions) {
        const run = async () => {
          switch (a.kind) {
            case "insert": {
              const c = composer();
              if (!c) throw new IrisError("There's no composer to write into here");
              c.insert(String(a.args[0] ?? ""), { at: "end", block: true });
              c.focus();
              return;
            }
            case "send": {
              const c = composer();
              if (!c) throw new IrisError("There's no composer to send from here");
              c.replace({ text: String(a.args[0] ?? ""), mentions: [] });
              await c.submit();
              return;
            }
            case "explain": {
              const c = composer();
              if (!c) return;
              c.insert(`Explain ${String(a.args[0] ?? "this")} in more detail.`, { at: "end", block: true });
              c.focus();
              return;
            }
            case "copy": {
              const ok = await experimental_copyToClipboard({ text: String(a.args[0] ?? "") });
              if (ok) toast.success("Copied");
              return;
            }
            case "openUrl": {
              const url = String(a.args[0] ?? "");
              if (!/^https:\/\//.test(url)) throw new IrisError(`Only https links open: ${url}`);
              ref.current.navigate.openUrl(url);
              return;
            }
            case "openFile":
              await openFile(String(a.args[0] ?? ""), (a.args[1] as number | null) ?? null);
              return;
            case "set":
              runtime.setState(String(a.args[0]), a.args[1]);
              return;
            case "toggle":
              runtime.setState(String(a.args[0]), !runtime.getState(String(a.args[0])));
              return;
            case "submit": {
              const submit = ref.current.submit;
              if (!submit) throw new IrisError("submit() works only inside an iris_ask picker");
              submit(a.args.length ? a.args[0] : runtime.answers());
              return;
            }
          }
        };
        run().catch((e) => report(e, a.kind));
      }
    },
    [composer, openFile, report],
  );

  const run = useCallback(
    (handler: unknown, args: unknown[] = []) => {
      try {
        ref.current.runtime.interp.steps = 0;
        perform(ref.current.runtime.interp.runHandler(handler, args));
      } catch (e) {
        report(e);
      }
    },
    [perform, report],
  );

  return useMemo(() => ({ run, perform, report }), [run, perform, report]);
}
