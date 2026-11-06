import { test, expect } from "vitest";
import { openExportStream, BOM } from "./stream.js";
import { csvFormat } from "./csv-format.js";

const source = { key: "s", fields: [{ key: "n", label: "N", type: "int" }, { key: "amt", label: "Amount", type: "money" }] };

function pages(total, { cut = Infinity } = {}) {
  const asked = [];
  const readPage = async ({ limit, offset }) => {
    asked.push([offset, limit]);
    const count = Math.max(0, Math.min(limit, total - offset, cut));
    return { rows: Array.from({ length: count }, (_, i) => ({ n: offset + i, amt: (offset + i) * 100 })), total };
  };
  return { asked, readPage };
}

async function drain(stream) {
  let s = "";
  for await (const c of stream) s += c;
  return s;
}

test("reads page by page up to the first page's total and counts the rows", async () => {
  const { asked, readPage } = pages(5);
  const { stream, countPromise } = await openExportStream({ source, format: csvFormat, readPage, pageSize: 2 });
  expect(asked).toEqual([[0, 2]]); // the first page is read before the stream is handed back
  const text = await drain(stream);
  expect(asked).toEqual([[0, 2], [2, 2], [4, 1]]);
  expect(text).toBe(`${BOM}N,Amount\r\n0,0.00\r\n1,1.00\r\n2,2.00\r\n3,3.00\r\n4,4.00\r\n`);
  expect(await countPromise).toBe(5);
});

test("maxRows caps the file and the limit asked for", async () => {
  const { asked, readPage } = pages(10);
  const { stream, countPromise } = await openExportStream({ source, format: { ...csvFormat, bom: false }, readPage, pageSize: 4, maxRows: 6 });
  const lines = (await drain(stream)).split("\r\n").filter(Boolean);
  expect(asked).toEqual([[0, 4], [4, 2]]);
  expect(lines).toHaveLength(7);
  expect(await countPromise).toBe(6);
});

test("a short page ends the file; a page longer than asked is cut", async () => {
  const short = pages(10, { cut: 3 });
  const a = await openExportStream({ source, format: csvFormat, readPage: short.readPage, pageSize: 4 });
  await drain(a.stream);
  expect(short.asked).toEqual([[0, 4]]);

  const long = async () => ({ rows: Array.from({ length: 9 }, (_, n) => ({ n })) }); // no total: the whole result at once
  const b = await openExportStream({ source, format: csvFormat, readPage: long, pageSize: 100, maxRows: 5 });
  await drain(b.stream);
  expect(await b.countPromise).toBe(5);
});

test("a failing first read rejects before any stream exists", async () => {
  await expect(openExportStream({ source, format: csvFormat, readPage: async () => { throw new Error("boom"); }, pageSize: 2 })).rejects.toThrow("boom");
});

test("csvFormat writes cells by column type through csvValue and neutralises formulas", () => {
  const src = { fields: [{ key: "t", label: "T", type: "text" }, { key: "m", label: "M", type: "money" }, { key: "d", label: "D", type: "date" }] };
  expect(csvFormat.header(src)).toBe("T,M,D");
  expect(csvFormat.serializeRow({ t: "=1+1", m: -1250, d: new Date("2026-03-08T23:30:00Z") }, src)).toBe("'=1+1,-12.50,2026-03-08");
  expect(csvFormat.serializeRow({ t: null, m: null, d: null }, src)).toBe(",,");
});
