import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { CATALOG } from "../core/catalog";
import { referenceSections, SECTION_LIMIT } from "../core/prompt";
import { applyMemory, arrangement, contents, edgePoint, groupOf, layoutBoard, normalizeBoard, pinned, placeBoxes, withoutItem } from "../core/board";
import { flattenJson, parseDotStrings, parsePo, placeholders, readLocaleFile, readStrings, reviewStrings } from "../core/l10n";

describe("Whiteboard", () => {
  const raw = [
    { id: "now", type: "group", text: "Now" },
    { id: "later", type: "group", title: "Later" },
    { id: "a", text: "Sync", in: "now" },
    { id: "b", text: "Login", in: "now" },
    { id: "c", text: "Themes", in: "later" },
    "Loose idea",
    { id: "t", type: "text", text: "Q3", at: [0, -80] },
  ];

  it("reads items and arrows and reports what's wrong", () => {
    const { items, arrows, problems } = normalizeBoard(
      [...raw, { id: "a", text: "dup" }, { type: "shape" }, { id: "x", in: "nowhere" }],
      [["a", "b", "unblocks"], { from: "a", to: "zz" }, { from: "b", to: "c", dashed: true }],
    );
    expect(items.map((i) => i.id)).toEqual(["now", "later", "a", "b", "c", "note-6", "t", "x"]);
    expect(items[1].text).toBe("Later");
    expect(arrows).toEqual([
      { from: "a", to: "b", label: "unblocks", dashed: false },
      { from: "b", to: "c", label: null, dashed: true },
    ]);
    expect(problems).toEqual(['Item 8: id "a" is used twice', "Item 9: type must be note, text or group", 'x: no group "nowhere"', 'Arrow 2: no item "zz"']);
  });

  it("lays out groups in a row with their notes inside, loose items below", () => {
    const { items } = normalizeBoard(raw, []);
    const boxes = layoutBoard(items);
    expect(boxes.now.x).toBe(0);
    expect(boxes.later.x).toBeGreaterThan(boxes.now.x + boxes.now.w);
    expect(groupOf("a", items, boxes)).toBe("now");
    expect(groupOf("c", items, boxes)).toBe("later");
    expect(groupOf("note-6", items, boxes)).toBeNull();
    expect(boxes["note-6"].y).toBeGreaterThan(boxes.now.y + boxes.now.h);
    expect(boxes.t).toMatchObject({ x: 0, y: -80 });
    expect(contents("now", items, boxes).sort()).toEqual(["a", "b"]);
  });

  it("answers with groups in reading order after a move, and keeps edits", () => {
    const { items } = normalizeBoard(raw, []);
    const before = layoutBoard(items);
    const memory = {
      at: { a: [before.later.x + 20, before.later.y + 100] as [number, number] },
      text: { b: "Passkeys" },
      added: [{ id: "note-9", text: "New", at: [before.later.x + 20, before.later.y + 44] as [number, number] }],
      removed: ["note-6"],
    };
    const now = applyMemory(items, memory);
    const boxes = placeBoxes(now, memory);
    const a = arrangement(now, boxes, true);
    expect(a.groups).toEqual({ now: ["b"], later: ["c", "note-9", "a"] });
    expect(a.loose).toEqual(["t"]);
    expect(a.text?.b).toBe("Passkeys");
    expect(a.at.a).toEqual(memory.at.a);
  });

  it("keeps placed notes in their group when another group grows", () => {
    const { items } = normalizeBoard([{ id: "now", type: "group" }, { id: "later", type: "group" }, { id: "a", in: "now" }, { id: "c", in: "later" }, { id: "d", in: "later" }], []);
    const laid = layoutBoard(items);
    let memory = pinned(items, { at: { c: [laid.c.x, laid.c.y + 8] } }, laid);
    const grown = { ...memory, size: { now: [laid.now.w + 300, laid.now.h] as [number, number] } };
    memory = pinned(items, grown, placeBoxes(items, memory));
    const boxes = placeBoxes(applyMemory(items, memory), memory);
    expect(arrangement(items, boxes).groups).toEqual({ now: ["a"], later: ["c", "d"] });
  });

  it("forgets a deleted note it added, so the next one starts clean", () => {
    const memory = { added: [{ id: "note-1", text: "", at: [500, 500] as [number, number] }], text: { "note-1": "Old idea" }, at: { "note-1": [900, 900] as [number, number] } };
    const after = withoutItem(memory, "note-1");
    expect(after).toMatchObject({ added: [], at: {}, text: {} });
    expect(withoutItem(after, "a").removed).toEqual(["a"]);
  });

  it("starts arrows at the edge of a box", () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, [300, 25], 0)).toEqual([100, 25]);
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, [50, -200], 0)).toEqual([50, 0]);
  });
});

