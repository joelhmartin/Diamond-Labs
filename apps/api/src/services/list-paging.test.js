import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const { listInvoices, invoiceListWhere, INVOICE_LIST_LIMIT } = await import("./billing/invoice-queries.js");
const { listLabOrders, LIST_LIMIT } = await import("./lab/lab-orders.service.js");
const { listShipmentsForLab } = await import("./lab/lab-shipping-queries.js");
const { shipmentListWhere, SHIPMENT_LIST_LIMIT } = await import("./shipping/shipments.service.js");

/**
 * A db whose every awaited select chain pops the next queued result and records
 * each builder call as [method, args], so a test can see the limit/offset/where
 * each query was given. count(*) selects ({ n }) draw from `counts`, so the two
 * queries (which run concurrently) can't swap results.
 */
function recorder(results, counts = []) {
  const queries = [];
  const countQueries = [];
  const queue = [...results];
  const countQueue = [...counts];
  const chain = (cols) => {
    const calls = [];
    queries.push(calls);
    const counting = Boolean(cols && "n" in cols);
    if (counting) countQueries.push(calls);
    const b = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve((counting ? countQueue : queue).shift() ?? []).then(res, rej);
        return (...args) => { calls.push([prop, args]); return b; };
      },
    });
    return b;
  };
  return { queries, countQueries, select: chain, selectDistinct: chain };
}
const arg = (calls, name) => calls.find(([m]) => m === name)?.[1][0];
const render = (where) => new PgDialect().sqlToQuery(where);

// ── Invoices ────────────────────────────────────────────────────────────────
const invoiceRow = (n) => ({ invoice: { id: `i${n}`, invoiceNumber: n, kind: "client", status: "issued", totalCents: 100, issuedAt: new Date() }, clientName: "Dr A", practice: "Smile Co", labOrderNumber: null });

test("invoices: limit/offset page the list, total counts every match, and both queries share one WHERE", async () => {
  const db = recorder([[invoiceRow(3), invoiceRow(2)], [], []], [[{ n: 57 }]]);
  const out = await listInvoices({ limit: 2, offset: 4, q: "smile" }, db);
  assert.deepEqual(out.invoices.map((i) => i.invoiceNumber), [3, 2]);
  assert.equal(out.total, 57);
  assert.equal("truncated" in out, false);
  const rows = db.queries.find((q) => !db.countQueries.includes(q));
  const [count] = db.countQueries;
  assert.equal(arg(rows, "limit"), 2);
  assert.equal(arg(rows, "offset"), 4);
  assert.ok(arg(rows, "where"), "q produced a WHERE");
  assert.equal(arg(count, "where"), arg(rows, "where"), "page and count use the very same WHERE object");
  assert.equal(count.some(([m]) => m === "limit" || m === "offset"), false, "the count ignores limit/offset");
});

test("invoices: offset defaults to 0 when only limit is sent", async () => {
  const db = recorder([[]], [[{ n: 0 }]]);
  const out = await listInvoices({ limit: 25 }, db);
  assert.deepEqual(out, { invoices: [], total: 0 });
  assert.equal(arg(db.queries[0], "offset"), 0);
  assert.equal(db.countQueries.length, 1);
});

test("invoices: without limit the response is unchanged (capped, truncated flag, no count query)", async () => {
  const db = recorder([[invoiceRow(1)], [], []]);
  const out = await listInvoices({ status: "issued" }, db);
  assert.deepEqual(Object.keys(out), ["invoices", "truncated"]);
  assert.equal(out.truncated, false);
  assert.equal(arg(db.queries[0], "limit"), INVOICE_LIST_LIMIT);
  assert.equal(db.queries[0].some(([m]) => m === "offset"), false);
  assert.equal(db.countQueries.length, 0, "no count(*)");
  const full = recorder([Array.from({ length: INVOICE_LIST_LIMIT }, (_, i) => invoiceRow(i + 1)), [], []]);
  assert.equal((await listInvoices({}, full)).truncated, true);
});

test("invoices: q digits match the invoice number prefix", () => {
  const { sql, params } = render(invoiceListWhere({ q: "1004" }));
  assert.match(sql, /"invoice_number"::text like \$1/);
  assert.deepEqual(params, ["1004%"]);
});

