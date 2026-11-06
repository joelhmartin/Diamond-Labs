import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";

// A real drizzle query builder over a recording driver: each query answers the
// next queued row set (arrays in the select's column order); no database.
function queueDb(...rowSets) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    return { rows: rowSets.shift() ?? [] };
  });
  return { db, calls };
}

// authenticate reads the app db; each test points it at its own queue.
const holder = { db: null };
vi.mock("../config/database.js", () => ({
  get db() { return holder.db; },
}));

const { loadClientScope, requireClientPortal, canActForAccount, requestedAccounts, emptyClientScope, toClientScope } = await import("./client-scope.js");
const { authenticate } = await import("../middleware/authenticate.js");
const { signAccessToken } = await import("../lib/tokens.js");

beforeEach(() => { holder.db = null; });

// Row shapes, in select-column order:
const member = (accountId, role = "member") => [accountId, role]; // memberships: accountId, role
const grant = (orgId) => [orgId, "active", true]; // organization_admins: organizationId, status, organizationActive
const orgAccount = (orgId, accountId) => [orgId, accountId]; // organization_accounts
const orgDetail = (orgId, name, settings = {}) => [orgId, name, settings]; // organizations: id, name, settings

test("scope from direct membership only includes client accounts", async () => {
  const { db, calls } = queueDb([member("a1"), member("a2", "viewer")], []);
  const scope = await loadClientScope("u1", db);
  assert.deepEqual(scope.accountIds, ["a1", "a2"]);
  assert.deepEqual([...scope.via], [["a1", "member"], ["a2", "member"]]);
  assert.deepEqual(scope.organizations, []);
  // The direct half is one query that keeps only active memberships in active client accounts.
  const sql = calls[0].sql;
  assert.match(sql, /"memberships"\."status" = \$/);
  assert.match(sql, /"accounts"\."status" = \$/);
  assert.match(sql, /"accounts"\."is_client" = \$/);
  assert.deepEqual(calls[0].params, ["u1", "active", "active", true]);
  // A plain member costs two queries (memberships, admin grants): no per-account lookups.
  assert.equal(calls.length, 2);
});

test("viewer cannot pay", async () => {
  const { db } = queueDb([member("a1", "viewer"), member("a2", "admin")], []);
  const scope = await loadClientScope("u1", db);
  assert.equal(canActForAccount(scope, "a1"), true, "a viewer may read");
  assert.equal(canActForAccount(scope, "a1", { pay: true }), false, "a viewer may not pay");
  assert.equal(canActForAccount(scope, "a2", { pay: true }), true);
});

test("group admin can pay every group account", async () => {
  const { db, calls } = queueDb(
    [member("a1", "viewer")],
    [grant("o1")],
    [orgAccount("o1", "a2"), orgAccount("o1", "a3"), orgAccount("o1", "a4")],
    [["a2"], ["a3"]], // eligibility of the group's accounts: a4 is not an active client account
    [orgDetail("o1", "North Group", { combinedStatement: true })],
  );
  const scope = await loadClientScope("admin1", db);
  assert.deepEqual(scope.accountIds, ["a1", "a2", "a3"]);
  for (const a of ["a2", "a3"]) {
    assert.equal(canActForAccount(scope, a, { pay: true }), true, a);
    assert.equal(scope.via.get(a), "org-admin");
  }
  assert.equal(canActForAccount(scope, "a4"), false, "an inactive or non-client account in the group grants nothing");
  assert.equal(canActForAccount(scope, "a1", { pay: true }), false, "outside the group, still a viewer");
  assert.deepEqual(scope.organizations, [{ id: "o1", name: "North Group", combinedStatement: true, accountIds: ["a2", "a3"] }]);
  // Only the organization accounts were checked for eligibility, in one query.
  const elig = calls[3];
  assert.match(elig.sql, /"accounts"\."is_client" = \$/);
  assert.deepEqual(elig.params.slice(0, 3), ["a2", "a3", "a4"]);
  assert.equal(calls.length, 5);
});

