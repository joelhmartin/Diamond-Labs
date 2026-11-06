import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createAdminPracticesRoutes } from "../admin-practices.routes.js";
import { requireAdmin } from "../../middleware/require-role.js";
import { fakeTx } from "../../test/fake-tx.js";
import { listPractices } from "../../services/practices.service.js";

const as = (role) => async (request) => { request.user = { id: "u1", role }; };

async function build({ role = "admin", service }) {
  const app = Fastify();
  app.addHook("onRequest", as(role));
  // The real admin guard minus token parsing: the user is attached by the hook above.
  await app.register(createAdminPracticesRoutes({ service, guard: [requireAdmin] }), { prefix: "/api/v1" });
  return app;
}

test("a non-admin (a doctor, or lab staff) is refused and the service is never reached", async () => {
  let reached = 0;
  const service = { listPractices: async () => { reached += 1; return { rows: [], total: 0 }; } };
  for (const role of ["doctor", "lab", "user"]) {
    const app = await build({ role, service });
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/practices" });
    assert.equal(res.statusCode, 403, role);
    await app.close();
  }
  assert.equal(reached, 0);
});

test("the memberUserId filter and the other filters reach the service, parsed", async () => {
  const seen = [];
  const service = { listPractices: async (q) => { seen.push(q); return { rows: [{ id: "a1", name: "P", accountNumber: "7", organization: null, memberCount: 2 }], total: 1 }; } };
  const app = await build({ service });
  const res = await app.inject({ method: "GET", url: "/api/v1/admin/practices?memberUserId=doc1&missingNumber=true&q=%20smith%20&organizationId=o1&limit=5" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, { rows: [{ id: "a1", name: "P", accountNumber: "7", organization: null, memberCount: 2 }], total: 1 });
  assert.deepEqual(seen[0], { memberUserId: "doc1", missingNumber: true, q: "smith", organizationId: "o1", limit: 5, offset: 0 });
  const bare = await app.inject({ method: "GET", url: "/api/v1/admin/practices" });
  assert.deepEqual(seen[1], { limit: 25, offset: 0 }, "no filters: first page");
  const bad = await app.inject({ method: "GET", url: "/api/v1/admin/practices?missingNumber=maybe" });
  assert.equal(bad.statusCode, 422);
  assert.equal(bare.statusCode, 200);
  await app.close();
});

test("listPractices limits the list to client accounts and maps rows (organization, member count)", async () => {
  const db = fakeTx({ selects: [
    [
      { id: "a1", name: "North", accountNumber: "100", organizationId: "o1", organizationName: "Group", memberCount: 3 },
      { id: "a2", name: "South", accountNumber: null, organizationId: null, organizationName: null, memberCount: 0 },
    ],
    [{ total: 2 }],
  ] });
  const out = await listPractices({ memberUserId: "doc1" }, db);
  assert.deepEqual(out, {
    rows: [
      { id: "a1", name: "North", accountNumber: "100", organization: { id: "o1", name: "Group" }, memberCount: 3, openBalanceCents: 0 },
      { id: "a2", name: "South", accountNumber: null, organization: null, memberCount: 0, openBalanceCents: 0 },
    ],
    total: 2,
  });
});

test("listPractices sums each practice's open invoices with the ledger balance helper", async () => {
  const inv = (id, accountId, totalCents) => ({ id, accountId, clientUserId: "c", ownerName: null, invoiceNumber: id, status: "issued", totalCents, dueDate: null, issuedAt: "2026-10-01T12:00:00Z" });
  const db = fakeTx({ selects: [
    [{ id: "a1", name: "North", accountNumber: "100", organizationId: null, organizationName: null, memberCount: 1 }],
    [{ total: 1 }],
    [inv("i1", "a1", 10000), inv("i2", "a1", 5000)],
    [{ invoiceId: "i2", paid: 2000 }],
  ] });
  const out = await listPractices({}, db);
  assert.equal(out.rows[0].openBalanceCents, 13000);
});

test("the ungrouped filter reaches the service as a boolean", async () => {
  const seen = [];
  const app = await build({ service: { listPractices: async (q) => { seen.push(q); return { rows: [], total: 0 }; } } });
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/admin/practices?ungrouped=true" })).statusCode, 200);
  assert.equal(seen[0].ungrouped, true);
  await app.close();
});

test("PATCH and the members routes validate, pass the actor, and refuse non-admins", async () => {
  const calls = [];
  const rec = (name) => async (...a) => { calls.push([name, ...a]); return { ok: true }; };
  const service = { listPractices: async () => ({ rows: [], total: 0 }), setAccountNumber: rec("num"), listMembers: rec("list"), addMember: rec("add"), setMemberRole: rec("role"), removeMember: rec("rm") };
  const app = await build({ service });
  assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/practices/a1", payload: { accountNumber: " 77 " } })).statusCode, 200);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/practices/a1", payload: {} })).statusCode, 422);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/admin/practices/a1/members" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/practices/a1/members", payload: { userId: "u2", role: "viewer" } })).statusCode, 201);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/practices/a1/members", payload: { userId: "u2", role: "owner" } })).statusCode, 422);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/practices/a1/members/u2", payload: { role: "owner" } })).statusCode, 422);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/v1/admin/practices/a1/members/u2", payload: { role: "admin" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/v1/admin/practices/a1/members/u2" })).statusCode, 200);
  assert.deepEqual(calls.map((c) => c[0]), ["num", "list", "add", "role", "rm"]);
  assert.deepEqual(calls[0].slice(1), ["a1", "77", "u1"]);
  assert.deepEqual(calls[2].slice(1), ["a1", { userId: "u2", role: "viewer" }, "u1"]);
  await app.close();

  const lab = await build({ role: "lab", service });
  const before = calls.length;
  for (const [method, url] of [["PATCH", "/api/v1/admin/practices/a1"], ["GET", "/api/v1/admin/practices/a1/members"], ["DELETE", "/api/v1/admin/practices/a1/members/u2"]]) {
    assert.equal((await lab.inject({ method, url, payload: { accountNumber: "1" } })).statusCode, 403);
  }
  assert.equal(calls.length, before);
  await lab.close();
});
