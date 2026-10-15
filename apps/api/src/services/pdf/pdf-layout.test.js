import { test } from "vitest";
import assert from "node:assert/strict";
import { renderPdf, table, titleBlock, keyValueGrid, totalsBlock, footer } from "./pdf-layout.js";
import { printable, deepPrintable } from "./pdf-text.js";

const pages = (buf) => Number(/\/Count (\d+)/.exec(buf.toString("latin1"))?.[1]);

test("renderPdf resolves to PDF bytes, and rejects when drawing throws", async () => {
  const buf = await renderPdf("t", (doc) => {
    const y = titleBlock(doc, { title: "Invoice #1", caption: "LAB" });
    keyValueGrid(doc, [["A", "1"], ["B", "2"], ["C", "3"]], { top: y });
    totalsBlock(doc, [{ label: "Total", value: "$1.00", bold: true }]);
    footer(doc, "footer");
  });
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
  await assert.rejects(renderPdf("t", () => { throw new Error("bad model"); }), /bad model/);
});

test("a long table flows onto further pages instead of being cut", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => [String(i), `Line ${i} with a description long enough to wrap onto a second line in its column`, "$1.00"]);
  const buf = await renderPdf("t", (doc) => table(doc, {
    columns: [{ label: "#", width: 0.1 }, { label: "Description", width: 0.7 }, { label: "Amount", width: 0.2, align: "right" }],
    rows,
  }));
  assert.ok(pages(buf) >= 2, `expected 2+ pages, got ${pages(buf)}`);
});

test("text the standard fonts can't draw becomes ?, recursively", () => {
  assert.equal(printable("Café “Bite” — 2× • ok"), "Café “Bite” — 2× • ok");
  assert.deepEqual(deepPrintable({ a: ["Tooth 😀"], n: 5, z: null }), { a: ["Tooth ?"], n: 5, z: null });
});
