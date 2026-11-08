// A pinned card's alert condition, decided the way the card itself would see it: the card's
// source compiled, its loads answered from what was read for it, and the condition evaluated in
// the card's scope (its lets, states and loaded values).
import { IrisError, isPendingValue } from "./evaluate";
import { parseExpression } from "./parse";
import { CardRuntime, compile, type LoadResult } from "./program";

export type AlertCheck = { ok: true; held: boolean | null } | { ok: false; error: string };

/** The condition's parse error, or null when it parses. */
export function alertSyntaxError(when: string): string | null {
  try {
    parseExpression(when);
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)) || "the condition is incomplete";
  }
}

/**
 * Whether the condition holds for the card. held is null while something it reads is still
 * loading, so a slow source never fires or clears an alert.
 */
export function checkAlert(source: string, when: string, preloaded: Map<string, LoadResult>): AlertCheck {
  const program = compile(source);
  if (program.error) return { ok: false, error: program.error.message };
  let expr;
  try {
    expr = parseExpression(when);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Loads not read ahead stay pending: this check never waits on the network. A pending value
  // compared with something reads as false, so any read of one leaves the alert undecided.
  let waiting = false;
  const runtime = new CardRuntime(program, {
    preloaded,
    load: () => {
      waiting = true;
      return new Promise<LoadResult>(() => undefined);
    },
  });
  try {
    const value = runtime.interp.eval(expr, runtime.globals);
    if (waiting || isPendingValue(value)) return { ok: true, held: null };
    return { ok: true, held: Boolean(value) };
  } catch (e) {
    // A load that failed reads as an error here: undecided, like a pending one.
    if (e instanceof IrisError && /load\(/.test(e.message)) return { ok: true, held: null };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
