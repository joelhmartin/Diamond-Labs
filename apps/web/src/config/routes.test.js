import { test } from "vitest";
import assert from "node:assert/strict";
import { roleHome, ROUTES, labOrderPath } from "./routes.js";

test("lab staff land on the production board", () => {
  assert.equal(roleHome({ role: "lab" }), ROUTES.LAB_BOARD);
  assert.equal(roleHome({ role: "admin" }), ROUTES.DASHBOARD);
  assert.equal(labOrderPath("abc"), "/lab/orders/abc");
});