describe("StringsTable", () => {
  it("reads Apple .strings with comments, escapes and bare keys", () => {
    const { map, error } = parseDotStrings(`/* Title on the cart screen */\n"cart.title" = "Ihr \\"Warenkorb\\"";\n// Count\ncount = "%d Artikel\\n";\n"emoji" = "\\U2764";`);
    expect(error).toBeNull();
    expect(map.get("cart.title")).toEqual({ value: 'Ihr "Warenkorb"', comment: "Title on the cart screen" });
    expect(map.get("count")?.value).toBe("%d Artikel\n");
    expect(map.get("emoji")?.value).toBe("❤");
    expect(parseDotStrings(`"a" = "b"\n"c" = "d";`).error).toMatch(/line 1/);
  });

  it("reads .po entries: context, plurals, fuzzy, multi-line, empty", () => {
    const { map, error } = parsePo(`msgid ""\nmsgstr ""\n"Language: de\\n"\n\n#. Shown on the cart\nmsgctxt "cart"\nmsgid "Check out"\nmsgstr "Zur Kasse"\n\n#, fuzzy\nmsgid "Save"\nmsgstr "Sichern"\n\nmsgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] "%d Datei"\nmsgstr[1] ""\n"%d Dateien"\n\nmsgid "Open"\nmsgstr ""\n`);
    expect(error).toBeNull();
    expect(map.get("cart | Check out")).toMatchObject({ value: "Zur Kasse", src: "Check out", comment: "Shown on the cart" });
    expect(map.get("Save")).toMatchObject({ value: "Sichern", review: true });
    expect(map.get("%d file")).toMatchObject({ value: "%d Dateien", src: "%d files", plural: true });
    expect(map.get("Open")?.value).toBeNull();
    expect(map.has("")).toBe(false);
  });

  it("normalizes placeholders so reordering is fine and a lost one is not", () => {
    expect(placeholders("%1$@ has %2$lld items, 100% sure")).toEqual(["%@", "%d"]);
    expect(placeholders("Hi {name}, {{count}} new, {n, plural, one {# item} other {# items}}")).toEqual(["{count}", "{name}", "{n}"]);
  });

  it("flags missing, untranslated, review, placeholder and length issues per locale", () => {
    const { table, problems } = readStrings({
      en: { cart: { title: "Your cart", items: "%d items in %@" }, ok: "OK", checkout: "Check out" },
      de: `"cart.title" = "Ihr Warenkorb";\n"cart.items" = "%d Artikel";\n"ok" = "OK";\n"checkout" = "Zur Kasse gehen und dort bezahlen";`,
      fr: { cart: { title: "Your cart", items: "%d articles dans %@" } },
    });
    expect(problems).toEqual([]);
    expect(table.source).toBe("en");
    expect(table.locales).toEqual(["en", "de", "fr"]);
    const { rows, summary } = reviewStrings(table, { same: ["ok"] });
    const cell = (key: string, l: string) => rows.find((r) => r.key === key)?.cells[l].issues.map((x) => `${x.kind}: ${x.detail}`);
    expect(cell("cart.items", "de")).toEqual(["placeholders: missing %@"]);
    expect(cell("checkout", "de")?.[0]).toMatch(/^long: \+\d+% longer$/);
    expect(cell("ok", "de")).toEqual([]);
    expect(cell("cart.title", "fr")).toEqual(["untranslated: same as source"]);
    expect(cell("checkout", "fr")).toEqual(["missing: no entry"]);
    expect(summary.map((s) => [s.locale, s.translated, s.total, s.counts.missing])).toEqual([
      ["de", 4, 4, 0],
      ["fr", 1, 4, 2],
    ]);
  });

  it("reads a String Catalog with plurals, review states and keys as source text", () => {
    const { table } = readStrings({
      sourceLanguage: "en",
      strings: {
        "Hello": { localizations: { de: { stringUnit: { state: "translated", value: "Hallo" } } } },
        "%lld songs": { localizations: { de: { variations: { plural: { one: { stringUnit: { state: "translated", value: "%lld Lied" } }, other: { stringUnit: { state: "needs_review", value: "%lld Lieder" } } } } } } },
        "Skip": { shouldTranslate: false },
        "Bye": { comment: "Farewell", localizations: { ja: { stringUnit: { state: "translated", value: "さようなら" } } } },
      },
    });
    expect(table.keys).toEqual(["Hello", "%lld songs", "Bye"]);
    expect(table.locales).toEqual(["en", "de", "ja"]);
    const { rows } = reviewStrings(table);
    expect(rows[1].cells.de).toMatchObject({ value: "%lld Lieder", plural: true, issues: [{ kind: "review" }] });
    expect(rows[2].cells.de.issues.map((x) => x.kind)).toEqual(["missing"]);
    expect(rows[2].comment).toBe("Farewell");
  });

  it("uses .po msgids as the source when no source file is given", () => {
    const { table } = readStrings({ de: `msgid "Open"\nmsgstr "Öffnen"\n\nmsgid "Close"\nmsgstr ""\n` });
    expect(table.source).toBe("en");
    const { summary } = reviewStrings(table);
    expect(summary[0]).toMatchObject({ locale: "de", total: 2, translated: 1 });
  });

  it("survives hostile files: whitespace floods, odd locale names, deep nesting", () => {
    const t0 = Date.now();
    expect(readLocaleFile("\n ".repeat(200_000)).error).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    const cat = { sourceLanguage: "en", strings: { Hi: { localizations: { constructor: { stringUnit: { state: "translated", value: "x" } }, __proto__: {} } } } };
    expect(() => reviewStrings(readStrings(JSON.parse(JSON.stringify(cat).replace('"__proto__":{}', '"__proto__":{"stringUnit":{"value":"y"}}'))).table)).not.toThrow();
    const files = JSON.parse('{"en": {"a": "A"}, "__proto__": {"a": "B"}}');
    expect(readStrings(files).table.locales).toEqual(["en", "__proto__"]);
    expect(() => readStrings({ en: { a: "A" } }, { locales: ["toString"] })).not.toThrow();
    let deep: unknown = "x";
    for (let i = 0; i < 20_000; i++) deep = { k: deep };
    expect(() => flattenJson(deep)).not.toThrow();
  });

  it("reports unreadable files and unknown locales through check()", () => {
    const r = check(`<StringsTable strings={{ en: { a: "A" }, de: 42 }} locales={["de", "it"]} />`);
    expect(r.issues.map((i) => i.message)).toEqual(expect.arrayContaining([expect.stringMatching(/de: not a .strings, .po or JSON file/), expect.stringMatching(/No file for locale it/)]));
  });
});

describe("catalog", () => {
  it("has both components, with every reference section under the limit", () => {
    for (const name of ["Whiteboard", "StringsTable"]) expect(CATALOG.find((c) => c.name === name)?.heavy).toBe(true);
    for (const s of referenceSections()) expect(s.text.length).toBeLessThanOrEqual(SECTION_LIMIT);
  });

  it("flags a whiteboard arrow to nowhere in check()", () => {
    const r = check(`<Whiteboard items={[{ id: "a", text: "A" }]} arrows={[["a", "b"]]} />`);
    expect(r.issues.map((i) => i.message).join()).toMatch(/Arrow 1: no item "b"/);
  });
});
