import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// Offline-payment-unification: POST /admin/invoices/:invoiceId/offline-payment
// used to do its own db.insert(invoicePayments) directly. It now routes through
// the shared recordPaymentAndAllocations component (mocked below so these tests
// assert the route's own contract — locking, cap enforcement, user resolution,
// recordInSeazona wiring — independent of that component's internals, which are
// covered separately in payment-recording.service.test.js).

const admin = { id: "admin-1", role: "admin", approvalStatus: "approved" };
vi.mock("../../middleware/authenticate.js", () => ({
  authenticate: async (request) => {
    request.user = admin;
  },
}));

let invoice = null;
vi.mock("../../services/seazona.service.js", () => ({
  getInvoice: async (id) => (invoice && String(invoice.id) === String(id) ? invoice : null),
}));

let alreadyPaid = 0;
vi.mock("../../services/invoice-ledger.service.js", () => ({
  getInvoicePortalPaidStrict: async () => alreadyPaid,
  getPortalPaidMap: async () => ({}),
  getInvoicePortalPaid: async () => 0,
  getGlobalPortalPaidMap: async () => ({}),
}));

const recordCalls = [];
let recordImpl = async () => ({ seazonaPaymentId: null, ledgerWriteFailed: false });
vi.mock("../../services/payment-recording.service.js", () => ({
  recordPaymentAndAllocations: async (args) => {
    recordCalls.push(args);
    return recordImpl(args);
  },
}));

vi.mock("../../services/audit.service.js", () => ({
  log: async () => {},
  logSafe: async () => {},
}));

// One doctor row, keyed by id — matches the shape `users` select() would
// return for DOCTOR_COLUMNS (id, email, name, seazonaClientId, seazonaAccountNumber).
let doctorRows = [];
vi.mock("../../config/database.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond) => {
          // The route filters by users.id OR users.seazonaClientId — the test
          // double doesn't need to interpret drizzle's condition tree, just
          // return every configured doctor row and let the route's own JS
          // (bodyUserId vs seazonaClientId branch) pick the right one; each
          // test only configures one matching row.
          const result = Promise.resolve(doctorRows);
          result.limit = () => Promise.resolve(doctorRows.slice(0, 1));
          return result;
        },
      }),
    }),
  },
  queryClient: {},
}));

// Real payment-helpers.js (withInvoiceLocks/InvoiceLockedError) backed by an
// in-memory lock store standing in for config/redis.js — same pattern as
// jobs/definitions/autopay.job.test.js.
const lockStore = new Map();
const fakeRedis = {
  async set(key, val, _ex, _ttl, nx) {
    if (nx && lockStore.has(key)) return null;
    lockStore.set(key, val);
    return "OK";
  },
  async del(key) {
    lockStore.delete(key);
    return 1;
  },
  async get(key) {
    return lockStore.get(key) ?? null;
  },
};

vi.doMock("../../config/redis.js", () => ({ redis: fakeRedis }));

const invoiceRoutes = (await import("../invoice.routes.js")).default;

async function buildApp() {
  const app = Fastify();
  await app.register(invoiceRoutes, { prefix: "/api/v1" });
  return app;
}

const doctor = {
  id: "u1",
  email: "doc@example.com",
  name: "Dr. Doc",
  seazonaClientId: "c1",
  seazonaAccountNumber: "acct-1",
};

beforeEach(() => {
  admin.role = "admin";
  invoice = { id: "inv1", invoiceNumber: "1001", clientId: "c1", total: 500 };
  alreadyPaid = 0;
  recordCalls.length = 0;
  recordImpl = async () => ({ seazonaPaymentId: null, ledgerWriteFailed: false });
  doctorRows = [doctor];
  lockStore.clear();
});

describe("POST /admin/invoices/:invoiceId/offline-payment", () => {
  it("routes through recordPaymentAndAllocations with source admin_offline and an OFFLINE- sentinel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(res.statusCode).toBe(200);
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]).toMatchObject({ source: "admin_offline", amount: 100 });
    expect(recordCalls[0].transactionId).toMatch(/^OFFLINE-/);
    expect(recordCalls[0].user).toMatchObject({ id: "u1", seazonaClientId: "c1" });
    await app.close();
  });

  it("defaults writeToSeazona to false when recordInSeazona is omitted", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(recordCalls[0].writeToSeazona).toBe(false);
    await app.close();
  });

  it("keeps writeToSeazona false when recordInSeazona is explicitly false", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1", recordInSeazona: false },
    });
    expect(recordCalls[0].writeToSeazona).toBe(false);
    await app.close();
  });

  it("sets writeToSeazona true when recordInSeazona is true", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1", recordInSeazona: true },
    });
    expect(res.statusCode).toBe(200);
    expect(recordCalls[0].writeToSeazona).toBe(true);
    await app.close();
  });

  it("passes wasCharged:false and an offline audit action with the admin as actor", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(recordCalls[0]).toMatchObject({
      wasCharged: false,
      auditAction: "payment.offline_recorded",
      actorUserId: "admin-1",
    });
    await app.close();
  });

  it("rejects an over-cap amount before ever calling recordPaymentAndAllocations", async () => {
    alreadyPaid = 450; // remaining = 50
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(res.statusCode).toBe(422);
    expect(recordCalls).toHaveLength(0);
    await app.close();
  });

  it("returns 409 when the invoice is already locked by a concurrent writer", async () => {
    lockStore.set("chargeguard:inv:inv1", "1"); // simulate a held lock (invoiceLockKey format)
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(res.statusCode).toBe(409);
    expect(recordCalls).toHaveLength(0);
    await app.close();
  });

  it("surfaces ledgerWriteFailed in the response when the shared component reports it", async () => {
    recordImpl = async () => ({ seazonaPaymentId: null, ledgerWriteFailed: true });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ledgerWriteFailed).toBe(true);
    await app.close();
  });

  it("rejects non-admins", async () => {
    admin.role = "doctor";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invoices/inv1/offline-payment",
      payload: { amount: 100, seazonaClientId: "c1" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
