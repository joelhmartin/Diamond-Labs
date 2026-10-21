import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGACY_LINE_DESCRIPTION, isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { centsOf, mapLegacyInvoice, planInvoices, SUMMARY_LINE_DESCRIPTION } from "./map-invoices.js";
import { labNoon, dayOf } from "./dates.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const summaries = load("invoices.json");
const details = new Map(load("invoice-details.json").map((d) => [d.id, d]));
const byId = (id) => summaries.find((s) => s.id === id);
const owners = new Map([["c-1324", "u-1324"], ["c-2001", "u-2001"]]);

test("dollars → cents; junk is null", () => {
  assert.equal(centsOf(1250), 125000);
  assert.equal(centsOf("12.5"), 1250);
  assert.equal(centsOf("$1,234.56"), 123456);
  assert.equal(centsOf(0.1 + 0.2), 30);
  assert.equal(centsOf(null), null);
  assert.equal(centsOf("abc"), null);
});

test("lab noon keeps the lab-local day in both CST and CDT", () => {
  for (const d of ["2026-01-15", "2026-07-15"]) assert.equal(isoDateIn(LAB_TIMEZONE, labNoon(d)), d);
});

test("dayOf reads the leading date only", () => {
  assert.equal(dayOf("2026-02-15T00:00:00"), "2026-02-15");
  assert.equal(dayOf("15/02/2026"), null);
  assert.equal(dayOf(null), null);
});

test("a summary-only invoice: one line at total − tax, the due date stands in for the issue date", () => {
  const { invoice, lines, approximatedDate, detailed } = mapLegacyInvoice({ summary: byId("inv-a"), ownerUserId: "u-1324" });
  assert.equal(invoice.kind, "legacy");
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.invoiceNumber, 11114);
  assert.equal(invoice.legacySeazonaInvoiceId, "inv-a");
  assert.equal(invoice.clientUserId, "u-1324");
  assert.equal(invoice.legacyPatient, "Test Patient A");
  assert.equal(invoice.totalCents, 125000);
  assert.equal(invoice.dueDate, "2026-02-15");
  assert.equal(isoDateIn(LAB_TIMEZONE, invoice.issuedAt), "2026-02-15");
  assert.equal(approximatedDate, true);
  assert.equal(detailed, false);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, SUMMARY_LINE_DESCRIPTION);
  assert.equal(lines[0].lineCents, 125000);
  assert.equal(lines[0].priceSource, "legacy");
  assert.equal(lines[0].invoiceId, invoice.id);
});

test("a detailed invoice: real lines sealed later, an adjustment so lines + tax = Seazona's total", () => {
  const { invoice, lines, approximatedDate } = mapLegacyInvoice({ summary: byId("inv-b"), detail: details.get("inv-b"), ownerUserId: "u-1324" });
  assert.equal(invoice.taxCents, 1000);
  assert.equal(invoice.subtotalCents, 29000);
  assert.equal(invoice.totalCents, 30000);
  assert.equal(isoDateIn(LAB_TIMEZONE, invoice.issuedAt), "2026-01-30");
  assert.equal(approximatedDate, false);
  assert.deepEqual(lines.map((l) => [l.kind, l.code, l.lineCents]), [["item", "2608", 25000], ["item", "SHIP", 1500], ["adjustment", null, 2500]]);
  assert.equal(lines[0].description, LEGACY_LINE_DESCRIPTION);
  assert.equal(lines[0].legacyDescription, "DDSO Nylon — Test Patient B");
  assert.equal(lines.reduce((s, l) => s + l.lineCents, 0) + invoice.taxCents, invoice.totalCents);
});

test("a void Seazona invoice is void, voided when issued", () => {
  const { invoice } = mapLegacyInvoice({ summary: byId("inv-c"), ownerUserId: "u-2001" });
  assert.equal(invoice.status, "void");
  assert.equal(invoice.voidedAt.getTime(), invoice.issuedAt.getTime());
});

test("problems instead of guesses: a non-numeric number, an unloaded client, a negative total", () => {
  assert.deepEqual(mapLegacyInvoice({ summary: byId("inv-x"), ownerUserId: "u-2001" }), { problem: "invoice_number_not_numeric" });
  assert.deepEqual(mapLegacyInvoice({ summary: byId("inv-y"), ownerUserId: undefined }), { problem: "client_not_loaded" });
  assert.deepEqual(mapLegacyInvoice({ summary: { ...byId("inv-d"), total: -5 }, ownerUserId: "u-2001" }), { problem: "negative_total" });
});

