// Reads what FontPreview shows from a font file: names, metrics, the code
// points it covers (cmap) and its variation axes (fvar). TrueType, OpenType
// and collections are read directly; WOFF and WOFF2 tables come in already
// decompressed (chunks/files.tsx inflates them with DecompressionStream).

export interface FontAxis {
  tag: string;
  name: string;
  min: number;
  def: number;
  max: number;
}

export interface FontInfo {
  format: "TrueType" | "OpenType" | "WOFF" | "WOFF2" | "Collection";
  family: string | null;
  style: string | null;
  fullName: string | null;
  version: string | null;
  designer: string | null;
  glyphs: number | null;
  unitsPerEm: number | null;
  ascender: number | null;
  descender: number | null;
  capHeight: number | null;
  xHeight: number | null;
  /** Code points the cmap maps, sorted; null when there is no readable cmap. */
  codepoints: number[] | null;
  axes: FontAxis[];
}

export type TableGetter = (tag: string) => DataView | null;

const tagAt = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function fontSignature(bytes: Uint8Array): "sfnt" | "otto" | "ttcf" | "woff" | "woff2" | null {
  if (bytes.length < 12) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = tagAt(v, 0);
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  if (tag === "ttcf") return "ttcf";
  if (tag === "OTTO") return "otto";
  if (v.getUint32(0) === 0x00010000 || tag === "true") return "sfnt";
  return null;
}

/** Tables of a plain sfnt starting at `start` (0, or a collection's first font). */
export function sfntTables(bytes: Uint8Array, start = 0): TableGetter {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint16(start + 4);
  const map = new Map<string, DataView>();
  for (let i = 0; i < count; i++) {
    const rec = start + 12 + i * 16;
    if (rec + 16 > bytes.length) break;
    const offset = v.getUint32(rec + 8);
    const length = v.getUint32(rec + 12);
    if (offset + length <= bytes.length) map.set(tagAt(v, rec), new DataView(bytes.buffer, bytes.byteOffset + offset, length));
  }
  return (tag) => map.get(tag) ?? null;
}

/** The first font of a collection starts at the first offset in its header. */
export function collectionStart(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(12);
}

export interface PackedTable {
  tag: string;
  offset: number;
  compLength: number;
  origLength: number;
}

/** A WOFF file's table directory; a table with compLength < origLength is zlib-compressed. */
export function woffDirectory(bytes: Uint8Array): PackedTable[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint16(12);
  const out: PackedTable[] = [];
  for (let i = 0; i < count; i++) {
    const rec = 44 + i * 20;
    if (rec + 20 > bytes.length) break;
    out.push({ tag: tagAt(v, rec), offset: v.getUint32(rec + 4), compLength: v.getUint32(rec + 8), origLength: v.getUint32(rec + 12) });
  }
  return out;
}

const WOFF2_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
).match(/.{4}\s?/g)!.map((t) => t.slice(0, 4));

export interface Woff2Directory {
  /** Where the brotli stream starts and how long it is. */
  dataOffset: number;
  compressedLength: number;
  /** Each table's place in the decompressed stream; transformed glyf, loca and hmtx are skipped (not needed here). */
  tables: { tag: string; offset: number; length: number; transformed: boolean }[];
}

/** A WOFF2 file's directory (UIntBase128 lengths, known-tag flags). */
export function woff2Directory(bytes: Uint8Array): Woff2Directory | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint16(12);
  const compressedLength = v.getUint32(20);
  let p = 48;
  const base128 = () => {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      if (p >= bytes.length) return null;
      const b = v.getUint8(p++);
      n = n * 128 + (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    return null;
  };
  const tables: Woff2Directory["tables"] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (p >= bytes.length) return null;
    const flags = v.getUint8(p++);
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      if (p + 4 > bytes.length) return null;
      tag = tagAt(v, p);
      p += 4;
    }
    const version = (flags >> 6) & 3;
    const orig = base128();
    if (orig === null) return null;
    // glyf and loca are transformed unless version is 3; every other table only when version isn't 0.
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    let length = orig;
    if (transformed) {
      const t = base128();
      if (t === null) return null;
      length = t;
    }
    tables.push({ tag, offset, length, transformed });
    offset += length;
  }
  return { dataOffset: p, compressedLength, tables };
}

/** A getter over tables that were unpacked into a Map. */
export function mapTables(map: Map<string, Uint8Array>): TableGetter {
  return (tag) => {
    const b = map.get(tag);
    return b ? new DataView(b.buffer, b.byteOffset, b.byteLength) : null;
  };
}

function readNames(t: DataView | null): Map<number, string> {
  const out = new Map<number, string>();
  if (!t || t.byteLength < 6) return out;
  const count = t.getUint16(2);
  const storage = t.getUint16(4);
  // Windows English first, then any Windows or Unicode record, then Mac Roman.
  const rank = (platform: number, lang: number) => (platform === 3 && lang === 0x409 ? 0 : platform === 3 || platform === 0 ? 1 : platform === 1 && lang === 0 ? 2 : 9);
  const best = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > t.byteLength) break;
    const platform = t.getUint16(r);
    const encoding = t.getUint16(r + 2);
    const lang = t.getUint16(r + 4);
    const id = t.getUint16(r + 6);
    const len = t.getUint16(r + 8);
    const off = storage + t.getUint16(r + 10);
    const score = rank(platform, lang);
    if (score === 9 || (best.get(id) ?? 99) <= score || off + len > t.byteLength) continue;
    let s = "";
    if (platform === 1 && encoding === 0) for (let k = 0; k < len; k++) s += String.fromCharCode(t.getUint8(off + k));
    else for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(t.getUint16(off + k));
    s = s.replace(/\0/g, "").trim();
    if (!s) continue;
    best.set(id, score);
    out.set(id, s);
  }
  return out;
}

