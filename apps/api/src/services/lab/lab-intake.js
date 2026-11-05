import { inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import { users } from "../../db/schema/index.js";
import { IntakeError, promoteIntake, intakeIdsThatExist, INTAKE_RECORD_TYPE } from "../../modules/upload-intake/index.js";
import { notify } from "../notify-seam.js";
import { LabOrderError } from "./lab-order-rules.js";
import { LAB_ORDER_RECORD_TYPE } from "./lab-tags.js";

/**
 * Scanner-export intakes as the lab sees them: the glue between the generic
 * upload-intake module and lab orders. Intakes are a record-files record type
 * ("intake"); promoting one happens inside the staff order's transaction.
 */
export { INTAKE_RECORD_TYPE };

/** The ids (of `ids`) that are intakes (the file routes' record-type check). */
export const intakeIdsThatExistForFiles = (ids, database = db) => intakeIdsThatExist(ids, database);

/**
 * Claims a pending intake for the new order and moves its files onto it. Any
 * refusal (unknown, already used, discarded) becomes a LabOrderError so the
 * order entry rolls back with a message staff can read.
 */
export async function promoteIntakeIn(tx, intakeId, { labOrderId, byUserId = null } = {}) {
  try {
    await promoteIntake(tx, intakeId, { recordType: LAB_ORDER_RECORD_TYPE, recordId: labOrderId, byUserId });
  } catch (err) {
    if (err instanceof IntakeError) throw new LabOrderError(err.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID", err.message);
    throw err;
  }
}

/** Tells staff a drop landed (ids only; piece 8 repoints the seam at real delivery). */
export async function notifyIntakesCreated(intakes, database = db) {
  for (const i of intakes) {
    await notify(database, { event: "intake.created", recordType: INTAKE_RECORD_TYPE, recordId: i.id, audience: "staff", data: {} });
  }
}

/** Adds `byName` (who dropped the files) to listed intakes. */
export async function withDroppedBy(rows, database = db) {
  const ids = [...new Set(rows.map((r) => r.createdBy).filter(Boolean))];
  if (!ids.length) return rows.map((r) => ({ ...r, byName: null }));
  const found = await database.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  const names = new Map(found.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, byName: names.get(r.createdBy) ?? null }));
}
