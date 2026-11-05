// Accessibility audits (axe-core or Lighthouse reports) and geo heatmaps
// (countries or US states shaded in one accent hue). Both load on demand.
import { component, p } from "./spec";

export const ACCESSIBILITY = [
  component({
    name: "AccessibilityAudit",
    group: "Accessibility",
    summary:
      "An axe-core or Lighthouse accessibility report: counts by impact, failing rules grouped by impact or WCAG criterion, each with its nodes (selector, HTML, how it fails) and help link. With a screenshot, failing nodes are boxed on it.",
    props: {
      report: p.any('An axe-core result (or the array @axe-core/cli writes) or a Lighthouse JSON report: load("$BB_THREAD_STORAGE/axe.json")', { required: true }),
      screenshot: p.str("Page screenshot path; nodes with a box ({x, y, width, height} in page px) are outlined. Lighthouse's own is used when present"),
      scale: p.num("Screenshot pixels per page pixel (2 for Retina)", { def: 1 }),
      group: p.oneOf(["impact", "wcag"], "Group rules by", { def: "impact" }),
      review: p.bool("Show items axe marks as needing review", { def: true }),
      title: p.str("Caption"),
      onPick: p.on("(rule, selector) => ... when a node is clicked, instead of copying its selector"),
    },
    children: "none",
    example: `<Card title="Checkout accessibility" icon="accessibility">
<AccessibilityAudit screenshot="$BB_THREAD_STORAGE/checkout.png" report={{ url: "https://shop.example.com/checkout", violations: [
  { id: "image-alt", impact: "critical", tags: ["wcag2a", "wcag111"], help: "Images must have alternative text", helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt",
    nodes: [{ target: ["header > img"], html: "<img src=\\"logo.png\\">", failureSummary: "Element does not have an alt attribute", box: { x: 20, y: 16, width: 28, height: 28 } }] },
  { id: "color-contrast", impact: "serious", tags: ["wcag2aa", "wcag143"], help: "Elements must meet minimum color contrast ratio thresholds", helpUrl: "https://dequeuniversity.com/rules/axe/4.14/color-contrast",
    nodes: [
      { target: [".hint"], html: "<p class=\\"hint\\">", failureSummary: "Contrast 1.97 (#b8b8bf on #ffffff), needs 4.5:1", box: { x: 20, y: 115, width: 600, height: 19 } },
      { target: [".pay"], html: "<div class=\\"pay\\" role=\\"button\\">", failureSummary: "Contrast 2.42 (#ffffff on #7ea6f6), needs 4.5:1", box: { x: 20, y: 364, width: 113, height: 42 } },
    ] },
  { id: "heading-order", impact: "moderate", tags: ["best-practice"], help: "Heading levels should only increase by one", helpUrl: "https://dequeuniversity.com/rules/axe/4.14/heading-order",
    nodes: [{ target: ["main > h4"], html: "<h4>Shipping</h4>", failureSummary: "Heading order invalid", box: { x: 20, y: 150, width: 600, height: 20 } }] },
], passes: [{ id: "document-title" }, { id: "label" }] }} />
</Card>`,
    aliases: ["A11yAudit", "A11y", "Axe", "AxeReport"],
    heavy: true,
  }),
];

export const GEO = [
  component({
    name: "GeoHeatmap",
    group: "Geo",
    summary:
      "A choropleth of countries or US states shaded by value in one accent hue, with a legend, hover readouts and a table view. Rows match ISO or USPS codes or names; rows for one region add up.",
    props: {
      data: p.any('Rows [{country: "DE", users: 120}] or {DE: 120}', { required: true }),
      map: p.oneOf(["world", "us"], "Countries or US states", { def: "world" }),
      key: p.str("Field naming the region; default id, code, country, state, region or name"),
      value: p.str("Field with the number; default value or the first numeric one"),
      label: p.str("What the value is, e.g. \"Users\""),
      format: p.fmt(),
      steps: p.num("Shades, 3-9", { def: 5 }),
      scale: p.oneOf(["linear", "quantile"], "quantile puts about as many regions in each shade", { def: "linear" }),
      domain: p.list("[low, high]; default the data's range", "number[]"),
      title: p.str("Caption"),
      onPick: p.on("(id, value, row) => ... when a region is clicked"),
    },
    children: "none",
    example: `<Card title="Weekly active users" icon="globe">
<GeoHeatmap label="Users" format="compact" data={[
  { country: "US", users: 48200 }, { country: "DE", users: 21400 }, { country: "GB", users: 17900 },
  { country: "FR", users: 12100 }, { country: "BR", users: 9800 }, { country: "JP", users: 8700 },
  { country: "IN", users: 15300 }, { country: "CA", users: 7600 }, { country: "AU", users: 5200 },
  { country: "HR", users: 2100 }, { country: "ZA", users: 1900 }, { country: "MX", users: 4400 },
]} />
</Card>`,
    aliases: ["Choropleth", "GeoMap", "WorldMap", "CountryMap"],
    heavy: true,
  }),
];
