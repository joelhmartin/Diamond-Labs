import { test } from "vitest";
import assert from "node:assert/strict";
import {
  readPaymentsExport, mergePaymentFiles, derivedExportBytes, derivedProvenance, centsText, PAYMENT_PROBLEM_KINDS,
} from "./payments-export.js";
import { readExport } from "./export-table.js";
import { ImportRefusal } from "./import-errors.js";

// Fake names and numbers only.
const table = (rows, { th = false } = {}) => Buffer.from(`<table>${rows.map((r, i) => {
  const tag = th && i === 0 ? "th" : "td";
  return `<tr>${r.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
}).join("")}</table>`);
const HEAD = ["Date", "Client", "Amount", "Reference #", "Notes", "Entered By"];

test("reads the mapped columns only, with a footer Total cross-check", () => {
  const parsed = readPaymentsExport(table([
    HEAD,
    ["01/02/2026", "ACCT-1", "$100.00", "Invoices 12345, 12346", "", "Pat Example"],
    ["01/03/2026", "ACCT-2", "(25.00)", "", "refund inv 12347", "Sam Sample"],
    ["", "", "", "", "", ""],
    ["Total", "", "$75.00", "", "", ""],
  ]), { file: 2 });
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.exportTotalCents, 7500);
  assert.equal(parsed.headerLine, 1);
  assert.deepEqual(parsed.unmappedStatusHeaders, []);
  assert.deepEqual(parsed.payments, [
    { id: "f2:L2", file: 2, line: 2, date: "01/02/2026", amountCents: 10000, reference: "Invoices 12345, 12346", notes: "", client: "ACCT-1" },
    { id: "f2:L3", file: 2, line: 3, date: "01/03/2026", amountCents: -2500, reference: "", notes: "refund inv 12347", client: "ACCT-2" },
  ]);
  assert.ok(!JSON.stringify(parsed).includes("Pat Example"), "an unmapped column never reaches the output");
});

test("bad amounts, missing dates and a footer that does not add up are problems (row numbers only)", () => {
  const parsed = readPaymentsExport(table([
    HEAD,
    ["01/02/2026", "A1", "abc", "Inv 1", "", ""],
    ["", "A1", "5.00", "Inv 2", "", ""],
    ["01/04/2026", "A1", "5.00", "Inv 3", "", ""],
    ["Totals", "", "9.00", "", "", ""],
  ]));
  assert.deepEqual(parsed.problems, [
    { kind: PAYMENT_PROBLEM_KINDS.badAmount, count: 1, seazonaIds: [], lines: [2] },
    { kind: PAYMENT_PROBLEM_KINDS.noDate, count: 1, seazonaIds: [], lines: [3] },
    { kind: PAYMENT_PROBLEM_KINDS.totalMismatch, count: 1, seazonaIds: [], lines: [5] },
  ]);
  assert.equal(parsed.payments.length, 1);
});

test("a status column: allow-listed values apply, reverse (dropped) or refund (negative); any other value is refused", () => {
  const head = ["Date", "Amount", "Notes", "Status"];
  const parsed = readPaymentsExport(table([
    head,
    ["1/1/26", "10.00", "Inv 1", "Posted"],
    ["1/2/26", "20.00", "Inv 2", "Reversed"],
    ["1/3/26", "5.00", "Inv 3", "Refund"],
    ["1/4/26", "7.00", "Inv 4", ""],
    ["Total", "42.00", "", ""],
  ]));
  assert.deepEqual(parsed.problems, [], "the footer cross-checks the amounts as printed");
  assert.deepEqual(parsed.payments.map((p) => [p.line, p.amountCents]), [[2, 1000], [4, -500], [5, 700]]);
  assert.deepEqual(parsed.reversedLines, [3]);
  assert.throws(
    () => readPaymentsExport(table([head, ["1/1/26", "10.00", "Inv 1", "Pending review"]])),
    (e) => e instanceof ImportRefusal && /Unknown status value\(s\).*"pending review"/.test(e.message),
  );
});

test("an unmapped column that looks like a status is reported (the CLI refuses a live run on it)", () => {
  const parsed = readPaymentsExport(table([["Date", "Amount", "Notes", "Payment Type", "Voided?"], ["1/1/26", "1.00", "x", "Visa", ""]]));
  assert.deepEqual(parsed.unmappedStatusHeaders, ["Payment Type", "Voided?"]);
  const mapped = readPaymentsExport(table([["Date", "Amount", "Notes", "Payment Type"], ["1/1/26", "1.00", "x", "Visa"]]), { columns: { status: ["Payment Type"] } });
  assert.deepEqual(mapped.unmappedStatusHeaders, []);
  assert.equal(mapped.payments[0].amountCents, 100);
});

test("--columns overrides a column; a missing required column fails loudly without printing data cells", () => {
  const bytes = table([["Paid On", "Memo", "Sum"], ["01/02/2026", "Fake Patient", "10.00"]], { th: true });
  assert.throws(() => readPaymentsExport(bytes), (e) => e instanceof ImportRefusal && /"Paid On", "Memo", "Sum"/.test(e.message) && /--columns/.test(e.message));
  const noTh = table([["01/02/2026", "Fake Patient", "10.00"]]);
  assert.throws(() => readPaymentsExport(noTh), (e) => /3 column\(s\)/.test(e.message) && !e.message.includes("Fake Patient"));
  const parsed = readPaymentsExport(bytes, { columns: { date: ["Paid On"], amount: ["Sum"], notes: ["Memo"] } });
  assert.equal(parsed.payments[0].notes, "Fake Patient");
  assert.equal(parsed.payments[0].client, null, "no client column: null");
  assert.throws(() => readPaymentsExport(table([["Date", "Amount"], ["1/1/26", "1.00"]])), /reference or notes column.*"Date", "Amount"/);
  assert.throws(() => readPaymentsExport(bytes, { columns: { payee: ["Memo"] } }), /Unknown --columns name "payee"/);
});

test("monthly files: a payment repeated across files is kept once; repeats inside one file are kept", () => {
  const jan = readPaymentsExport(table([HEAD, ["01/31/2026", "A1", "10.00", "Inv 1", "", ""], ["01/31/2026", "A1", "10.00", "Inv 1", "", ""]]), { file: 1 });
  const overlap = readPaymentsExport(table([HEAD, ["01/31/2026", "A1", "10.00", "Inv 1", "note differs", ""], ["02/01/2026", "A1", "10.00", "Inv 1", "", ""]]), { file: 2 });
  const merged = mergePaymentFiles([jan, overlap]);
  assert.equal(merged.duplicatesDropped, 1);
  assert.deepEqual(merged.payments.map((p) => p.id), ["f1:L2", "f1:L3", "f2:L3"]);
});

test("the derived file round-trips through readExport and carries its provenance", () => {
  const rows = [{ key: "12345", cents: 0 }, { key: "12346", cents: 123456 }, { key: "12347", cents: -500 }, { key: "12348", cents: 5 }];
  const provenance = { maxInvoiceNumber: 12348, invoiceRecords: 4, derivedRows: 4, sourceFiles: 2, unclear: "credit-definite", derivedAt: "2026-11-05T12:00:00.000Z" };
  const bytes = derivedExportBytes(rows, provenance);
  const parsed = readExport(bytes, { kind: "invoice" });
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.rows.map(({ key, cents }) => ({ key, cents })), rows.map((r) => ({ key: Number(r.key), cents: r.cents })));
  assert.equal(parsed.exportTotalCents, 122961);
  assert.deepEqual(derivedProvenance(bytes), provenance);
  assert.equal(derivedProvenance(Buffer.from("<table></table>")), null);
  assert.deepEqual(derivedExportBytes(rows, provenance), bytes, "deterministic for equal input");
  assert.equal(centsText(-5), "-0.05");
  assert.equal(centsText(123456), "1234.56");
});
