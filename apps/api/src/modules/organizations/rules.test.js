import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveScope, mayAdminister } from "./rules.js";

const mem = (accountId, over = {}) => ({ accountId, role: "member", status: "active", accountActive: true, accountEligible: true, ...over });
const orgAcc = (organizationId, accountId, over = {}) => ({ organizationId, accountId, accountActive: true, accountEligible: true, ...over });
const grant = (organizationId, over = {}) => ({ organizationId, status: "active", organizationActive: true, ...over });

test("removed membership drops the account", () => {
  const s = resolveScope({ memberships: [mem("a1", { status: "removed" })], adminOf: [], orgAccounts: [] });
  assert.deepEqual(s.accountIds, []);
});

test("removed admin drops the group's accounts", () => {
  const s = resolveScope({ memberships: [], adminOf: [grant("o1", { status: "removed" })], orgAccounts: [orgAcc("o1", "a1")] });
  assert.deepEqual(s.accountIds, []);
  assert.deepEqual(s.organizations, []);
});

test("archived organization grants nothing", () => {
  const s = resolveScope({ memberships: [], adminOf: [grant("o1", { organizationActive: false })], orgAccounts: [orgAcc("o1", "a1")] });
  assert.deepEqual(s.accountIds, []);
});

test("org admin sees every eligible active account in the org", () => {
  const s = resolveScope({
    memberships: [],
    adminOf: [grant("o1")],
    orgAccounts: [orgAcc("o1", "a2"), orgAcc("o1", "a1"), orgAcc("o1", "a3", { accountActive: false })],
  });
  assert.deepEqual(s.accountIds, ["a1", "a2"]);
  assert.deepEqual(s.organizations, [{ id: "o1", accountIds: ["a1", "a2"] }]);
  assert.equal(s.via.get("a1"), "org-admin");
});

test("org-admin grant wins over a viewer membership", () => {
  const s = resolveScope({ memberships: [mem("a1", { role: "viewer" })], adminOf: [grant("o1")], orgAccounts: [orgAcc("o1", "a1")] });
  assert.equal(s.roles.get("a1"), "org-admin");
  assert.equal(s.via.get("a1"), "org-admin");
  assert.equal(mayAdminister(s, "a1"), true);
});

test("a member-only account keeps its role and is not administered", () => {
  const s = resolveScope({ memberships: [mem("a1", { role: "viewer" })], adminOf: [], orgAccounts: [] });
  assert.equal(s.roles.get("a1"), "viewer");
  assert.equal(s.via.get("a1"), "member");
  assert.equal(mayAdminister(s, "a1"), false);
});

test("ineligible accounts are never in scope", () => {
  const s = resolveScope({
    memberships: [mem("a1", { accountEligible: false })],
    adminOf: [grant("o1")],
    orgAccounts: [orgAcc("o1", "a2", { accountEligible: false })],
  });
  assert.deepEqual(s.accountIds, []);
});
