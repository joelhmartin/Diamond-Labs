import { inArray } from "drizzle-orm";
import { isTerminalLabStatus } from "@my-app/shared";
import { productVariants } from "../../db/schema/index.js";
import { DEFAULT_CALENDAR } from "../../modules/business-calendar/index.js";
import { getCalendar } from "../../modules/business-calendar/service.js";
import { WorkflowError } from "../../modules/workflows/index.js";
import { createWorkflowsService } from "../../modules/workflows/service.js";
import { LabOrderError, parseDueDate } from "./lab-order-rules.js";
import { labRank, rankOf, scheduleFlags } from "./lab-schedule-flags.js";

/**
 * Lab glue for the generic business-calendar and workflows modules: which
 * workflow a lab order runs on, its due date, the stage plan saved with it
 * (workflow_plans, record type "lab_order") and the behind / at-risk flags.
 * Piece 6's staff order entry calls defaultDueAt + saveSchedule too: their
 * signatures are fixed by roadmap ruling R-A.
 */

export const LAB_RECORD_TYPE = "lab_order";

export { AT_RISK_BUSINESS_DAYS, LAB_MILESTONES, labRank, scheduleFlags } from "./lab-schedule-flags.js";

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
  let plan;
  try {
    plan = await workflows.planFor({ workflowKey: key, startAt, rush, dueAt }, calendar);
  } catch (err) {
    // Routes map only LabOrderError: an unknown explicit key is a bad request, not a 500.
    if (err instanceof WorkflowError && err.code === "NOT_FOUND") throw new LabOrderError("INVALID", err.message);
    throw err;
  }
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

/** Saved plans for many lab orders at once: Map<orderId, plan>. */
export function schedulesOf(exec, labOrderIds) {
  return createWorkflowsService(exec).plansFor(LAB_RECORD_TYPE, labOrderIds);
}

/**
 * A staff-chosen workflow must be active. Inactive templates still resolve
 * for remakes of orders already planned on them (workflows service), but
 * cannot be picked for an existing order. An unknown key is left to the planner.
 */
export async function assertWorkflowActive(tx, workflowKey) {
  const template = await createWorkflowsService(tx).getWorkflow(workflowKey);
  if (template && template.active === false) throw new LabOrderError("INVALID", "That workflow is inactive.");
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
