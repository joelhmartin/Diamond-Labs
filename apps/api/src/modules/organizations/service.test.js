import { test } from "vitest";
import assert from "node:assert/strict";

const { createOrganizationsService } = await import("./service.js");
const { fakeTx } = await import("../../test/fake-tx.js");

function build() {
  const audits = [];
  const svc = createOrganizationsService({ audit: (e) => audits.push(e) });
  return { svc, audits };
}
const ORG = { id: "o1", name: "North Group", settings: { combinedStatement: false }, status: "active" };
// Replace tx.insert with one that records values and resolves `.returning()` via returnFn(values).
function stubInsert(tx, returnFn = (vals) => vals.map((v) => ({ accountId: v.accountId }))) {
  tx.insert = () => {
    const entry = { op: "insert" };
    tx.log.push(entry);
    const b = {
      values: (v) => { entry.values = v; return b; },
      onConflictDoNothing: () => b,
      returning: async () => returnFn(entry.values),
    };
    return b;
  };
}
const inserts = (tx) => tx.log.filter((e) => e.op === "insert");

test("createOrganization writes the row and audits ids only", async () => {
  const tx = fakeTx({ selects: [[]] });
  const { svc, audits } = build();
  const org = await svc.createOrganization({ name: "  North Group ", settings: {}, byUserId: "u1" }, tx);
  assert.equal(org.name, "North Group");
  assert.deepEqual(org.settings, { combinedStatement: false });
  assert.equal(inserts(tx).length, 1);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { userId: "u1", action: "organization.created", targetType: "organization", targetId: org.id, metadata: {} });
});

test("a name taken (case-insensitive) is a CONFLICT and nothing is written", async () => {
  const tx = fakeTx({ selects: [[{ id: "other" }]] });
  const { svc, audits } = build();
  await assert.rejects(() => svc.createOrganization({ name: "north group", byUserId: "u1" }, tx), (e) => e.code === "CONFLICT");
  assert.equal(inserts(tx).length, 0);
  assert.equal(audits.length, 0);
});

test("a unique-index violation on insert is also a CONFLICT", async () => {
  const tx = fakeTx({ selects: [[]] });
  tx.insert = () => ({ values: async () => { throw Object.assign(new Error("dup"), { code: "23505" }); } });
  const { svc } = build();
  await assert.rejects(() => svc.createOrganization({ name: "X", byUserId: "u1" }, tx), (e) => e.code === "CONFLICT");
});

test("updateOrganization merges settings and audits the field names only", async () => {
  const tx = fakeTx({ selects: [[ORG]] });
  const { svc, audits } = build();
  const org = await svc.updateOrganization("o1", { settings: { combinedStatement: true }, status: "archived" }, "u1", tx);
  assert.deepEqual(org.settings, { combinedStatement: true });
  assert.equal(org.status, "archived");
  assert.deepEqual(audits[0].metadata, { fields: ["settings", "status"] });
});

test("updateOrganization of an unknown id is NOT_FOUND", async () => {
  const tx = fakeTx({ selects: [[]] });
  const { svc } = build();
  await assert.rejects(() => svc.updateOrganization("nope", { status: "archived" }, "u1", tx), (e) => e.code === "NOT_FOUND");
});

test("addAccounts refuses an account already in another organization", async () => {
  const tx = fakeTx({ selects: [[ORG], [{ organizationId: "o2", accountId: "a2" }]] });
  stubInsert(tx);
  const { svc, audits } = build();
  const out = await svc.addAccounts("o1", ["a1", "a2"], { byUserId: "u1", exists: async (ids) => new Set(ids) }, tx);
  assert.deepEqual(out, { added: ["a1"], alreadyInOther: ["a2"] });
  const [ins] = inserts(tx);
  assert.deepEqual(ins.values.map((v) => v.accountId), ["a1"]);
  assert.deepEqual(audits[0].metadata, { accountIds: ["a1"] });
});

