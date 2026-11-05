import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { z } from "zod";
import { createExportRegistry } from "./registry.js";
import { csvFormat } from "./formats/csv.js";
import { createExportsRoutes } from "./routes.js";

function build({ order = [], audit = async () => {} } = {}) {
  const registry = createExportRegistry();
  registry.defineFormat(csvFormat);
  registry.defineSource({
    key: "sales", label: "Sales", params: [{ id: "from", label: "From", type: "date" }],
    paramsSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
    fields: [{ key: "name", label: "Name", type: "text" }],
    async fetchPage() { return { rows: [{ name: "a" }, { name: "b" }], total: 2 }; },
  });
  const app = Fastify();
  app.register(createExportsRoutes({
    registry, db: {}, audit,
    preHandler: async (request) => { order.push("pre"); request.user = { id: "admin-1" }; },
  }), { prefix: "/admin" });
  return app;
}

test("download sets Content-Disposition from source key and dates and calls audit with rowCount", async () => {
  const audits = [];
  const app = build({ audit: async (a) => audits.push(a) });
  const res = await app.inject({ url: "/admin/exports/sales/download.csv?from=2026-01-01&to=2026-01-31" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-disposition"], 'attachment; filename="sales-2026-01-01-2026-01-31.csv"');
  assert.match(res.headers["content-type"], /^text\/csv/);
  assert.equal(res.body, "﻿Name\r\na\r\nb\r\n");
  assert.deepEqual(audits, [{ actorId: "admin-1", sourceKey: "sales", formatKey: "csv", params: { from: "2026-01-01", to: "2026-01-31" }, rowCount: 2 }]);
});

test("preHandler runs before every route", async () => {
  const order = [];
  const app = build({ order });
  await app.inject({ url: "/admin/exports" });
  await app.inject({ url: "/admin/exports/sales/preview?limit=1&offset=0" });
  await app.inject({ url: "/admin/exports/sales/download.csv" });
  assert.deepEqual(order, ["pre", "pre", "pre"]);
});

test("list route returns the registry listing", async () => {
  const res = await build().inject({ url: "/admin/exports" });
  const { data } = res.json();
  assert.equal(data[0].key, "sales");
  assert.deepEqual(data[0].formats, ["csv"]);
});

test("preview pages by limit/offset and keeps them out of the params", async () => {
  const res = await build().inject({ url: "/admin/exports/sales/preview?limit=1&offset=0&from=2026-01-01" });
  assert.equal(res.statusCode, 200);
  const { data } = res.json();
  assert.equal(data.total, 2);
  assert.deepEqual(data.fields.map((f) => f.key), ["name"]);
});

test("bad params and unsupported format are 422, unknown source 404, and nothing is audited", async () => {
  const audits = [];
  const app = build({ audit: async (a) => audits.push(a) });
  assert.equal((await app.inject({ url: "/admin/exports/sales/download.csv?from=1&from=2" })).statusCode, 422);
  assert.equal((await app.inject({ url: "/admin/exports/sales/download.zip" })).statusCode, 422);
  assert.equal((await app.inject({ url: "/admin/exports/nope/download.csv" })).statusCode, 404);
  assert.deepEqual(audits, []);
});
