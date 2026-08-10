import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// In-memory stand-in for the `invoice_payments` table. The mock's `groupBy`
// performs the SAME aggregation Postgres would (sum of appliedAmount per
// seazonaInvoiceId), so these tests exercise getGlobalPortalPaidMap's own
// logic (parsing + key mapping + soft-fail), not a re-implementation of SQL.
let seedRows = [];
let groupByShouldThrow = false;

vi.mock("../config/database.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        groupBy: async () => {
          if (groupByShouldThrow) throw new Error("connection refused");
          const totals = new Map();
          for (const row of seedRows) {
            const key = row.seazonaInvoiceId;
            totals.set(key, (totals.get(key) || 0) + Number(row.appliedAmount));
          }
          // Postgres numeric columns come back as strings through the driver —
          // mirror that so the parseFloat() in the real code is exercised too.
          // Drizzle keys the result row by the JS object key given to select()
          // (`totalPaid`), not the SQL `.as("total_paid")` alias — that alias
          // only affects the generated SQL text.
          return [...totals.entries()].map(([seazonaInvoiceId, total]) => ({
            seazonaInvoiceId,
            totalPaid: total.toFixed(2),
          }));
        },
      }),
    }),
  },
}));

const { getGlobalPortalPaidMap } = await import("./invoice-ledger.service.js");

beforeEach(() => {
  seedRows = [];
  groupByShouldThrow = false;
});

describe("getGlobalPortalPaidMap", () => {
  it("sums multiple applied-payment rows for the same invoice", () => {
    seedRows.push(
      { seazonaInvoiceId: "101", appliedAmount: "100.00" },
      { seazonaInvoiceId: "101", appliedAmount: "25.00" }
    );
    return getGlobalPortalPaidMap().then((map) => {
      expect(map["101"]).toBe(125);
    });
  });

  it("nets a negative refund/void row against prior payments instead of ignoring or abs()-ing it", async () => {
    seedRows.push(
      { seazonaInvoiceId: "101", appliedAmount: "100.00" },
      { seazonaInvoiceId: "101", appliedAmount: "-30.00" }
    );
    const map = await getGlobalPortalPaidMap();
    expect(map["101"]).toBe(70);
  });

  it("preserves a net-negative total (full refund exceeding recorded payments) rather than dropping or flipping the sign", async () => {
    seedRows.push({ seazonaInvoiceId: "202", appliedAmount: "-50.00" });
    const map = await getGlobalPortalPaidMap();
    expect(map["202"]).toBe(-50);
  });

  it("keys the map by every distinct seazonaInvoiceId, scoped across all users", async () => {
    seedRows.push(
      { seazonaInvoiceId: "101", appliedAmount: "10.00" },
      { seazonaInvoiceId: "303", appliedAmount: "40.00" }
    );
    const map = await getGlobalPortalPaidMap();
    expect(map).toEqual({ "101": 10, "303": 40 });
  });

  it("soft-fails to {} on a DB error instead of throwing (display path, not a guard)", async () => {
    groupByShouldThrow = true;
    await expect(getGlobalPortalPaidMap()).resolves.toEqual({});
  });
});
