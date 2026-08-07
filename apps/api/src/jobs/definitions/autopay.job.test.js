import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const charged = [];
vi.mock("../../services/authorizenet.service.js", () => ({
  chargeCustomerProfile: vi.fn(async (args) => {
    charged.push(args);
    return { transactionId: "tx1", responseCode: "1", authCode: "A" };
  }),
}));

const recorded = [];
vi.mock("../../services/payment-recording.service.js", () => ({
  recordPaymentAndAllocations: vi.fn(async (args) => {
    recorded.push(args);
    return { seazonaPaymentId: "sp1" };
  }),
  verifyAllocations: async () => null,
}));

const attempts = [];
const enrollmentUpdates = [];
vi.mock("../../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { attempts.push(v); } }),
    update: () => ({ set: (v) => ({ where: async () => { enrollmentUpdates.push(v); } }) }),
  },
}));

// Same db/redis mocking pattern as jobs/runner.test.js — withIdempotency and
// withInvoiceLocks (apps/api/src/lib/payment-helpers.js) both go through
// config/redis.js's real get/set/del contract; only the underlying storage
// (the Postgres-backed kv shim) is faked here. Without this, config/redis.js
// would still try to talk to the (mocked-away) `queryClient` from
// config/database.js and every non-dry-run charge would fail before it ever
// reached the gateway mock.
const lockStore = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
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
  },
}));

const { processEnrollment } = await import("../../services/autopay-runner.service.js");

const doctor = {
  id: "u1", email: "d@x.com", name: "Doc",
  seazonaClientId: "c1", seazonaAccountNumber: "1324",
  authorizeNetCustomerProfileId: "cp1",
};
const enrollment = { id: "e1", userId: "u1", amount: "500.00", dayOfMonth: 15, paymentProfileId: "pp1", enabled: true, status: "active", consecutiveFailures: 0 };
const invoices = [
  { id: "i1", invoiceNumber: "1001", balance: 300, dueDate: "2026-01-01" },
  { id: "i2", invoiceNumber: "1002", balance: 400, dueDate: "2026-02-01" },
];

beforeEach(() => {
  charged.length = 0;
  recorded.length = 0;
  attempts.length = 0;
  enrollmentUpdates.length = 0;
  lockStore.clear();
});

describe("processEnrollment", () => {
  const now = new Date("2026-08-15T14:00:00Z");

  it("charges the enrolled amount and allocates oldest-first", async () => {
    const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
    expect(charged[0]).toMatchObject({ customerProfileId: "cp1", paymentProfileId: "pp1", amount: 500 });
    expect(recorded[0].allocations).toEqual([
      { invoiceId: "i1", invoiceNumber: "1001", amount: 300 },
      { invoiceId: "i2", invoiceNumber: "1002", amount: 200 },
    ]);
    expect(recorded[0].source).toBe("autopay");
    expect(attempt.status).toBe("succeeded");
  });

  it("charges only the balance when it is under the enrolled amount", async () => {
    const attempt = await processEnrollment({
      enrollment, doctor, invoices: [{ id: "i1", invoiceNumber: "1001", balance: 180, dueDate: "2026-01-01" }],
      dryRun: false, now, runId: "r1",
    });
    expect(charged[0].amount).toBe(180);
    expect(attempt.status).toBe("succeeded");
  });

  it("charges nothing and completes when the balance is zero", async () => {
    const attempt = await processEnrollment({ enrollment, doctor, invoices: [], dryRun: false, now, runId: "r1" });
    expect(charged).toHaveLength(0);
    expect(attempt.status).toBe("skipped");
  });

  // The whole point of the gate: a dry run must produce a full plan and no charge.
  it("records would_charge and does not charge on a dry run", async () => {
    const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: true, now, runId: "r1" });
    expect(charged).toHaveLength(0);
    expect(recorded).toHaveLength(0);
    expect(attempt.status).toBe("would_charge");
    expect(attempt.amountAttempted).toBe("500.00");
    expect(attempt.allocations).toHaveLength(2);
  });

  it("records a failure when the gateway declines", async () => {
    const authnet = await import("../../services/authorizenet.service.js");
    authnet.chargeCustomerProfile.mockRejectedValueOnce(
      Object.assign(new Error("declined"), { authNetResponse: {} })
    );
    const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
    expect(attempt.status).toBe("failed");
    expect(attempt.failureReason).toMatch(/declined/i);
  });
});
