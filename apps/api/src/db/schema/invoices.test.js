import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invoices, invoiceLines, invoicePayments } from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migration = (prefix) => {
  const f = readdirSync(migrationsDir).find((n) => n.startsWith(prefix) && n.endsWith(".sql"));
  assert.ok(f, `no ${prefix}* migration`);
  return readFileSync(join(migrationsDir, f), "utf8");
};

test("invoices carry identity, lifecycle and totals in cents", () => {
  has(invoices, [
    "id", "invoiceNumber", "kind", "clientUserId", "labOrderId", "legacySeazonaInvoiceId", "status", "version",
    "issuedAt", "dueDate", "voidedAt", "voidReason", "subtotalCents", "taxCents", "shippingCents", "totalCents",
    "notes", "createdAt", "updatedAt",
  ]);
  assert.equal(invoices.invoiceNumber.notNull, true);
  assert.equal(invoices.clientUserId.notNull, false, "a guest's shop invoice has no client");
  assert.equal(invoices.version.notNull, true);
  for (const c of ["subtotalCents", "taxCents", "shippingCents", "totalCents"]) assert.equal(invoices[c].columnType, "PgInteger", c);
});

test("invoice lines are typed, in cents, and remember where their price came from", () => {
  has(invoiceLines, [
    "id", "invoiceId", "position", "kind", "variantId", "code", "description", "qty", "unitCents", "lineCents",
    "taxable", "priceSource", "priceNote", "labOrderLineId", "createdAt",
  ]);
  assert.equal(invoiceLines.kind.default, "item");
});

test("the ledger points at local invoices, in cents, with the manual-payment fields", () => {
  has(invoicePayments, ["invoiceId", "appliedCents", "paidOn", "reference", "note"]);
  assert.equal(invoicePayments.userId.notNull, false, "a guest's shop payment has no portal user");
  assert.equal(invoicePayments.seazonaInvoiceId.notNull, false, "legacy column, kept for Seazona-era rows");
});

test("0028: invoice numbers are unique; one invoice per lab order and per legacy Seazona invoice", () => {
  const sql = migration("0028_");
  assert.match(sql, /CREATE TABLE "invoices"/);
  assert.match(sql, /CREATE TABLE "invoice_lines"/);
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_invoice_number_idx"/);
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_lab_order_idx"/);
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_legacy_seazona_idx"/);
  assert.match(sql, /ALTER TABLE "invoice_payments" ADD COLUMN "applied_cents" integer;/);
  assert.match(sql, /ALTER TABLE "invoice_payments" ALTER COLUMN "user_id" DROP NOT NULL;/);
  assert.match(sql, /ALTER TABLE "invoice_payments" ALTER COLUMN "applied_amount" DROP NOT NULL;/);
});

test("0029 converts every existing ledger amount to cents, half away from zero", () => {
  const sql = migration("0029_");
  assert.match(sql, /UPDATE "invoice_payments" SET "applied_cents" = round\("applied_amount" \* 100\)::integer WHERE "applied_cents" IS NULL;/);
});