test("plan: skips loaded invoices, refuses a taken number, counts what it approximated", () => {
  const records = summaries.map((p) => ({ seazonaId: p.id, payload: p }));
  const plan = planInvoices({ summaries: records, details, owners, existingSeazonaIds: new Set(["inv-d"]), existingNumbers: new Set([11120]) });
  assert.deepEqual(plan.rows.map((r) => r.invoice.legacySeazonaInvoiceId), ["inv-a", "inv-b"]);
  assert.equal(plan.counts.alreadyLoaded, 1);
  assert.equal(plan.counts.detailed, 1);
  assert.equal(plan.counts.approximatedDates, 1);
  assert.equal(plan.counts.totalCents, 155000);
  const kinds = Object.fromEntries(plan.problems.map((p) => [p.kind, p.seazonaIds]));
  assert.deepEqual(kinds.invoice_number_taken, ["inv-c"]);
  assert.deepEqual(kinds.invoice_number_not_numeric, ["inv-x"]);
  assert.deepEqual(kinds.client_not_loaded, ["inv-y"]);
  assert.ok(!JSON.stringify(plan.problems).includes("Patient"));
});

test("plan: a client whose linked user is not an eligible owner loads UNOWNED and is reported (F2: same as orders)", () => {
  const records = summaries.map((p) => ({ seazonaId: p.id, payload: p }));
  const plan = planInvoices({
    summaries: records, details, owners: new Map([["c-2001", "u-2001"]]), unownedClients: new Set(["c-1324"]),
    existingSeazonaIds: new Set(), existingNumbers: new Set(),
  });
  assert.deepEqual(plan.rows.map((r) => r.invoice.legacySeazonaInvoiceId), ["inv-a", "inv-b", "inv-c", "inv-d"]);
  assert.equal(plan.rows.find((r) => r.invoice.legacySeazonaInvoiceId === "inv-a").invoice.clientUserId, null);
  const kinds = Object.fromEntries(plan.problems.map((p) => [p.kind, p.seazonaIds]));
  assert.deepEqual(kinds.client_owner_not_approved_doctor, ["c-1324"], "client ids");
  assert.equal(plan.counts.unowned, 2);
  assert.equal(plan.counts.skippedNoOwner, undefined, "nothing is skipped for an owner problem any more");
  assert.ok(plan.problems.every((p) => p.count === p.seazonaIds.length));
});

test("plan: a client shared by several eligible doctors loads unowned and is reported", () => {
  const records = summaries.map((p) => ({ seazonaId: p.id, payload: p }));
  const plan = planInvoices({
    summaries: records, details, owners: new Map([["c-2001", "u-2001"]]), ambiguousClients: new Set(["c-1324"]),
    existingSeazonaIds: new Set(), existingNumbers: new Set(),
  });
  const a = plan.rows.find((r) => r.invoice.legacySeazonaInvoiceId === "inv-a");
  assert.equal(a.invoice.clientUserId, null);
  assert.equal(plan.counts.unowned, 2);
  assert.deepEqual(plan.problems.find((p) => p.kind === "client_has_multiple_owners").seazonaIds, ["c-1324"], "one client, two invoices");
});

test("plan: a duplicate of an already-loaded legacy number is flagged with its id", () => {
  const records = [{ seazonaId: "inv-dup", payload: { ...byId("inv-d"), id: "inv-dup" } }];
  const plan = planInvoices({ summaries: records, details, owners, existingSeazonaIds: new Set(["inv-d"]), existingNumbers: new Set([11121]) });
  assert.deepEqual(plan.problems.find((p) => p.kind === "invoice_number_taken").seazonaIds, ["inv-dup"]);
  assert.equal(plan.rows.length, 0);
});

test("detailed means an item actually mapped; dropped items are counted", () => {
  const bad = { id: "inv-a", productServiceItems: [{ type: "product", name: "no amount" }] };
  const m = mapLegacyInvoice({ summary: byId("inv-a"), detail: bad, ownerUserId: "u" });
  assert.equal(m.detailed, false);
  assert.equal(m.droppedItems, 1);
  assert.equal(m.lines[0].description, SUMMARY_LINE_DESCRIPTION);
  const plan = planInvoices({ summaries: [{ seazonaId: "inv-a", payload: byId("inv-a") }], details: new Map([["inv-a", bad]]), owners, existingSeazonaIds: new Set(), existingNumbers: new Set() });
  assert.equal(plan.counts.droppedDetailItems, 1);
  assert.equal(plan.counts.summaryOnly, 1);
});

test("the summary's invoice number is the authority: a non-numeric one is a problem even if the detail has a number", () => {
  const r = mapLegacyInvoice({ summary: byId("inv-x"), detail: { id: "inv-x", invoiceNumber: "99999" }, ownerUserId: "u-2001" });
  assert.deepEqual(r, { problem: "invoice_number_not_numeric" });
});

test("numbers are decimal-exact via toCents (half-up); exponent forms and >2-decimal text are refused", () => {
  assert.equal(centsOf(0.1 + 0.2), 30);
  assert.equal(centsOf(1.005), 101);
  assert.equal(centsOf(1e21), null);
  assert.equal(centsOf("1.234"), null);
});

test("an ambiguous comma is not money", () => {
  assert.equal(centsOf("12,34"), null);
  assert.equal(centsOf("1,234"), 123400);
  assert.equal(mapLegacyInvoice({ summary: { ...byId("inv-d"), total: "12,34" }, ownerUserId: "u" }).problem, "total_not_money");
});
