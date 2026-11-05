#!/usr/bin/env node
// Builds GeoHeatmap's boundaries: compact SVG paths for the world's countries
// (Natural Earth 1:110m through world-atlas, Equal Earth projection, no
// Antarctica) and the US states (Census through us-atlas, Albers USA with
// Alaska and Hawaii inset), plus core/geo-regions.ts with the codes and names
// that rows match against. Run after changing a source package, then
// node scripts/build-chunks.mjs, and commit assets/geo/ and core/geo-regions.ts.
import { geoEqualEarth, geoIdentity, geoPath } from "d3-geo";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iso = require("iso-3166-1");

// Short display names where world-atlas abbreviates; extra names people write.
const DISPLAY = {
  "United States of America": "United States", "Dem. Rep. Congo": "DR Congo", "Dominican Rep.": "Dominican Republic", "W. Sahara": "Western Sahara",
  "Falkland Is.": "Falkland Islands", "Fr. S. Antarctic Lands": "French Southern Lands", "Central African Rep.": "Central African Republic",
  "Eq. Guinea": "Equatorial Guinea", eSwatini: "Eswatini", "Solomon Is.": "Solomon Islands", "Bosnia and Herz.": "Bosnia and Herzegovina",
  "S. Sudan": "South Sudan", "N. Cyprus": "Northern Cyprus",
};
const EXTRA = {
  US: ["USA", "America", "United States of America"], GB: ["UK", "Great Britain", "Britain"], CD: ["DRC", "Democratic Republic of the Congo", "Congo-Kinshasa"],
  CG: ["Republic of the Congo", "Congo-Brazzaville"], CI: ["Ivory Coast", "Cote d'Ivoire"], CZ: ["Czech Republic"], SZ: ["Swaziland"], TR: ["Turkey", "Türkiye"],
  MK: ["Macedonia"], KR: ["Korea"], RU: ["Russian Federation"], NL: ["Holland"], MM: ["Burma"], CV: ["Cape Verde"], TL: ["East Timor"], VA: ["Holy See"],
};
const MANUAL = { Kosovo: { a2: "XK", a3: "XKX" } };

const num = (v) => Math.round(v * 10) / 10;

/** Integer SVG paths in relative moves (m, l, z): about half the size of d3's absolute ones. */
function paths(features, projection) {
  const path = geoPath(projection).digits(1);
  return features.map((f) => compact(path(f) ?? ""));
}

function compact(d) {
  let out = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const [, cmd, args] of d.matchAll(/([MLZ])([^MLZ]*)/g)) {
    if (cmd === "Z") {
      // After z the pen is back at the subpath's start; the next m is relative to it.
      out += "z";
      x = sx;
      y = sy;
      continue;
    }
    const [ax, ay] = args.split(",").map((v) => Math.round(Number(v)));
    const dx = ax - x;
    const dy = ay - y;
    if (cmd === "L" && dx === 0 && dy === 0) continue;
    out += `${cmd === "M" ? "m" : out.endsWith("l") || /[\d]$/.test(out) && !out.endsWith("z") ? " " : "l"}${dx}${dy < 0 ? dy : ` ${dy}`}`;
    if (cmd === "M") (out += "l"), (sx = ax), (sy = ay);
    x = ax;
    y = ay;
  }
  // "m3 4l" followed by a number reads as an implicit lineto; tidy empty "l" before z or m.
  return out.replace(/l(?=z|m|$)/g, "").replace(/l /g, "l").replace(/ -/g, "-");
}

// ---- World ----
const world = require("world-atlas/countries-110m.json");
const byNum = new Map(iso.all().map((c) => [c.numeric, c]));
const countries = feature(world, world.objects.countries).features.filter((f) => f.properties.name !== "Antarctica");
const W = 960;
const proj = geoEqualEarth().fitWidth(W, { type: "FeatureCollection", features: countries });
const wb = geoPath(proj).bounds({ type: "FeatureCollection", features: countries });
proj.translate([proj.translate()[0] - wb[0][0], proj.translate()[1] - wb[0][1]]);
const H = Math.ceil(wb[1][1] - wb[0][1]);
const worldD = paths(countries, proj);
const worldRegions = countries.map((f, k) => {
  const c = byNum.get(f.id);
  const raw = f.properties.name;
  const name = DISPLAY[raw] ?? raw;
  const m = MANUAL[raw];
  const a2 = c?.alpha2 ?? m?.a2 ?? "";
  const names = [...new Set([raw, c?.country, ...(EXTRA[a2] ?? [])].filter((n) => n && n !== name))];
  return { id: a2 || `#${name}`, a2, a3: c?.alpha3 ?? m?.a3 ?? "", n: f.id ?? "", name, names, d: worldD[k] };
});

