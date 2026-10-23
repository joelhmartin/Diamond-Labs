import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = { id: "admin-1", role: "admin" }; } }));
vi.mock("../../middleware/require-role.js", () => ({ requireAdmin: async () => {} }));

const lockStore = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) { if (nx && lockStore.has(key)) return null; lockStore.set(key, val); return "OK"; },
    async del(key) { lockStore.delete(key); return 1; },
    async get(key) { return lockStore.get(key) ?? null; },
  },
}));

// select() answers come off a queue in call order: original rows, existing refund, doctor.
let selectQueue = [];
const inserted = [];
// Every write, in call order, so a test can assert what happened before/after the gateway call.
const ops = [];
let updateFails = false;
vi.mock("../../config/database.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => selectQueue.shift() ?? [] }) }),
    insert: () => ({ values: async (v) => { inserted.push(v); ops.push("insert"); } }),
    update: () => ({ set: (v) => ({ where: async () => { if (updateFails) throw new Error("db down"); ops.push({ update: v }); } }) }),
    delete: () => ({ where: async () => { ops.push("delete"); } }),
  },
}));

const voidOrRefund = vi.fn();
vi.mock("../../lib/void-refund.js", () => ({ voidOrRefund: (...a) => voidOrRefund(...a) }));
const receipts = [];
vi.mock("../../services/email.service.js", () => ({ sendRefundReceipt: async (a) => { receipts.push(a); } }));
const audits = [];
vi.mock("../../services/audit.service.js", () => ({ logSafe: async (e) => { audits.push(e); } }));

const { ERROR_CODES } = await import("@my-app/shared");
const ERROR_UNCERTAIN_STATUS = ERROR_CODES.REFUND_UNCERTAIN.status;
const { default: refundRoutes } = await import("../refund.routes.js");

const original = (invoiceId, appliedCents) => ({ id: `p-${invoiceId}`, userId: "doc1", invoiceId, invoiceNumber: `N${invoiceId}`, appliedCents, transactionId: "tx1", source: "doctor_card" });

async function refund(body) {
  const app = Fastify();
  await app.register(refundRoutes, { prefix: "/api/v1" });
  const res = await app.inject({ method: "POST", url: "/api/v1/admin/payments/refund", payload: body });
  await app.close();
  return res;
}

beforeEach(() => {
  selectQueue = [[original("a", 30000), original("b", 12550)], [], [{ id: "doc1", email: "d@x.com" }]];
  inserted.length = 0; ops.length = 0; updateFails = false; receipts.length = 0; audits.length = 0; lockStore.clear();
  voidOrRefund.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /admin/payments/refund money handling", () => {
  it("refuses a manual payment before any guard row or gateway call", async () => {
    for (const source of ["admin_check", "admin_cash", "admin_ach", "admin_other"]) {
      selectQueue = [[{ ...original("a", 30000), source }], [], [{ id: "doc1" }]];
      const res = await refund({ transactionId: "tx1" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/credit, not a card refund/);
    }
    selectQueue = [[{ ...original("a", 30000), source: null, transactionId: "OFFLINE-9" }], [], []];
    expect((await refund({ transactionId: "OFFLINE-9" })).statusCode).toBe(422);
    expect(inserted).toHaveLength(0);
    expect(voidOrRefund).not.toHaveBeenCalled();
  });

  it("sends a partial refund to the gateway as a decimal string, not a float division", async () => {
    // 1,000,000.07 / 100 style drift cannot happen: the amount is formatted from integer cents.
    selectQueue[0] = [original("a", 30007)];
    voidOrRefund.mockResolvedValue({ action: "refund", transactionId: "rf1", amount: 300.07 });
    const res = await refund({ transactionId: "tx1", allocations: [{ invoiceId: "a", amountCents: 30007 }] });
    expect(res.statusCode).toBe(200);
    expect(voidOrRefund).toHaveBeenCalledWith("tx1", "300.07");
  });

  it("derives the reversal cents from the plan rows, not the gateway's amount", async () => {
    // A gateway amount that doesn't parse back to cents must not change what the ledger and receipt say.
    voidOrRefund.mockResolvedValue({ action: "void", transactionId: "rf1", amount: undefined });
    const res = await refund({ transactionId: "tx1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.amountCents).toBe(42550);
    expect(receipts[0].amountCents).toBe(42550);
    expect(audits[0].metadata.amountCents).toBe(42550);
    expect(inserted.at(-1).map((r) => r.appliedCents)).toEqual([-30000, -12550]);
  });

  it("writes the reversal rows BEFORE the gateway call, then stamps the real refund id", async () => {
    voidOrRefund.mockImplementation(async () => {
      ops.push("gateway");
      return { action: "refund", transactionId: "rf1" };
    });
    const res = await refund({ transactionId: "tx1", allocations: [{ invoiceId: "a", amountCents: 4000 }] });
    expect(res.statusCode).toBe(200);
    expect(ops).toEqual(["insert", "gateway", { update: { transactionId: "rf1" } }]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject([{ appliedCents: -4000, transactionId: "REFUND-PENDING-tx1", refundsTransactionId: "tx1", source: "refund", invoiceId: "a" }]);
  });

  it("deletes the pending rows when the gateway definitively moved no money", async () => {
    voidOrRefund.mockRejectedValue(Object.assign(new Error("declined"), { refundErrorKind: "validation" }));
    const res = await refund({ transactionId: "tx1" });
    expect(res.statusCode).toBe(422);
    expect(ops).toEqual(["insert", "delete"]);
  });

  it("keeps the pending rows when the outcome is uncertain", async () => {
    voidOrRefund.mockRejectedValue(new Error("socket hang up"));
    const res = await refund({ transactionId: "tx1" });
    expect(res.statusCode).toBe(ERROR_UNCERTAIN_STATUS);
    expect(ops).toEqual(["insert"]);
  });

  it("a failed id stamp leaves correct amounts in place and flags the response", async () => {
    voidOrRefund.mockResolvedValue({ action: "refund", transactionId: "rf1" });
    updateFails = true;
    const res = await refund({ transactionId: "tx1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ amountCents: 42550, ledgerWriteFailed: true });
    expect(ops).toEqual(["insert"]);
    expect(inserted[0].map((r) => r.appliedCents)).toEqual([-30000, -12550]);
  });
});

it("never offers a Seazona settlement row as a refundable payment", () => {
  const src = readFileSync(fileURLToPath(new URL("../refund.routes.js", import.meta.url)), "utf8");
  expect(src).toMatch(/notInArray\(invoicePayments\.source, \[\.\.\.HISTORY_EXCLUDED_SOURCES, CREDIT_SOURCE\]\)/);
});
