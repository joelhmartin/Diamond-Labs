import { LAB_ARCHES, LAB_LINE_QTY_MAX, LAB_PATIENT_NAME_MAX } from "@my-app/shared";
import { LabOrderError, newOrder, cleanFieldValue, parseDueDate } from "./lab-order-rules.js";

/**
 * Pure rules for orders lab staff type in (piece 6, source "staff"): the
 * catalog lines and the plan staff-orders.service.js inserts. No DB and no
 * clock. Production fields reuse the field-edit rules in lab-order-rules.js,
 * so a value entry accepts is a value the order page accepts.
 */

/** A quantity the bench accepts (1–99); throws LabOrderError("INVALID"). */
export function checkLineQty(qty) {
  if (!Number.isInteger(qty) || qty < 1 || qty > LAB_LINE_QTY_MAX) {
    throw new LabOrderError("INVALID", `Quantity must be a whole number from 1 to ${LAB_LINE_QTY_MAX}.`);
  }
  return qty;
}

/**
 * One requested line → its bench line fields. Name and code come from the
 * catalog variant; anything else the client sent about the product is ignored.
 */
export function catalogLine(input, variant) {
  if (!variant) throw new LabOrderError("INVALID", "A product on this order isn't in the catalog.");
  const arch = input.arch ?? null;
  if (arch !== null && !LAB_ARCHES.includes(arch)) throw new LabOrderError("INVALID", "Unknown arch.");
  return {
    variantId: variant.id, code: variant.code ?? null, name: variant.name, arch,
    qty: checkLineQty(input.qty ?? 1), noteOnly: Boolean(input.noteOnly), sourceLabel: null,
  };
}

/** Requested lines → bench lines in order (no ids or positions yet). Shared by entry and the price preview. */
export function catalogLines(inputLines = [], variantsById) {
  return inputLines.map((l) => catalogLine(l, variantsById.get(l.variantId)));
}

/**
 * A staff entry → { labOrder, lines, event }. `dueDate` is already resolved
 * (the request's, or the scheduling default from lab-scheduling.js).
 */
export function planStaffOrder({ input, variantsById, orderNumber, labOrderId, byUserId = null, now, dueDate }) {
  if (!input.clientUserId) throw new LabOrderError("INVALID", "Pick a practice.");
  const patientName = typeof input.patientName === "string" ? input.patientName.trim() : "";
  if (!patientName) throw new LabOrderError("INVALID", "Enter the patient's name.");
  if (patientName.length > LAB_PATIENT_NAME_MAX) throw new LabOrderError("INVALID", `Patient names are limited to ${LAB_PATIENT_NAME_MAX} characters.`);
  if (!parseDueDate(dueDate)) throw new LabOrderError("INVALID", "Due date must be a real date (YYYY-MM-DD).");

  const labOrder = {
    ...newOrder({ labOrderId, orderNumber, source: "staff", sourceId: labOrderId, clientUserId: input.clientUserId, now }),
    patientName,
    dueDate,
    rush: Boolean(input.rush),
    panNumber: cleanFieldValue("pan", input.pan),
    deliveryMethod: cleanFieldValue("delivery", input.deliveryMethod),
    enclosures: cleanFieldValue("enclosures", input.enclosures),
    labNotes: cleanFieldValue("notes", input.notes),
  };
  const lines = catalogLines(input.lines, variantsById).map((l, position) => ({ ...l, labOrderId, position }));
  const event = { labOrderId, type: "release", from: null, to: "received", byUserId, note: "Staff entry", at: now };
  return { labOrder, lines, event };
}
