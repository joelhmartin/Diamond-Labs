import { test } from "vitest";
import assert from "node:assert/strict";
import { DEVICE_ROWS } from "./devices.table.js";

test("every row has a stable slug mapKey and at least one match literal", () => {
  for (const r of DEVICE_ROWS) {
    assert.match(r.mapKey, /^primary:[a-z-]+:[a-z0-9-]+$/, `bad mapKey: ${r.mapKey}`);
    assert.ok(Array.isArray(r.match) && r.match.length > 0, `no match[] on ${r.mapKey}`);
    assert.ok(["confirmed", "proposed", "open"].includes(r.status), `bad status on ${r.mapKey}`);
  }
});

test("mapKeys are unique", () => {
  const seen = new Set();
  for (const r of DEVICE_ROWS) {
    assert.ok(!seen.has(r.mapKey), `duplicate mapKey: ${r.mapKey}`);
    seen.add(r.mapKey);
  }
});

test("DDSO Nylon resolves to 2608, not the retired 2147", () => {
  const row = DEVICE_ROWS.find((r) => r.mapKey === "primary:ddso:nylon");
  assert.equal(row.code, "2608");
  assert.ok(row.match.includes("NYLON"));
});
