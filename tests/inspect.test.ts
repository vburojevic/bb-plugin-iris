import { describe, expect, it } from "vitest";
import { harPhases, normalizeExchange, normalizeWaterfall, parseRawHttp, readBody, resourceType, statusTone, ticks, toCurl } from "../core/http";
import { detectFormat, parseSchema, rankTables } from "../core/schema";
import { normalizePlan } from "../core/queryplan";

describe("HttpExchange", () => {
  it("reads request and response objects", () => {
    const { exchange: ex, problems } = normalizeExchange({
      request: { method: "post", url: "https://api.example.com/v1/users", headers: { "Content-Type": "application/json", Authorization: "Bearer abc" }, body: { name: "Ada" } },
      response: { status: 201, headers: [{ name: "content-type", value: "application/json" }], body: '{"id": 7}' },
      ms: 182,
    });
    expect(problems).toEqual([]);
    expect(ex.method).toBe("POST");
    expect(ex.status).toBe(201);
    expect(ex.statusText).toBe("Created");
    expect(ex.reqBody).toContain('"name": "Ada"');
    expect(readBody(ex.resBody, ex.resMime)).toMatchObject({ kind: "json", json: { id: 7 } });
    expect(ex.size).toBe(9);
    expect(ex.ms).toBe(182);
  });

  it("reads curl -i output, keeping the last response after a redirect", () => {
    const raw = "HTTP/1.1 301 Moved\r\nLocation: /b\r\n\r\nHTTP/2 404\r\ncontent-type: text/plain\r\nx-a: 1\r\n\r\nnot here";
    const r = parseRawHttp(raw);
    expect(r.start).toBe("HTTP/2 404");
    expect(r.headers).toEqual([["content-type", "text/plain"], ["x-a", "1"]]);
    expect(r.body).toBe("not here");
    const { exchange } = normalizeExchange({ request: "GET /items?x=1 HTTP/1.1\nHost: shop.dev\n", response: raw });
    expect(exchange.url).toBe("https://shop.dev/items?x=1");
    expect(exchange.status).toBe(404);
    expect(exchange.statusText).toBe("Not Found");
  });

  it("reads a HAR entry and its timings", () => {
    const { exchange } = normalizeExchange({
      entry: { request: { method: "GET", url: "https://x.dev/a", headers: [] }, response: { status: 200, headers: [], content: { size: 512, mimeType: "text/html", text: "<p>" } }, time: 120, timings: { blocked: 2, dns: -1, connect: 30, ssl: 20, send: 1, wait: 80, receive: 7 } },
    });
    expect(exchange.size).toBe(512);
    expect(exchange.resMime).toBe("text/html");
    expect(exchange.phases).toEqual([
      { kind: "blocked", ms: 2 },
      { kind: "connect", ms: 10 },
      { kind: "tls", ms: 20 },
      { kind: "send", ms: 1 },
      { kind: "wait", ms: 80 },
      { kind: "receive", ms: 7 },
    ]);
  });

  it("builds a curl command with secrets masked", () => {
    const { exchange } = normalizeExchange({ request: { method: "PUT", url: "https://a.dev/x?q='1'", headers: { Authorization: "Bearer secret", Accept: "*/*" }, body: "{}" } });
    const curl = toCurl(exchange);
    expect(curl).toContain("-X PUT");
    expect(curl).not.toContain("secret");
    expect(curl).toContain("Bearer ••••••••");
    expect(curl).toContain(`'https://a.dev/x?q='\\''1'\\'''`);
    expect(toCurl(exchange, true)).toContain("Bearer secret");
  });

  it("tones status codes and reports a missing request", () => {
    expect([200, 304, 404, 503, null].map(statusTone)).toEqual(["good", "info", "warn", "bad", "neutral"]);
    expect(normalizeExchange({}).problems.length).toBe(1);
  });
});

