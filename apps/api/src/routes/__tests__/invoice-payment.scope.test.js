import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * Review Focus 3 (piece 11): one charge whose allocations include an invoice
 * outside the payer's payable scope is refused as a whole, BEFORE any card
 * gateway call, and writes nothing. The real verifyAllocations and the real
 * saved-card charge run; only the DB, Redis, the gateway and email are fakes.
 */

const { toClientScope } = await import("../../services/client-scope-rules.js");
const scopeOf = (roles) => toClientScope({ accountIds: Object.keys(roles), roles: new Map(Object.entries(roles)), via: new Map(), organizations: [] });

let user;
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = user; } }));

const store = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) { if (nx && store.has(key)) return null; store.set(key, val); return "OK"; },
    async del(key) { store.delete(key); return 1; },
    async get(key) { return store.get(key) ?? null; },
  },
}));

// verifyAllocations reads the invoices (with their account) and, with the cap, the paid sums.
let invoiceRows = [];
const inserted = [];
const chain = (result) => new Proxy(function () {}, {
  get(_t, prop) {
    if (prop === "then") return (res, rej) => Promise.resolve(result).then(res, rej);
    return () => chain(result);
  },
});
vi.mock("../../config/database.js", () => ({
  db: {
    // Only verifyAllocations' invoice read gets rows; the paid sums and hosted-complete's dedup reads see none.
    select: (cols) => chain(cols && "invoiceNumber" in cols ? invoiceRows : []),
    insert: () => ({ values: async (v) => { inserted.push(...v); } }),
  },
}));

const gatewayCalls = [];
vi.mock("../../services/authorizenet.service.js", () => ({
  chargeCustomerProfile: async (args) => { gatewayCalls.push(args); return { transactionId: "tx1", responseCode: "1", authCode: "A" }; },
  getTransactionDetails: async () => ({ orderInvoiceNumber: "Hscope", responseCode: "1", transactionStatus: "settledSuccessfully", amount: 1, status: "ok" }),
}));
const receipts = [];
vi.mock("../../services/email.service.js", () => ({ sendPaymentReceipt: async (a) => { receipts.push(a); return true; } }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: () => {}, log: async () => {} }));
vi.mock("../../services/card.service.js", () => ({ ensureCustomerProfile: async () => "cp1" }));

const { default: invoicePaymentRoutes } = await import("../invoice-payment.routes.js");

const inv = (id, accountId, number) => ({ id, invoiceNumber: number, accountId, accountNumber: null, status: "issued", totalCents: 50000 });

async function chargeSaved(allocations) {
  const app = Fastify();
  await app.register(invoicePaymentRoutes, { prefix: "/api/v1" });
  const res = await app.inject({
    method: "POST", url: "/api/v1/payments/charge-saved", headers: { "idempotency-key": `k-${Math.random()}` },
    payload: { paymentProfileId: "pp1", amountCents: allocations.reduce((s, a) => s + a.amountCents, 0), allocations },
  });
  await app.close();
  return res;
}

beforeEach(() => {
  store.clear(); inserted.length = 0; gatewayCalls.length = 0; receipts.length = 0;
  user = { id: "gadmin", role: "user", email: "ga@x.com", authorizeNetCustomerProfileId: "cp1", scope: scopeOf({ a1: "org-admin", a2: "org-admin" }) };
  invoiceRows = [inv("i1", "a1", 500001), inv("i2", "a2", 500002), inv("i9", "a9", 500009)];
});

describe("POST /payments/charge-saved on the practice scope", () => {
  it("mixed allocation with one foreign invoice charges nothing", async () => {
    const res = await chargeSaved([{ invoiceId: "i1", amountCents: 100 }, { invoiceId: "i9", amountCents: 100 }]);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(gatewayCalls).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(receipts).toHaveLength(0);
  });

  it("practice staff cannot pay a sibling practice's invoice (404, no charge)", async () => {
    user = { ...user, id: "staff", scope: scopeOf({ a1: "member" }) };
    const res = await chargeSaved([{ invoiceId: "i2", amountCents: 100 }]);
    expect(res.statusCode).toBe(404);
    expect(gatewayCalls).toHaveLength(0);
  });

  it("viewer allocation refused (404, no charge)", async () => {
    user = { ...user, id: "viewer", scope: scopeOf({ a1: "viewer" }) };
    expect((await chargeSaved([{ invoiceId: "i1", amountCents: 100 }])).statusCode).toBe(404);
    expect(gatewayCalls).toHaveLength(0);
  });

  it("a group admin's one charge across two practices: one gateway call, one ledger row per invoice", async () => {
    const res = await chargeSaved([{ invoiceId: "i1", amountCents: 100 }, { invoiceId: "i2", amountCents: 250 }]);
    expect(res.statusCode).toBe(200);
    expect(gatewayCalls).toHaveLength(1);
    expect(gatewayCalls[0].amount).toBe("3.50");
    expect(inserted.map((r) => [r.invoiceId, r.transactionId, r.userId, r.appliedCents])).toEqual([["i1", "tx1", "gadmin", 100], ["i2", "tx1", "gadmin", 250]]);
    expect(receipts.map((r) => r.to)).toEqual(["ga@x.com"]);
  });
});

describe("POST /payments/hosted-complete after the scope was lost", () => {
  it("scope lost between token and complete: nothing recorded, the captured-not-recorded alert fires", async () => {
    // The token was issued while a group admin of a1; removed from the group before completing.
    store.set("rxpay:hosted:Hscope", JSON.stringify({ userId: "gadmin", amountCents: 100, allocations: [{ invoiceId: "i1", invoiceNumber: "500001", amountCents: 100 }] }));
    user = { ...user, role: "user", scope: scopeOf({}) };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = Fastify();
    await app.register(invoicePaymentRoutes, { prefix: "/api/v1" });
    const res = await app.inject({ method: "POST", url: "/api/v1/payments/hosted-complete", payload: { transId: "t-lost", refId: "Hscope", allocations: [{ invoiceId: "i1", amountCents: 100 }] } });
    await app.close();
    const alerts = errors.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[PAYMENT][CAPTURED_NOT_RECORDED]"));
    errors.mockRestore();
    expect(res.statusCode).toBe(404);
    expect(inserted).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0].split("reconcile required ")[1])).toEqual({ transactionId: "t-lost", userId: "gadmin", amountCents: 100, invoiceIds: ["i1"] });
  });

  it("hosted-complete is guarded by authenticate only, so a lost scope reaches the alerting path", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../invoice-payment.routes.js", import.meta.url), "utf8");
    expect(src).toMatch(/fastify\.post\("\/payments\/hosted-complete", \{ \.\.\.CHARGE_RATE_LIMIT, preHandler: \[authenticate, validate\(hostedCompleteSchema\)\] \}/);
  });
});

describe("admin charge as client", () => {
  it("uses the TARGET user's scope, loaded for the request, for both the ownership pass and the in-lock re-check", async () => {
    const { readFileSync } = await import("node:fs");
    const { handlerSource } = await import("./_source.js");
    const src = readFileSync(new URL("../admin-payment.routes.js", import.meta.url), "utf8");
    const body = handlerSource(src, 'fastify.post("/admin/users/:userId/payments/charge-saved",');
    expect(body).toMatch(/const scope = await loadClientScope\(doctor\.id\);/);
    expect(body).toMatch(/const own = await verifyAllocations\(allocations, scope\);/);
    expect(body).toMatch(/chargeSavedCardAndRecord\(\{\s*payer: doctor,\s*scope,/);
    expect(body).not.toMatch(/request\.user\.scope|clientScopeOf\(request\.user\)/);
  });
});
