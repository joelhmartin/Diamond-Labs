import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import { adjustmentReasons } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { InvoiceError } from "./invoice-rules.js";

/**
 * The remake/discount reason pick-list (Admin > Reasons). A reason's
 * discountPercent is its default: a remake created from it is priced that
 * percent off (null = 100%), and "Add discount" on a draft offers it.
 * Reasons are deactivated, never deleted: orders point at them.
 */

const APPLIES = { remake: ["remake", "both"], discount: ["discount", "both"] };
const UNIQUE_VIOLATION = "23505";

const present = (r) => ({
  id: r.id, appliesTo: r.appliesTo, label: r.label, discountPercent: r.discountPercent ?? null,
  active: r.active, position: r.position,
});

/** Reasons in pick-list order. `appliesTo` "remake" | "discount" also returns the "both" ones. */
export async function listReasons({ appliesTo, includeInactive = false } = {}, database = db) {
  const where = [];
  if (APPLIES[appliesTo]) where.push(inArray(adjustmentReasons.appliesTo, APPLIES[appliesTo]));
  if (!includeInactive) where.push(eq(adjustmentReasons.active, true));
  const rows = await database
    .select()
    .from(adjustmentReasons)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(adjustmentReasons.position), asc(adjustmentReasons.label));
  return rows.map(present);
}

/** One reason, or null. */
export async function getReason(id, database = db) {
  if (!id) return null;
  const [row] = await database.select().from(adjustmentReasons).where(eq(adjustmentReasons.id, id));
  return row ? present(row) : null;
}

/** An ACTIVE reason that may be used for `kind` ("remake" | "discount"); anything else is a 422. */
export async function requireReason(id, kind, database = db) {
  const reason = await getReason(id, database);
  if (!reason || !reason.active || !APPLIES[kind].includes(reason.appliesTo)) {
    throw new InvoiceError("INVALID", "That reason isn't available.");
  }
  return reason;
}

/** The default percent a remake from this reason is priced off; null when there is no reason (priced 100% off). */
export async function remakePercentFor(reasonId, database = db) {
  const reason = await getReason(reasonId, database);
  return reason?.discountPercent ?? null;
}

async function writeUnique(fn) {
  try {
    return await fn();
  } catch (err) {
    if ((err?.code ?? err?.cause?.code) === UNIQUE_VIOLATION) throw new InvoiceError("INVALID", "A reason with that label already exists.");
    throw err;
  }
}

export function createReason({ appliesTo, label, discountPercent = null, position = 0 }, database = db) {
  return writeUnique(async () => {
    const [row] = await database
      .insert(adjustmentReasons)
      .values({ id: createId(), appliesTo, label: label.trim(), discountPercent, position })
      .returning();
    return present(row);
  });
}

export function updateReason(id, patch, database = db) {
  const values = { updatedAt: new Date() };
  for (const k of ["appliesTo", "discountPercent", "position", "active"]) if (patch[k] !== undefined) values[k] = patch[k];
  if (patch.label !== undefined) values.label = patch.label.trim();
  return writeUnique(async () => {
    const [row] = await database.update(adjustmentReasons).set(values).where(eq(adjustmentReasons.id, id)).returning();
    if (!row) throw new InvoiceError("NOT_FOUND", "Reason not found.");
    return present(row);
  });
}
