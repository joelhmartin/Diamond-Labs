import { test } from "vitest";
import assert from "node:assert/strict";
import { ROUTES, accountPathFor, isPortalHome, roleHome } from "./routes.js";
import { passwordSchema } from "../components/account/ProfileForms.jsx";

test("portal homes are the doctor portal and the pending page, never the staff shell", () => {
  assert.equal(isPortalHome(roleHome({ role: "doctor", approvalStatus: "approved" })), true);
  assert.equal(isPortalHome(roleHome({ role: "doctor", approvalStatus: "pending" })), true);
  assert.equal(isPortalHome(roleHome({ role: "admin" })), false);
  assert.equal(isPortalHome(roleHome({ role: "user" })), false);
});

test("the account menu links doctors to their Account page, staff to Settings, pending doctors nowhere", () => {
  assert.equal(accountPathFor(roleHome({ role: "doctor", approvalStatus: "approved" })), ROUTES.DOCTOR_ACCOUNT);
  assert.equal(accountPathFor(roleHome({ role: "admin" })), ROUTES.SETTINGS);
  assert.equal(accountPathFor(roleHome({ role: "doctor", approvalStatus: "pending" })), null);
});

test("a new password must match its confirmation and meet the shared rules", () => {
  const ok = { currentPassword: "x", newPassword: "LongEnough123", confirmPassword: "LongEnough123" };
  assert.equal(passwordSchema.safeParse(ok).success, true);
  assert.equal(passwordSchema.safeParse({ ...ok, confirmPassword: "Different123x" }).success, false);
  assert.equal(passwordSchema.safeParse({ ...ok, newPassword: "short1A", confirmPassword: "short1A" }).success, false);
});
