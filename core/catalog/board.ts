// Whiteboard (a freeform canvas of notes, groups, text and arrows) and
// localization review (StringsTable). Both views load on demand.
import { component, p } from "./spec";

const COLORS = "a tone (good, warn, bad, info) when it means one, or accent to mark it; default theme surfaces, notes take their group's";

export const WHITEBOARD = [
  component({
    name: "Whiteboard",
    group: "Whiteboard",
    summary:
      "A freeform canvas of sticky notes, groups, text and arrows. People drag items (a group carries what sits in it), pan by dragging the background, zoom with pinch or ⌘-scroll. Moves are saved with the card. Items without at are laid out for you: groups in a row, their notes inside.",
    props: {
      items: p.list(`type note (default), text or group. in puts a note in a group. at [x,y] and size [w,h] in px are optional. color: ${COLORS}`, "{id, text, type?, in?, at?, size?, color?}[]", { required: true }),
      arrows: p.list("Between item ids; [from, to, label?] works too", "{from, to, label?, dashed?}[]"),
      bind: p.bind("A <state> that gets the arrangement after each move: {groups: {groupId: [ids in reading order]}, loose: [ids], at: {id: [x,y]}, text?}; for iris_ask pickers", { required: false }),
      editable: p.bool("Double-click adds or edits a note; Delete removes one", { def: false }),
      height: p.num("Height in px", { def: 420 }),
      title: p.str("Caption"),
      onPick: p.on("Runs with (id, text) when the person double-clicks a note on a board that is not editable, or presses Enter on it"),
    },
    children: "none",
    example: `<state plan={null} />
<Card title="Sort the backlog">
<Whiteboard bind="plan" items={[
  { id: "now", type: "group", text: "Now", color: "accent" },
  { id: "later", type: "group", text: "Later" },
  { id: "sync", text: "Offline sync", in: "now" },
  { id: "login", text: "Passkey login", in: "now" },
  { id: "themes", text: "Custom themes", in: "later" },
  { id: "export", text: "CSV export" },
]} arrows={[["sync", "themes", "before"]]} />
</Card>`,
    aliases: ["Canvas", "StickyNotes", "Affinity", "Sticky"],
    heavy: true,
  }),
];

export const LOCALIZATION = [
  component({
    name: "StringsTable",
    group: "Localization",
    summary:
      "Localized strings side by side: a row per key, a column per locale, each cell flagged when missing, untranslated, marked for review, with placeholders that don't match the source, or likely to truncate. Above it, a tile per locale with % translated and its issue counts (click one to filter). Search, issue filters, click a cell to copy.",
    props: {
      strings: p.any(
        'One .xcstrings catalog (load("Localizable.xcstrings")), or locale → file: { en: load("en.json"), de: load("de.lproj/Localizable.strings"), fr: load("fr.po") }. JSON may be nested; .po msgids are source text',
        { required: true },
      ),
      source: p.str("Source locale; default the catalog's, else en, else the first"),
      locales: p.list("Locales to show, in order; default all", "string[]"),
      show: p.oneOf(["issues", "all"], "Rows shown first", { def: "issues" }),
      view: p.oneOf(["both", "summary", "table"], "Tiles, table or both", { def: "both" }),
      growth: p.num("Flag a translation longer than source × growth (and 8+ characters longer)", { def: 1.5 }),
      limits: p.any("Most characters a value may take: a number for all, or { key: max }"),
      same: p.list("Keys that may equal the source (brand names, OK)", "string[]"),
      title: p.str("Caption"),
      onPick: p.on("Runs with (key, locale) when the person clicks a cell, instead of copying"),
    },
    children: "none",
    example: `<Card title="Release strings">
<StringsTable strings={{
  en: { "cart.title": "Your cart", "cart.items": "%d items in %@", "checkout": "Check out" },
  de: { "cart.title": "Ihr Warenkorb", "cart.items": "%d Artikel", "checkout": "Zur Kasse gehen und bezahlen" },
  fr: { "cart.title": "Your cart", "cart.items": "%d articles dans %@" },
}} />
</Card>`,
    aliases: ["Localization", "Translations", "L10n", "StringsReview"],
    heavy: true,
  }),
];
