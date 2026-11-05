/**
 * Streamed CSV export. Server-paged reports are read page by page, each page
 * in its own short read-only transaction, so no connection is held while the
 * client downloads. Cell text comes from the shared csvValue so the file
 * matches the screen; each field is encoded by the shared csvField (via
 * csvRow), the same encoder the browser's selected-rows export uses.
 */
import { Readable } from "node:stream";
import { csvValue, csvRow, CSV_EOL } from "@my-app/shared";
import { prepareRun, executePrepared, defaultRunSlots } from "./runner.js";

export const CSV_ROW_CAP = 100000;
export const CSV_PAGE_SIZE = 2000;

/** One CSV record, CRLF terminated; fields go through the one shared encoder (quoting + formula neutralising). */
const csvLine = (cells) => `${csvRow(cells)}${CSV_EOL}`;

const rowsToCsv = (columns, rows) => rows.map((row) => csvLine(columns.map((c) => csvValue(c, row[c.id])))).join("");

/**
 * Validate, run the first page (so a bad request or timeout is a normal JSON
 * error), then send the rest as a stream. `onExport(paramNames)` fires once
 * before anything is sent.
 */
export async function streamCsv({ registry, db, key, query, actor, reply, now = new Date(), tz = "UTC", slots = defaultRunSlots, onExport }) {
  const prepared = prepareRun({ registry, key, query, actor, now, tz });
  const { def, params } = prepared;
  const exec = (page) => executePrepared({ ...prepared, page }, { db, actor, slots });
  const server = def.paging === "server";
  const sort = prepared.page?.sort ?? null;

  const first = await exec(server ? { limit: CSV_PAGE_SIZE, offset: 0, sort } : null);
  onExport?.(Object.keys(params));

  async function* lines() {
    yield csvLine(def.columns.map((c) => c.label));
    yield rowsToCsv(def.columns, first.rows);
    if (!server) return;
    const end = Math.min(first.total, CSV_ROW_CAP);
    let sent = first.rows.length;
    for (let offset = CSV_PAGE_SIZE; offset < end && sent > 0; offset += CSV_PAGE_SIZE) {
      const next = await exec({ limit: Math.min(CSV_PAGE_SIZE, end - offset), offset, sort });
      if (!next.rows.length) return;
      sent = next.rows.length;
      yield rowsToCsv(def.columns, next.rows);
    }
  }

  reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${key}-${prepared.clock.today}.csv"`)
    .header("Cache-Control", "no-store");
  return reply.send(Readable.from(lines()));
}
