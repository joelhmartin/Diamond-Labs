import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createOrganizationsRoutes, organizationErrorReply } from "./routes.js";
import { OrganizationError } from "./rules.js";
import { organizationAccountsSchema } from "@my-app/shared";

const pass = async () => {};
const deny = async (_req, reply) => reply.code(403).send({ error: { code: "FORBIDDEN", status: 403 } });

async function build({ service = {}, guard = pass, describeAccounts = async (ids) => ids.map((id) => ({ id, label: id })), userExists } = {}) {
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.user = { id: "admin1" }; });
  await app.register(createOrganizationsRoutes({ service, guard, describeAccounts, userExists }), { prefix: "/admin/organizations" });
  return app;
}

test("errors map to HTTP statuses; foreign errors are not swallowed", () => {
  assert.equal(organizationErrorReply(new OrganizationError("NOT_FOUND", "x")).status, 404);
  assert.equal(organizationErrorReply(new OrganizationError("CONFLICT", "x")).status, 409);
  assert.equal(organizationErrorReply(new OrganizationError("INVALID", "x")).status, 422);
  assert.equal(organizationErrorReply(new Error("boom")), null);
});

test("non-admin guard -> 403 on every route and the service is never reached", async () => {
  let reached = 0;
  const hit = async () => { reached += 1; return {}; };
  const app = await build({ guard: deny, service: new Proxy({}, { get: () => hit }) });
  for (const [method, url, payload] of [
    ["GET", "/admin/organizations"],
    ["POST", "/admin/organizations", { name: "A" }],
    ["GET", "/admin/organizations/o1"],
    ["PATCH", "/admin/organizations/o1", { status: "archived" }],
    ["POST", "/admin/organizations/o1/accounts", { accountIds: ["a1"] }],
    ["DELETE", "/admin/organizations/o1/accounts/a1"],
    ["POST", "/admin/organizations/o1/admins", { userId: "u1" }],
    ["DELETE", "/admin/organizations/o1/admins/u1"],
  ]) {
    const res = await app.inject({ method, url, payload });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
  assert.equal(reached, 0);
  await app.close();
});

test("settings with an unknown key -> 422", async () => {
  const app = await build({ service: { createOrganization: async () => { throw new Error("must not run"); } } });
  const res = await app.inject({ method: "POST", url: "/admin/organizations", payload: { name: "A", settings: { bogus: true } } });
  assert.equal(res.statusCode, 422);
  const patch = await app.inject({ method: "PATCH", url: "/admin/organizations/o1", payload: { settings: { bogus: 1 } } });
  assert.equal(patch.statusCode, 422);
  await app.close();
});

test("name taken (case-insensitive) -> 409", async () => {
  const app = await build({ service: { createOrganization: async () => { throw new OrganizationError("CONFLICT", "An organization with that name already exists."); } } });
  const res = await app.inject({ method: "POST", url: "/admin/organizations", payload: { name: "north" } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, "CONFLICT");
  await app.close();
});

test("addAccounts over 500 ids is refused by the schema (422) before the service", async () => {
  const ids = Array.from({ length: 501 }, (_, i) => `a${i}`);
  assert.equal(organizationAccountsSchema.safeParse({ accountIds: ids }).success, false);
  assert.equal(organizationAccountsSchema.safeParse({ accountIds: ids.slice(0, 500) }).success, true);
  const app = await build({ service: { addAccounts: async () => { throw new Error("must not run"); } } });
  const res = await app.inject({ method: "POST", url: "/admin/organizations/o1/accounts", payload: { accountIds: ids } });
  assert.equal(res.statusCode, 422);
  await app.close();
});

test("addAccounts passes the actor and an account-exists check built from describeAccounts", async () => {
  let seen;
  const app = await build({
    describeAccounts: async (ids) => ids.filter((i) => i !== "ghost").map((id) => ({ id, label: id })),
    service: {
      addAccounts: async (orgId, ids, opts) => { seen = { orgId, ids, byUserId: opts.byUserId, found: await opts.exists(["a1", "ghost"]) }; return { added: ["a1"], alreadyInOther: [] }; },
    },
  });
  const res = await app.inject({ method: "POST", url: "/admin/organizations/o1/accounts", payload: { accountIds: ["a1"] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, { added: ["a1"], alreadyInOther: [] });
  assert.deepEqual(seen, { orgId: "o1", ids: ["a1"], byUserId: "admin1", found: new Set(["a1"]) });
  await app.close();
});

test("detail view adds account labels from describeAccounts", async () => {
  const app = await build({
    service: { getOrganization: async (id) => ({ id, name: "N", accountIds: ["a1"], admins: [] }) },
    describeAccounts: async (ids) => ids.map((id) => ({ id, label: `Label ${id}` })),
  });
  const res = await app.inject({ method: "GET", url: "/admin/organizations/o1" });
  assert.deepEqual(res.json().data.accounts, [{ id: "a1", label: "Label a1" }]);
  await app.close();
});

test("list passes paging and filters; create returns 201; remove routes use the actor", async () => {
  const calls = [];
  const app = await build({
    service: {
      listOrganizations: async (q) => { calls.push(["list", q]); return { rows: [], total: 0 }; },
      createOrganization: async (a) => { calls.push(["create", a]); return { id: "o9", name: a.name }; },
      removeAccount: async (...a) => { calls.push(["removeAccount", ...a]); },
      removeAdmin: async (...a) => { calls.push(["removeAdmin", ...a]); },
    },
  });
  const list = await app.inject({ method: "GET", url: "/admin/organizations?q=no&status=active&limit=10&offset=20" });
  assert.deepEqual(list.json().data, { rows: [], total: 0 });
  assert.deepEqual(calls[0], ["list", { q: "no", status: "active", limit: 10, offset: 20 }]);
  const created = await app.inject({ method: "POST", url: "/admin/organizations", payload: { name: "New" } });
  assert.equal(created.statusCode, 201);
  assert.equal(calls[1][1].byUserId, "admin1");
  await app.inject({ method: "DELETE", url: "/admin/organizations/o1/accounts/a1" });
  await app.inject({ method: "DELETE", url: "/admin/organizations/o1/admins/u1" });
  assert.deepEqual(calls[2], ["removeAccount", "o1", "a1", { byUserId: "admin1" }]);
  assert.deepEqual(calls[3], ["removeAdmin", "o1", "u1", { byUserId: "admin1" }]);
  await app.close();
});