test("invoices: q text matches practice and doctor name case-insensitively, wildcards escaped", () => {
  const { sql, params } = render(invoiceListWhere({ q: "sm_ile" }));
  assert.match(sql, /"company_name" ilike \$1/);
  assert.match(sql, /"client"\."name" ilike \$2/);
  assert.deepEqual(params, ["%sm\\_ile%", "%sm\\_ile%"]);
  assert.doesNotMatch(sql, /legacy_patient|patient_first|patient_last/, "encrypted patient columns are never searched");
});

// ── Lab orders ──────────────────────────────────────────────────────────────
test("lab orders: limit/offset page the list, total counts all matches over the same WHERE", async () => {
  const db = recorder([[]], [[{ n: 1234 }]]);
  const out = await listLabOrders({ limit: 50, offset: 100, q: "100" }, new Date(), db);
  assert.deepEqual(out, { orders: [], total: 1234 });
  const rows = db.queries.find((q) => !db.countQueries.includes(q));
  const [count] = db.countQueries;
  assert.equal(arg(rows, "limit"), 50);
  assert.equal(arg(rows, "offset"), 100);
  assert.equal(arg(count, "where"), arg(rows, "where"));
});

test("lab orders: without limit the board's response is unchanged (LIST_LIMIT cap, truncated, no count)", async () => {
  const db = recorder([[]]);
  const out = await listLabOrders({}, new Date(), db);
  assert.deepEqual(out, { orders: [], truncated: false });
  assert.equal(arg(db.queries[0], "limit"), LIST_LIMIT);
  assert.equal(db.queries[0].some(([m]) => m === "offset"), false);
  assert.equal(db.countQueries.length, 0, "no count(*)");
});

// ── Shipments ───────────────────────────────────────────────────────────────
const shipRow = (id) => ({ id, carrier: "ups", trackingNumber: `1Z${id}`, status: "label_created", shippedAt: null, createdByUserId: null, shipTo: { name: "A" } });

test("shipments: limit/offset page the list, total counts all matches", async () => {
  const db = recorder([[shipRow("a"), shipRow("b")], [], []], [[{ n: 31 }]]);
  const out = await listShipmentsForLab({ limit: 2, offset: 2, q: "1Z" }, db);
  assert.deepEqual(out.shipments.map((s) => s.id), ["a", "b"]);
  assert.equal(out.total, 31);
  assert.equal("truncated" in out, false);
  const rows = db.queries.find((q) => !db.countQueries.includes(q));
  const [count] = db.countQueries;
  assert.equal(arg(rows, "limit"), 2);
  assert.equal(arg(rows, "offset"), 2);
  assert.ok(arg(count, "where"));
  assert.equal(count.some(([m]) => m === "limit" || m === "offset"), false);
});

test("shipments: without limit the response is unchanged (capped, truncated flag)", async () => {
  const db = recorder([[shipRow("a")], [], []]);
  const out = await listShipmentsForLab({}, db);
  assert.equal(out.truncated, false);
  assert.equal("total" in out, false);
  assert.equal(arg(db.queries[0], "limit"), SHIPMENT_LIST_LIMIT);
  assert.equal(db.queries[0].some(([m]) => m === "offset"), false);
});

test("shipments: q matches the tracking number (contains) or an order number prefix", () => {
  const { sql, params } = render(shipmentListWhere({ q: "1Z99" }));
  assert.match(sql, /"tracking_number" ilike \$1/);
  assert.match(sql, /"order_number"::text like \$2/);
  assert.deepEqual(params, ["%1Z99%", "1Z99%"]);
  assert.equal(shipmentListWhere({}), undefined);
});

// ── Admin payments (in-memory list: offset before the slice, existing total) ─
test("admin payments: a limit pages the filtered list ({ payments, total }); without it the 200-row cap and truncated stay", () => {
  const src = readFileSync(new URL("../routes/payment.routes.js", import.meta.url), "utf8");
  assert.match(src, /validateQuery\(adminPaymentsQuerySchema\)/);
  assert.match(src, /if \(page\) return \{ data: \{ payments: sliceRows\(payments, page\), total \} \}/);
  assert.match(src, /payments\.slice\(0, 200\)[\s\S]*truncated: total > sliced\.length/);
});
