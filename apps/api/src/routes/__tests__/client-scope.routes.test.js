import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createClientScopeRoutes, clientScopeView } from "../client-scope.routes.js";
import { toClientScope } from "../../services/client-scope.js";

const scope = toClientScope({
  accountIds: ["a1", "a2"],
  roles: new Map([["a1", "viewer"], ["a2", "org-admin"]]),
  via: new Map([["a1", "member"], ["a2", "org-admin"]]),
  organizations: [{ id: "o1", accountIds: ["a2"] }],
}, new Map([["o1", { name: "North Group", combinedStatement: true }]]));

const deps = {
  describeAccounts: async (ids) => new Map(ids.map((id) => [id, { id, name: `Practice ${id}`, accountNumber: id === "a1" ? "100" : null }])),
  organizationOf: async () => new Map([["a2", { id: "o1", name: "North Group", settings: {} }]]),
  directAccountIds: async () => new Set(["a1", "a2"]), // a2 is ALSO a direct membership
};

async function build(user) {
  const app = Fastify();
  const guard = [async (request) => { request.user = user; }];
  await app.register(createClientScopeRoutes({ guard, view: (s, ctx) => clientScopeView(s, { ...deps, ...ctx }) }), { prefix: "/api/v1" });
  return app;
}

test("GET /client/scope returns the spec shape from the request's scope", async () => {
  const app = await build({ id: "u1", role: "user", scope });
  const res = await app.inject({ method: "GET", url: "/api/v1/client/scope" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, {
    accounts: [
      { id: "a1", name: "Practice a1", accountNumber: "100", organizationId: null, via: "member", role: "viewer", payable: false, direct: true },
      { id: "a2", name: "Practice a2", accountNumber: null, organizationId: "o1", via: "org-admin", role: "org-admin", payable: true, direct: true },
    ],
    organizations: [{ id: "o1", name: "North Group", combinedStatement: true }],
  });
  await app.close();
});

test("an account that is both a direct membership and a group grant is direct: true with via org-admin; a group-only one is not", async () => {
  const view = await clientScopeView(scope, { ...deps, userId: "u1", directAccountIds: async () => new Set(["a2"]) });
  assert.deepEqual(view.accounts.map((a) => [a.id, a.via, a.direct]), [["a1", "member", false], ["a2", "org-admin", true]]);
});

test("an empty scope is an empty answer, and costs no lookups", async () => {
  let looked = 0;
  const counting = { describeAccounts: async () => { looked += 1; return new Map(); }, organizationOf: async () => { looked += 1; return new Map(); } };
  const app = Fastify();
  await app.register(createClientScopeRoutes({ guard: [async (r) => { r.user = { id: "s1", role: "user" }; }], view: (s) => clientScopeView(s, counting) }), { prefix: "/api/v1" });
  const res = await app.inject({ method: "GET", url: "/api/v1/client/scope" });
  assert.deepEqual(res.json().data, { accounts: [], organizations: [] });
  assert.equal(looked, 0);
  await app.close();
});
