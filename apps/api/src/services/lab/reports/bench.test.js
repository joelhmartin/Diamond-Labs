// The pure parts of the reports bench (scripts/reports-bench.js): the database
// guard, the seed plan and the report indexes. The bench itself runs against
// a real local Postgres and is not part of the unit suite.
import { test } from "vitest";
import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import { labOrders, labOrderEvents, invoices, invoiceLines, invoicePayments, shipments } from "../../../db/schema/index.js";
import { BENCH_DATABASE, assertBenchUrl, benchUrl, maintenanceUrl } from "../../../../scripts/reports-bench.js";
import { sqlText } from "../../../test/sql-text.js";
import { SEED_PLAN, seedPlan } from "../../../../scripts/reports-bench-seed.js";

test("bench refuses a database not named diamond_labs_bench", () => {
  assert.equal(BENCH_DATABASE, "diamond_labs_bench");
  assert.equal(assertBenchUrl("postgresql://bif@localhost:5432/diamond_labs_bench"), "diamond_labs_bench");
  assert.equal(assertBenchUrl("postgres://bif@127.0.0.1/diamond_labs_bench?sslmode=disable"), "diamond_labs_bench");
  for (const url of [
    undefined,
    "",
    "not a url",
    "postgresql://bif@localhost:5432/diamond_labs",
    "postgresql://bif@localhost:5432/diamond_labs_bench_old",
    "postgresql://bif@localhost:5432/DIAMOND_LABS_BENCH",
    "postgresql://bif@localhost:5432/",
    // Right name, but not this machine: the bench never runs against a remote server.
    "postgresql://u:p@34.45.85.116:5432/diamond_labs_bench",
    "postgresql://u:p@/diamond_labs_bench?host=/cloudsql/x:y:z",
    // Right path, but postgres.js would take the database (or startup options) from the query string.
    "postgresql://bif@localhost/diamond_labs_bench?database=diamond_labs",
    "postgresql://bif@localhost/diamond_labs_bench?options=-c%20search_path%3Dother",
    "postgresql://bif@localhost/diamond_labs_bench?sslmode=disable&db=diamond_labs",
    "postgresql://bif@localhost/diamond_labs_bench?host=localhost",
  ]) {
    assert.throws(() => assertBenchUrl(url), /diamond_labs_bench/, `accepted ${url}`);
  }
});

test("the bench connects only through a URL rebuilt from its validated parts", () => {
  assert.equal(benchUrl("postgresql://bif@localhost:5432/diamond_labs_bench"), "postgresql://bif@localhost:5432/diamond_labs_bench");
  const rebuilt = new URL(benchUrl("postgres://bif:s%40cret@127.0.0.1:6543/diamond_labs_bench"));
  assert.equal(rebuilt.search, "");
  assert.equal(rebuilt.protocol, "postgresql:");
  assert.equal(`${rebuilt.username}:${rebuilt.password}@${rebuilt.host}${rebuilt.pathname}`, "bif:s%40cret@127.0.0.1:6543/diamond_labs_bench");
  // sslmode is the one parameter kept.
  assert.equal(new URL(benchUrl("postgresql://bif@localhost/diamond_labs_bench?sslmode=disable")).search, "?sslmode=disable");
  // The maintenance URL (DROP / CREATE) is rebuilt the same way, pointing at postgres.
  const admin = new URL(maintenanceUrl(benchUrl("postgresql://bif@localhost:5432/diamond_labs_bench")));
  assert.equal(admin.pathname, "/postgres");
  assert.equal(admin.search, "");
  assert.equal(admin.host, "localhost:5432");
});

test("seed plan sizes match the stated counts", () => {
  assert.deepEqual(SEED_PLAN, {
    clients: 480, orders: 21000, invoices: 20000, invoiceLines: 30000,
    orderEvents: 60000, payments: 15000, shipments: 9000,
  });
  const plan = seedPlan();
  assert.equal(plan.clients.length, 480);
  assert.equal(plan.clients[0].name, "Client 001");
  assert.equal(plan.clients[479].name, "Client 480");
  assert.equal(plan.orders.length, 21000);
  assert.equal(plan.invoices.length, 20000);
  assert.equal(plan.invoiceLines.length, 30000);
  assert.equal(plan.orderEvents.length, 60000);
  assert.equal(plan.payments.length, 15000);
  assert.equal(plan.shipments.length, 9000);
});