describe("Waterfall", () => {
  const har = {
    log: {
      pages: [{ startedDateTime: "2026-01-01T00:00:00.000Z", pageTimings: { onContentLoad: 300, onLoad: 520 } }],
      entries: [
        { startedDateTime: "2026-01-01T00:00:00.050Z", time: 200, request: { method: "GET", url: "https://shop.dev/app.js" }, response: { status: 200, content: { mimeType: "application/javascript", size: 1000 }, _transferSize: 400 }, timings: { wait: 150, receive: 50 } },
        { startedDateTime: "2026-01-01T00:00:00.000Z", time: 40, request: { method: "GET", url: "https://shop.dev/" }, response: { status: 200, content: { mimeType: "text/html" }, bodySize: 100 }, timings: { wait: 30, receive: 10 } },
        { startedDateTime: "2026-01-01T00:00:00.100Z", time: 90, request: { method: "POST", url: "https://api.shop.dev/cart?id=3" }, response: { status: 500, content: { mimeType: "application/json" } }, timings: { wait: 90 } },
      ],
    },
  };

  it("puts entries on one time axis with page marks", () => {
    const { data, problems } = normalizeWaterfall(JSON.stringify(har));
    expect(problems).toEqual([]);
    expect(data.rows.map((r) => [r.name, r.start, r.type])).toEqual([
      ["shop.dev", 0, "document"],
      ["app.js", 50, "script"],
      ["cart?id=3", 100, "fetch"],
    ]);
    expect(data.rows[1].size).toBe(400);
    expect(data.marks).toEqual([{ label: "DOMContentLoaded", at: 300 }, { label: "Load", at: 520 }]);
    expect(data.total).toBe(520);
    expect(data.bytes).toBe(500);
  });

  it("takes a simple list too", () => {
    const { data } = normalizeWaterfall([{ url: "/a.css", start: 10, ms: 20 }, { url: "/b.png", start: 0, ms: 5 }]);
    expect(data.rows.map((r) => r.type)).toEqual(["image", "style"]);
    expect(data.total).toBe(30);
  });

  it("reports input that isn't HAR", () => {
    expect(normalizeWaterfall("nope").problems[0]).toMatch(/HAR/);
    expect(normalizeWaterfall({}).problems[0]).toMatch(/no entries/);
  });

  it("classifies resources and picks round ticks", () => {
    expect(resourceType("", "https://a/x.woff2")).toBe("font");
    expect(resourceType("", "https://a/x", "xhr")).toBe("fetch");
    expect(ticks(520)).toEqual([0, 200, 400]);
    expect(ticks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(harPhases({ dns: -1 })).toEqual([]);
  });
});

describe("ErDiagram parsers", () => {
  it("reads SQL with inline, table-level and ALTER foreign keys", () => {
    const sql = `
      -- users first
      CREATE TABLE IF NOT EXISTS public.users (
        id bigserial PRIMARY KEY,
        email varchar(255) NOT NULL UNIQUE,
        team_id int REFERENCES teams
      );
      create table "teams" ("id" serial primary key, name text);
      CREATE TABLE posts (
        id uuid,
        author_id bigint NOT NULL,
        price numeric(10, 2) DEFAULT 0,
        CONSTRAINT posts_pk PRIMARY KEY (id),
        CONSTRAINT fk_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE TABLE profiles (user_id bigint PRIMARY KEY REFERENCES users(id), bio text);
      ALTER TABLE ONLY posts ADD CONSTRAINT fk_editor FOREIGN KEY (editor_id) REFERENCES users(id);
    `;
    expect(detectFormat(sql)).toBe("sql");
    const { schema } = parseSchema({ schema: sql });
    expect(schema.tables.map((t) => t.name)).toEqual(["users", "teams", "posts", "profiles"]);
    const users = schema.tables[0];
    expect(users.columns.map((c) => [c.name, c.type, c.pk ?? false, c.nullable])).toEqual([
      ["id", "bigserial", true, false],
      ["email", "varchar(255)", false, false],
      ["team_id", "int", false, true],
    ]);
    expect(schema.tables[2].columns.find((c) => c.name === "price")?.type).toBe("numeric(10, 2)");
    expect(schema.tables[2].columns[0].pk).toBe(true);
    const rel = schema.relations.map((r) => `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}:${r.kind}`).sort();
    expect(rel).toEqual(["posts.author_id->users.id:many", "posts.editor_id->users.id:many", "profiles.user_id->users.id:one", "users.team_id->teams.id:many"]);
    expect(rankTables(schema)).toEqual([["teams"], ["users"], ["posts", "profiles"]]);
  });

  it("reads a Prisma schema", () => {
    const prisma = `
      model User {
        id    Int     @id @default(autoincrement())
        email String  @unique
        posts Post[]
        profile Profile?
      }
      model Post {
        id       Int   @id
        title    String
        author   User  @relation(fields: [authorId], references: [id])
        authorId Int
        tags     String[]
        @@index([authorId])
      }
      model Profile {
        userId Int  @unique
        user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
      }
      enum Role { USER ADMIN }
    `;
    expect(detectFormat(prisma)).toBe("prisma");
    const { schema, problems } = parseSchema({ schema: prisma });
    expect(problems).toEqual([]);
    expect(schema.tables.map((t) => [t.name, t.columns.map((c) => c.name).join(",")])).toEqual([
      ["User", "id,email"],
      ["Post", "id,title,authorId,tags"],
      ["Profile", "userId"],
    ]);
    expect(schema.tables[1].columns[2].indexed).toBe(true);
    expect(schema.relations.map((r) => `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}:${r.kind}`)).toEqual(["Post.authorId->User.id:many", "Profile.userId->User.id:one"]);
  });

  it("reads a Convex schema.ts", () => {
    const convex = `
      import { defineSchema, defineTable } from "convex/server";
      import { v } from "convex/values";
      const teams = defineTable({ name: v.string() });
      export default defineSchema({
        groups: teams,
        users: defineTable({
          name: v.string(),
          teamId: v.optional(v.id("groups")), // their team
          role: v.union(v.literal("admin"), v.literal("member")),
        }).index("by_team", ["teamId"]),
        messages: defineTable({
          author: v.id("users"),
          readBy: v.array(v.id("users")),
          body: v.string(),
        }),
      });
    `;
    expect(detectFormat(convex)).toBe("convex");
    const { schema, problems } = parseSchema({ schema: convex });
    expect(problems).toEqual([]);
    expect(schema.tables.map((t) => t.name)).toEqual(["groups", "users", "messages"]);
    const users = schema.tables[1];
    expect(users.columns.map((c) => [c.name, c.type, c.nullable])).toEqual([
      ["_id", "Id<users>", false],
      ["name", "string", false],
      ["teamId", "Id<groups>", true],
      ["role", '"admin" | "member"', false],
    ]);
    expect(users.columns[2].indexed).toBe(true);
    expect(schema.relations.map((r) => `${r.from.table}.${r.from.column}->${r.to.table}:${r.kind}`)).toEqual(["users.teamId->groups:many", "messages.author->users:many", "messages.readBy->users:list"]);
  });

  it("takes tables and relations as data and reports dangling ones", () => {
    const { schema, problems } = parseSchema({
      tables: [{ name: "a", columns: ["id int", { name: "b_id", type: "int", fk: "b.id" }] }, { name: "b", columns: ["id"] }],
      relations: [{ from: "a.x", to: "zzz.id" }],
    });
    expect(schema.relations.map((r) => `${r.from.column}->${r.to.table}`)).toEqual(["b_id->b"]);
    expect(problems[0]).toMatch(/zzz/);
  });
});

describe("QueryPlan", () => {
  const explain = [
    {
      Plan: {
        "Node Type": "Hash Join", "Join Type": "Inner", "Startup Cost": 10, "Total Cost": 300, "Plan Rows": 50, "Plan Width": 40, "Actual Startup Time": 1, "Actual Total Time": 30, "Actual Rows": 5000, "Actual Loops": 1, "Hash Cond": "(o.user_id = u.id)",
        Plans: [
          { "Node Type": "Seq Scan", "Parent Relationship": "Outer", "Relation Name": "orders", Alias: "o", "Startup Cost": 0, "Total Cost": 200, "Plan Rows": 10000, "Plan Width": 20, "Actual Startup Time": 0.1, "Actual Total Time": 20, "Actual Rows": 5000, "Actual Loops": 1, Filter: "(total > 100)", "Rows Removed by Filter": 95000 },
          { "Node Type": "Hash", "Parent Relationship": "Inner", "Startup Cost": 5, "Total Cost": 5, "Plan Rows": 100, "Plan Width": 20, "Actual Startup Time": 2, "Actual Total Time": 2, "Actual Rows": 100, "Actual Loops": 1, "Hash Batches": 4,
            Plans: [{ "Node Type": "Index Scan", "Parent Relationship": "Outer", "Index Name": "users_pkey", "Relation Name": "users", Alias: "u", "Startup Cost": 0, "Total Cost": 4, "Plan Rows": 100, "Plan Width": 20, "Actual Startup Time": 0, "Actual Total Time": 1.5, "Actual Rows": 100, "Actual Loops": 1 }] },
        ],
      },
      "Planning Time": 0.4,
      "Execution Time": 31.2,
    },
  ];

  it("builds the tree with self times, labels and warnings", () => {
    const { plan, problems } = normalizePlan(JSON.stringify(explain));
    expect(problems).toEqual([]);
    expect(plan.analyzed).toBe(true);
    expect(plan.executionMs).toBe(31.2);
    expect(plan.nodes.map((n) => n.label)).toEqual(["Hash Join (Inner)", "Seq Scan on orders o", "Hash", "Index Scan using users_pkey on users u"]);
    expect(plan.nodes.map((n) => n.selfMs)).toEqual([8, 20, 0.5, 1.5]);
    expect(plan.root!.selfCost).toBe(95);
    expect(plan.nodes[0].warnings[0]).toMatch(/Estimated 50 rows, got 5000 \(100x more\)/);
    expect(plan.nodes[1].warnings[0]).toMatch(/Read 100k rows to keep 5000/);
    expect(plan.nodes[2].warnings).toContain("Hash used 4 batches (spilled to disk)");
    expect(plan.nodes[1].details[0]).toEqual(["Filter", "(total > 100)"]);
  });

  it("reads plain EXPLAIN without ANALYZE and the shapes clients print", () => {
    const { plan } = normalizePlan([{ "QUERY PLAN": [{ Plan: { "Node Type": "Seq Scan", "Relation Name": "t", "Startup Cost": 0, "Total Cost": 12.5, "Plan Rows": 250, "Plan Width": 8 } }] }]);
    expect(plan.analyzed).toBe(false);
    expect(plan.totalCost).toBe(12.5);
    expect(plan.nodes[0].selfCost).toBe(12.5);
  });

  it("explains text plans instead of failing", () => {
    expect(normalizePlan("Seq Scan on t  (cost=0.00..12.50 rows=250 width=8)").problems[0]).toMatch(/FORMAT JSON/);
    expect(normalizePlan(42).problems.length).toBe(1);
  });
});

describe("review fixes", () => {
  it("masks more secret headers and query values, and quotes odd methods", () => {
    const { exchange } = normalizeExchange({ request: { method: "get $(id)", url: "https://a.dev/x?api_key=sk_live_1&page=2", headers: { "X-Goog-Api-Key": "k1", "Private-Token": "t1", Accept: "*/*" } } });
    const curl = toCurl(exchange);
    expect(curl).not.toMatch(/sk_live_1|k1|t1/);
    expect(curl).toContain("page=2");
    expect(curl).toContain("-X 'GET $(ID)'");
  });

  it("returns finite ticks for any total", () => {
    expect(ticks(5e-324)).toEqual([0]);
    expect(ticks(Infinity)).toEqual([0]);
    expect(normalizeWaterfall([{ url: "/a", start: 0, ms: 1 }, { url: "/b", start: 1e308, ms: 1e308 }]).data.total).toBe(Infinity);
  });

  it("keeps quoted text that looks like a comment", () => {
    const prisma = `model Site {\n  id  Int @id\n  url String @default("https://example.com") // home\n}`;
    expect(parseSchema({ schema: prisma }).schema.tables[0].columns.map((c) => c.name)).toEqual(["id", "url"]);
    const sql = "CREATE TABLE t (id int PRIMARY KEY, note text DEFAULT '--', x int); -- end";
    expect(parseSchema({ schema: sql }).schema.tables[0].columns.map((c) => c.name)).toEqual(["id", "note", "x"]);
  });

  it("keeps schema names when two schemas share a table name", () => {
    const sql = `CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE TABLE public.users (id uuid PRIMARY KEY, auth_id uuid REFERENCES auth.users(id));
      CREATE TABLE posts (id int PRIMARY KEY, user_id uuid REFERENCES users(id));`;
    const { schema, problems } = parseSchema({ schema: sql });
    expect(problems).toEqual([]);
    expect(schema.tables.map((t) => t.name)).toEqual(["auth.users", "public.users", "posts"]);
    expect(schema.relations.map((r) => `${r.from.table}->${r.to.table}`)).toEqual(["public.users->auth.users", "posts->public.users"]);
  });

  it("reads a QUERY PLAN held as text", () => {
    const inner = JSON.stringify([{ Plan: { "Node Type": "Result", "Startup Cost": 0, "Total Cost": 0.01 } }]);
    expect(normalizePlan([{ "QUERY PLAN": inner }]).plan.nodes[0].type).toBe("Result");
    expect(normalizePlan([{ "QUERY PLAN": "Seq Scan" }]).problems[0]).toMatch(/FORMAT JSON/);
  });
});
