// Patterns that take more than one component or tool: iris_examples(["Recipes"]) returns them.
// Every ```iris block here passes check() (tests/recipes.test.ts).

export interface Recipe {
  name: string;
  /** Markdown: when to use it, the steps, and the blocks. */
  text: string;
}

export const RECIPES: Recipe[] = [
  {
    name: "A status card that follows a file",
    text: `For work that runs a while (a migration, a fleet, a release): keep the card in a file and rewrite the file as things change. The person sees the newest version without a new message.
1. Write the card's markup to $BB_THREAD_STORAGE/status.iris (Iris markup, with or without the \`\`\` lines).
2. Show it inline: put \`::iris{file="$BB_THREAD_STORAGE/status.iris"}\` on its own line in your reply. It re-reads the file every 3 s while it shows.
3. Keep it in view while the chat scrolls on: iris_pin with file "$BB_THREAD_STORAGE/status.iris" (or \`bb iris pin $BB_THREAD_STORAGE/status.iris --id status\`). Pinning again with the same id replaces it; iris_unpin when the work is done.
4. Rewrite the file at each step. Numbers that change by the second go in a JSON file the card loads inside <Card state="live">, so the card file only changes when the shape does.
\`\`\`iris
<let p={load("$BB_THREAD_STORAGE/progress.json", {fallback: {done: 0, total: 6}})} />
<Card title="Logging migration" state="live">
  <Progress label="Services moved" value={p.done} max={p.total} />
  <Status items={[
    { name: "auth", status: "done" },
    { name: "billing", status: "done" },
    { name: "notifications", status: "on-track", note: "Tests running" },
    { name: "search", status: "blocked", note: "Waits on the schema change" },
  ]} />
</Card>
\`\`\``,
  },
  {
    name: "A Variants picker",
    text: `For a choice the person must see to make (palettes, layouts, copy, mockups): one <Variant> per option, each a full preview, in an iris_ask picker so you wait for the answer. The answer is the shown variant's value plus anything else bound.
1. Call iris_ask with title "Which direction?" and this source. Put your recommendation first in its label or detail.
2. The answer comes back as JSON, e.g. {"pick": "ember", "note": ""}. Build with it.
\`\`\`iris
<state pick="ember" note="" />
<Variants bind="pick" label="Which palette for the dashboard?">
  <Variant value="ember" label="Ember (recommended)" colors={["#17110E", "#F2E6DC", "#FF7A3D"]} detail="Warm charcoal, orange accent">
    <Swatches backgrounds={[{ name: "Surface", value: "#17110E" }]} colors={[{ name: "Text", value: "#F2E6DC" }, { name: "Accent", value: "#FF7A3D" }]} />
  </Variant>
  <Variant value="slate" label="Slate" colors={["#0F1513", "#E3ECE8", "#2BB3A3"]} detail="Green-tinted grays, teal accent">
    <Swatches backgrounds={[{ name: "Surface", value: "#0F1513" }]} colors={[{ name: "Text", value: "#E3ECE8" }, { name: "Accent", value: "#2BB3A3" }]} />
  </Variant>
</Variants>
<TextArea bind="note" label="Anything to change?" placeholder="Optional" />
<Submit />
\`\`\`
For layouts, put a <Mockup> or an <Image> in each Variant instead of Swatches.`,
  },
  {
    name: "Changing a card the person already has",
    text: `To show another scenario in a card already in the thread (a slider, a pick, a field), set its inputs instead of sending a new card: iris_cards lists the thread's cards by number with what is set; iris_card_set with {card: 2, values: {seats: 20}} sets them (or \`bb iris set 2 seats=20\`). Each value must be a <state> the card declares and keep its type. An open card redraws at once.`,
  },
];

export const RECIPES_FAMILY = "Recipes";

export function recipesText(): string {
  return RECIPES.map((r) => `## ${r.name}\n${r.text}`).join("\n\n");
}
