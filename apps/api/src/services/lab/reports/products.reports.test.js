import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { PRODUCT_REPORTS } from "./products.reports.js";

const report = (key) => PRODUCT_REPORTS.find((r) => r.key === key);
const range = (from, to) => ({ from, to, previous: { from: "2000-01-01", to: "2000-01-31" } });
const page = (over = {}) => ({ page: { limit: 50, offset: 0, sort: null, ...over } });
const PHI = /legacy_patient|patient_|form_data|notes|hold_reason|source_label/;

afterEach(() => { delete process.env.REPORTS_COVERAGE_FROM; });

test("units sold sums lab_order_lines qty, excluding noteOnly lines", async () => {
  const tx = fakeTx({ executes: [[
    { product: "Olmos Night", category: "Night guards", units: "7", orders: "5" },
    { product: "Hawley retainer", category: null, units: "2", orders: "2" },
  ]] });
  const out = await report("products.units").run(tx, { range: range("2026-10-01", "2026-10-31") });
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /sum\(lab_order_lines\.qty\)/);
  assert.match(text, /lab_order_lines\.note_only = false/);
  assert.match(text, /lab_orders\.status <> 'cancelled'/);
  assert.match(text, /lab_orders\.received_at >= /);
  assert.ok(params.includes("2026-10-01") && params.includes("2026-10-31"));
  assert.doesNotMatch(text, PHI);
  assert.deepEqual(out.rows, [
    { product: "Olmos Night", category: "Night guards", units: 7, orders: 5 },
    { product: "Hawley retainer", category: null, units: 2, orders: 2 },
  ]);
  assert.deepEqual(out.summary, { product: "Total", units: 9 });
  assert.ok(!report("products.units").columns.some((c) => c.type === "money"));
});

test("products sold groups invoice lines by variant falling back to code", async () => {
  process.env.REPORTS_COVERAGE_FROM = "2026-11-15";
  const tx = fakeTx({ executes: [[
    { variantId: "v1", code: "2608", product: "Olmos Night — Hard", family: "Olmos Night", units: "4", amount: "40000" },
    { variantId: null, code: "9999", product: null, family: null, units: "1", amount: "500" },
    { variantId: null, code: null, product: null, family: null, units: "3", amount: "9500" },
  ]] });
  const out = await report("products.sold").run(tx, { range: range("2026-11-01", "2026-11-30") });
  const [{ text }] = executedSql(tx);
  assert.match(text, /left join product_variants as by_code on invoice_lines\.variant_id is null and by_code\.code = invoice_lines\.code/);
  assert.match(text, /coalesce\(product_variants\.id, by_code\.id\)/);
  assert.match(text, /invoice_lines\.kind = 'item'/);
  assert.match(text, /status\s*=\s*'issued'/);
  assert.deepEqual(out.rows.map((r) => [r.product, r.code, r.units, r.amount, r.share]), [
    ["Olmos Night — Hard", "2608", 4, 40000, 0.8],
    ["Code 9999 (not in catalog)", "9999", 1, 500, 0.01],
    ["No product", null, 3, 9500, 0.19],
  ]);
  assert.deepEqual(out.summary, { product: "Total", units: 8, amount: 50000, share: 1 });
  assert.match(out.notice, /2026-11-15/);
});

test("price list is catalog variants with base price, active only by default", async () => {
  const tx = fakeTx({ executes: [[{ family: "Olmos Night", category: "Night guards", variant: "Hard", code: "2608", basePriceCents: 12500, active: true }]] });
  const out = await report("products.price-list").run(tx, {});
  const [{ text }] = executedSql(tx);
  assert.match(text, /product_variants\.base_price_cents/);
  assert.match(text, /product_variants\.active = true and product_families\.active = true/);
  assert.deepEqual(out.rows[0], { family: "Olmos Night", category: "Night guards", variant: "Hard", code: "2608", basePrice: 12500, active: "Yes" });
  const all = fakeTx({ executes: [[]] });
  await report("products.price-list").run(all, { includeInactive: true });
  assert.doesNotMatch(executedSql(all)[0].text, /active = true/);
});

test("units sold detail is server-paged, ordered with a line-id tiebreaker, and never selects patient data", async () => {
  const tx = fakeTx({ executes: [
    [{ total: "120" }],
    [{ lineId: "l1", labOrderId: "o1", orderNumber: 50001, receivedDay: "2026-10-02", client: "One Dental", code: "2608", product: "Olmos Night", qty: "2", invoiceId: "i1", invoiceNumber: 7001 }],
  ] });
  const out = await report("products.units-detail").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, page({ limit: 25, offset: 50, sort: { id: "qty", desc: true } }));
  assert.equal(out.total, 120);
  assert.deepEqual(out.rows[0], { lineId: "l1", labOrderId: "o1", orderNumber: 50001, received: "2026-10-02", client: "One Dental", code: "2608", product: "Olmos Night", qty: 2, invoiceId: "i1", invoiceNumber: 7001 });
  const [count, rows] = executedSql(tx);
  for (const q of [count, rows]) {
    assert.match(q.text, /lab_order_lines\.note_only = false/);
    assert.match(q.text, /lab_orders\.status <> 'cancelled'/);
    assert.doesNotMatch(q.text, PHI);
  }
  assert.match(rows.text, /order by lab_order_lines\.qty desc nulls last, lab_order_lines\.id desc limit \$\d+ offset \$\d+/);
  assert.ok(rows.params.includes(25) && rows.params.includes(50));
  const cols = Object.fromEntries(report("products.units-detail").columns.map((c) => [c.id, c]));
  assert.equal(cols.orderNumber.link, "/lab/orders/{labOrderId}");
  assert.equal(cols.invoiceNumber.link, "/admin/invoices/{invoiceId}");
  assert.ok(!Object.values(cols).some((c) => c.type === "money"));
});
