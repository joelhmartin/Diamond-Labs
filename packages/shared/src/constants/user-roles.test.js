import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_ROLES, isStaffRole, roleToggleFor, roleChangeRefusal, ROLE_CHANGE_CHOICES } from "./user-roles.js";

test("staff are admins and lab technicians, nobody else", () => {
  assert.deepEqual([...STAFF_ROLES], ["admin", "lab"]);
  assert.equal(Object.isFrozen(STAFF_ROLES), true);
  assert.equal(isStaffRole("admin"), true);
  assert.equal(isStaffRole("lab"), true);
  for (const r of ["doctor", "user", "", null, undefined]) assert.equal(isStaffRole(r), false, String(r));
});

test("only plain users and lab staff get the lab-access toggle, never yourself", () => {
  assert.deepEqual([...ROLE_CHANGE_CHOICES], ["lab", "user"]);
  assert.deepEqual(roleToggleFor({ id: "u1", role: "user" }, "a1"), { role: "lab", label: "Make lab staff" });
  assert.deepEqual(roleToggleFor({ id: "u1", role: "lab" }, "a1"), { role: "user", label: "Remove lab access" });
  assert.equal(roleToggleFor({ id: "d1", role: "doctor" }, "a1"), null);
  assert.equal(roleToggleFor({ id: "a2", role: "admin" }, "a1"), null);
  assert.equal(roleToggleFor({ id: "a1", role: "user" }, "a1"), null);
});

test("the API refuses exactly what the UI doesn't offer", () => {
  assert.equal(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "user" }, role: "lab" }), null);
  assert.equal(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "lab" }, role: "user" }), null);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "a1", role: "user" }, role: "lab" }), /your own role/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "a2", role: "admin" }, role: "lab" }), /Admin and doctor/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "d1", role: "doctor" }, role: "lab" }), /Admin and doctor/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "user" }, role: "admin" }), /Only lab staff/);
});
