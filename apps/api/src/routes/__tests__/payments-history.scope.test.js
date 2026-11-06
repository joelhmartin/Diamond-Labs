import { test, vi } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

const { toClientScope } = await import("../../services/client-scope-rules.js");
const scope = toClientScope({ accountIds: ["A"], roles: new Map([["A", "admin"]]), via: new Map(), organizations: [] });

vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = { id: "u1", role: "user", scope }; } }));
vi.mock("../../middleware/require-role.js", () => ({ requireClientPortal: async () => {}, requireAdmin: async () => {} }));
const listPaymentHistory = vi.fn();
vi.mock("../../services/billing/ledger.service.js", () => ({ listPaymentHistory: (...a) => listPaymentHistory(...a), listAllPayments: vi.fn() }));
const { default: paymentRoutes } = await import("../payment.routes.js");

test("GET /payments/history shows only practices in the caller's scope, even on their own payments to a practice they left", async () => {
  listPaymentHistory.mockResolvedValue([
    { transactionId: "T1", accountId: null, accountIds: ["A", "GONE"] },
    { transactionId: "T2", accountId: "GONE", accountIds: ["GONE"] },
  ]);
  const app = Fastify();
  await app.register(paymentRoutes, { prefix: "/api/v1" });
  const res = await app.inject({ method: "GET", url: "/api/v1/payments/history" });
  assert.equal(res.statusCode, 200);
  const [t1, t2] = res.json().data.payments;
  assert.deepEqual([t1.accountId, t1.accountIds], ["A", ["A"]]);
  assert.deepEqual([t2.accountId, t2.accountIds], [null, []]);
  await app.close();
});
