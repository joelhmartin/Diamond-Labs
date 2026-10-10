import { test } from "vitest";
import assert from "node:assert/strict";
import { roleToggle, sourceLabel } from "../staff.js";

test("only plain users and lab staff get the lab-access toggle, never yourself", () => {
  assert.deepEqual(roleToggle({ id: "u1", role: "user" }, "a1"), { role: "lab", label: "Make lab staff" });
  assert.deepEqual(roleToggle({ id: "u1", role: "lab" }, "a1"), { role: "user", label: "Remove lab access" });
  assert.equal(roleToggle({ id: "d1", role: "doctor" }, "a1"), null);
  assert.equal(roleToggle({ id: "a2", role: "admin" }, "a1"), null);
  assert.equal(roleToggle({ id: "a1", role: "user" }, "a1"), null);
});

test("order sources read as words", () => {
  assert.equal(sourceLabel("rx_case"), "Rx case");
  assert.equal(sourceLabel("shop_order"), "Shop order");
});
