/**
 * Lab order status rules — the ONE table both the API (lab-order-rules.js,
 * lab.routes.js) and the web (board, order detail, doctor "My cases") read,
 * so a move the UI offers is a move the API accepts.
 *
 *   received → in_production → quality_check → ready_to_ship → shipped
 *   quality_check → in_production    (failed QC goes back to the bench)
 *   ready_to_ship → quality_check    (caught at packing)
 *   any non-terminal → on_hold (reason) → back to where it was held from
 *   any non-terminal → cancelled (reason)
 */
export const LAB_ORDER_STATUSES = [
  "received", "in_production", "quality_check", "ready_to_ship", "shipped", "on_hold", "cancelled",
];

/** Board columns, left to right. Cancelled orders live on Admin › Orders, not the board. */
export const LAB_BOARD_COLUMNS = [
  "received", "in_production", "quality_check", "ready_to_ship", "on_hold", "shipped",
];

export const TERMINAL_LAB_STATUSES = ["shipped", "cancelled"];
export const REASON_REQUIRED_STATUSES = ["on_hold", "cancelled"];

const FLOW = {
  received: ["in_production"],
  in_production: ["quality_check"],
  quality_check: ["ready_to_ship", "in_production"],
  ready_to_ship: ["shipped", "quality_check"],
};

export const LAB_STATUS_LABELS = {
  received: "Received",
  in_production: "In production",
  quality_check: "Quality check",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export function isTerminalLabStatus(status) {
  return TERMINAL_LAB_STATUSES.includes(status);
}

/**
 * Every status `status` may move to. `heldFrom` is where an on-hold order
 * resumes; an on-hold row without a usable one resumes at received rather
 * than being stuck with no way out but cancel.
 */
export function allowedNextStatuses(status, { heldFrom = null } = {}) {
  if (!LAB_ORDER_STATUSES.includes(status) || isTerminalLabStatus(status)) return [];
  if (status === "on_hold") {
    const resume = FLOW[heldFrom] ? heldFrom : "received";
    return [resume, "cancelled"];
  }
  return [...FLOW[status], "on_hold", "cancelled"];
}

export function canMoveLabOrder(from, to, opts) {
  return allowedNextStatuses(from, opts).includes(to);
}

export function reasonRequiredFor(to) {
  return REASON_REQUIRED_STATUSES.includes(to);
}

/** The lab is in San Antonio; "today" for due dates is the lab's today. */
export const LAB_TIMEZONE = "America/Chicago";

/** "YYYY-MM-DD" for `now` in `timeZone`. */
export function isoDateIn(timeZone = LAB_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Past its due date and still open. Due dates are "YYYY-MM-DD", so string order is date order. */
export function isOverdue(dueDate, status, todayIso) {
  if (!dueDate || isTerminalLabStatus(status)) return false;
  return dueDate < todayIso;
}

// ── Doctor-facing view ─────────────────────────────────────────────────────
// Doctors see production in plain words. Hold reasons, lab notes, assignee
// and department are staff-only: doctorCaseView builds its result from an
// explicit allow-list, so a column added to lab_orders later can never reach
// a doctor by default.

export const DOCTOR_STATUS_LABELS = {
  received: "Received",
  in_production: "In production",
  quality_check: "In production",
  ready_to_ship: "In production",
  on_hold: "On hold",
  shipped: "Shipped",
  cancelled: "Cancelled",
  // Case-level (no lab order yet): the lab sent the case back with a question.
  awaiting_doctor: "Waiting on you",
};

export function doctorStatusFor({ caseStatus, labOrderStatus } = {}) {
  if (labOrderStatus) return DOCTOR_STATUS_LABELS[labOrderStatus] ?? "In production";
  if (caseStatus === "cancelled") return "Cancelled";
  if (caseStatus === "awaiting_doctor") return DOCTOR_STATUS_LABELS.awaiting_doctor;
  if (caseStatus === "pushed") return "Sent to lab";
  return "Submitted";
}

/** The lab order that represents a case now: the newest (a remake supersedes the original). */
export function currentLabOrder(labOrders = []) {
  return [...labOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null;
}

/** "YYYY-MM-DD" (or an ISO timestamp) → "MM/DD/YYYY"; "" for null/invalid. The one US date formatter. */
export function formatUsDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** An instant (Date / ISO timestamp) as the lab's calendar date, "MM/DD/YYYY"; "" for null/invalid. */
export function formatLabDate(instant) {
  if (!instant) return "";
  const d = new Date(instant);
  return Number.isNaN(d.getTime()) ? "" : formatUsDate(isoDateIn(LAB_TIMEZONE, d));
}

/**
 * Patient name + device summary for a (decrypted) rx_cases row. The one place
 * this composition lives; null when the data is absent or failed to decrypt.
 */
export function caseSummary(caseRow) {
  const devices = caseRow?.deviceOptions?.devices ?? [];
  return {
    patientName: `${caseRow?.patientFirst ?? ""} ${caseRow?.patientLast ?? ""}`.trim() || null,
    deviceSummary: devices.map((d) => d.label || d.deviceKey).filter(Boolean).join(", ") || null,
  };
}

/**
 * One row of a doctor's "My cases".
 * @param {object} caseRow   DECRYPTED rx_cases row (or the redacted placeholder a failed decrypt yields)
 * @param {Array}  labOrders lab_orders rows for this case — only allow-listed fields are read
 */
export function doctorCaseView(caseRow, labOrders = []) {
  const current = currentLabOrder(labOrders);
  const { patientName, deviceSummary } = caseSummary(caseRow);
  return {
    id: caseRow.id,
    caseNumber: caseRow.caseNumber,
    patientName,
    deviceSummary,
    submittedAt: caseRow.createdAt,
    status: doctorStatusFor({ caseStatus: caseRow.status, labOrderStatus: current?.status }),
    dueDate: current?.dueDate ?? caseRow.dueDate ?? null,
    isRemake: Boolean(current?.isRemake),
    orderNumber: current?.orderNumber ?? null,
  };
}
