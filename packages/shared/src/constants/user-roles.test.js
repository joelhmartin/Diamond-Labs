import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_ROLES, isStaffRole } from "./user-roles.js";

test("staff are admins and lab technicians, nobody else", () => {
  assert.deepEqual([...STAFF_ROLES], ["admin", "lab"]);
  assert.equal(Object.isFrozen(STAFF_ROLES), true);
  assert.equal(isStaffRole("admin"), true);
  assert.equal(isStaffRole("lab"), true);
  for (const r of ["doctor", "user", "", null, undefined]) assert.equal(isStaffRole(r), false, String(r));
});
