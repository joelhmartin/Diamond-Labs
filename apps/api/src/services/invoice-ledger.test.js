import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// Fake drizzle `db`: records the WHERE handed to each query and resolves the
// rows the test queues (or rejects, to simulate a DB error).
const state = { wheres: [], result: [], fail: null };
vi.mock("../config/database.js", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (w) => {
      state.wheres.push(w);
      const p = state.fail ? Promise.reject(state.fail) : Promise.resolve(state.result);
      return Object.assign(p, { groupBy: () => p });
    },
  };
  return { db: chain, queryClient: {} };
});

const {
  invoicePaidWhere,
  getInvoicePaidStrict,
  getInvoicePaid,
  getClientPaidMap,
} = await import("./invoice-ledger.service.js");

const dialect = new PgDialect();
const render = (w) => dialect.sqlToQuery(w);

beforeEach(() => {
  state.wheres = [];
  state.result = [];
  state.fail = null;
});

/**
 * CodeRabbit (PR #36): the paid-cap was keyed by portal userId, but several
 * logins can share one seazonaClientId. After login A paid an invoice in full,
 * login B computed "paid so far = 0" and could pay the whole balance again.
 * The cap is now keyed by Seazona client + invoice, with no user in the predicate.
 */
describe("invoice paid-cap keying", () => {
  it("filters on seazona_client_id AND seazona_invoice_id, never user_id", () => {
    const { sql, params } = render(invoicePaidWhere({ seazonaClientId: "client-1", seazonaInvoiceId: "inv-9" }));
    expect(sql).toMatch(/"seazona_client_id" = \$1/);
    expect(sql).toMatch(/"seazona_invoice_id" = \$2/);
    expect(sql).not.toMatch(/user_id/);
    expect(params).toEqual(["client-1", "inv-9"]);
  });

  it("refuses to build a predicate with a missing key (would silently widen or zero the sum)", () => {
    expect(() => invoicePaidWhere({ seazonaClientId: null, seazonaInvoiceId: "inv-9" })).toThrow(/required/);
    expect(() => invoicePaidWhere({ seazonaClientId: "client-1" })).toThrow(/required/);
  });

  it("getInvoicePaidStrict queries with that predicate and sums the result", async () => {
    state.result = [{ totalPaid: "125.50" }];
    const paid = await getInvoicePaidStrict({ seazonaClientId: "client-1", seazonaInvoiceId: "inv-9" });
    expect(paid).toBe(125.5);
    expect(render(state.wheres[0])).toEqual(
      render(invoicePaidWhere({ seazonaClientId: "client-1", seazonaInvoiceId: "inv-9" }))
    );
  });

  it("getInvoicePaidStrict THROWS on a DB error (a guard must fail closed)", async () => {
    state.fail = new Error("connection reset");
    await expect(getInvoicePaidStrict({ seazonaClientId: "client-1", seazonaInvoiceId: "inv-9" })).rejects.toThrow(
      "connection reset"
    );
  });

  it("getInvoicePaidStrict THROWS when the client id is missing, instead of reporting 0", async () => {
    await expect(getInvoicePaidStrict({ seazonaClientId: undefined, seazonaInvoiceId: "inv-9" })).rejects.toThrow(
      /required/
    );
  });

  it("getInvoicePaid (display) degrades to 0 on a DB error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.fail = new Error("connection reset");
    await expect(getInvoicePaid({ seazonaClientId: "client-1", seazonaInvoiceId: "inv-9" })).resolves.toBe(0);
  });

  it("getClientPaidMap (display) is keyed by client, so every login of a practice sees the same balance", async () => {
    state.result = [
      { seazonaInvoiceId: "inv-1", totalPaid: "10.00" },
      { seazonaInvoiceId: "inv-2", totalPaid: "0.50" },
    ];
    await expect(getClientPaidMap("client-1")).resolves.toEqual({ "inv-1": 10, "inv-2": 0.5 });
    const { sql } = render(state.wheres[0]);
    expect(sql).toMatch(/"seazona_client_id" = \$1/);
    expect(sql).not.toMatch(/user_id/);
  });
});
