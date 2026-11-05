import { test } from "vitest";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { invoiceExportParamsSchema, LAB_TIMEZONE } from "@my-app/shared";
import { invoicesSource } from "./invoices.export.js";

const dialect = new PgDialect();
const render = (chunk) => dialect.sqlToQuery(chunk);

/** A db whose awaited select chains pop queued results and record every builder call. */
function recordingDb(selects) {
  const chains = [];
  const db = {
    select: () => {
      const calls = [];
      chains.push(calls);
      const b = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === "then") return (res, rej) => Promise.resolve(selects.shift() ?? []).then(res, rej);
          return (...args) => { calls.push([prop, args]); return b; };
        },
      });
      return b;
    },
  };
  return { db, chains };
}

const inv = (over = {}) => ({
  id: "i1", invoiceNumber: 1001, kind: "order", status: "issued", issuedAt: new Date("2026-03-02T05:30:00Z"),
  dueDate: "2026-04-01", subtotalCents: 9000, taxCents: 720, shippingCents: 280, totalCents: 10_000, ...over,
});
const row = (invoice, over = {}) => ({
  invoice, clientName: "Dr A", practice: "A Dental", accountNumber: "A-1", orderNumber: 77,
  receivedAt: new Date("2026-03-01T03:30:00Z"), ...over,
});
const params = { dateField: "issued", from: "2026-03-01", to: "2026-03-31" };

test("fields never include a patient column", () => {
  assert.ok(invoicesSource.fields.length > 0);
  for (const f of invoicesSource.fields) assert.doesNotMatch(f.key, /patient/i);
  assert.deepEqual(invoicesSource.fields.map((f) => f.key), [
    "invoiceNumber", "kind", "status", "accountNumber", "practice", "clientName", "orderNumber",
    "orderedOn", "issuedOn", "dueOn", "subtotal", "tax", "shipping", "total", "paid", "balance",
  ]);
});

test("fetchPage pages with limit/offset and a stable order", async () => {
  const { db, chains } = recordingDb([[row(inv())], [{ n: 41 }], []]);
  const page = await invoicesSource.fetchPage(db, params, { limit: 25, offset: 50 });
  const calls = Object.fromEntries(chains[0].map(([m, a]) => [m, a]));
  assert.match(render(calls.orderBy[0]).sql, /"invoice_number" asc/);
  assert.equal(calls.limit[0], 25);
  assert.equal(calls.offset[0], 50);
  assert.equal(page.total, 41);
});

test("status open/paid is derived from the ledger balance, not stored", async () => {
  const rows = [
    row(inv({ id: "a", invoiceNumber: 1, totalCents: 10_000 })),
    row(inv({ id: "b", invoiceNumber: 2, totalCents: 10_000 })),
    row(inv({ id: "c", invoiceNumber: 3, status: "void" })),
    row(inv({ id: "d", invoiceNumber: 4, status: "draft", issuedAt: null, dueDate: null })),
  ];
  const { db } = recordingDb([rows, [{ n: 4 }], [{ invoiceId: "a", paid: "4000" }, { invoiceId: "b", paid: "10000" }]]);
  const { rows: out } = await invoicesSource.fetchPage(db, params, { limit: 10, offset: 0 });
  assert.deepEqual(out.map((r) => r.status), ["open", "paid", "void", "draft"]);
  assert.deepEqual([out[0].paid, out[0].balance], [4000, 6000]);
  assert.deepEqual([out[1].paid, out[1].balance], [10_000, 0]);
  assert.equal(out[3].issuedOn, null);
});

test("dates are lab-local and ordered falls back to issued_at without a lab order", async () => {
  const rows = [
    row(inv()), // received 2026-03-01 03:30Z = Feb 28 evening in Chicago
    row(inv({ id: "legacy", invoiceNumber: 2, kind: "legacy" }), { receivedAt: null, orderNumber: null }),
  ];
  const { db } = recordingDb([rows, [{ n: 2 }], []]);
  const { rows: out } = await invoicesSource.fetchPage(db, params, { limit: 10, offset: 0 });
  assert.equal(out[0].orderedOn, "2026-02-28");
  assert.equal(out[0].issuedOn, "2026-03-01");
  assert.equal(out[1].orderedOn, "2026-03-01", "falls back to the issue date");
  assert.equal(out[1].orderNumber, null);
});

test("the WHERE filters ordered on coalesce(received_at, issued_at) in the lab timezone", async () => {
  const { db, chains } = recordingDb([[], [{ n: 0 }]]);
  await invoicesSource.fetchPage(db, { ...params, dateField: "ordered", statuses: ["open", "paid"] }, { limit: 10, offset: 0 });
  const where = chains[0].find(([m]) => m === "where")[1][0];
  const { sql, params: bound } = render(where);
  assert.match(sql, /coalesce\("lab_orders"\."received_at", "invoices"\."issued_at"\)/);
  assert.match(sql, /at time zone/i);
  assert.ok(bound.includes(LAB_TIMEZONE));
  assert.ok(bound.includes("2026-03-01") && bound.includes("2026-03-31"));
  assert.match(sql, /total_cents/);
});

test("the due filter compares the date column directly", async () => {
  const { db, chains } = recordingDb([[], [{ n: 0 }]]);
  await invoicesSource.fetchPage(db, { ...params, dateField: "due" }, { limit: 10, offset: 0 });
  const { sql } = render(chains[0].find(([m]) => m === "where")[1][0]);
  assert.match(sql, /"due_date" >= /);
  assert.doesNotMatch(sql, /at time zone/i);
});

test("schema refuses a range over 366 days and to < from", () => {
  const ok = invoiceExportParamsSchema.safeParse({ dateField: "issued", from: "2026-01-01", to: "2027-01-02" });
  assert.equal(ok.success, true, "366 days apart is allowed");
  assert.equal(invoiceExportParamsSchema.safeParse({ dateField: "issued", from: "2026-01-01", to: "2027-01-03" }).success, false);
  assert.equal(invoiceExportParamsSchema.safeParse({ dateField: "issued", from: "2026-02-01", to: "2026-01-01" }).success, false);
  assert.equal(invoiceExportParamsSchema.safeParse({ dateField: "issued", from: "2026-02-30", to: "2026-03-01" }).success, false);
  assert.equal(invoiceExportParamsSchema.safeParse({ dateField: "bogus", from: "2026-01-01", to: "2026-01-02" }).success, false);
});

test("statuses accept a single value, a comma list or an array", () => {
  const p = (statuses) => invoiceExportParamsSchema.parse({ dateField: "due", from: "2026-01-01", to: "2026-01-31", statuses }).statuses;
  assert.deepEqual(p("open"), ["open"]);
  assert.deepEqual(p("open,paid"), ["open", "paid"]);
  assert.deepEqual(p(["void"]), ["void"]);
  assert.equal(p(undefined), undefined);
});
