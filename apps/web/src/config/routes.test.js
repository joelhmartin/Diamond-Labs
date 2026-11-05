import { test } from "vitest";
import assert from "node:assert/strict";
import { roleHome, ROUTES, labOrderPath, shipmentPrintPath } from "./routes.js";

test("admin roleHome is /lab/dashboard, lab is /lab", () => {
  assert.equal(roleHome({ role: "lab" }), ROUTES.LAB_BOARD);
  assert.equal(roleHome({ role: "lab" }), "/lab");
  assert.equal(roleHome({ role: "admin" }), ROUTES.LAB_DASHBOARD_HOME);
  assert.equal(roleHome({ role: "admin" }), "/lab/dashboard");
  assert.equal(roleHome({ role: "user" }), ROUTES.DASHBOARD);
  assert.equal(labOrderPath("abc"), "/lab/orders/abc");
});

test("the label print page and Admin › Shipments have one path each", () => {
  assert.equal(shipmentPrintPath("sh1"), "/lab/shipments/sh1/print");
  assert.equal(ROUTES.ADMIN_SHIPMENTS, "/admin/shipments");
});
