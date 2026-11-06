import { test } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { createExportRegistry } from "./registry.js";
import { csvFormat } from "./index.js";
import { runExport, previewExport } from "./export.service.js";

const fields = [
  { key: "name", label: "Name", type: "text" },
  { key: "amountCents", label: "Amount", type: "money" },
  { key: "on", label: "On", type: "date" },
];

function setup({ rows = 2500, extra = {} } = {}) {
  const calls = [];
  const registry = createExportRegistry();
  registry.defineFormat(csvFormat);
  registry.defineFormat({ key: "only-other", label: "X", extension: "x", contentType: "text/plain", supports: (s) => s.key === "other", serializeRow: () => "" });
  registry.defineSource({
    key: "sales", label: "Sales", params: [], fields,
    paramsSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
    async fetchPage(_db, params, { limit, offset }) {
      calls.push({ params, limit, offset });
      const out = [];
      for (let i = offset; i < Math.min(offset + limit, rows); i++) out.push({ name: `n${i}`, amountCents: i - 5, on: "2026-01-02" });
      return { rows: out, total: rows };
    },
    ...extra,
  });
  return { registry, calls };
}

async function drain(stream) {
  let s = "";
  for await (const chunk of stream) s += chunk;
  return s;
}

test("runExport pages until rows run out and emits header once", async () => {
  const { registry, calls } = setup();
  const r = await runExport({ registry, db: {}, sourceKey: "sales", formatKey: "csv", params: {} });
  const text = await drain(r.stream);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.offset), [0, 1000, 2000]);
  const lines = text.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  assert.equal(lines.length, 2501);
  assert.equal(lines[0], "Name,Amount,On");
  assert.equal(lines[1], "n0,-0.05,2026-01-02");
  assert.equal(await r.countPromise, 2500);
  assert.ok(text.startsWith("﻿"), "csv carries a UTF-8 BOM");
});

test("an exact page multiple does not fetch an empty extra page", async () => {
  const { registry, calls } = setup({ rows: 2000 });
  const r = await runExport({ registry, db: {}, sourceKey: "sales", formatKey: "csv", params: {} });
  await drain(r.stream);
  assert.equal(calls.length, 2);
});

test("unknown format or a format that does not support the source is refused with EXPORT_FORMAT_UNSUPPORTED", async () => {
  const { registry } = setup();
  for (const formatKey of ["nope", "only-other"]) {
    await assert.rejects(
      runExport({ registry, db: {}, sourceKey: "sales", formatKey, params: {} }),
      (e) => e.code === "EXPORT_FORMAT_UNSUPPORTED" && e.statusCode === 422
    );
  }
});

test("unknown source is EXPORT_SOURCE_UNKNOWN (404)", async () => {
  const { registry } = setup();
  await assert.rejects(
    runExport({ registry, db: {}, sourceKey: "nope", formatKey: "csv", params: {} }),
    (e) => e.code === "EXPORT_SOURCE_UNKNOWN" && e.statusCode === 404
  );
});

test("params failing paramsSchema throw EXPORT_PARAMS_INVALID", async () => {
  const { registry } = setup();
  await assert.rejects(
    runExport({ registry, db: {}, sourceKey: "sales", formatKey: "csv", params: { from: 5 } }),
    (e) => e.code === "EXPORT_PARAMS_INVALID" && e.statusCode === 422
  );
  await assert.rejects(previewExport({ registry, db: {}, sourceKey: "sales", params: { from: 5 }, limit: 10, offset: 0 }), (e) => e.code === "EXPORT_PARAMS_INVALID");
});

test("filename is <source>-<from>-<to>.<ext> when both dates exist, else <source>.<ext>", async () => {
  const { registry } = setup({ rows: 1 });
  const a = await runExport({ registry, db: {}, sourceKey: "sales", formatKey: "csv", params: { from: "2026-01-01", to: "2026-01-31" } });
  assert.equal(a.filename, "sales-2026-01-01-2026-01-31.csv");
  assert.equal(a.contentType, "text/csv; charset=utf-8");
  const b = await runExport({ registry, db: {}, sourceKey: "sales", formatKey: "csv", params: { from: "2026-01-01" } });
  assert.equal(b.filename, "sales.csv");
});

test("a value that starts with = is written as text", async () => {
  const { registry } = setup({
    extra: { fetchPage: async () => ({ rows: [{ name: "=HYPERLINK(1)", amountCents: 100, on: null }], total: 1 }) },
  });
  const r = await runExport({ registry, db: {}, sourceKey: "sales", formatKey: "csv", params: {} });
  const text = await drain(r.stream);
  assert.match(text, /'=HYPERLINK\(1\),1\.00,\r\n/);
});

test("previewExport returns one page, the total and the fields", async () => {
  const { registry, calls } = setup();
  const p = await previewExport({ registry, db: {}, sourceKey: "sales", params: {}, limit: 5, offset: 10 });
  assert.equal(p.rows.length, 5);
  assert.equal(p.total, 2500);
  assert.deepEqual(p.fields, fields);
  assert.deepEqual(calls[0], { params: {}, limit: 5, offset: 10 });
});
