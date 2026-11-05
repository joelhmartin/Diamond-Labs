import { inArray } from "drizzle-orm";
import { LAB_STATUS_LABELS, isTerminalLabStatus } from "@my-app/shared";
import { productVariants } from "../../db/schema/index.js";
import { DEFAULT_CALENDAR, businessDaysBetween } from "../../modules/business-calendar/index.js";
import { getCalendar } from "../../modules/business-calendar/service.js";
import { behindSchedule } from "../../modules/workflows/index.js";
import { createWorkflowsService } from "../../modules/workflows/service.js";
import { parseDueDate } from "./lab-order-rules.js";

/**
 * Lab glue for the generic business-calendar and workflows modules: which
 * workflow a lab order runs on, its due date, the stage plan saved with it
 * (workflow_plans, record type "lab_order") and the behind / at-risk flags.
 * Piece 6's staff order entry calls defaultDueAt + saveSchedule too: their
 * signatures are fixed by roadmap ruling R-A.
 */

export const LAB_RECORD_TYPE = "lab_order";

/** At risk: due within this many business days (or past due) and not yet in QC. */
export const AT_RISK_BUSINESS_DAYS = 2;

const MILESTONE_ORDER = ["received", "in_production", "quality_check", "ready_to_ship", "shipped"];
const RANK = Object.fromEntries(MILESTONE_ORDER.map((m, i) => [m, i]));
const rankOf = (milestone) => RANK[milestone] ?? 0;

/** The milestones a lab workflow stage may name, in board order. */
export const LAB_MILESTONES = MILESTONE_ORDER.map((value) => ({ value, label: LAB_STATUS_LABELS[value] }));

/** An order's place on the milestone line, 0..4. An on-hold order ranks where it was held from. */
export function labRank(status, heldFrom = null) {
  return rankOf(status === "on_hold" ? heldFrom : status);
}

/** Assignment tiers for workflowForSubjects: the variants first, then their catalog families. */
async function subjectTiers(tx, variantIds) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = await tx.select({ familyId: productVariants.familyId }).from(productVariants).where(inArray(productVariants.id, ids));
  const families = [...new Set(rows.map((r) => r.familyId).filter(Boolean))];
  return [ids.map((id) => ({ type: "variant", id })), families.map((id) => ({ type: "family", id }))];
}

/**
 * The due date and stage plan for a new (or replanned) lab order, read inside
 * the caller's transaction. Workflow: `workflowKey`, else the longest assigned
 * to the variants, then to their families, else the default workflow, else
 * none (the calendar's lead time, no stages). A rush takes the workflow's rush
 * link when it has one. A valid `requestedDueDate` is kept and the stages are
 * planned in reverse from it; otherwise forward from the lab-local day of `startAt`.
 *
 * With no workflow, no lead time and no requested date there is nothing to
 * plan: `{ dueDate: null, plan: null }` (an unconfigured calendar keeps the
 * pre-scheduling behaviour).
 *
 * @returns {Promise<{ dueDate: string|null, plan: object|null }>}
 */
export async function defaultDueAt(tx, { variantIds = [], requestedDueDate = null, rush = false, workflowKey = null, startAt = new Date() } = {}) {
  const workflows = createWorkflowsService(tx);
  const calendar = await getCalendar(tx);
  let key = workflowKey;
  if (key == null) key = (await workflows.workflowForSubjects(await subjectTiers(tx, variantIds)))?.key ?? null;
  const dueAt = parseDueDate(requestedDueDate);
  if (key == null && dueAt == null && !calendar.leadDays) return { dueDate: null, plan: null };
  const plan = await workflows.planFor({ workflowKey: key, startAt, rush, dueAt }, calendar);
  return { dueDate: plan.dueAt, plan };
}

/** Upsert a lab order's plan inside the caller's transaction; no plan, no write. */
export async function saveSchedule(tx, labOrderId, plan) {
  if (!plan) return;
  await createWorkflowsService(tx).savePlan(tx, LAB_RECORD_TYPE, labOrderId, plan);
}

/** The saved plan of one lab order, or null. `exec` is a db or a transaction. */
export async function scheduleOf(exec, labOrderId) {
  return (await createWorkflowsService(exec).plansFor(LAB_RECORD_TYPE, [labOrderId])).get(labOrderId) ?? null;
}

/**
 * Replan an open order on `workflowKey`: forward from its receivedAt, or in
 * reverse from its current due date when `keepDueDate` (and it has one).
 * Returns the new plan and the key it replaces (null when it had no plan).
 */
export async function replanOrder(tx, order, { workflowKey, keepDueDate = false }) {
  const current = await scheduleOf(tx, order.id);
  const { plan } = await defaultDueAt(tx, {
    workflowKey, requestedDueDate: keepDueDate ? order.dueDate : null, startAt: order.receivedAt ?? new Date(),
  });
  return { fromKey: current?.workflowKey ?? null, plan };
}

/** The original's workflow, forward from now: a remake has no requested date. */
export async function remakeSchedule(tx, { originalId, originalLines, now }) {
  const original = await scheduleOf(tx, originalId);
  return defaultDueAt(tx, {
    variantIds: originalLines.map((l) => l.variantId), workflowKey: original?.workflowKey ?? null, startAt: now,
  });
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
    && businessDaysBetween(todayIso, order.dueDate, calendar ?? DEFAULT_CALENDAR) <= AT_RISK_BUSINESS_DAYS
    && rank < RANK.quality_check;
  return { behind, lateStage, atRisk: behind || dueSoon };
}

/** The order page's Schedule panel (and the slip's): null when the order has no plan. */
export function presentSchedule(plan, order, todayIso, calendar = DEFAULT_CALENDAR) {
  if (!plan) return null;
  const terminal = isTerminalLabStatus(order.status);
  const rank = labRank(order.status, order.heldFrom);
  const { behind, atRisk } = scheduleFlags(order, plan, todayIso, calendar);
  return {
    workflowKey: plan.workflowKey ?? null,
    workflowName: plan.workflowName ?? null,
    direction: plan.direction,
    stages: (plan.stages ?? []).map((s) => {
      const reached = rankOf(s.milestone) <= rank;
      return { key: s.key, label: s.label, targetAt: s.targetAt, reached, late: !terminal && !reached && s.targetAt < todayIso };
    }),
    behind,
    atRisk,
  };
}
