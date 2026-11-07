// Pinned cards over RPC: discoverable, so `bb plugin rpc list iris` shows them and any client
// (the app, the bb CLI, another plugin) can read and change a thread's pins. Agents in a thread
// use the iris_pin tools or `bb iris pin`, which act on their own thread only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Pin } from "../core/pins";

const threadId = z.string().min(1).max(64);
// A plain schema (not a custom type), so bb can publish it as JSON Schema for discovery.
const pin: z.ZodType<Pin> = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().optional(),
  file: z.string().optional(),
  by: z.enum(["agent", "person"]),
  at: z.number(),
});

export const pinsContract = defineRpcContract({
  "pins.list": {
    experimental_description: "The thread's pinned cards: id, title, source or file, who pinned it and when.",
    input: z.object({ threadId }),
    output: z.object({ pins: z.array(pin) }),
  },
  "pins.set": {
    experimental_description:
      "Pins a card beside the thread's conversation, or replaces the pin with the same id: give source (Iris markup) or file (a workspace or thread storage path whose content is the card, re-read while it shows). The card is checked first; a card with errors is refused with the check's report.",
    input: z.object({
      threadId,
      id: z.string().min(1).max(40).optional(),
      title: z.string().min(1).max(120).optional(),
      source: z.string().min(1).max(100_000).optional(),
      file: z.string().min(1).max(2000).optional(),
      by: z.enum(["agent", "person"]).optional(),
    }),
    output: z.union([z.object({ ok: z.literal(true), pin, replaced: z.boolean(), report: z.string() }), z.object({ ok: z.literal(false), error: z.string() })]),
  },
  "pins.remove": {
    experimental_description: "Unpins one card by id, or every card with all: true.",
    input: z.object({ threadId, id: z.string().min(1).max(40).optional(), all: z.boolean().optional() }),
    output: z.object({ ok: z.boolean(), removed: z.array(z.string()) }),
  },
});

export type PinsContract = typeof pinsContract;
