/**
 * The one paged export writer. Every server-side file export goes through it
 * (the exports module's downloads and the reports module's CSV), so paging,
 * the row cap, the byte order mark and line endings are decided in one place.
 * Pure: it yields strings and knows nothing about HTTP or a database.
 */
import { CSV_EOL } from "./csv.js";

export const BOM = "﻿";

/**
 * Read the first page, then return a lazy stream of the whole file.
 *
 *   openExportStream({ source, format, readPage, pageSize, maxRows? })
 *     readPage({ limit, offset }) -> Promise<{ rows, total? }>
 *     -> Promise<{ stream, countPromise }>
 *
 * The first page is read before this resolves, so a bad request or a failing
 * first read is an ordinary error the caller can still answer with JSON. The
 * rest is read one page at a time (offsets 0, pageSize, 2 * pageSize, ...) and
 * stops at a short page, at the first page's `total`, or at `maxRows`. The
 * format writes the file: `bom`, `header(source)`, `serializeRow(row, source)`
 * and `footer(source)`; header and rows get the CSV line ending.
 * `countPromise` resolves with the rows written once the stream ends or is
 * abandoned.
 */
export async function openExportStream({ source, format, readPage, pageSize, maxRows = Infinity }) {
  const firstLimit = Math.min(pageSize, maxRows);
  const first = await readPage({ limit: firstLimit, offset: 0 });
  const end = Math.min(first.total ?? Infinity, maxRows);

  let rowCount = 0;
  let settle;
  const countPromise = new Promise((resolve) => { settle = resolve; });

  async function* generate() {
    try {
      if (format.bom) yield BOM;
      if (format.header) yield format.header(source) + CSV_EOL;
      let page = first;
      let offset = 0;
      let limit = firstLimit;
      for (;;) {
        const rows = page.rows.slice(0, Math.max(0, Math.min(limit, end - offset)));
        if (rows.length) yield rows.map((row) => format.serializeRow(row, source) + CSV_EOL).join("");
        rowCount += rows.length;
        if (rows.length < limit || offset + rows.length >= end) break;
        offset += pageSize;
        limit = Math.min(pageSize, end - offset);
        page = await readPage({ limit, offset });
      }
      if (format.footer) yield format.footer(source);
    } finally {
      settle(rowCount);
    }
  }

  return { stream: generate(), countPromise };
}
