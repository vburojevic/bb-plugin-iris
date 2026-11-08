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
  alert: z.object({ when: z.string(), message: z.string().optional(), firing: z.boolean().optional(), since: z.number().optional(), seen: z.boolean().optional() }).optional(),
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
      alert: z
        .object({
          when: z.string().min(1).max(500).describe("An Iris expression over the card's own names, such as build.state == \"failed\"; when it turns true the pin asks for the person's attention"),
          message: z.string().min(1).max(200).optional().describe("What the alert says; default the card's title"),
        })
        .optional(),
    }),
    output: z.union([z.object({ ok: z.literal(true), pin, replaced: z.boolean(), report: z.string() }), z.object({ ok: z.literal(false), error: z.string() })]),
  },
  "pins.all": {
    experimental_description: "Every open thread's pinned cards, the most recently pinned thread first: thread id, title, project id and its pins.",
    input: z.object({}),
    output: z.object({ threads: z.array(z.object({ threadId: z.string(), title: z.string(), projectId: z.string().nullable(), pins: z.array(pin) })) }),
  },
  "pins.ack": {
    experimental_description: "Dismisses a pin's alert by id, or every alert in the thread without an id. It asks again only after its condition clears and holds again.",
    input: z.object({ threadId, id: z.string().min(1).max(40).optional() }),
    output: z.object({ ok: z.boolean(), acked: z.array(z.string()) }),
  },
  "pins.remove": {
    experimental_description: "Unpins one card by id, or every card with all: true.",
    input: z.object({ threadId, id: z.string().min(1).max(40).optional(), all: z.boolean().optional() }),
    output: z.object({ ok: z.boolean(), removed: z.array(z.string()) }),
  },
});

export type PinsContract = typeof pinsContract;

const card = z.object({ n: z.number(), message: z.string(), index: z.number(), language: z.string(), title: z.string(), inputs: z.record(z.string(), z.unknown()) });

/** The thread's own Iris cards and what the person set in each, and the agent setting them. */
export const cardsContract = defineRpcContract({
  "cards.list": {
    experimental_description: "The thread's Iris cards, newest last: message id, block index, title, language, and the inputs the person set in each (sliders, choices, text, stored values).",
    input: z.object({ threadId }),
    output: z.object({
      cards: z.array(card),
    }),
  },
  "cards.set": {
    experimental_description:
      "Sets inputs in one of the thread's ```iris cards by its n from cards.list: values by <state> name, each keeping its type. The card is checked with them first (refused with the report on errors); open views redraw with the new values.",
    input: z.object({ threadId, card: z.number().int().min(1), values: z.record(z.string(), z.unknown()) }),
    output: z.union([z.object({ ok: z.literal(true), card, changed: z.array(z.string()), report: z.string() }), z.object({ ok: z.literal(false), error: z.string() })]),
  },
});