function readCmap(t: DataView | null, limit: number): number[] | null {
  if (!t || t.byteLength < 4) return null;
  const count = t.getUint16(2);
  let pick: { offset: number; score: number } | null = null;
  for (let i = 0; i < count; i++) {
    const r = 4 + i * 8;
    if (r + 8 > t.byteLength) break;
    const platform = t.getUint16(r);
    const encoding = t.getUint16(r + 2);
    const offset = t.getUint32(r + 4);
    if (offset + 2 > t.byteLength) continue;
    const format = t.getUint16(offset);
    const score = format === 12 && (platform === 3 || platform === 0) ? 0 : format === 4 && ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) ? 1 : 9;
    if (score < 9 && (!pick || score < pick.score)) pick = { offset, score };
  }
  if (!pick) return null;
  const o = pick.offset;
  const set = new Set<number>();
  if (t.getUint16(o) === 4) {
    const segs = t.getUint16(o + 6) / 2;
    const ends = o + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs && set.size < limit; s++) {
      const end = t.getUint16(ends + s * 2);
      const start = t.getUint16(starts + s * 2);
      const delta = t.getInt16(deltas + s * 2);
      const rangeOffset = t.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff && set.size < limit; c++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + rangeOffset + (c - start) * 2;
          glyph = at + 2 <= t.byteLength ? t.getUint16(at) : 0;
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) set.add(c);
      }
    }
  } else {
    const groups = t.getUint32(o + 12);
    for (let g = 0; g < groups && set.size < limit; g++) {
      const r = o + 16 + g * 12;
      if (r + 12 > t.byteLength) break;
      const start = t.getUint32(r);
      const end = Math.min(t.getUint32(r + 4), 0x10ffff);
      const glyph = t.getUint32(r + 8);
      for (let c = start; c <= end && set.size < limit; c++) if (glyph + (c - start) > 0) set.add(c);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function readAxes(t: DataView | null, names: Map<number, string>): FontAxis[] {
  if (!t || t.byteLength < 16) return [];
  const axesOffset = t.getUint16(4);
  const count = t.getUint16(8);
  const size = t.getUint16(10);
  const fixed = (o: number) => t.getInt32(o) / 65536;
  const out: FontAxis[] = [];
  const KNOWN: Record<string, string> = { wght: "Weight", wdth: "Width", ital: "Italic", slnt: "Slant", opsz: "Optical size" };
  for (let i = 0; i < count; i++) {
    const o = axesOffset + i * size;
    if (o + 20 > t.byteLength) break;
    const tag = tagAt(t, o);
    out.push({ tag, min: fixed(o + 4), def: fixed(o + 8), max: fixed(o + 12), name: names.get(t.getUint16(o + 18)) ?? KNOWN[tag] ?? tag });
  }
  return out;
}

/** Everything FontPreview shows, from the font's tables. */
export function readFont(get: TableGetter, format: FontInfo["format"], codepointLimit = 70_000): FontInfo {
  const names = readNames(get("name"));
  const maxp = get("maxp");
  const head = get("head");
  const hhea = get("hhea");
  const os2 = get("OS/2");
  const safe = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  return {
    format,
    family: names.get(16) ?? names.get(1) ?? null,
    style: names.get(17) ?? names.get(2) ?? null,
    fullName: names.get(4) ?? null,
    version: names.get(5)?.replace(/^Version\s*/i, "") ?? null,
    designer: names.get(9) ?? null,
    glyphs: maxp && maxp.byteLength >= 6 ? maxp.getUint16(4) : null,
    unitsPerEm: head && head.byteLength >= 20 ? head.getUint16(18) : null,
    ascender: hhea && hhea.byteLength >= 8 ? hhea.getInt16(4) : null,
    descender: hhea && hhea.byteLength >= 8 ? hhea.getInt16(6) : null,
    xHeight: os2 && os2.byteLength >= 90 && os2.getUint16(0) >= 2 ? os2.getInt16(86) : null,
    capHeight: os2 && os2.byteLength >= 90 && os2.getUint16(0) >= 2 ? os2.getInt16(88) : null,
    codepoints: safe(() => readCmap(get("cmap"), codepointLimit)),
    axes: safe(() => readAxes(get("fvar"), names)) ?? [],
  };
}

/** Space, controls and other invisible code points are left out of the glyph grid. */
export function visibleCodepoint(c: number): boolean {
  return !(c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0xad || (c >= 0x2000 && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0xfeff || (c >= 0xe0000 && c <= 0xe007f));
}

export function hexCode(c: number): string {
  return `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Characters the browser can probe when the cmap can't be read (WOFF2 without brotli). */
export const PROBE_RANGES: [number, number][] = [
  [0x21, 0x7e],
  [0xa1, 0x17f],
  [0x370, 0x3ff],
  [0x400, 0x45f],
  [0x2010, 0x2044],
  [0x20a0, 0x20bf],
  [0x2190, 0x21ff],
];
