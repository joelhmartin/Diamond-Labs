/**
 * Streamed CSV export. A report is written as an export source through the
 * shared paged writer and CSV format (`openExportStream` and `csvFormat` in
 * packages/shared/src/exports), the same path the exports module's downloads
 * take: its columns are the fields, so each cell comes from the shared
 * csvValue (the file matches the screen) and is encoded by the shared csvRow.
 * Server-paged reports are read page by page, each page in its own short
 * read-only transaction, so no connection is held while the client downloads.
 */
import { Readable } from "node:stream";
import { csvFormat, openExportStream } from "@my-app/shared";
import { prepareRun, executePrepared, defaultRunSlots } from "./runner.js";

export const CSV_ROW_CAP = 100000;
export const CSV_PAGE_SIZE = 2000;

/** Report files are the shared CSV format, BOM included (as the browser's selected-rows export), so Excel reads UTF-8. */
export const REPORT_CSV_FORMAT = csvFormat;

/**
 * Validate, run the first page (so a bad request or timeout is a normal JSON
 * error), then send the rest as a stream. `onExport(paramNames)` fires once
 * before anything is sent.
 */
export async function streamCsv({ registry, db, key, query, actor, reply, now = new Date(), tz = "UTC", slots = defaultRunSlots, onExport }) {
  const prepared = prepareRun({ registry, key, query, actor, now, tz });
  const { def, params } = prepared;
  // A client-paged report comes back whole in one run: cut it at the export cap, not the on-screen one.
  const exec = (page) => executePrepared({ ...prepared, page }, { db, actor, slots, rowCap: CSV_ROW_CAP });
  const server = def.paging === "server";
  const sort = prepared.page?.sort ?? null;

  // The report as an export source: its columns are the fields (csvValue reads a column's type and timeZone).
  const source = { key, fields: def.columns.map((c) => ({ ...c, key: c.id })) };
  const readPage = server
    ? ({ limit, offset }) => exec({ limit, offset, sort })
    : async () => {
        const { rows } = await exec(null);
        return { rows, total: rows.length }; // one run is the whole file
      };
  const { stream } = await openExportStream({
    source, format: REPORT_CSV_FORMAT, readPage, pageSize: server ? CSV_PAGE_SIZE : CSV_ROW_CAP, maxRows: CSV_ROW_CAP,
  });
  onExport?.(Object.keys(params));

  reply
    .header("Content-Type", REPORT_CSV_FORMAT.contentType)
    .header("Content-Disposition", `attachment; filename="${key}-${prepared.clock.today}.csv"`)
    .header("Cache-Control", "no-store");
  return reply.send(Readable.from(stream));
}
