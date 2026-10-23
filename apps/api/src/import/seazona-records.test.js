import { test } from "vitest";
import assert from "node:assert/strict";
import { invoiceStatusFor, orderStatusFor, isOpenOrderStatus, recordDate, recordNumber, firstString, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";

test("a Seazona invoice is void only for a void or cancel state; every workflow state is issued", () => {
  for (const s of ["Void", " voided ", "Cancelled", "CANCELED", "Deleted"]) assert.equal(invoiceStatusFor(s), "void", s);
  for (const s of ["Shipped", "Hold", "In Production", "", null]) assert.equal(invoiceStatusFor(s), "issued", String(s));
});

test("order workflow states map to board statuses; an unknown state is null, never guessed", () => {
  assert.deepEqual(orderStatusFor("In Production"), { status: "in_production", heldFrom: null });
  assert.deepEqual(orderStatusFor("Hold"), { status: "on_hold", heldFrom: "in_production" });
  assert.deepEqual(orderStatusFor("shipped"), { status: "shipped", heldFrom: null });
  assert.deepEqual(orderStatusFor("Ready_To_Ship"), { status: "ready_to_ship", heldFrom: null });
  assert.equal(orderStatusFor("Invoiced"), null);
  assert.equal(orderStatusFor(undefined), null);
  assert.equal(isOpenOrderStatus("Hold"), true);
  assert.equal(isOpenOrderStatus("Shipped"), false);
  assert.equal(isOpenOrderStatus("Mystery"), false, "an unknown state is not fetched as open");
});

test("dates, numbers and strings are read defensively", () => {
  assert.equal(recordDate("invoice", { due: "2026-03-01T00:00:00", date: "2026-02-01T09:00:00" }), "2026-02-01");
  assert.equal(recordDate("invoice", { due: "2026-03-01" }), "2026-03-01");
  assert.equal(recordDate("order", { ordered: "nope" }), null);
  assert.equal(recordNumber({ invoiceNumber: "11114" }, INVOICE_NUMBER_FIELDS), 11114);
  assert.equal(recordNumber({ invoiceNumber: 11114 }, INVOICE_NUMBER_FIELDS), 11114);
  assert.equal(recordNumber({ invoiceNumber: "INV-7" }, INVOICE_NUMBER_FIELDS), null);
  assert.equal(recordNumber({ invoiceNumber: "0" }, INVOICE_NUMBER_FIELDS), null);
  assert.equal(firstString({ a: "  ", b: " x " }, ["a", "b"]), "x");
});
