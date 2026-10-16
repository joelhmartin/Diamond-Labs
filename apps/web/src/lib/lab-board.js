import { LAB_BOARD_COLUMNS, LAB_STATUS_LABELS, allowedNextStatuses, reasonRequiredFor, formatUsDate } from "@my-app/shared";

const label = (s) => LAB_STATUS_LABELS[s] ?? s ?? "—";

/** Cards → one list per board column (every column present; off-board statuses dropped). */
export function groupByStatus(cards = []) {
  const out = Object.fromEntries(LAB_BOARD_COLUMNS.map((s) => [s, []]));
  for (const c of cards) if (out[c.status]) out[c.status].push(c);
  return out;
}

/**
 * The one-click moves a card offers: every allowed move that needs no
 * reason. Hold and cancel need a reason, so they live on the order page.
 */
export function quickMoves(card) {
  return allowedNextStatuses(card.status, { heldFrom: card.heldFrom ?? null })
    .filter((to) => !reasonRequiredFor(to))
    .map((to) => ({ to, label: `→ ${label(to)}` }));
}

/** Board filter state → GET /lab/orders params. */
export function boardParams(filters = {}) {
  const out = {};
  for (const k of ["departmentId", "assigneeUserId", "q", "dueBefore"]) {
    const v = typeof filters[k] === "string" ? filters[k].trim() : "";
    if (v) out[k] = v;
  }
  if (filters.rush) out.rush = "true";
  return out;
}

/** One timeline row as a sentence. */
export function describeEvent(e, { staffById = {}, departmentsById = {} } = {}) {
  const who = e.byName || "System";
  switch (e.type) {
    case "release": return `${who}: released to the lab${e.note ? ` — ${e.note}` : ""}`;
    case "status": return `${who}: ${label(e.from)} → ${label(e.to)}${e.note ? ` — ${e.note}` : ""}`;
    case "hold": return `${who}: put on hold — ${e.note ?? "no reason recorded"}`;
    case "assign": return e.to ? `${who}: assigned to ${staffById[e.to] ?? "a former staff member"}` : `${who}: unassigned`;
    case "department": return e.to ? `${who}: moved to ${departmentsById[e.to] ?? "a removed department"}` : `${who}: removed from its department`;
    case "due": return e.to ? `${who}: due date set to ${formatUsDate(e.to)}` : `${who}: due date cleared`;
    case "note": return `${who}: ${e.note ?? "note"}`;
    default: return `${who}: ${e.type}`;
  }
}
