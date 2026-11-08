import { CHARTS, CODE, DIAGRAMS, PROJECT } from "./work";
import { CONTENT, DATA, LAYOUT } from "./core";
import { INPUTS, PICKERS, PLANNING } from "./plan";
import { EVIDENCE } from "./evidence";
import { LIVE_PROJECT } from "./live";
import { DESIGN, MEDIA } from "./media";
import { DATA_EXPLORE, GRAPHS, LIVE_CARDS, MATH } from "./explore";
import { GRAPHICS, LEARNING } from "./learn";
import { API, SHEETS } from "./inspect";
import { REVIEW, TERMINAL } from "./review";
import { LOCALIZATION, WHITEBOARD } from "./board";
import { FILES, PLAYERS } from "./files";
import { COMPUTE, RELEASE, TIME } from "./tools";
import { ACCESSIBILITY, GEO } from "./interact";
import { TRACKING } from "./track";
import { AGENTS, DEBUG, DECISIONS, SCHEMA_DIFF, TEST_HISTORY, THEME_PREVIEW } from "./agents";
import type { ComponentSpec } from "./spec";

export * from "./spec";

export const CATALOG: readonly ComponentSpec[] = [...LAYOUT, ...CONTENT, ...DATA, ...CHARTS, ...DIAGRAMS, ...CODE, ...PROJECT, ...TEST_HISTORY, ...AGENTS, ...DEBUG, ...EVIDENCE, ...LIVE_PROJECT, ...PLANNING, ...DECISIONS, ...INPUTS, ...PICKERS, ...MEDIA, ...DESIGN, ...THEME_PREVIEW, ...DATA_EXPLORE, ...MATH, ...GRAPHS, ...LIVE_CARDS, ...LEARNING, ...GRAPHICS, ...SHEETS, ...API, ...SCHEMA_DIFF, ...REVIEW, ...TERMINAL, ...WHITEBOARD, ...LOCALIZATION, ...PLAYERS, ...FILES, ...COMPUTE, ...TIME, ...RELEASE, ...ACCESSIBILITY, ...GEO, ...TRACKING];

const byName = new Map<string, ComponentSpec>();
const byAlias = new Map<string, ComponentSpec>();
for (const c of CATALOG) {
  if (byName.has(c.name)) throw new Error(`Duplicate component ${c.name}`);
  byName.set(c.name, c);
}
for (const c of CATALOG) {
  for (const a of c.aliases ?? []) {
    if (byName.has(a) || byAlias.has(a)) throw new Error(`Alias ${a} of ${c.name} is taken`);
    byAlias.set(a, c);
  }
}

/** The component a tag names: exact, alias, or case-insensitive. */
export function findComponent(name: string): ComponentSpec | undefined {
  return byName.get(name) ?? byAlias.get(name) ?? [...byName.values(), ...byAlias.values()].find((c) => c.name.toLowerCase() === name.toLowerCase());
}

export const COMPONENT_NAMES = CATALOG.map((c) => c.name);
export const ALL_TAG_NAMES = [...byName.keys(), ...byAlias.keys()];

/** Tags whose content is read verbatim by the parser. */
export const RAW_TAGS = new Set(CATALOG.filter((c) => c.children === "raw").flatMap((c) => [c.name, ...(c.aliases ?? [])]));
