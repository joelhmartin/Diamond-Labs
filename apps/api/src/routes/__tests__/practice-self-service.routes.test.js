import { test, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * Piece 11: a practice (client account) is managed by the lab only
 * (/admin/practices/:id/members, audited). The SaaS template's self-service
 * member, invitation and account-mutation routes refuse it with 404
 * NOT_FOUND, even for the practice's owner, and never reach a service or
 * write. A non-client account works exactly as before.
 *
 * The real requireAccount, refuseClientAccount, authorize and the real
 * invitation service run over a fake db (each awaited select pops the next
 * queued rows); the membership and account services are recorders.
 */
const holder = { db: null };
vi.mock("../../config/database.js", () => ({ get db() { return holder.db; } }));
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = { id: "u1", role: "doctor" }; } }));
const reached = [];
const recorder = (name) => async (...args) => { reached.push(name); return { ok: true, args: args.length }; };
vi.mock("../../services/membership.service.js", () => ({
  listMembers: recorder("listMembers"), updateMemberRole: recorder("updateMemberRole"), removeMember: recorder("removeMember"),
  suspendMember: recorder("suspendMember"), reactivateMember: recorder("reactivateMember"),
}));
vi.mock("../../services/account.service.js", () => ({
  createAccount: recorder("createAccount"), updateAccount: recorder("updateAccount"), deleteAccount: recorder("deleteAccount"),
}));

const { fakeTx } = await import("../../test/fake-tx.js");
const { errorHandler } = await import("../../middleware/error-handler.js");
const { default: accountRoutes } = await import("../account.routes.js");
const { default: memberRoutes } = await import("../member.routes.js");
const { default: invitationRoutes } = await import("../invitation.routes.js");

async function app() {
  const f = Fastify();
  f.setErrorHandler(errorHandler);
  await f.register(accountRoutes, { prefix: "/api/v1/accounts" });
  await f.register(memberRoutes, { prefix: "/api/v1/accounts" });
  await f.register(invitationRoutes, { prefix: "/api/v1/invitations" });
  return f;
}

beforeEach(() => { reached.length = 0; });

const account = (isClient) => [{ id: "A", name: "Acct", status: "active", isClient, ownerId: "u1" }];
const owner = [{ id: "m1", userId: "u1", accountId: "A", role: "owner", status: "active" }];
const future = new Date(Date.now() + 86_400_000);
const pendingInvite = [{ id: "inv1", accountId: "A", email: "u1@example.com", role: "admin", status: "pending", token: "tok", expiresAt: future }];

// Each row: the request, and (after requireAccount's account + membership selects, where it has them)
// what a non-client account's service would read. `service` is the recorder a non-client call reaches.
const ROUTES = [
  { name: "invite", method: "POST", url: "/api/v1/accounts/A/members/invite", payload: { email: "new@example.com", role: "owner" }, after: [[], []], writes: true },
  { name: "list members", method: "GET", url: "/api/v1/accounts/A/members", service: "listMembers" },
  { name: "role change", method: "PATCH", url: "/api/v1/accounts/A/members/m2/role", payload: { role: "member" }, service: "updateMemberRole" },
  { name: "remove", method: "DELETE", url: "/api/v1/accounts/A/members/m2", service: "removeMember" },
  { name: "suspend", method: "POST", url: "/api/v1/accounts/A/members/m2/suspend", service: "suspendMember" },
  { name: "reactivate", method: "POST", url: "/api/v1/accounts/A/members/m2/reactivate", service: "reactivateMember" },
  { name: "account update", method: "PATCH", url: "/api/v1/accounts/A", payload: { name: "Renamed" }, service: "updateAccount" },
  { name: "account delete", method: "DELETE", url: "/api/v1/accounts/A", service: "deleteAccount" },
  { name: "invite revoke", method: "DELETE", url: "/api/v1/invitations/inv1", headers: { "x-account-id": "A" }, after: [pendingInvite], writes: true },
  { name: "invite resend", method: "POST", url: "/api/v1/invitations/inv1/resend", headers: { "x-account-id": "A" }, after: [pendingInvite], writes: true },
];

for (const row of ROUTES) {
  test(`${row.name}: refused (404 NOT_FOUND) on a practice, allowed on a non-client account`, async () => {
    const f = await app();
    const req = { method: row.method, url: row.url, payload: row.payload, headers: row.headers };

    holder.db = fakeTx({ selects: [account(true), owner, ...(row.after ?? [])] });
    const refused = await f.inject(req);
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error.code).toBe("NOT_FOUND");
    expect(reached).toEqual([]);
    expect(holder.db.log.filter((l) => ["insert", "update", "delete"].includes(l.op))).toEqual([]);

    holder.db = fakeTx({ selects: [account(false), owner, ...(row.after ?? [])] });
    const allowed = await f.inject(req);
    expect(allowed.statusCode).toBe(200);
    if (row.service) expect(reached).toEqual([row.service]);
    if (row.writes) expect(holder.db.log.some((l) => l.op === "insert" || l.op === "update")).toBe(true);
    await f.close();
  });
}

test("invite accept: an invitation into a practice never creates a membership; a non-client one still does", async () => {
  const f = await app();
  const req = { method: "POST", url: "/api/v1/invitations/tok/accept" };
  holder.db = fakeTx({ selects: [pendingInvite, [{ isClient: true }], [{ email: "u1@example.com" }]] });
  const refused = await f.inject(req);
  expect(refused.statusCode).toBe(404);
  expect(refused.json().error.code).toBe("NOT_FOUND");
  expect(holder.db.log.filter((l) => ["insert", "update"].includes(l.op))).toEqual([]);

  holder.db = fakeTx({ selects: [pendingInvite, [{ isClient: false }], [{ email: "u1@example.com" }]] });
  const allowed = await f.inject(req);
  expect(allowed.statusCode).toBe(200);
  expect(allowed.json().data).toEqual({ accountId: "A", role: "admin" });
  expect(holder.db.log.find((l) => l.op === "insert").values).toMatchObject({ userId: "u1", accountId: "A", status: "active" });
  await f.close();
});
