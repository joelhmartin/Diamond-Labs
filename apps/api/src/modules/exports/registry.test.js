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

test("a source field needs a known column type (money, not cents)", () => {
  const r = createExportRegistry();
  assert.throws(() => r.defineSource({ ...source("sales"), fields: [{ key: "t", label: "T", type: "cents" }] }), /unknown type "cents"/);
  assert.throws(() => r.defineSource({ ...source("sales"), fields: [] }), /needs fields/);
  r.defineSource({ ...source("sales"), fields: [{ key: "t", label: "T", type: "money" }] });
});

test("params are report param specs: a name, a known type, no lookups", () => {
  const r = createExportRegistry();
  assert.throws(() => r.defineSource({ ...source("a"), params: [{ id: "from", type: "date" }] }), /needs a name/);
  assert.throws(() => r.defineSource({ ...source("b"), params: [{ name: "x", type: "calendar" }] }), /unknown type/);
  assert.throws(() => r.defineSource({ ...source("c"), params: [{ name: "x", type: "lookup", source: "s" }] }), /not supported/);
  r.defineSource({ ...source("d"), params: [{ name: "from", type: "date" }, { name: "k", type: "multiselect", options: ["a"] }] });
});

test("source() and format() return undefined for unknown keys", () => {
  const r = createExportRegistry();
  assert.equal(r.source("nope"), undefined);
  assert.equal(r.format("nope"), undefined);
});
