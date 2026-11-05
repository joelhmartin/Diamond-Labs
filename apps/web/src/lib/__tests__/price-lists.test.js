import { test } from "vitest";
import assert from "node:assert/strict";
import { adjustByPercent, sourceChip } from "../price-lists.js";

test("adjustByPercent rounds half away from zero to the cent", () => {
  assert.equal(adjustByPercent(1005, -10), 905);
  assert.equal(adjustByPercent(1000, 12.5), 1125);
  assert.equal(adjustByPercent(1001, 50), 1502); // 1501.5 rounds up
  assert.equal(adjustByPercent(1000, -100), 0);
  assert.equal(adjustByPercent(1000, -150), 0); // never negative
});

test("sourceChip names the origin of an effective price", () => {
  assert.deepEqual(sourceChip({ source: "client" }), { label: "Client", tone: "client" });
  assert.deepEqual(sourceChip({ source: "list", listName: "Gold" }), { label: "List: Gold", tone: "list" });
  assert.deepEqual(sourceChip(null), { label: "Base", tone: "base" });
});
