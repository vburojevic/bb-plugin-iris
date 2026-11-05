// Wave 3: sheets (an editable table with formulas) and the API and schema
// inspector (one HTTP exchange, a HAR waterfall, an ER diagram, a query plan).
import { component, p } from "./spec";

export const SHEETS = [
  component({
    name: "Sheet",
    group: "Sheets",
    summary:
      "An editable spreadsheet. Row 1 is the header, data starts at row 2. Cells starting with = are formulas: refs (B2, B2:B9, B:B), + - * / ^ & % and comparisons, SUM AVG MIN MAX COUNT MEDIAN IF IFERROR AND OR ROUND ROUNDUP ROUNDDOWN ABS MOD SUMIF COUNTIF CONCAT. Add and remove rows, paste from a spreadsheet, copy as CSV. In iris_ask, bind it and <Submit /> returns the edited table.",
    props: {
      rows: p.any("List of lists (first row is the header), list of objects, or CSV text", { required: true }),
      columns: p.list("formula computes each row from column keys (Qty * Price), read-only; a cell's own =formula wins. format: usd, percent, integer...", "(string | {key, label?, format?, formula?, width?})[]"),
      bind: p.bind("Optional state that gets the table as objects with computed values", { required: false }),
      editable: p.bool("Cells, rows and paste can change", { def: true }),
      title: p.str("Caption"),
      height: p.num("Most height in px; rows scroll inside", { def: 420 }),
    },
    children: "none",
    example: `<Sheet title="Budget" rows={[
  ["Item", "Qty", "Price", "Cost"],
  ["Laptops", 3, 1899, null],
  ["Monitors", 4, 329, null],
  ["Total", "=SUM(B2:B3)", null, "=SUM(D2:D3)"],
]} columns={["Item", "Qty", { key: "Price", format: "usd" }, { key: "Cost", formula: "Qty * Price", format: "usd" }]} />`,
    aliases: ["Spreadsheet", "EditableTable", "Excel"],
    heavy: true,
  }),
];

export const API = [
  component({
    name: "HttpExchange",
    group: "API",
    summary: "One HTTP request and its response: method, URL, status, time, size, headers (secrets masked) and the body as a JSON tree or text. Copies as curl.",
    props: {
      request: p.any("{method, url, headers?, body?}, raw HTTP text, or a URL"),
      response: p.any("{status, headers?, body?} or curl -i output: load(\"$BB_THREAD_STORAGE/res.txt\", {raw: true})"),
      entry: p.obj("A HAR entry instead of request and response"),
      ms: p.num("Total time in ms"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<HttpExchange ms={142} request={{ method: "POST", url: "https://api.example.com/v1/orders", headers: { "Content-Type": "application/json", Authorization: "Bearer sk_live_42" }, body: { sku: "A-1", qty: 2 } }} response={{ status: 201, headers: { "content-type": "application/json" }, body: { id: "ord_9", status: "paid", items: [{ sku: "A-1", qty: 2 }] } }} />`,
    aliases: ["HttpRequest", "Request", "ApiCall", "HttpResponse"],
    heavy: true,
  }),
  component({
    name: "Waterfall",
    group: "API",
    summary: "Network requests on a timeline: each bar split into queue, DNS, connect, TLS, wait and download, with DOMContentLoaded and Load lines. Filter by type, search, click a row for its headers and body.",
    props: {
      har: p.any("A HAR file (load(\"$BB_THREAD_STORAGE/page.har\")) or a list of {url, start, ms, method?, status?, size?}", { required: true }),
      title: p.str("Caption"),
      height: p.num("Most height in px", { def: 420 }),
    },
    children: "none",
    example: `<Waterfall har={[
  { url: "https://shop.dev/", start: 0, ms: 120, status: 200, size: 14200 },
  { url: "https://shop.dev/app.js", start: 130, ms: 260, status: 200, size: 88100 },
  { url: "https://shop.dev/app.css", start: 135, ms: 90, status: 200, size: 12300 },
  { url: "https://api.shop.dev/cart", method: "POST", start: 420, ms: 310, status: 500 },
]} />`,
    aliases: ["HarViewer", "NetworkWaterfall", "Har"],
    heavy: true,
  }),
  component({
    name: "ErDiagram",
    group: "API",
    summary: "Tables, columns and relations drawn from schema text: SQL CREATE TABLE, a Prisma schema or a Convex schema.ts (format is detected). Keys and foreign keys marked; hover a table to trace its links.",
    props: {
      schema: p.str("The schema text, often load(\"prisma/schema.prisma\", {raw: true})"),
      format: p.oneOf(["auto", "sql", "prisma", "convex"], "Which language", { def: "auto" }),
      tables: p.list("Instead of text", "{name, columns: (\"name type\" | {name, type?, pk?, fk?: \"table.col\", nullable?})[]}[]"),
      relations: p.list("Extra links", "{from: \"posts.user_id\", to: \"users.id\", label?}[]"),
      title: p.str("Caption"),
      height: p.num("Most height in px", { def: 520 }),
    },
    children: "none",
    example: `<ErDiagram schema={\`CREATE TABLE teams (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL, team_id int REFERENCES teams(id));
CREATE TABLE posts (id serial PRIMARY KEY, author_id int NOT NULL REFERENCES users(id), title text);\`} />`,
    aliases: ["EntityRelationship", "SchemaDiagram", "DatabaseSchema", "Erd"],
    heavy: true,
  }),
  component({
    name: "QueryPlan",
    group: "API",
    summary: "A Postgres EXPLAIN (FORMAT JSON) plan as a collapsible tree: each node's own time (with ANALYZE) or cost as a bar, estimated against actual rows, and warnings for bad estimates, spills and big filtered scans. Click a node for its details.",
    props: {
      plan: p.any("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) output: load(\"$BB_THREAD_STORAGE/plan.json\")", { required: true }),
      query: p.str("The SQL, shown above the tree"),
      metric: p.oneOf(["time", "cost"], "What the bars show (default time when analyzed)"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<QueryPlan query="SELECT * FROM orders o JOIN users u ON u.id = o.user_id WHERE o.total > 100" plan={[{ "Planning Time": 0.3, "Execution Time": 48.1, Plan: { "Node Type": "Hash Join", "Join Type": "Inner", "Startup Cost": 12, "Total Cost": 2410, "Plan Rows": 60, "Actual Total Time": 47.6, "Actual Rows": 5100, "Actual Loops": 1, "Hash Cond": "(o.user_id = u.id)", Plans: [
  { "Node Type": "Seq Scan", "Relation Name": "orders", Alias: "o", "Startup Cost": 0, "Total Cost": 2300, "Plan Rows": 6000, "Actual Total Time": 41.2, "Actual Rows": 5100, "Actual Loops": 1, Filter: "(total > 100)", "Rows Removed by Filter": 94900 },
  { "Node Type": "Hash", "Startup Cost": 9, "Total Cost": 9, "Plan Rows": 400, "Actual Total Time": 0.9, "Actual Rows": 400, "Actual Loops": 1, Plans: [{ "Node Type": "Index Scan", "Index Name": "users_pkey", "Relation Name": "users", Alias: "u", "Startup Cost": 0, "Total Cost": 8, "Plan Rows": 400, "Actual Total Time": 0.6, "Actual Rows": 400, "Actual Loops": 1 }] },
] } }]} />`,
    aliases: ["Explain", "ExplainPlan", "QueryPlanner"],
    heavy: true,
  }),
];