test("addAccounts reports an account claimed concurrently as alreadyInOther and audits only inserted ids", async () => {
  const tx = fakeTx({ selects: [[ORG], []] });
  stubInsert(tx, () => [{ accountId: "a1" }]); // a2 lost the race: the insert returned fewer rows than sent
  const { svc, audits } = build();
  const out = await svc.addAccounts("o1", ["a1", "a2"], { byUserId: "u1", exists: async (ids) => new Set(ids) }, tx);
  assert.deepEqual(out, { added: ["a1"], alreadyInOther: ["a2"] });
  assert.deepEqual(audits[0].metadata, { accountIds: ["a1"] });
});

test("addAccounts treats an account already in this organization as a no-op", async () => {
  const tx = fakeTx({ selects: [[ORG], [{ organizationId: "o1", accountId: "a1" }]] });
  const { svc, audits } = build();
  const out = await svc.addAccounts("o1", ["a1"], { byUserId: "u1", exists: async (ids) => new Set(ids) }, tx);
  assert.deepEqual(out, { added: [], alreadyInOther: [] });
  assert.equal(inserts(tx).length, 0);
  assert.equal(audits.length, 0);
});

test("addAccounts refuses unknown account ids without writing", async () => {
  const tx = fakeTx({ selects: [[ORG]] });
  const { svc } = build();
  await assert.rejects(
    () => svc.addAccounts("o1", ["a1", "ghost"], { byUserId: "u1", exists: async () => new Set(["a1"]) }, tx),
    (e) => e.code === "INVALID",
  );
  assert.equal(inserts(tx).length, 0);
});

test("addAccounts to an archived organization is refused", async () => {
  const tx = fakeTx({ selects: [[{ ...ORG, status: "archived" }]] });
  const { svc } = build();
  await assert.rejects(() => svc.addAccounts("o1", ["a1"], { byUserId: "u1", exists: async (i) => new Set(i) }, tx), (e) => e.code === "INVALID");
});

test("removeAccount deletes the link and audits ids", async () => {
  const tx = fakeTx({ selects: [[{ organizationId: "o1", accountId: "a1" }]] });
  const { svc, audits } = build();
  await svc.removeAccount("o1", "a1", { byUserId: "u1" }, tx);
  assert.equal(tx.log.filter((e) => e.op === "delete").length, 1);
  assert.deepEqual(audits[0], { userId: "u1", action: "organization.account_removed", targetType: "organization", targetId: "o1", metadata: { accountId: "a1" } });
});

test("removeAccount for an account not in the organization is NOT_FOUND", async () => {
  const tx = fakeTx({ selects: [[]] });
  const { svc } = build();
  await assert.rejects(() => svc.removeAccount("o1", "a1", { byUserId: "u1" }, tx), (e) => e.code === "NOT_FOUND");
});

test("addAdmin and removeAdmin audit the user id only", async () => {
  const tx = fakeTx({ selects: [[ORG], [{ id: "g1", status: "active" }]] });
  const { svc, audits } = build();
  await svc.addAdmin("o1", "u9", { byUserId: "u1" }, tx);
  await svc.removeAdmin("o1", "u9", { byUserId: "u1" }, tx);
  assert.deepEqual(audits.map((a) => [a.action, a.metadata]), [
    ["organization.admin_added", { userId: "u9" }],
    ["organization.admin_removed", { userId: "u9" }],
  ]);
});

test("addAdmin refuses an unknown user when an exists check is given", async () => {
  const tx = fakeTx({ selects: [[ORG]] });
  const { svc } = build();
  await assert.rejects(() => svc.addAdmin("o1", "ghost", { byUserId: "u1", exists: async () => false }, tx), (e) => e.code === "INVALID");
  assert.equal(inserts(tx).length, 0);
});

test("getOrganization returns the account ids and admins", async () => {
  const tx = fakeTx({ selects: [[ORG], [{ accountId: "a2" }, { accountId: "a1" }], [{ userId: "u9", status: "active" }]] });
  const { svc } = build();
  const out = await svc.getOrganization("o1", tx);
  assert.deepEqual(out.accountIds, ["a1", "a2"]);
  assert.deepEqual(out.admins, [{ userId: "u9", status: "active" }]);
});

