/**
 * Workflow stage targets (piece 7) for the task reports: each planned lab
 * order's saved plan (workflow_plans, record type "lab_order", made by
 * planFor when the order was received), read in the report's own transaction
 * and judged by piece 7's own rule (lab-scheduling `presentSchedule`: a stage
 * is reached when the order's milestone rank has passed it, late when its
 * target is before today and it is not reached; the order is behind when any
 * stage is late). Cancelled orders have no tasks. No patient, note or form
 * column is selected.
 */
import { sql } from "drizzle-orm";
import { labOrders, workflowPlans } from "../../../db/schema/index.js";
import { LAB_RECORD_TYPE, presentSchedule } from "../lab-scheduling.js";
import { clientName, rowsOf } from "./lab-metrics.js";
import { assigneeName, departmentName, isOpenOrder, orderJoins, statusBadge } from "./order-metrics.js";

/** A stage's state as a badge: done (reached), behind (late) or to do. */
export const STAGE_STATES = Object.freeze({ done: "Done", behind: "Behind", todo: "To do" });
const stateBadge = (t) => {
  const value = t.reached ? "done" : t.late ? "behind" : "todo";
  return { value, label: STAGE_STATES[value] };
};

/** The plan has a stage target on a day in `range` (jsonb: [{ key, label, milestone, targetAt }]). */
const hasTargetIn = (range) => sql`exists (
  select 1 from jsonb_array_elements(${workflowPlans.stages}) as st(s)
  where (st.s->>'targetAt') between ${range.from} and ${range.to})`;

const asStages = (v) => {
  const list = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(list) ? list : [];
};

/**
 * Planned, non-cancelled orders with their saved stages:
 * [{ labOrderId, orderNumber, client, status, heldFrom, dueDate, assigneeUserId, assignee, departmentId, department, stages }].
 * `range` keeps orders with a stage target in it; `openOnly` drops shipped orders.
 */
export async function plannedOrders(tx, { range = null, openOnly = false, assignee = null, department = null } = {}) {
  const where = [sql`${labOrders.status} <> 'cancelled'`];
  if (openOnly) where.push(isOpenOrder);
  if (range) where.push(hasTargetIn(range));
  if (assignee) where.push(sql`${labOrders.assigneeUserId} = ${assignee}`);
  if (department) where.push(sql`${labOrders.departmentId} = ${department}`);
  const raw = await rowsOf(tx, sql`
    select ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${clientName} as "client",
      ${labOrders.status} as "status", ${labOrders.heldFrom} as "heldFrom", to_char(${labOrders.dueDate}, 'YYYY-MM-DD') as "dueDate",
      ${labOrders.assigneeUserId} as "assigneeUserId", ${assigneeName} as "assignee",
      ${labOrders.departmentId} as "departmentId", ${departmentName} as "department", ${workflowPlans.stages} as "stages"
    from ${labOrders}
    join ${workflowPlans} on ${workflowPlans.recordType} = ${LAB_RECORD_TYPE} and ${workflowPlans.recordId} = ${labOrders.id}
    ${orderJoins}
    where ${sql.join(where, sql` and `)}
    order by ${labOrders.orderNumber}`);
  return raw.map((r) => ({
    labOrderId: r.labOrderId, orderNumber: r.orderNumber, client: r.client ?? null, status: r.status, heldFrom: r.heldFrom ?? null,
    dueDate: r.dueDate ?? null, assigneeUserId: r.assigneeUserId ?? null, assignee: r.assignee,
    departmentId: r.departmentId ?? null, department: r.department, stages: asStages(r.stages),
  }));
}

/**
 * One row per stage target (in `range` when given), judged as of `today`:
 * the order's fields plus { stageKey, stage, position, target, reached, late, behind, state, orderStatus }.
 */
export function stageTargets(orders, today, calendar, range = null) {
  const out = [];
  for (const o of orders) {
    const schedule = presentSchedule({ stages: o.stages }, { status: o.status, heldFrom: o.heldFrom, dueDate: o.dueDate }, today, calendar);
    if (!schedule) continue;
    schedule.stages.forEach((s, position) => {
      if (range && (s.targetAt < range.from || s.targetAt > range.to)) return;
      const t = { reached: s.reached, late: s.late };
      out.push({
        labOrderId: o.labOrderId, orderNumber: o.orderNumber, client: o.client, assigneeUserId: o.assigneeUserId, assignee: o.assignee,
        departmentId: o.departmentId, department: o.department, dueDate: o.dueDate, orderStatus: statusBadge(o.status),
        stageKey: s.key, stage: s.label, position, target: s.targetAt, ...t, behind: schedule.behind, state: stateBadge(t),
      });
    });
  }
  return out;
}

/** Group stage-target rows by `keyOf` into { due, done, behind } counts, keeping the first row's `fields`. */
export function countTargets(targets, keyOf, fields) {
  const groups = new Map();
  for (const t of targets) {
    const k = keyOf(t);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { ...fields(t), due: 0, done: 0, behind: 0 }));
    g.due += 1;
    if (t.reached) g.done += 1;
    if (t.late) g.behind += 1;
  }
  return [...groups.values()];
}

/** Text sort with nulls (Unassigned / No department) last. */
export const byName = (field, idField) => (a, b) =>
  (a[idField] == null) - (b[idField] == null) || String(a[field]).localeCompare(String(b[field]));

/** The row a task list shows for one stage target. */
export const taskRow = (t) => ({
  labOrderId: t.labOrderId, orderNumber: t.orderNumber, client: t.client, assignee: t.assignee, department: t.department,
  stage: t.stage, target: t.target, dueDate: t.dueDate, status: t.orderStatus, state: t.state,
});
