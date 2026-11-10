import { test } from "vitest";
import assert from "node:assert/strict";
import { isPortalHome, roleHome } from "./routes.js";

test("portal homes are the doctor portal and the pending page, never the staff shell", () => {
  assert.equal(isPortalHome(roleHome({ role: "doctor", approvalStatus: "approved" })), true);
  assert.equal(isPortalHome(roleHome({ role: "doctor", approvalStatus: "pending" })), true);
  assert.equal(isPortalHome(roleHome({ role: "admin" })), false);
  assert.equal(isPortalHome(roleHome({ role: "user" })), false);
});
