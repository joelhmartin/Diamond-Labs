import { canRelease } from "../rx/case-gates.js";

/**
 * Pure rules for lab orders: numbering, and turning a released Rx case, a
 * paid shop order or a remake into the rows to insert. No DB and no clock —
 * callers pass ids and `now` — so every rule here is unit-tested and
 * lab-orders.service.js only runs the plans inside a transaction.
 */

export class LabOrderError extends Error {
  /**
   * @param {"NOT_FOUND"|"STALE"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"INVALID"|"RELEASE_BLOCKED"|"ALREADY_RELEASED"|"CONFLICT"} code
   * @param {string} message  safe to show staff
   * @param {{ allowed?: string[], blocking?: string[] }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "LabOrderError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/** The next order number: continues from `start`, never reuses one. */
export function nextLabOrderNumber(maxExisting, start) {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new RangeError(`LAB_ORDER_NUMBER_START must be a positive integer, got ${start}`);
  }
  if (maxExisting == null) return start;
  return Math.max(Number(maxExisting) + 1, start);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A "YYYY-MM-DD" that is a real calendar date, else null. */
export function parseDueDate(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

const NO_RUSH = "No Rush";

/**
 * Whether the doctor asked for a rush, and which tier. The live form never
 * writes rx_cases.rush — the answer lives in formData: `rushCase` (["Yes"])
 * plus a tier per material, `rushChargeNylon` / `rushChargeBiomed`
 * (rx-common.sections.js). The retired wizard wrote the columns, so they win
 * when set.
 */
export function rushFromCase(caseRow = {}) {
  if (caseRow.rush) return { rush: true, rushTier: caseRow.rushTier ?? null };
  const f = caseRow.formData || {};
  if (![].concat(f.rushCase ?? []).includes("Yes")) return { rush: false, rushTier: null };
  const picks = [f.rushChargeNylon, f.rushChargeBiomed].filter((t) => typeof t === "string" && t !== "");
  const tiers = [...new Set(picks.filter((t) => t !== NO_RUSH))];
  if (picks.length > 0 && tiers.length === 0) return { rush: false, rushTier: null };
  return { rush: true, rushTier: tiers.length ? tiers.join(" / ").slice(0, 40) : null };
}

function newOrder({ labOrderId, orderNumber, source, sourceId, clientUserId, now }) {
  return {
    id: labOrderId, orderNumber, source, sourceId, clientUserId: clientUserId ?? null,
    status: "received", heldFrom: null, departmentId: null, assigneeUserId: null,
    dueDate: null, rush: false, rushTier: null, isRemake: false, remakeOfOrderId: null,
    holdReason: null, labNotes: null, version: 1,
    receivedAt: now, startedAt: null, shippedAt: null, cancelledAt: null, createdAt: now, updatedAt: now,
  };
}

/**
 * A released Rx case → its lab order, line snapshot and release event.
 *
 * `lines` are the case's STORED rx_case_lines in position order (staff
 * corrections included). The gate is re-checked here so no caller can
 * release a partial job. `variantIdByCode` maps a lab code to its catalog
 * variant; a code with no variant is kept (the code is what the bench reads)
 * and reported in `unknownCodes` for invoicing (piece 3) to catch.
 */
export function planRxRelease({ caseRow, lines, variantIdByCode = new Map(), orderNumber, labOrderId, byUserId = null, now }) {
  const gate = canRelease(lines);
  if (!gate.ok) throw new LabOrderError("RELEASE_BLOCKED", gate.reason, { blocking: gate.blocking ?? [] });
  const labOrder = {
    ...newOrder({ labOrderId, orderNumber, source: "rx_case", sourceId: caseRow.id, clientUserId: caseRow.userId, now }),
    dueDate: parseDueDate(caseRow.dueDate) ?? parseDueDate(caseRow.formData?.dueDate),
    ...rushFromCase(caseRow),
  };
  const unknownCodes = [];
  const orderLines = lines.map((l, position) => {
    const code = l.noteOnly ? null : (l.seazonaCode ?? null);
    const variantId = code ? (variantIdByCode.get(code) ?? null) : null;
    if (code && !variantId && !unknownCodes.includes(code)) unknownCodes.push(code);
    return {
      labOrderId, position, variantId, code,
      name: l.name || l.sourceLabel || l.mapKey || "Unnamed line",
      arch: l.arch ?? null, qty: 1, noteOnly: Boolean(l.noteOnly), sourceLabel: l.sourceLabel ?? null,
    };
  });
  const event = { labOrderId, type: "release", from: caseRow.status ?? null, to: "received", byUserId, note: null, at: now };
  return { labOrder, lines: orderLines, event, unknownCodes };
}

/**
 * A paid shop order → its lab order. Runs inside the checkout transaction
 * AFTER the card is charged, so it must not refuse anything the pricing
 * service accepted: a guest, a codeless variant — all still make a job.
 * Shop lines are picked and shipped, not fabricated; same board.
 */
export function planShopLabOrder({ orderId, clientUserId = null, quoteLines, orderNumber, labOrderId, now }) {
  const labOrder = newOrder({ labOrderId, orderNumber, source: "shop_order", sourceId: orderId, clientUserId, now });
  const lines = quoteLines.map((l, position) => ({
    labOrderId, position, variantId: l.variantId ?? null, code: l.code ?? null,
    name: l.name || "Unnamed item", arch: null, qty: l.qty, noteOnly: false, sourceLabel: null,
  }));
  const event = { labOrderId, type: "release", from: "paid", to: "received", byUserId: null, note: null, at: now };
  return { labOrder, lines, event };
}

/**
 * A remake of a shipped order: a new lab order for the same source, flagged
 * isRemake and pointing back at the original, with its lines copied. The
 * reason is required — "why was this remade" is what the lab and invoicing
 * (piece 3) both ask. Whether it is charged is piece 3's concern.
 */
export function planRemake({ original, originalLines, reason, orderNumber, labOrderId, byUserId = null, now }) {
  if (original.status !== "shipped") throw new LabOrderError("INVALID", "Only a shipped order can be remade.");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) throw new LabOrderError("REASON_REQUIRED", "Say why this order is being remade.");
  const labOrder = {
    ...newOrder({ labOrderId, orderNumber, source: original.source, sourceId: original.sourceId, clientUserId: original.clientUserId, now }),
    isRemake: true,
    remakeOfOrderId: original.id,
  };
  const lines = originalLines.map((l, position) => ({
    labOrderId, position, variantId: l.variantId ?? null, code: l.code ?? null, name: l.name,
    arch: l.arch ?? null, qty: l.qty, noteOnly: Boolean(l.noteOnly), sourceLabel: l.sourceLabel ?? null,
  }));
  const events = [
    { labOrderId, type: "release", from: null, to: "received", byUserId, note: `Remake of #${original.orderNumber}: ${why}`, at: now },
    { labOrderId: original.id, type: "note", from: null, to: null, byUserId, note: `Remake created: #${orderNumber}`, at: now },
  ];
  return { labOrder, lines, events };
}
