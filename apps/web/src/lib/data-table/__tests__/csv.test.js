import { test } from "vitest";
import assert from "node:assert/strict";
import { toCsv } from "../csv.js";

test("toCsv quotes commas, quotes and newlines and uses exportValue", () => {
  const columns = [
    { id: "name", header: "Name", cell: (r) => r.name },
    { id: "amount", header: "Amount", cell: (r) => ({ jsx: r.amount }), exportValue: (r) => r.amount.toFixed(2) },
    { id: "count", header: "Count", cell: (r) => r.count },
    { id: "badge", header: "Badge", cell: () => ({ $$typeof: "element" }) },
    { id: "actions", header: "Actions", cell: () => "x", export: false },
    { id: "note", header: { node: true }, cell: (r) => r.note },
  ];
  const rows = [
    { name: "Smith, Jane", amount: 12.5, count: 3, note: 'said "hi"' },
    { name: "Plain", amount: 0, count: 0, note: "two\nlines" },
  ];
  assert.equal(
    toCsv(rows, columns),
    [
      "Name,Amount,Count,Badge,note",
      '"Smith, Jane",12.50,3,,"said ""hi"""',
      'Plain,0.00,0,,"two\nlines"',
    ].join("\r\n"),
  );
});

test("toCsv renders null and undefined as empty cells and an empty list as just the header", () => {
  const columns = [{ id: "a", header: "A", cell: (r) => r.a, exportValue: (r) => r.a }];
  assert.equal(toCsv([{ a: null }, { a: undefined }], columns), "A\r\n\r\n");
  assert.equal(toCsv([], columns), "A");
});
