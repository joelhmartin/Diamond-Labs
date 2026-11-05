import { LAB_STATUS_LABELS, isTerminalLabStatus } from "@my-app/shared";
import { DEFAULT_CALENDAR, addBusinessDays } from "../../modules/business-calendar/index.js";
import { behindSchedule } from "../../modules/workflows/index.js";

/**
 * The pure half of lab scheduling: milestone ranks and the behind / at-risk
 * flags. A leaf on purpose (no DB schema, no service imports) so
 * lab-order-rules.js can use it; lab-scheduling.js re-exports it.
 */

/** At risk: due within this many business days (or past due) and not yet in QC. */
export const AT_RISK_BUSINESS_DAYS = 2;

const MILESTONE_ORDER = ["received", "in_production", "quality_check", "ready_to_ship", "shipped"];
const RANK = Object.fromEntries(MILESTONE_ORDER.map((m, i) => [m, i]));
export const rankOf = (milestone) => RANK[milestone] ?? 0;

/** The milestones a lab workflow stage may name, in board order. */
export const LAB_MILESTONES = MILESTONE_ORDER.map((value) => ({ value, label: LAB_STATUS_LABELS[value] }));

/** An order's place on the milestone line, 0..4. An on-hold order ranks where it was held from. */
export function labRank(status, heldFrom = null) {
  return rankOf(status === "on_hold" ? heldFrom : status);
}


// One cutoff per (calendar, today): a board load flags hundreds of orders.
const cutoffs = new WeakMap();

/**
 * The first date that is NOT within the at-risk window: the (AT_RISK_BUSINESS_DAYS + 1)th
 * open day after today. A due date strictly before it is at risk, whatever
 * its distance in the past, and a far-future due date costs nothing.
 */
function atRiskCutoff(todayIso, calendar) {
  let byDay = cutoffs.get(calendar);
  if (!byDay) { byDay = new Map(); cutoffs.set(calendar, byDay); }
  if (!byDay.has(todayIso)) {
    let cutoff;
    try { cutoff = addBusinessDays(todayIso, AT_RISK_BUSINESS_DAYS + 1, calendar); } catch { cutoff = "\uffff"; } // no open day at all: everything is due soon
    byDay.set(todayIso, cutoff);
  }
  return byDay.get(todayIso);
}

const NO_FLAGS = Object.freeze({ behind: false, lateStage: null, atRisk: false });

/**
 * Computed on read, never stored. `behind`: a stage target has passed and the
 * order hasn't reached its milestone. `atRisk`: behind, or due within
 * AT_RISK_BUSINESS_DAYS business days (past due included) and not yet in QC.
 * Shipped and cancelled orders are neither. Works without a plan (due date only).
 */
export function scheduleFlags(order, plan, todayIso, calendar = DEFAULT_CALENDAR) {
  if (!order || isTerminalLabStatus(order.status)) return { ...NO_FLAGS };
  const rank = labRank(order.status, order.heldFrom);
  const { behind, lateStage } = behindSchedule(plan?.stages ?? [], rank, rankOf, todayIso);
  const dueSoon = Boolean(order.dueDate)
    && order.dueDate < atRiskCutoff(todayIso, calendar ?? DEFAULT_CALENDAR)
    && rank < RANK.quality_check;
  return { behind, lateStage, atRisk: behind || dueSoon };
}

