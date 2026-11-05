import { test } from "vitest";
import assert from "node:assert/strict";
import { createExportRegistry } from "./registry.js";

const source = (key) => ({ key, label: key, params: [], fields: [{ key: "a", label: "A", type: "text" }], fetchPage: async () => ({ rows: [], total: 0 }) });
const format = (key, supports) => ({ key, label: key, extension: key, contentType: "text/plain", supports, serializeRow: () => "" });

test("duplicate source key throws", () => {
  const r = createExportRegistry();
  r.defineSource(source("sales"));
  assert.throws(() => r.defineSource(source("sales")), /sales/);
});

test("duplicate format key throws", () => {
  const r = createExportRegistry();
  r.defineFormat(format("csv", () => true));
  assert.throws(() => r.defineFormat(format("csv", () => true)), /csv/);
});

test("list() shows only formats whose supports() accepts the source", () => {
  const r = createExportRegistry();
  r.defineFormat(format("csv", () => true));
  r.defineFormat(format("iif", (s) => s.key === "sales"));
  r.defineSource(source("sales"));
  r.defineSource(source("stock"));
  const list = r.list();
  assert.deepEqual(list.map((s) => [s.key, s.formats]), [["sales", [{ key: "csv", label: "csv", extension: "csv" }, { key: "iif", label: "iif", extension: "iif" }]], ["stock", [{ key: "csv", label: "csv", extension: "csv" }]]]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["fields", "formats", "key", "label", "params"]);
});

test("source() and format() return undefined for unknown keys", () => {
  const r = createExportRegistry();
  assert.equal(r.source("nope"), undefined);
  assert.equal(r.format("nope"), undefined);
});
