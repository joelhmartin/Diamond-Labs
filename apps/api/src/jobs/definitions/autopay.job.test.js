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
// runAutopaySweep's enrollment query — controlled per-test via `dueRows`.
let dueRows = [];
vi.mock("../../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { attempts.push(v); } }),
    update: () => ({ set: (v) => ({ where: async () => { enrollmentUpdates.push(v); } }) }),
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => dueRows }) }) }),
  },
}));

// Reachability-aware Seazona read + the STRICT ledger read — controlled per
// test so the two Critical-bug regression tests (ledger blip, Seazona outage)
// can force each failure mode independently of the gateway/db mocks above.
const seazonaGetInvoicesResult = vi.fn(async () => ({ reachable: true, invoices: [] }));
vi.mock("../../services/seazona.service.js", () => ({
  getInvoicesResult: seazonaGetInvoicesResult,
}));

const ledgerGetPortalPaidMapStrict = vi.fn(async () => ({}));
vi.mock("../../services/invoice-ledger.service.js", () => ({
  getPortalPaidMapStrict: ledgerGetPortalPaidMapStrict,
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

const { processEnrollment, runAutopaySweep } = await import("../../services/autopay-runner.service.js");

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

// Raw Seazona-shaped invoices for the runAutopaySweep-level tests — same
// dollar amounts as `invoices` above (balance = total - portal-paid), so a
// sweep run through resolveOpenInvoices() produces the identical allocation
// plan as the direct processEnrollment tests.
const rawSeazonaInvoices = [
  { id: "i1", invoiceNumber: "1001", clientId: "c1", total: 300, due: "2026-01-01" },
  { id: "i2", invoiceNumber: "1002", clientId: "c1", total: 400, due: "2026-02-01" },
];

// Aug 15 09:00 America/Chicago (the default AUTOPAY_TIMEZONE) — day 15,
// matching `enrollment.dayOfMonth`, so isDueOn() picks this enrollment up.
const now = new Date("2026-08-15T14:00:00Z");

beforeEach(() => {
  charged.length = 0;
  recorded.length = 0;
  attempts.length = 0;
  enrollmentUpdates.length = 0;
  lockStore.clear();
  dueRows = [];
  seazonaGetInvoicesResult.mockClear();
  seazonaGetInvoicesResult.mockImplementation(async () => ({ reachable: true, invoices: rawSeazonaInvoices }));
  ledgerGetPortalPaidMapStrict.mockClear();
  ledgerGetPortalPaidMapStrict.mockImplementation(async () => ({}));
});

describe("processEnrollment", () => {
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

  // Critical 2(b) — `completed` must be recoverable: a doctor who paid off in
  // full and later receives new invoices has to resume automatically, not
  // stay silently disabled forever.
  it("reactivates a completed enrollment that owes money again and still charges it", async () => {
    const completedEnrollment = { ...enrollment, status: "completed" };
    const attempt = await processEnrollment({
      enrollment: completedEnrollment, doctor, invoices, dryRun: false, now, runId: "r1",
    });
    expect(enrollmentUpdates.some((u) => u.status === "active")).toBe(true);
    expect(charged).toHaveLength(1);
    expect(attempt.status).toBe("succeeded");
  });
});

describe("runAutopaySweep", () => {
  // Critical 1 — a ledger-read blip must never be read as "paid so far = 0"
  // (which would reopen the full invoice total and overcharge).
  it("records a failed attempt and charges nothing when the local ledger read fails", async () => {
    dueRows = [{ enrollment, doctor }];
    ledgerGetPortalPaidMapStrict.mockRejectedValueOnce(new Error("connection reset"));

    const summary = await runAutopaySweep({ dryRun: false, now, runId: "r1" });

    expect(charged).toHaveLength(0);
    expect(summary.failed).toBe(1);
    expect(summary.charged).toBe(0);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("failed");
    expect(attempts[0].failureReason).toMatch(/ledger read failed/i);
  });

  // Critical 2(a) — a Seazona outage must never be read as "zero invoices".
  it("records a skipped attempt, leaves status untouched, and charges nothing when Seazona is unreachable", async () => {
    dueRows = [{ enrollment, doctor }];
    seazonaGetInvoicesResult.mockResolvedValueOnce({ reachable: false, invoices: [] });

    const summary = await runAutopaySweep({ dryRun: false, now, runId: "r1" });

    expect(charged).toHaveLength(0);
    expect(summary.skipped).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("skipped");
    expect(attempts[0].failureReason).toMatch(/seazona unreachable/i);
    // No enrollment update at all — status must be left exactly as it was,
    // not inferred as paid-off from an outage.
    expect(enrollmentUpdates).toHaveLength(0);
  });

  it("charges a due enrollment end-to-end when Seazona and the ledger are healthy", async () => {
    dueRows = [{ enrollment, doctor }];

    const summary = await runAutopaySweep({ dryRun: false, now, runId: "r1" });

    expect(charged).toHaveLength(1);
    expect(charged[0].amount).toBe(500);
    expect(summary.charged).toBe(1);
    expect(summary.totalAmount).toBe(500);
  });
});

describe("autopay job — two-switch dry-run gate", () => {
  // Minor — the safety valve itself: a live run request must still resolve to
  // a dry run when AUTOPAY_LIVE_RUN is false. Spies on runAutopaySweep rather
  // than going fully end-to-end so this doesn't depend on the real wall-clock
  // date lining up with `enrollment.dayOfMonth` (the job handler — correctly
  // — does not accept an injectable `now`; that's a scheduler concern, not a
  // gate concern) — it isolates exactly the one thing this test is for: what
  // `dryRun` value autopay.job.js's handler passes down.
  it("stays dry when a live run is requested but AUTOPAY_LIVE_RUN is false", async () => {
    const { env } = await import("../../config/env.js");
    const original = env.AUTOPAY_LIVE_RUN;
    env.AUTOPAY_LIVE_RUN = false;

    const runnerModule = await import("../../services/autopay-runner.service.js");
    const spy = vi.spyOn(runnerModule, "runAutopaySweep").mockResolvedValue({
      considered: 0, charged: 0, skipped: 0, failed: 0, wouldCharge: 0, totalAmount: 0,
    });

    try {
      await import("./autopay.job.js");
      const { getJob } = await import("../registry.js");
      await getJob("autopay").handler({ dryRun: false, log: undefined, runId: "r1" });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ dryRun: true });
    } finally {
      env.AUTOPAY_LIVE_RUN = original;
      spy.mockRestore();
    }
  });
});
