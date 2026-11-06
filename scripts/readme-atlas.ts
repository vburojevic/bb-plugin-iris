// Writes the README's component atlas from the catalog: every component as a real
// screenshot (docs/atlas/{dark,light}/<Name>.webp, made by scripts/capture-atlas.mjs),
// grouped by family, each linking to its live page in the playground.
//   npx tsx scripts/readme-atlas.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, GROUPS } from "../core/catalog";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYGROUND = "https://vburojevic.github.io/bb-plugin-iris/";
const COLUMNS = 3;
/** Shown open at the top: the most telling cards, each with the moment it is for. */
const HIGHLIGHTS: [string, string][] = [
  ["Acceptance", "Proof it's done"],
  ["Decision", "A decision to make"],
  ["Chart", "Data to read"],
  ["Tests", "A test run"],
  ["PullRequest", "Where the PR stands"],
  ["Plan", "A plan to approve"],
  ["Forecast", "When it will land"],
  ["Budget", "Spend against a limit"],
  ["CompareGrid", "What changed on screen"],
];

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The summary's first sentence; a long one ends at its first semicolon. A colon stays, so "A test run: counts, failures first" keeps what follows it. */
const firstSentence = (s: string) => {
  const m = /^(.+?\.)(\s|$)/.exec(s);
  let out = m ? m[1] : s;
  if (out.length > 150 && out.includes(";")) out = `${out.slice(0, out.indexOf(";"))}.`;
  return out;
};

function tile(name: string, moment?: string): string {
  const c = CATALOG.find((x) => x.name === name);
  if (!c || !existsSync(join(root, "docs", "atlas", "dark", `${name}.webp`))) return "<td></td>";
  const href = `${PLAYGROUND}#/${name}`;
  const summary = escape(firstSentence(c.summary));
  const picture = `<a href="${href}"><picture><source media="(prefers-color-scheme: light)" srcset="docs/atlas/light/${name}.webp"><img src="docs/atlas/dark/${name}.webp" alt="${escape(name)}: ${summary}" width="100%"></picture></a>`;
  const caption = moment ? `<b>${escape(moment)}</b><br><sub><a href="${href}"><code>${name}</code></a> ${summary}</sub>` : `<a href="${href}"><b>${name}</b></a><br><sub>${summary}</sub>`;
  return `<td width="${Math.floor(100 / COLUMNS)}%" valign="top">${picture}<br>${caption}</td>`;
}

function grid(names: (string | [string, string])[]): string {
  const rows: string[] = [];
  for (let i = 0; i < names.length; i += COLUMNS) {
    const cells = names.slice(i, i + COLUMNS).map((n) => (typeof n === "string" ? tile(n) : tile(n[0], n[1])));
    while (cells.length < COLUMNS) cells.push("<td></td>");
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table>\n${rows.join("\n")}\n</table>`;
}

const parts: string[] = [];
parts.push(`### The right card for the moment\n\n${grid(HIGHLIGHTS)}\n`);
parts.push(`### Every component, by family\n\nOpen a family to see each card as it renders in bb. Every picture links to its live page in the [playground](${PLAYGROUND}), with its code and every prop.\n`);
for (const g of GROUPS) {
  const names = CATALOG.filter((c) => c.group === g).map((c) => c.name);
  if (!names.length) continue;
  parts.push(`<details>\n<summary><b>${g}</b> · ${names.length} ${names.length === 1 ? "component" : "components"}: ${names.join(", ")}</summary>\n<br>\n\n${grid(names)}\n\n</details>\n`);
}

const atlas = parts.join("\n");
const readmePath = join(root, "README.md");
const readme = readFileSync(readmePath, "utf8");
const start = "<!-- atlas:start -->";
const end = "<!-- atlas:end -->";
if (!readme.includes(start) || !readme.includes(end)) throw new Error("README.md has no atlas markers");
writeFileSync(readmePath, `${readme.slice(0, readme.indexOf(start) + start.length)}\n\n${atlas}\n${readme.slice(readme.indexOf(end))}`);
console.log(`atlas: ${CATALOG.length} components in ${GROUPS.length} groups`);
