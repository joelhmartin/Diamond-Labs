/**
 * What Seazona's fields mean, in one place: status tables, and defensive
 * readers for fields whose exact names the live payloads confirm at rehearsal
 * (the fixtures in test-fixtures/seazona are built from the documented shapes).
 * A rehearsal that finds a new status or field name changes THIS file, and
 * the fixture, in the same commit.
 */
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

const VOID_INVOICE_STATES = new Set(["void", "voided", "cancelled", "canceled", "deleted"]);

/** An invoice's `status` is a production workflow state; only a void/cancel state voids it. */
export const invoiceStatusFor = (status) => (VOID_INVOICE_STATES.has(norm(status)) ? "void" : "issued");

const ORDER_STATES = {
  "new": "received", "received": "received", "entered": "received", "pending": "received", "open": "received",
  "in production": "in_production", "production": "in_production", "in progress": "in_production",
  "quality check": "quality_check", "qc": "quality_check",
  "ready": "ready_to_ship", "ready to ship": "ready_to_ship",
  "hold": "on_hold", "on hold": "on_hold",
  "shipped": "shipped", "delivered": "shipped", "complete": "shipped", "completed": "shipped",
  "cancelled": "cancelled", "canceled": "cancelled", "void": "cancelled", "voided": "cancelled", "deleted": "cancelled",
};

/** Seazona order state → { status, heldFrom }; null when unknown (reported, and a live load refuses). */
export function orderStatusFor(state) {
  const status = ORDER_STATES[norm(state)];
  if (!status) return null;
  return { status, heldFrom: status === "on_hold" ? "in_production" : null };
}

export function isOpenOrderStatus(state) {
  const m = orderStatusFor(state);
  return m !== null && m.status !== "shipped" && m.status !== "cancelled";
}

const DATE_FIELDS = {
  invoice: ["date", "invoiceDate", "created", "createdAt", "due"],
  order: ["ordered", "orderDate", "created", "createdAt"],
};

/** The record's own date as "YYYY-MM-DD" (an invoice falls back to its due date); null when none. */
export function recordDate(entity, payload) {
  for (const k of DATE_FIELDS[entity] ?? []) {
    const v = payload?.[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

export function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export const INVOICE_NUMBER_FIELDS = ["invoiceNumber", "number"];
export const ORDER_NUMBER_FIELDS = ["orderNumber", "number"];

/** A record's business number as a positive safe integer; null when absent or not numeric. */
export function recordNumber(payload, keys) {
  for (const k of keys) {
    const v = payload?.[k];
    if (v == null || v === "") continue;
    const s = String(v).trim();
    if (!/^\d{1,9}$/.test(s)) return null;
    const n = Number(s);
    return n > 0 ? n : null;
  }
  return null;
}
