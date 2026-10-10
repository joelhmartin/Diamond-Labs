import { test } from "vitest";
import assert from "node:assert/strict";
import { roleChangeRefusal } from "./staff-roles.js";

test("an admin can make a plain user lab staff and back", () => {
  assert.equal(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "user" }, role: "lab" }), null);
  assert.equal(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "lab" }, role: "user" }), null);
});

test("admins, doctors and yourself are out of bounds", () => {
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "a1", role: "user" }, role: "lab" }), /your own role/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "a2", role: "admin" }, role: "lab" }), /Admin and doctor/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "d1", role: "doctor" }, role: "lab" }), /Admin and doctor/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "user" }, role: "admin" }), /Only lab staff/);
});