test("a group-admin grant wins over a viewer membership in the same practice", async () => {
  const { db } = queueDb([member("a2", "viewer")], [grant("o1")], [orgAccount("o1", "a2")], [], [orgDetail("o1", "G")]);
  const scope = await loadClientScope("u1", db);
  assert.equal(canActForAccount(scope, "a2", { pay: true }), true);
});

test("removed or suspended membership is out of scope on the next authenticate", async () => {
  const token = await signAccessToken({ sub: "u1" });
  const userRow = ["u1", "u1@x.test", "U One", "active", "user", "not_required", null, null, null, null, null, false];
  const request = () => ({ headers: { authorization: `Bearer ${token}` } });
  const reply = { code() { return this; }, send() { return this; } };

  // First request: an active membership in a1.
  let q = queueDb([userRow], [member("a1")], []);
  holder.db = q.db;
  const first = request();
  await authenticate(first, reply);
  assert.deepEqual(first.user.scope.accountIds, ["a1"]);

  // The membership is then removed (or suspended): the SQL filter drops it, and the
  // very next request with the same token sees no practice. Nothing was cached.
  q = queueDb([userRow], [], []);
  holder.db = q.db;
  const second = request();
  await authenticate(second, reply);
  assert.deepEqual(second.user.scope.accountIds, []);
  assert.equal(q.calls.length, 3, "user, memberships, admin grants: loaded again on this request");
  assert.ok(q.calls[1].params.includes("active"), "membership status is filtered to active");
});

test("requestedAccounts: all, one in scope, and refusals that read as not found", () => {
  const scope = toClientScope({ accountIds: ["a1", "a2"], roles: new Map(), via: new Map(), organizations: [] });
  assert.deepEqual(requestedAccounts(scope, undefined), ["a1", "a2"]);
  assert.deepEqual(requestedAccounts(scope, "all"), ["a1", "a2"]);
  assert.deepEqual(requestedAccounts(scope, ""), ["a1", "a2"]);
  assert.deepEqual(requestedAccounts(scope, "a2"), ["a2"]);
  for (const bad of ["a9", "organization:o1", ["a1"], "ALL"]) {
    assert.throws(() => requestedAccounts(scope, bad), (e) => e.statusCode === 404 && e.code === "NOT_FOUND", String(bad));
  }
  // Never widens: an empty scope asking for "all" gets nothing.
  assert.deepEqual(requestedAccounts(emptyClientScope(), "all"), []);
  assert.throws(() => requestedAccounts(emptyClientScope(), "a1"), (e) => e.code === "NOT_FOUND");
});

test("canActForAccount fails closed on a null account and an empty scope", () => {
  const scope = toClientScope({ accountIds: ["a1"], roles: new Map([["a1", "member"]]), via: new Map(), organizations: [] });
  assert.equal(canActForAccount(scope, null), false);
  assert.equal(canActForAccount(scope, null, { pay: true }), false);
  assert.equal(canActForAccount(undefined, "a1"), false);
  assert.equal(canActForAccount(emptyClientScope(), "a1"), false);
});

test("requireClientPortal: a scoped login or an approved doctor; anyone else 403", async () => {
  const replyFake = () => ({ statusCode: null, code(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } });
  const run = async (user) => { const r = replyFake(); await requireClientPortal({ user }, r); return r.statusCode; };
  const scoped = { id: "bm", role: "user", scope: toClientScope({ accountIds: ["a1"], roles: new Map(), via: new Map(), organizations: [] }) };
  assert.equal(await run(scoped), null, "a DSO billing manager (not a doctor) with a practice");
  assert.equal(await run({ id: "d", role: "doctor", approvalStatus: "approved", scope: emptyClientScope() }), null, "an approved doctor not yet in a practice");
  assert.equal(await run({ id: "d", role: "doctor", approvalStatus: "pending", scope: emptyClientScope() }), 403);
  assert.equal(await run({ id: "s", role: "user", scope: emptyClientScope() }), 403, "a shopper");
  assert.equal(await run({ id: "s", role: "user" }), 403, "no scope at all");
  assert.equal(await run(undefined), 403);
});