test("organizationOf maps each account to its active organization", async () => {
  const tx = fakeTx({ selects: [[{ accountId: "a1", id: "o1", name: "North Group", settings: { combinedStatement: true } }]] });
  const { svc } = build();
  const map = await svc.organizationOf(["a1", "a2"], tx);
  assert.deepEqual([...map.keys()], ["a1"]);
  assert.deepEqual(map.get("a1"), { id: "o1", name: "North Group", settings: { combinedStatement: true } });
});

test("activeAdminIds lists the organization's active admins only", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const calls = [];
  const db = drizzle(async (sql, params) => { calls.push({ sql, params }); return { rows: [["u1"], ["u2"]] }; });
  const { svc } = build();
  assert.deepEqual(await svc.activeAdminIds("o1", db), ["u1", "u2"]);
  assert.match(calls[0].sql, /"organization_admins"\."organization_id" = \$1 and "organization_admins"\."status" = \$2/);
  assert.deepEqual(calls[0].params, ["o1", "active"]);
  assert.deepEqual(await svc.activeAdminIds(null, db), []);
  assert.equal(calls.length, 1);
});

test("scopeForUser combines glue memberships with organization admin grants", async () => {
  const tx = fakeTx({
    selects: [
      [{ organizationId: "o1", status: "active", organizationActive: true }],
      [{ organizationId: "o1", accountId: "a2" }, { organizationId: "o1", accountId: "a3" }],
    ],
  });
  const { svc } = build();
  const eligibleCalls = [];
  const scope = await svc.scopeForUser("u1", {
    loadMemberships: async () => [{ accountId: "a1", role: "viewer", status: "active", accountActive: true }],
    eligibleAccounts: async (ids) => { eligibleCalls.push(ids); return new Set(ids.filter((id) => id !== "a3")); },
  }, tx);
  assert.equal(eligibleCalls.length, 1, "one eligibility lookup per scope resolution");
  assert.deepEqual([...eligibleCalls[0]].sort(), ["a1", "a2", "a3"]);
  assert.deepEqual(scope.accountIds, ["a1", "a2"]);
  assert.equal(scope.roles.get("a1"), "viewer");
  assert.equal(scope.via.get("a2"), "org-admin");
});

test("a user with no admin grants never queries organization accounts", async () => {
  const tx = fakeTx({ selects: [[]] });
  const { svc } = build();
  const scope = await svc.scopeForUser("u1", { loadMemberships: async () => [], eligibleAccounts: async (ids) => new Set(ids) }, tx);
  assert.deepEqual(scope.accountIds, []);
  assert.equal(tx.log.filter((e) => e.op === "select").length, 1);
});

test("createOrganization refuses unknown settings keys from a direct caller", async () => {
  const tx = fakeTx({ selects: [[]] });
  const { svc } = build();
  await assert.rejects(() => svc.createOrganization({ name: "X", settings: { bogus: true }, byUserId: "u1" }, tx), (e) => e.code === "INVALID");
  assert.equal(inserts(tx).length, 0);
});

test("updateOrganization refuses unknown settings keys from a direct caller", async () => {
  const tx = fakeTx({ selects: [[ORG]] });
  const { svc } = build();
  await assert.rejects(() => svc.updateOrganization("o1", { settings: { bogus: 1 } }, "u1", tx), (e) => e.code === "INVALID");
  assert.equal(tx.log.filter((e) => e.op === "update").length, 0);
});

test("listOrganizations returns rows and the total", async () => {
  const tx = fakeTx({ selects: [[{ ...ORG, accountCount: 2, adminCount: 1 }], [{ total: 1 }]] });
  const { svc } = build();
  const out = await svc.listOrganizations({ q: "north", status: "active", limit: 25, offset: 0 }, tx);
  assert.equal(out.total, 1);
  assert.equal(out.rows[0].accountCount, 2);
});
