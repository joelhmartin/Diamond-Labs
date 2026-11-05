import { and, asc, eq, inArray } from "drizzle-orm";
import { db as appDb } from "../../config/database.js";
import { createId } from "../../lib/id.js";
import { uploadPrivateObject, deleteStoredFile, getSignedReadUrl } from "../../services/storage.service.js";
import { recordFiles } from "./schema.js";

/** Object key prefix inside the private bucket. */
export const STORAGE_PREFIX = "record-files";
/** Signed read links live five minutes. */
export const SIGNED_URL_TTL_SECONDS = 300;

export class FileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FileError";
    this.code = code; // NOT_FOUND | INVALID
  }
}

const defaultStorage = {
  upload: (o) => uploadPrivateObject({ prefix: STORAGE_PREFIX, ...o }),
  deleteObject: deleteStoredFile,
  sign: getSignedReadUrl,
};

/** The client-facing shape. The storage url is internal and never leaves the service. */
export const toFile = (r) => ({
  id: r.id, recordType: r.recordType, recordId: r.recordId, kind: r.kind,
  originalName: r.originalName, contentType: r.contentType ?? null, size: r.size, createdAt: r.createdAt,
});

/**
 * Upload every file, then insert all rows. If an upload or the insert fails,
 * the objects already uploaded are deleted so nothing is orphaned.
 *
 * @param {{ recordType: string, recordId: string, files: Array<{ kind: string, buffer: Buffer, originalName: string, contentType?: string }>, byUserId?: string, storage?: object }} args
 */
export async function attachFiles({ recordType, recordId, files, byUserId = null, storage = {} }, database = appDb) {
  const io = { ...defaultStorage, ...storage };
  const uploaded = [];
  const cleanup = () => Promise.all(uploaded.map((u) => io.deleteObject(u.gcsUrl)));
  try {
    for (const f of files) {
      const res = await io.upload({
        ownerId: recordId, kind: f.kind, buffer: f.buffer, originalName: f.originalName, contentType: f.contentType,
      });
      uploaded.push({ ...res, file: f });
    }
    if (!uploaded.length) return [];
    const rows = await database.insert(recordFiles).values(uploaded.map((u) => ({
      id: createId(), recordType, recordId, kind: u.file.kind,
      originalName: u.file.originalName, storageUrl: u.gcsUrl, contentType: u.file.contentType ?? null,
      size: u.size, createdBy: byUserId,
    }))).returning();
    return rows.map(toFile);
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** Map<recordId, FileRow[]> oldest first. Records with no files are absent. */
export async function filesFor(recordType, ids, database = appDb) {
  const out = new Map();
  if (!ids?.length) return out;
  const rows = await database.select().from(recordFiles)
    .where(and(eq(recordFiles.recordType, recordType), inArray(recordFiles.recordId, ids)))
    .orderBy(asc(recordFiles.createdAt));
  for (const r of rows) {
    if (!out.has(r.recordId)) out.set(r.recordId, []);
    out.get(r.recordId).push(toFile(r));
  }
  return out;
}

/** Re-point every file of one record at another (e.g. when a record is promoted). Storage is untouched. */
export async function relinkFiles(tx, { fromType, fromId, toType, toId }) {
  const moved = await tx.update(recordFiles).set({ recordType: toType, recordId: toId })
    .where(and(eq(recordFiles.recordType, fromType), eq(recordFiles.recordId, fromId)))
    .returning({ id: recordFiles.id });
  return moved.length;
}

async function loadRow(fileId, database) {
  const [row] = await database.select().from(recordFiles).where(eq(recordFiles.id, fileId));
  if (!row) throw new FileError("NOT_FOUND", "File not found.");
  return row;
}

/** One file row in client shape; NOT_FOUND when the id is unknown. */
export async function getFile(fileId, database = appDb) {
  return toFile(await loadRow(fileId, database));
}

/** A short-lived signed read link plus the file row. */
export async function signedUrlFor(fileId, { sign = defaultStorage.sign } = {}, database = appDb) {
  const row = await loadRow(fileId, database);
  return { url: await sign(row.storageUrl, SIGNED_URL_TTL_SECONDS), file: toFile(row) };
}

/** Delete the row, then the object (best-effort: a leftover object is harmless, a dangling row is not). */
export async function removeFile(fileId, { storage = {} } = {}, database = appDb) {
  const io = { ...defaultStorage, ...storage };
  const row = await loadRow(fileId, database);
  await database.delete(recordFiles).where(eq(recordFiles.id, fileId));
  await io.deleteObject(row.storageUrl);
  return toFile(row);
}
