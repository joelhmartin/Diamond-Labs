import { sql } from "drizzle-orm";
import { nextSequenceNumber } from "../lib/sequence.js";

/**
 * Allocate the next number of a sequence inside the caller's transaction. The
 * advisory lock is held until that transaction ends, so two concurrent writers
 * can never read the same max. Each sequence has its own lock id (lab orders
 * 7300421, invoices 7300422).
 */
// Advisory-lock id for invoice numbers. Lives here (db-free) so the import tools can share it without loading config/env.js.
export const INVOICE_NUMBER_LOCK = 7300422;

export async function allocateSequenceNumber(tx, { lockId, table, column, start }) {
  if (!Number.isSafeInteger(lockId)) throw new RangeError(`lockId must be an integer, got ${lockId}`);
  await tx.execute(sql.raw(`select pg_advisory_xact_lock(${lockId})`));
  const [row] = await tx.select({ max: sql`max(${column})` }).from(table);
  return nextSequenceNumber(row?.max == null ? null : Number(row.max), start);
}
