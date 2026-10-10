import { test } from "vitest";
import assert from "node:assert/strict";
import { sourceLabel } from "../staff.js";

test("order sources read as words", () => {
  assert.equal(sourceLabel("rx_case"), "Rx case");
  assert.equal(sourceLabel("shop_order"), "Shop order");
});
