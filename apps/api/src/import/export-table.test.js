import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exportText, htmlTableRows, exportCents, parseColumnsFlag, readExport, EXPORT_PROBLEM_KINDS } from "./export-table.js";
import { ImportRefusal } from "./import-errors.js";

const fixture = (name) => readFileSync(new URL(`../../test-fixtures/seazona/${name}`, import.meta.url));

test("money cells: dollars, thousands, negatives in both spellings; blank and junk are null", () => {
  assert.equal(exportCents("$1,234.56"), 123456);
  assert.equal(exportCents(" 12 "), 1200);
  assert.equal(exportCents("-20.00"), -2000);
  assert.equal(exportCents("(20.00)"), -2000);
  assert.equal(exportCents("$(5.10)"), -510);
  assert.equal(exportCents("-0.00"), 0);
  assert.equal(exportCents(""), null);
  assert.equal(exportCents("n/a"), null);
  assert.equal(exportCents("1.234"), null, "more than two decimals is not money");
  assert.equal(exportCents("(-5.00)"), null);
  for (const bad of ["12,34", "1,23.00", "1,2,3"]) assert.equal(exportCents(bad), null, bad);
  assert.equal(exportCents("999999999999999999"), null, "not a safe integer of cents");
  for (const dash of ["-", "$ -", "$-"]) assert.equal(exportCents(dash), 0, dash);
});

test("UTF-16 (with BOM) and UTF-8 (with BOM) both decode", () => {
  const html = "<table><tr><td>é</td></tr></table>";
  assert.equal(exportText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, "utf16le")])), html);
  assert.equal(exportText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(html, "utf8")])), html);
  const be = Buffer.from(html, "utf16le").swap16();
  assert.equal(exportText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), html);
});

test("rows survive missing closing tags, attributes, entities and nested markup; cell-less rows are skipped", () => {
  const rows = htmlTableRows('<table><tr class="h"><th>A<th>B</tr><tr></tr><tr><td><b>1</b>&nbsp;<td>Smith &amp; Co<tr><td>&#36;5</td></table>');
  assert.deepEqual(rows, [["A", "B"], ["1", "Smith & Co"], ["$5"]]);
});

test("per-invoice export: header found below a title row, open balances in cents, problems grouped by kind", () => {
  const { rows, problems, headerLine, exportTotalCents } = readExport(fixture("invoices-export.xls"), { kind: "invoice" });
  assert.equal(headerLine, 2);
  assert.deepEqual(rows.map((r) => [r.key, r.cents]), [[11114, 125000], [11115, 12050], [11120, -2000]]);
  assert.deepEqual(problems, [
    { kind: EXPORT_PROBLEM_KINDS.badBalance, count: 1, seazonaIds: ["11121"], lines: [6] },
  ], "the closing Total row is the footer, not a no-key problem");
  assert.equal(exportTotalCents, 135050);
  assert.ok(!/Example|Sample/.test(JSON.stringify(problems)), "problems never echo cell text");
});

test("only the mapped columns reach the output; client names and totals never do", () => {
  const { rows } = readExport(fixture("invoices-export.xls"), { kind: "invoice" });
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ["cents", "key", "line"]);
  assert.ok(!/Example|Sample/.test(JSON.stringify(rows)));
});

test("per-client export: Amount Due is the balance, not Previous Balance", () => {
  const { rows, problems, exportTotalCents } = readExport(fixture("statements-export.xls"), { kind: "client" });
  assert.deepEqual(rows.map((r) => [r.key, r.cents]), [["1324", 137050], ["2001", -2000], ["3005", 0]]);
  assert.deepEqual(problems, []);
  assert.equal(exportTotalCents, 135050);
});

test("a duplicate key is a problem, not a second row", () => {
  const html = "<table><tr><th>Invoice #</th><th>Open Balance</th></tr><tr><td>1</td><td>5</td></tr><tr><td>1</td><td>6</td></tr></table>";
  const { rows, problems } = readExport(Buffer.from(html), { kind: "invoice" });
  assert.equal(rows.length, 1);
  assert.deepEqual(problems, [{ kind: EXPORT_PROBLEM_KINDS.duplicate, count: 1, seazonaIds: ["1"], lines: [3] }]);
});

