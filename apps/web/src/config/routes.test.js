import { test } from "vitest";
import assert from "node:assert/strict";
import { roleHome, ROUTES, labOrderPath, shipmentPrintPath } from "./routes.js";

test("lab staff land on the production board", () => {
  assert.equal(roleHome({ role: "lab" }), ROUTES.LAB_BOARD);
  assert.equal(roleHome({ role: "admin" }), ROUTES.DASHBOARD);
  assert.equal(labOrderPath("abc"), "/lab/orders/abc");
});

test("routes include ADMIN_SCHEDULING and LAB_CALENDAR", () => {
  assert.equal(ROUTES.ADMIN_SCHEDULING, "/admin/scheduling");
  assert.equal(ROUTES.LAB_CALENDAR, "/lab/calendar");
});

test("the label print page and Admin › Shipments have one path each", () => {
  assert.equal(shipmentPrintPath("sh1"), "/lab/shipments/sh1/print");
  assert.equal(ROUTES.ADMIN_SHIPMENTS, "/admin/shipments");
});
