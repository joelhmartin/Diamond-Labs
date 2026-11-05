import { and, desc, eq, count, inArray } from "drizzle-orm";
import { db as appDb } from "../../config/database.js";
import { createId } from "../../lib/id.js";
import { fieldSealer } from "../../lib/crypto.js";
import { attachFiles, filesFor, relinkFiles, recordFiles } from "../record-files/index.js";
import { intakes } from "./schema.js";
import { IntakeError, planIntakes } from "./rules.js";
import { defaultParsers } from "./parsers.js";

/** Record type under which an intake's files are stored until a promote relinks them. */
export const INTAKE_RECORD_TYPE = "intake";

// hints (parsed from the files, can name a person) and the discard reason (free text) are encrypted at rest.
const secrets = fieldSealer(["hints", "discardReason"]);

/** The client-facing shape: hints opened, the sealed reason left out. */
const toIntake = (row, files = []) => {
  const open = secrets.open(row);
  return {
    id: row.id, channel: row.channel, status: row.status, parserKey: row.parserKey,
    hints: open.hints ? JSON.parse(open.hints) : null,
    promotedRecordType: row.promotedRecordType ?? null, promotedRecordId: row.promotedRecordId ?? null,
    createdBy: row.createdBy ?? null, createdAt: row.createdAt, decidedBy: row.decidedBy ?? null, decidedAt: row.decidedAt ?? null,
    files,
  };
};

/**
 * One pending intake per planned group, each with its files attached. A group whose
 * upload fails leaves no row behind and its files are reported with the refused ones.
 *
 * @param {{ files: Array<{ kind: string, buffer: Buffer, originalName: string, contentType?: string }>, split?: "one"|"per_file", channel?: string, byUserId?: string, parsers?: object, storage?: object }} args
 * @returns {Promise<{ intakes: object[], refused: Array<{ name: string, reason: string, message: string }> }>}
 */
export async function createIntakes({ files, split = "one", channel = "upload", byUserId = null, parsers = defaultParsers, storage }, database = appDb) {
  const { groups, refused } = planIntakes(files, split);
  const created = [];
  for (const group of groups) {
    const parser = parsers.pick(group);
    const row = {
      id: createId(), channel, status: "pending", parserKey: parser.key,
      hints: JSON.stringify(parser.parse(group)), createdBy: byUserId, createdAt: new Date(),
    };
    // Files first, row second: a failed upload never leaves a pending row; a failed insert removes the files.
    let attached;
    try {
      attached = await attachFiles({ recordType: INTAKE_RECORD_TYPE, recordId: row.id, files: group, byUserId, storage }, database);
      await database.insert(intakes).values(secrets.seal(row));
      created.push(toIntake(secrets.seal(row), attached));
    } catch (err) {
      // Ids and the error code only: file names can name a person, and a storage
      // error's message can echo the object path (which carries the file name).
      console.error("[upload-intake] could not store a drop", { intakeId: row.id, code: err?.code ?? null, marker: "STORE_FAILED" });
      if (attached?.length) await database.delete(recordFiles).where(inArray(recordFiles.id, attached.map((f) => f.id))).catch(() => {});
      for (const f of group) refused.push({ name: f.originalName, reason: "could not be stored", message: `"${f.originalName}" could not be stored. Try again.` });
    }
  }
  return { intakes: created, refused };
}

/** Newest first, with each intake's files; `status` filters. */
export async function listIntakes({ status, limit = 20, offset = 0 } = {}, database = appDb) {
  const where = status ? eq(intakes.status, status) : undefined;
  const rows = await database.select().from(intakes).where(where).orderBy(desc(intakes.createdAt), desc(intakes.id)).limit(limit).offset(offset);
  const [{ total } = { total: 0 }] = await database.select({ total: count() }).from(intakes).where(where);
  const files = await filesFor(INTAKE_RECORD_TYPE, rows.map((r) => r.id), database);
  return { rows: rows.map((r) => toIntake(r, files.get(r.id) ?? [])), total: Number(total) };
}

/** Why a conditional update on a pending intake matched nothing. */
async function whyNotPending(id, database, verb) {
  const [row] = await database.select({ status: intakes.status }).from(intakes).where(eq(intakes.id, id));
  if (!row) return new IntakeError("NOT_FOUND", "Intake not found.");
  if (row.status === "discarded") return new IntakeError("CONFLICT", verb === "promote" ? "This intake was discarded." : "Already discarded.");
  return new IntakeError("CONFLICT", verb === "promote" ? "Already used." : "Already used, so it cannot be discarded.");
}

/**
 * Claims a pending intake for a record (a conditional update, so a second claim
 * fails) and moves its files onto that record. Run inside the caller's transaction.
 */
export async function promoteIntake(tx, id, { recordType, recordId, byUserId = null }) {
  const claimed = await tx.update(intakes)
    .set({ status: "promoted", promotedRecordType: recordType, promotedRecordId: recordId, decidedBy: byUserId, decidedAt: new Date() })
    .where(and(eq(intakes.id, id), eq(intakes.status, "pending")))
    .returning({ id: intakes.id });
  if (!claimed.length) throw await whyNotPending(id, tx, "promote");
  await relinkFiles(tx, { fromType: INTAKE_RECORD_TYPE, fromId: id, toType: recordType, toId: recordId });
}

/** Marks a pending intake discarded; the optional reason is sealed. Its files stay for audit. */
export async function discardIntake(id, { reason, byUserId = null } = {}, database = appDb) {
  const sealed = secrets.seal({ discardReason: reason?.trim() || null });
  const done = await database.update(intakes)
    .set({ status: "discarded", decidedBy: byUserId, decidedAt: new Date(), discardReason: sealed.discardReason })
    .where(and(eq(intakes.id, id), eq(intakes.status, "pending")))
    .returning({ id: intakes.id });
  if (!done.length) throw await whyNotPending(id, database, "discard");
  return { id };
}

/** The ids (of `ids`) that are intakes. Used by the file routes' record-type check. */
export async function intakeIdsThatExist(ids, database = appDb) {
  if (!ids.length) return new Set();
  const rows = await database.select({ id: intakes.id }).from(intakes).where(inArray(intakes.id, ids));
  return new Set(rows.map((r) => r.id));
}
