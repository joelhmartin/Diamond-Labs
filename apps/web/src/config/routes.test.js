import { test } from "vitest";
import assert from "node:assert/strict";
import { ROUTES, roleHome, usesAppShell } from "./routes.js";

test("doctors stay out of the staff app shell; staff use it", () => {
  assert.equal(usesAppShell({ role: "doctor", approvalStatus: "approved" }), false);
  assert.equal(usesAppShell({ role: "doctor", approvalStatus: "pending" }), false);
  assert.equal(usesAppShell({ role: "admin" }), true);
  assert.equal(usesAppShell({ role: "user" }), true);
});

test("a doctor sent away from the app shell lands on their portal", () => {
  assert.equal(roleHome({ role: "doctor", approvalStatus: "approved" }), ROUTES.DOCTOR_INVOICES);
});
