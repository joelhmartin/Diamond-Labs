import { test } from "vitest";
import assert from "node:assert/strict";
import { roleHome, isPortalHome, accountPathFor, ROUTES, labOrderPath, shipmentPrintPath } from "./routes.js";
import { passwordSchema } from "../components/account/ProfileForms.jsx";

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

test("portal homes are the doctor portal and the pending page, never the staff shell", () => {
  assert.equal(isPortalHome(roleHome({ role: "doctor", approvalStatus: "approved" })), true);
  assert.equal(isPortalHome(roleHome({ role: "doctor", approvalStatus: "pending" })), true);
  assert.equal(isPortalHome(roleHome({ role: "user" }, { hasPractices: true })), true);
  assert.equal(isPortalHome(roleHome({ role: "admin" })), false);
  assert.equal(isPortalHome(roleHome({ role: "lab" })), false);
  assert.equal(isPortalHome(roleHome({ role: "user" })), false);
});

test("the account menu links portal logins to their Account page, staff to Settings, pending doctors nowhere", () => {
  assert.equal(accountPathFor(roleHome({ role: "doctor", approvalStatus: "approved" })), ROUTES.DOCTOR_ACCOUNT);
  assert.equal(accountPathFor(roleHome({ role: "user" }, { hasPractices: true })), ROUTES.DOCTOR_ACCOUNT);
  assert.equal(accountPathFor(roleHome({ role: "admin" })), ROUTES.SETTINGS);
  assert.equal(accountPathFor(roleHome({ role: "doctor", approvalStatus: "pending" })), null);
});

test("a new password must match its confirmation and meet the shared rules", () => {
  const ok = { currentPassword: "x", newPassword: "LongEnough123", confirmPassword: "LongEnough123" };
  assert.equal(passwordSchema.safeParse(ok).success, true);
  assert.equal(passwordSchema.safeParse({ ...ok, confirmPassword: "Different123x" }).success, false);
  assert.equal(passwordSchema.safeParse({ ...ok, newPassword: "short1A", confirmPassword: "short1A" }).success, false);
});
