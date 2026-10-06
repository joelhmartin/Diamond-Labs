import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// In-memory stand-in for the `invoice_payments` table. The mock's `groupBy`
// performs the SAME aggregation Postgres would (sum of appliedAmount per
// seazonaClientId + seazonaInvoiceId, rows with no client excluded by the
// WHERE), so these tests exercise getAllClientsPaidMap's own logic (parsing +
// key mapping + soft-fail), not a re-implementation of SQL.
let seedRows = [];
let groupByShouldThrow = false;

vi.mock("../config/database.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: async () => {
            if (groupByShouldThrow) throw new Error("connection refused");
            const totals = new Map();
            for (const row of seedRows) {
              if (row.seazonaClientId == null) continue; // WHERE seazona_client_id IS NOT NULL
              const key = `${row.seazonaClientId}\u0000${row.seazonaInvoiceId}`;
              totals.set(key, (totals.get(key) || 0) + Number(row.appliedAmount));
            }
            // Postgres numeric columns come back as strings through the driver —
            // mirror that so the parseFloat() in the real code is exercised too.
            return [...totals.entries()].map(([key, total]) => {
              const [seazonaClientId, seazonaInvoiceId] = key.split("\u0000");
              return { seazonaClientId, seazonaInvoiceId, totalPaid: total.toFixed(2) };
            });
          },
        }),
      }),
    }),
  },
}));

const { getAllClientsPaidMap, clientInvoiceKey } = await import("./invoice-ledger.service.js");

beforeEach(() => {
  seedRows = [];
  groupByShouldThrow = false;
});

describe("getAllClientsPaidMap", () => {
  it("sums multiple applied-payment rows for the same client invoice", async () => {
    seedRows.push(
      { seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "100.00" },
      { seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "25.00" }
    );
    const map = await getAllClientsPaidMap();
    expect(map[clientInvoiceKey("c1", "101")]).toBe(125);
  });

  it("nets a negative refund/void row against prior payments instead of ignoring or abs()-ing it", async () => {
    seedRows.push(
      { seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "100.00" },
      { seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "-30.00" }
    );
    const map = await getAllClientsPaidMap();
    expect(map[clientInvoiceKey("c1", "101")]).toBe(70);
  });

  it("preserves a net-negative total (full refund exceeding recorded payments) rather than dropping or flipping the sign", async () => {
    seedRows.push({ seazonaClientId: "c2", seazonaInvoiceId: "202", appliedAmount: "-50.00" });
    const map = await getAllClientsPaidMap();
    expect(map[clientInvoiceKey("c2", "202")]).toBe(-50);
  });

  it("keys by client + invoice, so every portal login of one practice nets into one figure", async () => {
    seedRows.push(
      { userId: "u1", seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "10.00" },
      { userId: "u2", seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "5.00" },
      { userId: "u3", seazonaClientId: "c3", seazonaInvoiceId: "303", appliedAmount: "40.00" }
    );
    const map = await getAllClientsPaidMap();
    expect(map).toEqual({ "c1:101": 15, "c3:303": 40 });
  });

  it("excludes ledger rows with no Seazona client, matching the per-client reads", async () => {
    seedRows.push(
      { seazonaClientId: null, seazonaInvoiceId: "101", appliedAmount: "99.00" },
      { seazonaClientId: "c1", seazonaInvoiceId: "101", appliedAmount: "1.00" }
    );
    const map = await getAllClientsPaidMap();
    expect(map).toEqual({ "c1:101": 1 });
  });

  it("soft-fails to {} on a DB error instead of throwing (display path, not a guard)", async () => {
    groupByShouldThrow = true;
    await expect(getAllClientsPaidMap()).resolves.toEqual({});
  });
});
