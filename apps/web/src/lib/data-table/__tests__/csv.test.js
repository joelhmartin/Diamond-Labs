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

test("toCsv neutralizes cells that a spreadsheet would run as a formula", () => {
  const columns = [{ id: "v", header: "V", cell: (r) => r.v }];
  const out = (v) => toCsv([{ v }], columns).split("\r\n")[1];
  assert.equal(out('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(out("+1+2"), "'+1+2");
  assert.equal(out("-2+3"), "'-2+3");
  assert.equal(out("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(out("\t=1"), "'\t=1");
  assert.equal(out("\r=1"), `"'\r=1"`);
  assert.equal(out("a=b"), "a=b", "only a leading trigger counts");
});

test("toCsv leaves negative numbers alone, numeric or exported as plain number text", () => {
  const columns = [
    { id: "n", header: "N", cell: (r) => r.n },
    { id: "s", header: "S", cell: () => null, exportValue: (r) => r.n.toFixed(2) },
  ];
  assert.equal(toCsv([{ n: -12.5 }], columns), "N,S\r\n-12.5,-12.50");
  assert.equal(toCsv([{ n: 3 }], columns), "N,S\r\n3,3.00");
});

test("downloadCsv saves the CSV with a UTF-8 BOM so Excel reads accents", async () => {
  const { downloadCsv } = await import("../csv.js");
  const saved = {};
  const g = globalThis;
  const orig = { URL: g.URL, document: g.document };
  g.URL = { createObjectURL: (blob) => { saved.blob = blob; return "blob:x"; }, revokeObjectURL: () => {} };
  const a = { click: () => { saved.clicked = true; }, remove: () => {} };
  g.document = { createElement: () => a, body: { appendChild: () => {} } };
  try {
    downloadCsv("out.csv", "Name\r\nJosé");
  } finally {
    g.URL = orig.URL;
    g.document = orig.document;
  }
  assert.equal(a.download, "out.csv");
  assert.ok(saved.clicked);
  const bytes = new Uint8Array(await saved.blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes.slice(3)), "Name\r\nJosé");
});
