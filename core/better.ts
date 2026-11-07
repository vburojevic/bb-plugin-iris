// Which way is good. Agents write it many ways (Benchmark itself says "lower"), so every component
// with a `better` prop reads the same words the same way.

const UP = new Set(["up", "higher", "high", "more", "increase", "bigger", "larger"]);
const DOWN = new Set(["down", "lower", "low", "less", "decrease", "smaller", "fewer"]);

/** "up", "down" or "none" from any of the words people use, else undefined. */
export function betterWay(v: unknown): "up" | "down" | "none" | undefined {
  if (typeof v !== "string") return undefined;
  const w = v.trim().toLowerCase();
  return UP.has(w) ? "up" : DOWN.has(w) ? "down" : w === "none" ? "none" : undefined;
}
