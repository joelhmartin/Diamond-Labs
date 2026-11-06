import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * The client invoice routes read through the login's practice scope
 * (services/client-scope.js): the list by `?account=`, the detail and PDF by
 * the invoice's account. Out of scope reads as 404, never 403.
 */

const { toClientScope } = await import("../../services/client-scope-rules.js");
const scopeOf = (roles) => toClientScope({ accountIds: Object.keys(roles), roles: new Map(Object.entries(roles)), via: new Map(), organizations: [] });

let user;
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = user; } }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: () => {}, log: async () => {} }));

const listCalls = [];
let rows = [];
let detail = null;
vi.mock("../../services/billing/invoice-queries.js", () => ({
  listClientInvoices: async (accountIds, opts) => { listCalls.push({ accountIds, opts }); return rows.filter((r) => accountIds.includes(r.accountId)); },
  getInvoiceDetail: async () => detail,
}));

const { default: invoiceRoutes } = await import("../invoice.routes.js");
const { errorHandler } = await import("../../middleware/error-handler.js");

async function get(url) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(invoiceRoutes, { prefix: "/api/v1" });
  const res = await app.inject({ method: "GET", url: `/api/v1${url}` });
  await app.close();
  return res;
}

const row = (over) => ({
  id: "i1", invoiceNumber: 500001, kind: "lab_order", status: "issued", accountId: "a1", accountName: "North", accountNumber: "1324",
  labOrderNumber: null, caseNumber: null, patientInitials: null, issuedAt: null, dueDate: null, totalCents: 10000, paidCents: 0, balanceCents: 10000, ...over,
});

beforeEach(() => {
  listCalls.length = 0;
  user = { id: "gadmin", role: "user", scope: scopeOf({ a1: "org-admin", a2: "org-admin" }) };
  rows = [row(), row({ id: "i2", invoiceNumber: 500002, accountId: "a2", accountName: "South", accountNumber: "2001", balanceCents: 2550 }), row({ id: "i3", accountId: "a9", balanceCents: 99999 })];
  detail = null;
});

describe("GET /invoices", () => {
  it("GET /invoices?account=all sums balanceCents over scoped rows", async () => {
    const res = await get("/invoices?account=all");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(listCalls[0].accountIds).toEqual(["a1", "a2"]);
    expect(body.data.map((r) => [r.id, r.accountId, r.accountName, r.accountNumber])).toEqual([["i1", "a1", "North", "1324"], ["i2", "a2", "South", "2001"]]);
    expect(body.meta).toEqual({ balanceCents: 12550 });
  });

  it("no ?account= is the whole scope; one account narrows to it", async () => {
    expect((await get("/invoices")).json().meta.balanceCents).toBe(12550);
    const one = await get("/invoices?account=a2");
    expect(listCalls.at(-1).accountIds).toEqual(["a2"]);
    expect(one.json()).toMatchObject({ meta: { balanceCents: 2550 } });
  });

  it("an account outside the scope reads as 404, and nothing is listed", async () => {
    const res = await get("/invoices?account=a9");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(listCalls).toHaveLength(0);
  });

  it("a doctor with no practice yet gets an empty list, not someone else's", async () => {
    user = { id: "doc1", role: "doctor", approvalStatus: "approved", scope: scopeOf({}) };
    const res = await get("/invoices");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [], meta: { balanceCents: 0 } });
  });

  it("a login with no practice that is not an approved doctor is refused by the client-portal guard", async () => {
    user = { id: "shopper", role: "user", scope: scopeOf({}) };
    expect((await get("/invoices")).statusCode).toBe(403);
  });
});

describe("GET /invoices/:id and /pdf", () => {
  const detailOf = (accountId, status = "issued") => ({ invoice: { id: "i1", accountId, status, clientUserId: "someone" }, lines: [], payments: [], labOrder: null, client: null });

  it("a sibling practice's invoice reads as 404", async () => {
    user = { id: "staff", role: "user", scope: scopeOf({ a1: "member" }) };
    detail = detailOf("a2");
    expect((await get("/invoices/i1")).statusCode).toBe(404);
    expect((await get("/invoices/i1/pdf")).statusCode).toBe(404);
  });

  it("an invoice with no practice reads as 404 to everyone in the portal", async () => {
    detail = detailOf(null);
    expect((await get("/invoices/i1")).statusCode).toBe(404);
  });

  it("an invoice of a practice in scope is readable, whoever owns it; a draft never is", async () => {
    user = { id: "viewer", role: "user", scope: scopeOf({ a1: "viewer" }) };
    detail = detailOf("a1");
    expect((await get("/invoices/i1")).statusCode).toBe(200);
    detail = detailOf("a1", "draft");
    expect((await get("/invoices/i1")).statusCode).toBe(404);
  });
});
