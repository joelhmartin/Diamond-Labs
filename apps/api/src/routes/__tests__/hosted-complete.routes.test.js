import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = { id: "doc1", role: "doctor" }; } }));
vi.mock("../../middleware/require-role.js", () => ({ requireApprovedDoctor: async () => {} }));

const store = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) { if (nx && store.has(key)) return null; store.set(key, val); return "OK"; },
    async del(key) { store.delete(key); return 1; },
    async get(key) { return store.get(key) ?? null; },
  },
}));

// select() answers come off a queue in call order (the early replay check, then the in-lock check).
let selectQueue = [];
vi.mock("../../config/database.js", () => ({
  db: { select: () => ({ from: () => ({ where: async () => selectQueue.shift() ?? [] }) }) },
}));

let details;
vi.mock("../../services/authorizenet.service.js", () => ({ getTransactionDetails: async () => details }));
let verifyResult = null;
const verifyCalls = [];
const recorded = [];
vi.mock("../../services/payment-recording.service.js", () => ({
  verifyAllocations: async (...args) => { verifyCalls.push(args); return verifyResult; },
  recordPaymentAndAllocations: async (a) => { recorded.push(a); return { ledgerWriteFailed: false }; },
}));
vi.mock("../../services/card.service.js", () => ({ ensureCustomerProfile: async () => "cp1" }));
vi.mock("../../services/card-charge.service.js", () => ({ chargeSavedCardAndRecord: async () => ({}) }));

const { default: invoicePaymentRoutes } = await import("../invoice-payment.routes.js");

const bound = { userId: "doc1", amountCents: 50000, allocations: [{ invoiceId: "inv1", invoiceNumber: "1001", amountCents: 50000 }] };
const body = { transId: "t1", refId: "Habc", allocations: bound.allocations };

async function complete() {
  const app = Fastify();
  await app.register(invoicePaymentRoutes, { prefix: "/api/v1" });
  const res = await app.inject({ method: "POST", url: "/api/v1/payments/hosted-complete", payload: body });
  await app.close();
  return res;
}

let errors;
beforeEach(() => {
  store.clear(); store.set("rxpay:hosted:Habc", JSON.stringify(bound));
  selectQueue = [];
  recorded.length = 0; verifyResult = null; verifyCalls.length = 0;
  details = { orderInvoiceNumber: "Habc", responseCode: "1", transactionStatus: "settledSuccessfully", amount: 500, status: "ok" };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

const alerts = () => errors.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[PAYMENT][CAPTURED_NOT_RECORDED]"));

describe("POST /payments/hosted-complete", () => {
  it("records a clean capture and raises no alert", async () => {
    const res = await complete();
    expect(res.statusCode).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(alerts()).toHaveLength(0);
  });

  it("alerts (ids and amounts only) when the cap check refuses a captured payment", async () => {
    verifyResult = { kind: "validation", message: "over the balance" };
    const res = await complete();
    expect(res.statusCode).toBe(422);
    expect(recorded).toHaveLength(0);
    expect(alerts()).toHaveLength(1);
    const payload = JSON.parse(alerts()[0].split("reconcile required ")[1]);
    expect(payload).toEqual({ transactionId: "t1", userId: "doc1", amountCents: 50000, invoiceIds: ["inv1"] });
    expect(alerts()[0]).not.toMatch(/over the balance/);
  });

  it("alerts when the captured amount differs from the bound amount", async () => {
    details.amount = 400;
    const res = await complete();
    expect(res.statusCode).toBe(422);
    expect(alerts()).toHaveLength(1);
    expect(JSON.parse(alerts()[0].split("reconcile required ")[1]).amountCents).toBe(40000);
  });

  it("re-checks the transaction id under the invoice locks, so a concurrent complete records once", async () => {
    // Early replay check sees nothing (the race); the in-lock check sees the winner's rows.
    selectQueue = [[], [{ id: "row1" }]];
    const res = await complete();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ alreadyRecorded: true, rows: 1 });
    expect(recorded).toHaveLength(0);
  });
});

describe("POST /payments/hosted-token", () => {
  it("checks the balance cap up front so a stale allocation is refused before the card is taken", async () => {
    verifyResult = { kind: "validation", message: "over the balance" };
    const app = Fastify();
    await app.register(invoicePaymentRoutes, { prefix: "/api/v1" });
    const res = await app.inject({ method: "POST", url: "/api/v1/payments/hosted-token", payload: { allocations: bound.allocations } });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0][2]).toEqual({ enforceCap: true });
  });
});
