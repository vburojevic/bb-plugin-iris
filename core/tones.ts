// Tone names agents reach for naturally ("warning", "success", "danger") mean the same as
// Iris's five tones, so they're read as those instead of failing the card.
export const TONES = ["neutral", "info", "good", "warn", "bad"] as const;
export type ToneName = (typeof TONES)[number];

const ALIASES: Record<string, ToneName> = {
  warning: "warn", caution: "warn", attention: "warn", pending: "warn",
  error: "bad", danger: "bad", destructive: "bad", critical: "bad", failure: "bad", failed: "bad", negative: "bad",
  success: "good", ok: "good", passed: "good", positive: "good", done: "good",
  information: "info", note: "info", primary: "info", accent: "info",
  default: "neutral", muted: "neutral", gray: "neutral", grey: "neutral", secondary: "neutral",
};

/** One of the five tones, or undefined; synonyms map to their tone. */
export function normalizeTone(v: unknown): ToneName | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  return (TONES as readonly string[]).includes(t) ? (t as ToneName) : ALIASES[t];
}
