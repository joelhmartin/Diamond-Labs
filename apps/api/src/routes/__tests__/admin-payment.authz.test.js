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
