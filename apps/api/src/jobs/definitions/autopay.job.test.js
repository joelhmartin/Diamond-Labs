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
// I3 — controllable per test so the in-lock cap re-check can be forced to
// fail independently of everything else; defaults to "no cap problem".
const paymentRecordingVerifyAllocations = vi.fn(async () => null);
vi.mock("../../services/payment-recording.service.js", () => ({
  recordPaymentAndAllocations: vi.fn(async (args) => {
    recorded.push(args);
    return { seazonaPaymentId: "sp1" };
  }),
  verifyAllocations: (...args) => paymentRecordingVerifyAllocations(...args),
}));

const attempts = [];
const enrollmentUpdates = [];
// runAutopaySweep's enrollment query — controlled per-test via `dueRows`.
let dueRows = [];
// C2/I4 — every autopay_attempts row already on file for "this user, this
// cycle", used by BOTH the retry-day gate (looks for a `failed` row) and the
// durable per-cycle charge guard (looks for a `succeeded` row). One knob
// covers both because in the real query they're the exact same rows, just
// filtered differently in application code — see attemptsThisCycle() in
// autopay-runner.service.js.
let cycleAttemptRows = [];
// Rollover-regression support: when set, the attempts-table `.where()` below
// stops returning `cycleAttemptRows` unconditionally and instead filters by
// the ACTUAL cycle_key param the query was built with — necessary to prove
// the retry-day gate and the durable per-cycle guard each query the correct
// (base, not calendar) cycle. Keyed by cycle_key string, e.g. "2026-04".
let attemptRowsByCycle = null;

/**
 * Pull `{ column_name: value }` out of a drizzle `and(eq(col, val), ...)`
 * condition tree by walking its SQL query-chunk structure. Test-only
 * introspection — real drizzle never needs this since Postgres does the
 * filtering; here the "database" is an in-memory mock that must decide what
 * to return based on which cycle was actually queried.
 */
function extractEqParams(sql) {
  const result = {};
  let pendingColumn = null;
  function walk(chunk) {
    if (chunk == null) return;
    const ctor = chunk.constructor?.name;
    if (ctor === "SQL" && Array.isArray(chunk.queryChunks)) {
      for (const c of chunk.queryChunks) walk(c);
    } else if (ctor === "Param") {
      if (pendingColumn) {
        result[pendingColumn] = chunk.value;
        pendingColumn = null;
      }
    } else if (chunk && typeof chunk === "object" && "name" in chunk && "table" in chunk) {
      pendingColumn = chunk.name;
    }
  }
  walk(sql);
  return result;
}

vi.mock("../../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { attempts.push(v); } }),
    update: () => ({ set: (v) => ({ where: async () => { enrollmentUpdates.push(v); } }) }),
    select: () => ({
      from: (table) => {
        if (table === autopayAttemptsTable) {
          return {
            where: async (cond) => {
              if (attemptRowsByCycle) {
                const { cycle_key: cycleKey } = extractEqParams(cond);
                return attemptRowsByCycle[cycleKey] || [];
              }
              return cycleAttemptRows;
            },
          };
        }
        return { innerJoin: () => ({ where: async () => dueRows }) };
      },
    }),
  },
}));

// Reachability-aware Seazona read + the STRICT ledger read — controlled per
// test so the two Critical-bug regression tests (ledger blip, Seazona outage)
// can force each failure mode independently of the gateway/db mocks above.
// CRITICAL 1 — must be the PAGINATING getAllInvoicesResult(), not the
// single-page getInvoicesResult(): the runner now calls the former exactly
// once per sweep (I6) rather than once per enrollment.
const seazonaGetAllInvoicesResult = vi.fn(async () => ({ reachable: true, invoices: [] }));
vi.mock("../../services/seazona.service.js", () => ({
  getAllInvoicesResult: seazonaGetAllInvoicesResult,
}));