test("renamed columns: a missing header is refused; --columns maps it", () => {
  const html = "<table><tr><th>Inv No</th><th>Still Owed</th></tr><tr><td>7</td><td>$1.00</td></tr></table>";
  assert.throws(() => readExport(Buffer.from(html), { kind: "invoice" }), ImportRefusal);
  const { rows } = readExport(Buffer.from(html), { kind: "invoice", columns: parseColumnsFlag("invoice=Inv No,balance=Still Owed") });
  assert.deepEqual(rows, [{ key: 7, cents: 100, line: 2 }]);
  assert.throws(() => parseColumnsFlag("nonsense"), /name="Header"/);
});

test("a row with content but a blank key and balance is a noKey problem, not a spacer", () => {
  const html = "<table><tr><th>Invoice #</th><th>Account</th><th>Client</th><th>Total</th><th>Open Balance</th></tr>" +
    "<tr><td></td><td>1324</td><td>Example</td><td>$5</td><td></td></tr><tr><td></td><td></td><td></td><td></td><td></td></tr></table>";
  const { problems } = readExport(Buffer.from(html), { kind: "invoice" });
  assert.deepEqual(problems, [{ kind: EXPORT_PROBLEM_KINDS.noKey, count: 1, seazonaIds: [], lines: [2] }]);
});

test("ambiguous or repeated headers are refused with header names only", () => {
  const two = "<table><tr><th>Invoice #</th><th>Open Balance</th><th>Amount Due</th></tr><tr><td>1</td><td>5</td><td>6</td></tr></table>";
  assert.throws(() => readExport(Buffer.from(two), { kind: "invoice" }), (e) => e instanceof ImportRefusal && /Open Balance.*Amount Due/.test(e.message) && /--columns/.test(e.message));
  const repeat = "<table><tr><th>Invoice #</th><th>Invoice #</th><th>Open Balance</th></tr></table>";
  assert.throws(() => readExport(Buffer.from(repeat), { kind: "invoice" }), ImportRefusal);
});

test("account keys are alphanumeric/dash up to 32 characters", () => {
  const html = "<table><tr><th>Account #</th><th>Amount Due</th></tr><tr><td>AB-12</td><td>1</td></tr><tr><td>12 / x</td><td>1</td></tr><tr><td>" + "9".repeat(33) + "</td><td>1</td></tr></table>";
  const { rows, problems } = readExport(Buffer.from(html), { kind: "client" });
  assert.deepEqual(rows.map((r) => r.key), ["AB-12"]);
  assert.equal(problems[0].count, 2);
});

// F4: the footer row every portal export ends with.
const table = (body) => Buffer.from(`<table><tr><th>Invoice #</th><th>Client</th><th>Open Balance</th></tr>${body}</table>`);
test("a footer total that does not match the rows to the cent is export-total-mismatch", () => {
  const { problems, exportTotalCents } = readExport(table("<tr><td>1</td><td>A</td><td>5.00</td></tr><tr><td>Grand Total</td><td></td><td>5.01</td></tr>"), { kind: "invoice" });
  assert.equal(exportTotalCents, 501);
  assert.deepEqual(problems, [{ kind: EXPORT_PROBLEM_KINDS.totalMismatch, count: 1, seazonaIds: [], lines: [3] }]);
  const junk = readExport(table("<tr><td>1</td><td>A</td><td>5.00</td></tr><tr><td>Totals</td><td></td><td>n/a</td></tr>"), { kind: "invoice" });
  assert.equal(junk.problems[0].kind, EXPORT_PROBLEM_KINDS.totalMismatch);
});

test("a Total row that is NOT the last row, or a keyless non-total last row, stays a no-key problem", () => {
  const mid = readExport(table("<tr><td>Total</td><td></td><td>5.00</td></tr><tr><td>1</td><td>A</td><td>5.00</td></tr>"), { kind: "invoice" });
  assert.deepEqual(mid.problems.map((p) => [p.kind, p.lines]), [[EXPORT_PROBLEM_KINDS.noKey, [2]]]);
  assert.equal(mid.exportTotalCents, null);
  const note = readExport(table("<tr><td>1</td><td>A</td><td>5.00</td></tr><tr><td>see note</td><td></td><td>5.00</td></tr>"), { kind: "invoice" });
  assert.deepEqual(note.problems.map((p) => p.kind), [EXPORT_PROBLEM_KINDS.noKey]);
  const trailingSpacer = readExport(table("<tr><td>1</td><td>A</td><td>5.00</td></tr><tr><td>Total</td><td></td><td>$5.00</td></tr><tr><td></td><td></td><td></td></tr>"), { kind: "invoice" });
  assert.deepEqual(trailingSpacer.problems, [], "a trailing spacer row doesn't hide the footer");
  assert.equal(trailingSpacer.exportTotalCents, 500);
});
