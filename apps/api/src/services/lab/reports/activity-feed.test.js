import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { activityFeed, activityFeedReport, FEED_LIMIT } from "./activity-feed.js";

const since = new Date("2026-10-29T05:00:00.000Z");
const at = (iso) => new Date(iso);

const EVENTS = [
  { id: "e1", kind: "status", fromStatus: "received", toStatus: "in_production", at: at("2026-11-05T15:00:00Z"), labOrderId: "lo1", orderNumber: 1041, client: "Acme Dental" },
  { id: "e2", kind: "hold", fromStatus: "in_production", toStatus: "on_hold", at: at("2026-11-05T13:00:00Z"), labOrderId: "lo2", orderNumber: 1042, client: null },
];
const SHIPMENTS = [
  { id: "s1", carrier: "ups", at: at("2026-11-05T14:00:00Z"), labOrderId: "lo3", orderNumber: 1043, client: "Bright Smiles" },
];
const PAYMENTS = [
  { id: "p1", cents: "12550", at: at("2026-11-05T16:00:00Z"), invoiceId: "inv1", labOrderId: "lo1", orderNumber: 1041, client: "Acme Dental" },
];

test("activity feed never selects note columns, and a lab actor's feed reads no payments", async () => {
  const tx = fakeTx({ executes: [EVENTS, SHIPMENTS] });
  const rows = await activityFeed(tx, { since, limit: FEED_LIMIT, includeMoney: false });
  const queries = executedSql(tx);
  assert.equal(queries.length, 2, "events and shipments only");
  for (const { text } of queries) {
    assert.doesNotMatch(text, /note/i);
    assert.doesNotMatch(text, /hold_reason|lab_notes|legacy_patient|patient_|form_data|reference/);
    assert.doesNotMatch(text, /invoice_payments/);
  }
  assert.equal(rows.filter((r) => r.kind === "payment").length, 0);

  // Through the report, the role decides: lab gets no payments, admin does.
  const labTx = fakeTx({ executes: [[], []] });
  await activityFeedReport.run(labTx, {}, { id: "u1", role: "lab" }, { now: new Date("2026-11-05T17:00:00Z") });
  assert.equal(executedSql(labTx).length, 2);
  const adminTx = fakeTx({ executes: [[], [], []] });
  await activityFeedReport.run(adminTx, {}, { id: "u2", role: "admin" }, { now: new Date("2026-11-05T17:00:00Z") });
  const adminSql = executedSql(adminTx);
  assert.equal(adminSql.length, 3);
  assert.match(adminSql[2].text, /from invoice_payments/);
  assert.match(adminSql[2].text, /invoice_payments\.applied_cents > 0/);
  for (const { text } of adminSql) assert.doesNotMatch(text, /note/i);
  // The window is the last 7 days.
  assert.ok(adminSql[0].params.includes("2026-10-29T17:00:00.000Z"));
});

test("activity feed merges events, shipments and payments newest first, limit 50", async () => {
  const tx = fakeTx({ executes: [EVENTS, SHIPMENTS, PAYMENTS] });
  const rows = await activityFeed(tx, { since, limit: FEED_LIMIT, includeMoney: true });
  assert.deepEqual(rows.map((r) => r.kind), ["payment", "status", "shipment", "hold"]);
  assert.deepEqual(rows[0], {
    at: "2026-11-05T16:00:00.000Z", kind: "payment", text: "Payment $125.50 · Order #1041 · Acme Dental", href: "/admin/invoices/inv1",
  });
  assert.deepEqual(rows[1], {
    at: "2026-11-05T15:00:00.000Z", kind: "status", text: "Order #1041 · Acme Dental: Received → In production", href: "/lab/orders/lo1",
  });
  assert.equal(rows[2].text, "Order #1043 · Bright Smiles: UPS shipment");
  assert.equal(rows[3].text, "Order #1042: put on hold");

  const queries = executedSql(tx);
  assert.match(queries[0].text, /lab_order_events\.type in \('status', 'hold'\)/);
  assert.match(queries[1].text, /shipments\.status <> 'voided'/);
  for (const { text } of queries) {
    assert.match(text, /order by .* desc limit \$\d+$/);
  }
  for (const { params } of queries) assert.ok(params.includes(FEED_LIMIT));

  // Many rows: the merge keeps only the newest 50.
  const many = (n, base) => Array.from({ length: n }, (_, i) => ({ ...EVENTS[0], id: `${base}${i}`, at: new Date(Date.parse("2026-11-05T00:00:00Z") + (i * 2 + (base === "b" ? 1 : 0)) * 60000) }));
  const big = await activityFeed(fakeTx({ executes: [many(50, "a"), many(50, "b").map((r) => ({ ...r, carrier: "fedex" })), []] }), { since, limit: FEED_LIMIT, includeMoney: true });
  assert.equal(big.length, 50);
  for (let i = 1; i < big.length; i++) assert.ok(big[i - 1].at >= big[i].at, "newest first");
});

test("the feed report is staff, unlisted, and its columns are a time and a line", () => {
  assert.equal(activityFeedReport.key, "ops.activity-feed");
  assert.equal(activityFeedReport.roles, undefined);
  assert.equal(activityFeedReport.unlisted, true);
  assert.deepEqual(activityFeedReport.columns.map((c) => c.type), ["datetime", "text"]);
});
