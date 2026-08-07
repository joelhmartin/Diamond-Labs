import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

let currentUser = { id: "u1", role: "admin", approvalStatus: "approved", email: "x@y.z", name: "X" };

vi.mock("../../middleware/authenticate.js", () => ({
  // Stands in for a successful authentication; the real token path is covered
  // by auth-security.test.js and token-confusion.test.js.
  authenticate: async (request) => { request.user = currentUser; },
}));

// I8 — loadDoctor's `users` lookup. Controlled per test so the 404-vs-leak
// tests below can pick exactly what the target row looks like (missing,
// wrong role, unapproved doctor) without needing a real DB. The 403-for-
// non-admin tests above never reach loadDoctor (requireAdmin rejects first),
// so this mock is inert for them.
let targetUserRow = null;
vi.mock("../../config/database.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (targetUserRow ? [targetUserRow] : []) }) }) }),
  },
}));

const adminPaymentRoutes = (await import("../admin-payment.routes.js")).default;

/** Build an app whose `authenticate` injects a user of the given role. */
async function appAs(role) {
  currentUser = { ...currentUser, role };
  const app = Fastify();
  await app.register(adminPaymentRoutes, { prefix: "/api/v1" });
  return app;
}

const ROUTES = [
  ["GET", "/api/v1/admin/autopay"],
  ["GET", "/api/v1/admin/users/u2/autopay"],
  ["PUT", "/api/v1/admin/users/u2/autopay"],
  ["DELETE", "/api/v1/admin/users/u2/autopay"],
  ["POST", "/api/v1/admin/users/u2/autopay/pause"],
  ["POST", "/api/v1/admin/users/u2/autopay/resume"],
  ["GET", "/api/v1/admin/users/u2/saved-cards"],
  ["POST", "/api/v1/admin/users/u2/saved-cards/hosted-token"],
  ["PUT", "/api/v1/admin/users/u2/saved-cards/pp1/default"],
  ["DELETE", "/api/v1/admin/users/u2/saved-cards/pp1"],
  ["POST", "/api/v1/admin/users/u2/payments/charge-saved"],
  ["GET", "/api/v1/admin/jobs"],
  ["GET", "/api/v1/admin/jobs/runs"],
  ["POST", "/api/v1/admin/jobs/autopay/run"],
];

describe("admin payment routes reject non-admins", () => {
  for (const [method, url] of ROUTES) {
    it(`${method} ${url} is 403 for a doctor`, async () => {
      const app = await appAs("doctor");
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it(`${method} ${url} is 403 for a plain user`, async () => {
      const app = await appAs("user");
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }
});

// I8 — loadDoctor used to validate only that a row with the target userId
// existed, with nothing checking it was actually a doctor. The frontend
// gates its doctor picker to `role === "doctor"`, but the server trusted
// that client-side invariant: POST .../payments/charge-saved was the only
// charge path with no approved-doctor predicate on the payer, and the
// enroll route would have happily enrolled another admin (or a plain
// `user`) in recurring charges. Every case below must 404 — the SAME
// status a genuinely missing id produces — so the response never confirms
// "this id exists but isn't a doctor" vs. "this id doesn't exist".
const NON_DOCTOR_ROUTES = [
  ["GET", "/api/v1/admin/users/u2/autopay"],
  ["PUT", "/api/v1/admin/users/u2/autopay", { amount: 500, dayOfMonth: 15, paymentProfileId: "pp1" }],
  ["DELETE", "/api/v1/admin/users/u2/autopay"],
  ["POST", "/api/v1/admin/users/u2/autopay/pause"],
  ["GET", "/api/v1/admin/users/u2/saved-cards"],
  [
    "POST",
    "/api/v1/admin/users/u2/payments/charge-saved",
    { paymentProfileId: "pp1", amount: 10, allocations: [{ invoiceId: "i1", amount: 10 }] },
  ],
];

describe("admin payment routes 404 on a non-doctor or unapproved-doctor target (I8)", () => {
  for (const [method, url, payload] of NON_DOCTOR_ROUTES) {
    it(`${method} ${url} is 404 when the target id does not exist`, async () => {
      targetUserRow = null;
      const app = await appAs("admin");
      const res = await app.inject({ method, url, payload: payload || {} });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it(`${method} ${url} is 404 when the target is not a doctor (e.g. another admin)`, async () => {
      targetUserRow = { id: "u2", role: "admin", approvalStatus: "approved" };
      const app = await appAs("admin");
      const res = await app.inject({ method, url, payload: payload || {} });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  }

  // Approval-status gating applies specifically to the charge and enroll
  // routes — a doctor who exists but was never approved (or was rejected)
  // must not be enrolled in or charged recurring payments.
  for (const [method, url, payload] of [
    ["PUT", "/api/v1/admin/users/u2/autopay", { amount: 500, dayOfMonth: 15, paymentProfileId: "pp1" }],
    [
      "POST",
      "/api/v1/admin/users/u2/payments/charge-saved",
      { paymentProfileId: "pp1", amount: 10, allocations: [{ invoiceId: "i1", amount: 10 }] },
    ],
  ]) {
    it(`${method} ${url} is 404 when the target is a doctor whose approval is pending`, async () => {
      targetUserRow = { id: "u2", role: "doctor", approvalStatus: "pending" };
      const app = await appAs("admin");
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  }
});