// Real (unmocked) schema import — pure pgTable definitions, no DB/env side
// effects — used only so the db mock above can tell the enrollments query
// apart from the attempts query by table identity.
const { autopayAttempts: autopayAttemptsTable } = await import("../../db/schema/index.js");

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
  cycleAttemptRows = [];
  attemptRowsByCycle = null;
  seazonaGetAllInvoicesResult.mockClear();
  seazonaGetAllInvoicesResult.mockImplementation(async () => ({ reachable: true, invoices: rawSeazonaInvoices }));
  ledgerGetPortalPaidMapStrict.mockClear();
  ledgerGetPortalPaidMapStrict.mockImplementation(async () => ({}));
  paymentRecordingVerifyAllocations.mockClear();
  paymentRecordingVerifyAllocations.mockImplementation(async () => null);
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

  // C2 — the durable per-cycle guard, exercised directly against
  // processEnrollment (the sweep-level test below exercises it via the
  // retry-day path instead).
  describe("C2 — durable per-cycle charge guard", () => {
    it("records skipped and does not charge when a succeeded, real attempt already exists this cycle", async () => {
      cycleAttemptRows = [{ status: "succeeded", dryRun: false }];
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
      expect(charged).toHaveLength(0);
      expect(recorded).toHaveLength(0);
      expect(attempt.status).toBe("skipped");
      expect(attempt.failureReason).toMatch(/already charged/i);
      // Must NOT be treated like a card decline — no consecutiveFailures
      // bump, no pause, no enrollment update of any kind.
      expect(enrollmentUpdates).toHaveLength(0);
    });

    it("ignores a succeeded DRY-RUN attempt — a dry run must never block a real charge", async () => {
      cycleAttemptRows = [{ status: "succeeded", dryRun: true }];
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
      expect(charged).toHaveLength(1);
      expect(attempt.status).toBe("succeeded");
    });

    it("ignores an earlier FAILED attempt this cycle — only a SUCCEEDED one blocks a charge", async () => {
      cycleAttemptRows = [{ status: "failed", dryRun: false }];
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
      expect(charged).toHaveLength(1);
      expect(attempt.status).toBe("succeeded");
    });
  });

  // I3 — the sweep is the only charge path that computes its allocation plan
  // well before entering the invoice lock; the cap must be re-verified
  // INSIDE the lock, same as every human charge path already does.
  describe("I3 — in-lock allocation cap re-check", () => {
    it("records failed (not a decline) and does not charge when the in-lock cap re-check fails", async () => {
      paymentRecordingVerifyAllocations.mockResolvedValueOnce({
        kind: "validation",
        message: "Allocation exceeds remaining balance.",
      });
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
      expect(charged).toHaveLength(0);
      expect(recorded).toHaveLength(0);
      expect(attempt.status).toBe("failed");
      expect(attempt.failureReason).toMatch(/exceeds remaining balance/i);
      // Not a card decline — must not bump consecutiveFailures or pause.
      expect(enrollmentUpdates.some((u) => u.consecutiveFailures !== undefined)).toBe(false);
    });

    // A "forbidden" kind also fires when getInvoice returns null, which is
    // what a Seazona outage looks like (the wrapper swallows failures to
    // null) — not just a genuinely missing/foreign invoice. The recorded
    // reason must not read as a definitive "not found" data problem.
    it("labels a 'forbidden' cap-check result as an unreachable/unavailable blip, not a flat 'not found'", async () => {
      paymentRecordingVerifyAllocations.mockResolvedValueOnce({
        kind: "forbidden",
        message: "Invoice 1001 not found.",
      });
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
      expect(charged).toHaveLength(0);
      expect(recorded).toHaveLength(0);
      expect(attempt.status).toBe("failed");
      expect(attempt.failureReason).toMatch(/unreachable|unavailable/i);
      // Still not a card decline — no consecutiveFailures bump/pause.
      expect(enrollmentUpdates.some((u) => u.consecutiveFailures !== undefined)).toBe(false);
    });
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

  // Nothing due — the full paginating archive walk must be skipped entirely,
  // not just its results ignored. This is the guard against paying that cost
  // (and its rate-limit risk) on every daily run regardless of whether
  // anything is actually due.
  it("skips the Seazona archive fetch entirely when nothing is due", async () => {
    dueRows = [];

    const summary = await runAutopaySweep({ dryRun: false, now, runId: "r1" });

    expect(summary.considered).toBe(0);
    expect(seazonaGetAllInvoicesResult).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });

  // Critical 2(a) — a Seazona outage must never be read as "zero invoices".
  it("records a skipped attempt, leaves status untouched, and charges nothing when Seazona is unreachable", async () => {
    dueRows = [{ enrollment, doctor }];
    seazonaGetAllInvoicesResult.mockResolvedValueOnce({ reachable: false, invoices: [] });

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

  // I6 — the archive must be fetched once for the whole sweep, not once per
  // enrollment (the thing that tripped a host-level 403 from ~950 requests).
  it("fetches the Seazona invoice archive only once even with multiple due enrollments", async () => {
    const doctor2 = { ...doctor, id: "u2", seazonaClientId: "c2" };
    const enrollment2 = { ...enrollment, id: "e2", userId: "u2" };
    dueRows = [{ enrollment, doctor }, { enrollment: enrollment2, doctor: doctor2 }];

    await runAutopaySweep({ dryRun: false, now, runId: "r1" });

    expect(seazonaGetAllInvoicesResult).toHaveBeenCalledTimes(1);
  });

  // I4 — decline retries fire on day+2/day+5, but ONLY when this cycle
  // already logged a real (non-dry-run) failed attempt.
  describe("I4 — decline retry days", () => {
    // Aug 17 in Chicago — enrollment.dayOfMonth is 15, so this is day+2, not
    // the enrollment's own due day.
    const retryNow = new Date("2026-08-17T14:00:00Z");

    it("fires on a retry day when this cycle already has a failed attempt, and charges", async () => {
      dueRows = [{ enrollment, doctor }];
      cycleAttemptRows = [{ status: "failed", dryRun: false }];

      const summary = await runAutopaySweep({ dryRun: false, now: retryNow, runId: "r1" });

      expect(summary.considered).toBe(1);
      expect(charged).toHaveLength(1);
      expect(summary.charged).toBe(1);
    });

    it("does not fire on a retry day when this cycle has no failed attempt yet", async () => {
      dueRows = [{ enrollment, doctor }];
      cycleAttemptRows = [];

      const summary = await runAutopaySweep({ dryRun: false, now: retryNow, runId: "r1" });

      expect(summary.considered).toBe(0);
      expect(charged).toHaveLength(0);
    });

    it("does not fire on a retry day when the only prior attempt was a dry run", async () => {
      dueRows = [{ enrollment, doctor }];
      cycleAttemptRows = [{ status: "failed", dryRun: true }];

      const summary = await runAutopaySweep({ dryRun: false, now: retryNow, runId: "r1" });

      expect(summary.considered).toBe(0);
      expect(charged).toHaveLength(0);
    });

    it("does not fire on a day that is neither the charge day nor a retry day", async () => {
      dueRows = [{ enrollment, doctor }];
      cycleAttemptRows = [{ status: "failed", dryRun: false }];
      // Aug 18 — one day past the day+2 retry, not day+5 either.
      const offDay = new Date("2026-08-18T14:00:00Z");

      const summary = await runAutopaySweep({ dryRun: false, now: offDay, runId: "r1" });

      expect(summary.considered).toBe(0);
      expect(charged).toHaveLength(0);
    });

    // Regression: a retry that rolls into next month must be gated and
    // stamped against the BASE cycle (the charge it's retrying), not the
    // calendar month it happens to land in. Before the fix, the gate queried
    // `cycleKeyFor(now)` — "2026-05" for a May 2 retry — and found nothing,
    // so the retry silently never fired.
    describe("rollover regression — retry crossing into next month", () => {
      const enrollment30 = { ...enrollment, id: "e30", dayOfMonth: 30 };

      it("picks up a retry on May 2 for an April 30 failure (base cycle 2026-04), and charges", async () => {
        dueRows = [{ enrollment: enrollment30, doctor }];
        // Only April's cycle has a failure on file — May's cycle has nothing.
        // The old `cycleKeyFor(now)` gate would query "2026-05" and find
        // nothing here, so this is exactly the regression case.
        attemptRowsByCycle = { "2026-04": [{ status: "failed", dryRun: false }] };
        const retryDate = new Date("2026-05-02T14:00:00Z"); // May 2, America/Chicago.

        const summary = await runAutopaySweep({ dryRun: false, now: retryDate, runId: "r1" });

        expect(summary.considered).toBe(1);
        expect(charged).toHaveLength(1);
        expect(summary.charged).toBe(1);
        // The succeeded attempt row must be stamped with April's cycle, not May's.
        expect(attempts).toHaveLength(1);
        expect(attempts[0].status).toBe("succeeded");
        expect(attempts[0].cycleKey).toBe("2026-04");
      });

      it("a May 2 retry success does not block the doctor's own May 30 charge", async () => {
        dueRows = [{ enrollment: enrollment30, doctor }];
        attemptRowsByCycle = { "2026-04": [{ status: "failed", dryRun: false }] };
        const retryDate = new Date("2026-05-02T14:00:00Z");

        const retrySummary = await runAutopaySweep({ dryRun: false, now: retryDate, runId: "r1" });
        expect(retrySummary.charged).toBe(1);
        expect(attempts[0].cycleKey).toBe("2026-04");

        // Simulate the next run: reset per-call trackers (a fresh sweep), but
        // the attempt store persists — May's own cycle ("2026-05") has no
        // succeeded row on file, since the May 2 retry was correctly stamped
        // "2026-04" above. The durable per-cycle guard (C2) must therefore
        // NOT block May 30's charge.
        charged.length = 0;
        attempts.length = 0;
        lockStore.clear();
        attemptRowsByCycle["2026-05"] = [];

        const chargeDate = new Date("2026-05-30T14:00:00Z"); // May 30 — enrollment30's own charge day.
        const chargeSummary = await runAutopaySweep({ dryRun: false, now: chargeDate, runId: "r2" });

        expect(chargeSummary.considered).toBe(1);
        expect(chargeSummary.charged).toBe(1);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].status).toBe("succeeded");
        expect(attempts[0].cycleKey).toBe("2026-05");
      });
    });
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
