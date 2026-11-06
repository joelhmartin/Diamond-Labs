/**
 * Golden bytes of the CSV export, captured before the CSV path was shared
 * with the reports module. A change here changes downloaded files.
 */
import { test, expect } from "vitest";
import { createExportRegistry } from "./registry.js";
import { csvFormat } from "./index.js";
import { runExport } from "./export.service.js";

const FIELDS = [
  { key: "number", label: "Number #", type: "int" },
  { key: "name", label: "Name, full", type: "text" },
  { key: "on", label: "On", type: "date" },
  { key: "total", label: 'Total "net"', type: "cents" },
];

const NAMES = ["Ann", "=SUM(A1)", 'b"c,d', "e\nf", "-12.50", "+1 call", "@cmd", "Zoë Ünal", "", null];

function rowAt(i) {
  return {
    number: i % 6 === 5 ? null : 1000 + i,
    name: NAMES[i % NAMES.length],
    on: i % 4 === 3 ? null : i % 2 ? "2026-03-08" : new Date(Date.UTC(2026, 2, 8 + i, 23, 30)),
    total: i % 5 === 4 ? null : i * 137 - 900,
  };
}

async function drain(stream) {
  let out = "";
  for await (const c of stream) out += c;
  return out;
}

test("CSV export: exact bytes over several pages, with a BOM", async () => {
  const registry = createExportRegistry();
  registry.defineFormat(csvFormat);
  const asked = [];
  registry.defineSource({
    key: "gold", label: "Gold", fields: FIELDS,
    async fetchPage(_db, _params, { limit, offset }) {
      asked.push([offset, limit]);
      const rows = [];
      for (let i = offset; i < Math.min(offset + limit, 11); i++) rows.push(rowAt(i));
      return { rows, total: 11 };
    },
  });
  const run = await runExport({ registry, db: {}, sourceKey: "gold", formatKey: "csv", params: { from: "2026-01-01", to: "2026-01-31" }, pageSize: 4 });
  expect(run.filename).toBe("gold-2026-01-01-2026-01-31.csv");
  expect(run.contentType).toBe("text/csv; charset=utf-8");
  expect(await drain(run.stream)).toBe(GOLDEN);
  expect(await run.countPromise).toBe(11);
  expect(asked.map(([offset]) => offset)).toEqual([0, 4, 8]);
});

const GOLDEN =
  "\ufeff" +
  "Number #,\"Name, full\",On,\"Total \"\"net\"\"\"\r\n" +
  "1000,Ann,2026-03-08,-9.00\r\n" +
  "1001,'=SUM(A1),2026-03-08,-7.63\r\n" +
  "1002,\"b\"\"c,d\",2026-03-10,-6.26\r\n" +
  "1003,\"e\nf\",,-4.89\r\n" +
  "1004,-12.50,2026-03-12,\r\n" +
  ",'+1 call,2026-03-08,-2.15\r\n" +
  "1006,'@cmd,2026-03-14,-0.78\r\n" +
  "1007,Zo\u00eb \u00dcnal,,0.59\r\n" +
  "1008,,2026-03-16,1.96\r\n" +
  "1009,,2026-03-08,\r\n" +
  "1010,Ann,2026-03-18,4.70\r\n";
