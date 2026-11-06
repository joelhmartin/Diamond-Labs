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
      { id: "a1", name: "North", accountNumber: "100", organization: { id: "o1", name: "Group" }, memberCount: 3 },
      { id: "a2", name: "South", accountNumber: null, organization: null, memberCount: 0 },
    ],
    total: 2,
  });
});
