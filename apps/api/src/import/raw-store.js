import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { createId } from "../lib/id.js";
import { encryptJson, decryptJson, encryptField, decryptField } from "../lib/crypto.js";
import { seazonaRecords, fetchRuns, importFiles, parityReports } from "./db/schema.js";

/**
 * The raw store's reads and writes. Payloads are sealed whole on the way in
 * and opened only in memory on the way out: never log what readRecords returns.
 */
const BATCH = 500;

export async function upsertRecords(importDb, { entity, records, runId, now = new Date() }) {
  for (let i = 0; i < records.length; i += BATCH) {
    const rows = records.slice(i, i + BATCH).map((r) => ({
      id: createId(),
      entity,
      seazonaId: String(r.seazonaId),
      payload: encryptJson(r.payload),
      lastModified: r.lastModified == null ? null : String(r.lastModified).slice(0, 40),
      fetchedAt: now,
      fetchRunId: runId,
    }));
    await importDb.insert(seazonaRecords).values(rows).onConflictDoUpdate({
      target: [seazonaRecords.entity, seazonaRecords.seazonaId],
      set: {
        payload: sql`excluded.payload`,
        lastModified: sql`excluded.last_modified`,
        fetchedAt: sql`excluded.fetched_at`,
        fetchRunId: sql`excluded.fetch_run_id`,
      },
    });
  }
  return records.length;
}

/** Every record of one entity, opened. PHI in memory only. */
export async function readRecords(importDb, entity) {
  const rows = await importDb.select().from(seazonaRecords).where(eq(seazonaRecords.entity, entity));
  return rows.map((r) => ({ seazonaId: r.seazonaId, payload: decryptJson(r.payload), lastModified: r.lastModified ?? null, fetchedAt: r.fetchedAt }));
}

/** seazonaId → lastModified for one entity, without opening anything. */
export async function recordIndex(importDb, entity) {
  const rows = await importDb
    .select({ seazonaId: seazonaRecords.seazonaId, lastModified: seazonaRecords.lastModified })
    .from(seazonaRecords)
    .where(eq(seazonaRecords.entity, entity));
  return new Map(rows.map((r) => [r.seazonaId, r.lastModified ?? null]));
}

export async function startRun(importDb, { entity, mode, plannedIds = null, now = new Date() }) {
  const id = createId();
  await importDb.insert(fetchRuns).values({ id, entity, mode, status: "running", startedAt: now, plannedIds, cursor: 0, requestCount: 0, errorCount: 0 });
  return id;
}

export async function saveProgress(importDb, runId, { cursor, requestCount, errorCount, lastStatus = null }) {
  await importDb.update(fetchRuns).set({ cursor, requestCount, errorCount, lastStatus }).where(eq(fetchRuns.id, runId));
}

export async function finishRun(importDb, runId, { status, cursor, requestCount, errorCount, lastStatus = null, note = null, now = new Date() }) {
  await importDb.update(fetchRuns).set({ status, cursor, requestCount, errorCount, lastStatus, note, finishedAt: now }).where(eq(fetchRuns.id, runId));
}

export async function getRun(importDb, runId) {
  const [run] = await importDb.select().from(fetchRuns).where(eq(fetchRuns.id, runId));
  return run ?? null;
}

/** Seal an uploaded export into the import DB. The same bytes twice return the first id. */
export async function saveFile(importDb, { kind, bytes, now = new Date() }) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [existing] = await importDb
    .select({ id: importFiles.id })
    .from(importFiles)
    .where(and(eq(importFiles.kind, kind), eq(importFiles.sha256, sha256)));
  if (existing) return existing.id;
  const id = createId();
  await importDb.insert(importFiles).values({ id, kind, sha256, content: encryptField(Buffer.from(bytes).toString("base64")), uploadedAt: now });
  return id;
}

export async function readFile(importDb, id) {
  const [row] = await importDb.select({ kind: importFiles.kind, content: importFiles.content }).from(importFiles).where(eq(importFiles.id, id));
  return row ? { kind: row.kind, bytes: Buffer.from(decryptField(row.content), "base64") } : null;
}

export async function saveParityReport(importDb, { target, clean, report, now = new Date() }) {
  const id = createId();
  await importDb.insert(parityReports).values({ id, target, clean, report, createdAt: now });
  return id;
}

/** The store bound to one import DB, as the fetcher, loader and parity report take it. */
export function rawStore(importDb) {
  return {
    upsert: (entity, records, runId) => upsertRecords(importDb, { entity, records, runId }),
    records: (entity) => readRecords(importDb, entity),
    index: (entity) => recordIndex(importDb, entity),
    startRun: (o) => startRun(importDb, o),
    saveProgress: (runId, p) => saveProgress(importDb, runId, p),
    finishRun: (runId, p) => finishRun(importDb, runId, p),
    getRun: (runId) => getRun(importDb, runId),
    saveFile: (o) => saveFile(importDb, o),
    readFile: (id) => readFile(importDb, id),
    saveParityReport: (o) => saveParityReport(importDb, o),
  };
}
