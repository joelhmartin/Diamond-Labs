import { LabOrderError } from "./lab-order-rules.js";

/**
 * Stub until Task 10 (upload intake) replaces this file with the real
 * `promoteIntakeIn(tx, intakeId, { labOrderId, byUserId })`, which claims a
 * pending intake and relinks its files onto the new order inside the staff
 * order's transaction. Until then an intake id is refused, so the create
 * rolls back instead of silently dropping the intake's files.
 */
// eslint-disable-next-line no-unused-vars
export async function promoteIntakeIn(tx, intakeId, { labOrderId, byUserId } = {}) {
  throw new LabOrderError("INVALID", "Intake not available");
}