test("seed plan is deterministic, spread over about three years, and carries no patient fields", () => {
  const now = new Date("2026-11-05T18:00:00Z");
  const a = seedPlan({ now });
  const b = seedPlan({ now });
  assert.deepEqual(a.orders.slice(0, 50), b.orders.slice(0, 50));
  assert.deepEqual(a.payments.slice(-50), b.payments.slice(-50));
  const received = a.orders.map((o) => o.receivedAt.getTime());
  const spanDays = (Math.max(...received) - Math.min(...received)) / 86400000;
  assert.ok(spanDays > 1000 && spanDays <= 3 * 366, `span ${spanDays} days`);
  assert.ok(Math.max(...received) <= now.getTime());
  for (const rows of [a.orders, a.invoices, a.invoiceLines, a.rxCases]) {
    for (const key of ["legacyPatient", "formData", "notes", "note", "holdReason", "labNotes", "priceNote"]) {
      assert.ok(rows.every((r) => r[key] === undefined || r[key] === null), `${key} set`);
    }
  }
  // The mix the reports slice by.
  const has = (rows, pred) => rows.some(pred);
  assert.ok(has(a.orders, (o) => o.source === "shop_order") && has(a.orders, (o) => o.source === "legacy"));
  assert.ok(has(a.orders, (o) => o.isRemake) && has(a.orders, (o) => o.status === "on_hold"));
  assert.ok(has(a.orders, (o) => o.departmentId) && has(a.orders, (o) => o.assigneeUserId));
  assert.ok(["draft", "issued", "void"].every((s) => has(a.invoices, (i) => i.status === s)));
  assert.ok(has(a.payments, (p) => p.appliedCents < 0) && has(a.payments, (p) => p.paidOn));
  assert.ok(["ups", "fedex", "manual"].every((c) => has(a.shipments, (s) => s.carrier === c)));
  assert.ok(has(a.rxCases, (r) => r.recordsMethod) && a.rxCaseFiles.some((f) => f.kind === "scan"));
});

// [table, name, columns, partial predicate or null]
const REPORT_INDEXES = [
  [labOrders, "lab_orders_received_idx", ["received_at"], null],
  [labOrders, "lab_orders_shipped_idx", ["shipped_at"], "shipped_at is not null"],
  [labOrders, "lab_orders_client_received_idx", ["client_user_id", "received_at"], null],
  [labOrders, "lab_orders_open_due_idx", ["due_date"], "status not in ('shipped', 'cancelled')"],
  [labOrders, "lab_orders_department_idx", ["department_id"], "department_id is not null"],
  [labOrders, "lab_orders_assignee_idx", ["assignee_user_id"], "assignee_user_id is not null"],
  [labOrderEvents, "lab_order_events_at_idx", ["at"], null],
  [labOrderEvents, "lab_order_events_type_at_idx", ["type", "at"], null],
  [invoices, "invoices_status_issued_idx", ["status", "issued_at"], null],
  [invoices, "invoices_client_issued_idx", ["client_user_id", "issued_at"], null],
  [invoicePayments, "invoice_payments_paid_on_idx", ["paid_on"], null],
  [invoicePayments, "invoice_payments_created_at_idx", ["created_at"], null],
  [invoiceLines, "invoice_lines_variant_idx", ["variant_id"], null],
  [shipments, "shipments_shipped_idx", ["shipped_at"], null],
];

test("schema declares each listed index", () => {
  for (const [table, name, columns, predicate] of REPORT_INDEXES) {
    const idx = getTableConfig(table).indexes.find((i) => i.config.name === name);
    assert.ok(idx, `missing index ${name}`);
    assert.deepEqual(idx.config.columns.map((c) => c.name), columns, name);
    assert.equal(idx.config.where ? sqlText(idx.config.where).trim() : null, predicate, `${name} predicate`);
    assert.equal(Boolean(idx.config.unique), false, `${name} unique`);
  }
});
