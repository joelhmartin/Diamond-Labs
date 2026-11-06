import { test } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";

process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

const { listClientCases, loadClientCase } = await import("./client-cases.js");
const { toClientScope } = await import("../client-scope-rules.js");

// Each query answers the next queued row set; the SQL and params are recorded. No database.
function queueDb(...rowSets) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    return { rows: rowSets.shift() ?? [] };
  });
  return { db, calls };
}

const scopeOf = (roles, via = {}) => toClientScope({ accountIds: Object.keys(roles), roles: new Map(Object.entries(roles)), via: new Map(Object.entries(via)), organizations: [] });
// A group admin of A and B; practice A's (non-doctor) staff member.
const groupAdmin = { id: "ga", role: "user", scope: scopeOf({ A: "org-admin", B: "org-admin" }, { A: "org-admin", B: "org-admin" }) };
const staffOfA = { id: "mA", role: "user", scope: scopeOf({ A: "member" }) };
const noPractice = { id: "d6", role: "doctor", approvalStatus: "approved", scope: scopeOf({}) };

test("My Cases in all practices lists both practices for a group admin and one for staff", async () => {
  const admin = queueDb([]);
  await listClientCases(groupAdmin, undefined, { database: admin.db });
  assert.match(admin.calls[0].sql, /"rx_cases"\."account_id" in \(\$1, \$2\)/);
  assert.deepEqual(admin.calls[0].params.slice(0, 2), ["A", "B"]);
  assert.match(admin.calls[0].sql, /order by "rx_cases"\."created_at" desc/);

  const member = queueDb([]);
  await listClientCases(staffOfA, "all", { database: member.db });
  assert.match(member.calls[0].sql, /"rx_cases"\."account_id" in \(\$1\)/);
  assert.deepEqual(member.calls[0].params.slice(0, 1), ["A"]);
  // The owner no longer matters: nothing filters by user_id.
  assert.doesNotMatch(member.calls[0].sql, /"user_id" =/);

  // One practice of the group, by ?account=.
  const one = queueDb([]);
  await listClientCases(groupAdmin, "B", { database: one.db });
  assert.deepEqual(one.calls[0].params.slice(0, 1), ["B"]);
});

test("a sibling ?account= is 404, and an empty scope reads nothing", async () => {
  const { db, calls } = queueDb();
  await assert.rejects(listClientCases(staffOfA, "B", { database: db }), (e) => e.statusCode === 404 && e.code === "NOT_FOUND");
  assert.deepEqual(await listClientCases(noPractice, undefined, { database: db }), []);
  assert.equal(calls.length, 0);
});

test("a case of a sibling practice, or with no practice, reads as not found to a client", async () => {
  const pick = async (user, accountId) => loadClientCase(user, "c1", { database: { select: () => ({ from: () => ({ where: async () => [{ id: "c1", accountId, userId: "d6" }] }) }) } });
  assert.equal(await pick(staffOfA, "B"), null);
  assert.equal((await pick(staffOfA, "A")).id, "c1");
  assert.equal((await pick(groupAdmin, "B")).id, "c1");
  // A null account fails closed, even for the case's owner.
  assert.equal(await pick(noPractice, null), null);
  assert.equal(await pick({ ...staffOfA, id: "d6" }, null), null);
  const missing = { select: () => ({ from: () => ({ where: async () => [] }) }) };
  assert.equal(await loadClientCase(staffOfA, "nope", { database: missing }), null);
});
