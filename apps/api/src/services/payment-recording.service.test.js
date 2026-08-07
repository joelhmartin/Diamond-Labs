import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// `env` is parsed once at import time in the real config/env.js (frozen for
// the life of the process), so tests that need to flip AUTHORIZE_NET_ENV
// mid-suite must mock the module with a mutable object rather than relying on
// process.env + vi.stubEnv (which would have no effect after the real module
// already parsed it).
const envMock = { AUTHORIZE_NET_ENV: "production" };
vi.mock("../config/env.js", () => ({ env: envMock }));

const seazonaCreatePayment = vi.fn(async () => ({ id: "sp1" }));
vi.mock("./seazona.service.js", () => ({
  createPayment: (...args) => seazonaCreatePayment(...args),
}));

const insertedRows = [];
vi.mock("../config/database.js", () => ({
  db: {
    insert: () => ({
      values: async (rows) => {
        insertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
      },
    }),
  },
}));

vi.mock("../db/schema/index.js", () => ({ invoicePayments: {} }));

const sendPaymentReceipt = vi.fn(async () => true);
vi.mock("./email.service.js", () => ({
  sendPaymentReceipt: (...args) => sendPaymentReceipt(...args),
}));

const auditEntries = [];
vi.mock("./audit.service.js", () => ({
  logSafe: async (entry) => {
    auditEntries.push(entry);
  },
}));

const { recordPaymentAndAllocations } = await import("./payment-recording.service.js");

const doctor = {
  id: "u1",
  email: "doc@example.com",
  seazonaClientId: "c1",
  seazonaAccountNumber: "acct-1",
};

const allocations = [{ invoiceId: "i1", invoiceNumber: "1001", amount: 100 }];

beforeEach(() => {
  envMock.AUTHORIZE_NET_ENV = "production";
  seazonaCreatePayment.mockClear();
  seazonaCreatePayment.mockImplementation(async () => ({ id: "sp1" }));
  insertedRows.length = 0;
  sendPaymentReceipt.mockClear();
  auditEntries.length = 0;
});

describe("recordPaymentAndAllocations — existing callers unaffected", () => {
  it("defaults write to Seazona in production with a clientId (unchanged existing behavior)", async () => {
    const result = await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(seazonaCreatePayment).toHaveBeenCalledTimes(1);
    expect(result.seazonaPaymentId).toBe("sp1");
  });

  it("defaults the receipt email to the charged copy (wasCharged: true)", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(sendPaymentReceipt).toHaveBeenCalledTimes(1);
    expect(sendPaymentReceipt.mock.calls[0][0]).toMatchObject({ wasCharged: true });
  });

  it("defaults the audit action to payment.charge with the paying user as actor", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({ action: "payment.charge", userId: "u1" });
  });

  it("still gates the Seazona write on sandbox env, regardless of writeToSeazona's default", async () => {
    envMock.AUTHORIZE_NET_ENV = "sandbox";
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(seazonaCreatePayment).not.toHaveBeenCalled();
  });

  it("still gates the Seazona write on the user having a seazonaClientId", async () => {
    await recordPaymentAndAllocations({
      user: { ...doctor, seazonaClientId: null },
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(seazonaCreatePayment).not.toHaveBeenCalled();
  });

  it("always writes the local ledger row regardless of writeToSeazona", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ source: "doctor_card", transactionId: "tx1" });
  });
});

describe("recordPaymentAndAllocations — writeToSeazona:false (admin offline default)", () => {
  it("makes NO Seazona call even in production with a clientId", async () => {
    const result = await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "OFFLINE-abc",
      allocations,
      source: "admin_offline",
      writeToSeazona: false,
    });
    expect(seazonaCreatePayment).not.toHaveBeenCalled();
    expect(result.seazonaPaymentId).toBeNull();
  });

  it("still writes the local ledger row", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "OFFLINE-abc",
      allocations,
      source: "admin_offline",
      writeToSeazona: false,
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ source: "admin_offline", seazonaPaymentId: null });
  });
});

describe("recordPaymentAndAllocations — writeToSeazona:true (admin offline opt-in)", () => {
  it("makes exactly ONE Seazona createPayment call", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "OFFLINE-abc",
      allocations,
      source: "admin_offline",
      writeToSeazona: true,
    });
    expect(seazonaCreatePayment).toHaveBeenCalledTimes(1);
  });

  it("produces a sensible referenceNumber/notes payload for an OFFLINE- sentinel (no gateway transaction)", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "OFFLINE-abc",
      allocations,
      source: "admin_offline",
      writeToSeazona: true,
    });
    const call = seazonaCreatePayment.mock.calls[0][0];
    expect(call.referenceNumber).toBe("Invoices 1001");
    expect(call.notes).toContain("OFFLINE-abc");
    expect(call.notes).not.toContain("txn"); // no longer implies a gateway transaction
  });
});

describe("recordPaymentAndAllocations — offline receipt-email copy", () => {
  it("passes wasCharged:false through to sendPaymentReceipt so the copy doesn't claim a card charge", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "OFFLINE-abc",
      allocations,
      source: "admin_offline",
      writeToSeazona: false,
      wasCharged: false,
    });
    expect(sendPaymentReceipt).toHaveBeenCalledTimes(1);
    expect(sendPaymentReceipt.mock.calls[0][0]).toMatchObject({ wasCharged: false });
  });
});

describe("recordPaymentAndAllocations — audit override for offline records", () => {
  it("logs the offline-specific action with the admin as actor, not the paying doctor", async () => {
    await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "OFFLINE-abc",
      allocations,
      source: "admin_offline",
      writeToSeazona: false,
      wasCharged: false,
      auditAction: "payment.offline_recorded",
      actorUserId: "admin-1",
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({ action: "payment.offline_recorded", userId: "admin-1" });
    // Never mislabeled as a card charge.
    expect(auditEntries[0].action).not.toBe("payment.charge");
  });
});

describe("recordPaymentAndAllocations — never throws", () => {
  it("treats a Seazona write that returns no id as a soft failure and still writes the ledger", async () => {
    // Matches the real seazonaService.request() contract: it never throws,
    // just resolves null on any failure.
    seazonaCreatePayment.mockImplementation(async () => null);
    const result = await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(result.seazonaPaymentId).toBeNull();
    expect(insertedRows).toHaveLength(1);
  });

  it("marks ledgerWriteFailed and does not throw when the DB insert fails", async () => {
    const { db } = await import("../config/database.js");
    const original = db.insert;
    db.insert = () => ({
      values: async () => {
        throw new Error("db down");
      },
    });
    const result = await recordPaymentAndAllocations({
      user: doctor,
      amount: 100,
      transactionId: "tx1",
      allocations,
      source: "doctor_card",
    });
    expect(result.ledgerWriteFailed).toBe(true);
    db.insert = original;
  });
});