// ---- US states ----
const usTopo = presimplify(require("us-atlas/states-albers-10m.json"));
const us = simplify(usTopo, 0.6);
const states = feature(us, us.objects.states).features;
const USPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", 10: "DE", 11: "DC", 12: "FL", 13: "GA", 15: "HI", 16: "ID", 17: "IL", 18: "IN", 19: "IA", 20: "KS", 21: "KY", 22: "LA", 23: "ME", 24: "MD", 25: "MA", 26: "MI", 27: "MN", 28: "MS", 29: "MO", 30: "MT", 31: "NE", 32: "NV", 33: "NH", 34: "NJ", 35: "NM", 36: "NY", 37: "NC", 38: "ND", 39: "OH", 40: "OK", 41: "OR", 42: "PA", 44: "RI", 45: "SC", 46: "SD", 47: "TN", 48: "TX", 49: "UT", 50: "VT", 51: "VA", 53: "WA", 54: "WV", 55: "WI", 56: "WY", 72: "PR" };
const idProj = geoIdentity();
const sb = geoPath(idProj).bounds({ type: "FeatureCollection", features: states });
idProj.translate([-Math.floor(sb[0][0]) + 2, -Math.floor(sb[0][1]) + 2]);
const usD = paths(states, idProj);
const usRegions = states.map((f, k) => {
  const a2 = USPS[f.id] ?? "";
  if (!a2) throw new Error(`no postal code for state ${f.id} ${f.properties.name}`);
  return { id: a2, a2, a3: "", n: f.id, name: f.properties.name, names: a2 === "DC" ? ["Washington DC", "Washington, D.C."] : [], d: usD[k] };
});
const usW = Math.ceil(sb[1][0] - sb[0][0]) + 4;
const usH = Math.ceil(sb[1][1] - sb[0][1]) + 4;

const drawn = new Set(worldRegions.map((r) => r.a2));
const undrawn = iso.all().filter((c) => !drawn.has(c.alpha2)).map((c) => [c.alpha2, c.alpha3, c.numeric, c.country.replace(/ \(.*\)$/, "")]).sort((a, b) => a[3].localeCompare(b[3]));

// ---- Write ----
const shapes = (w, h, regions) => ({ w, h, d: Object.fromEntries(regions.map((r) => [r.id, r.d])) });
await writeFile(join(root, "assets/geo/world.json"), JSON.stringify(shapes(W, H, worldRegions)));
await writeFile(join(root, "assets/geo/us.json"), JSON.stringify(shapes(usW, usH, usRegions)));
const table = (regions) => regions.map(({ d, ...r }) => [r.id, r.a3, r.n, r.name, ...r.names]).sort((a, b) => a[3].localeCompare(b[3]));
await writeFile(
  join(root, "core/geo-regions.ts"),
  `// Generated by scripts/build-geo.mjs from world-atlas (Natural Earth, public domain),
// us-atlas (US Census, public domain) and iso-3166-1 names. Do not edit by hand.
// Each region: [id (ISO alpha-2 or USPS code), alpha-3, numeric, display name, ...other names].
export type RegionRow = readonly string[];
export const WORLD_REGIONS: readonly RegionRow[] = ${JSON.stringify(table(worldRegions))};
export const US_REGIONS: readonly RegionRow[] = ${JSON.stringify(table(usRegions))};
/** Real countries and territories too small for the 1:110m map: they match, and show in the table only. */
export const WORLD_UNDRAWN: readonly RegionRow[] = ${JSON.stringify(undrawn)};
`,
);
console.log({ world: { regions: worldRegions.length, w: W, h: H, bytes: JSON.stringify(shapes(W, H, worldRegions)).length }, us: { regions: usRegions.length, w: usW, h: usH, bytes: JSON.stringify(shapes(usW, usH, usRegions)).length } });
void num;
