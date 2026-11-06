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

test("routes include ADMIN_SCHEDULING and LAB_CALENDAR", () => {
  assert.equal(ROUTES.ADMIN_SCHEDULING, "/admin/scheduling");
  assert.equal(ROUTES.LAB_CALENDAR, "/lab/calendar");
});

test("the label print page and Admin › Shipments have one path each", () => {
  assert.equal(shipmentPrintPath("sh1"), "/lab/shipments/sh1/print");
  assert.equal(ROUTES.ADMIN_SHIPMENTS, "/admin/shipments");
});

test("the New order route is declared before the order detail route", () => {
  const keys = Object.keys(ROUTES);
  assert.ok(keys.indexOf("LAB_ORDER_NEW") >= 0 && keys.indexOf("LAB_ORDER_NEW") < keys.indexOf("LAB_ORDER_DETAIL"));
  assert.equal(ROUTES.LAB_ORDER_NEW, "/lab/orders/new");
});

test("a practice login that is not a doctor lands in the portal; staff never do", () => {
  assert.equal(roleHome({ role: "user" }, { hasPractices: true }), ROUTES.DOCTOR_INVOICES);
  assert.equal(roleHome({ role: "user" }, { hasPractices: false }), ROUTES.DASHBOARD);
  assert.equal(roleHome({ role: "admin" }, { hasPractices: true }), ROUTES.LAB_DASHBOARD_HOME);
  assert.equal(roleHome({ role: "lab" }, { hasPractices: true }), ROUTES.LAB_BOARD);
});
