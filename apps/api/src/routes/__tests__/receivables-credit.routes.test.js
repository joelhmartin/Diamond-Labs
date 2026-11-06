import { test, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * "Account credit…" on a receivables row reaches the service with exactly that
 * row's target: a practice row → { accountId } (never its owner, whose scope
 * spans sibling practices), an Unassigned row → { clientUserId }. The picker
 * GET uses the same target.
 */
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = { id: "adm", role: "admin" }; } }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: () => {}, log: async () => {} }));
const calls = [];
vi.mock("../../services/billing/account-credit.service.js", async () => {
  const { InvoiceError } = await import("../../services/billing/invoice-rules.js");
  return {
    recordAccountCredit: async (args) => { calls.push(["record", args]); if (args.accountId === "gone") throw new InvoiceError("NOT_FOUND", "Practice not found."); return { transactionId: "credit:1", allocations: [] }; },
    creditableInvoices: async (target) => { calls.push(["list", target]); return [{ id: "i1" }]; },
  };
});

const { default: receivablesRoutes } = await import("../receivables.routes.js");
const { errorHandler } = await import("../../middleware/error-handler.js");

async function call(method, url, payload) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(receivablesRoutes, { prefix: "/api/v1" });
  const res = await app.inject({ method, url: `/api/v1${url}`, payload });
  await app.close();
  return res;
}

beforeEach(() => { calls.length = 0; });
const body = { amountCents: 500, reason: "goodwill" };

test("a practice row's credit and picker name the practice only", async () => {
  const res = await call("POST", "/admin/practices/a1/account-credit", body);
  expect(res.statusCode).toBe(201);
  expect(calls[0]).toEqual(["record", { accountId: "a1", ...body, byUserId: "adm" }]);
  const list = await call("GET", "/admin/practices/a1/account-credit/invoices");
  expect(list.json()).toEqual({ data: [{ id: "i1" }] });
  expect(calls[1]).toEqual(["list", { accountId: "a1" }]);
});

test("an Unassigned row's credit and picker name the client only", async () => {
  expect((await call("POST", "/admin/clients/doc1/account-credit", body)).statusCode).toBe(201);
  expect(calls[0]).toEqual(["record", { clientUserId: "doc1", ...body, byUserId: "adm" }]);
  await call("GET", "/admin/clients/doc1/account-credit/invoices");
  expect(calls[1]).toEqual(["list", { clientUserId: "doc1" }]);
});

test("an unknown practice is a 404 through the invoice error mapper", async () => {
  const res = await call("POST", "/admin/practices/gone/account-credit", body);
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe("NOT_FOUND");
});
