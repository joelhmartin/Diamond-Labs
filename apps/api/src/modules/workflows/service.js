import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { createId } from "../../lib/id.js";
import { workflows, workflowStages, workflowAssignments, workflowPlans } from "./schema.js";
import { WorkflowError } from "./errors.js";
import { validateTemplate, planWith, pickLongest } from "./rules.js";

const UNIQUE_VIOLATION = "23505";

const toStage = (r) => ({ key: r.key, label: r.label, milestone: r.milestone, dayOffset: r.dayOffset });

/** Templates (with ordered stages) matching `where`, by position then name. `exec` is a db or a transaction. */
async function loadTemplates(exec, where) {
  const base = exec.select().from(workflows);
  const rows = await (where ? base.where(where) : base).orderBy(asc(workflows.position), asc(workflows.name));
  if (!rows.length) return [];
  const stageRows = await exec
    .select()
    .from(workflowStages)
    .where(inArray(workflowStages.workflowId, rows.map((r) => r.id)))
    .orderBy(asc(workflowStages.position));
  const byWorkflow = new Map();
  for (const s of stageRows) {
    if (!byWorkflow.has(s.workflowId)) byWorkflow.set(s.workflowId, []);
    byWorkflow.get(s.workflowId).push(toStage(s));
  }
  return rows.map((r) => ({
    id: r.id, key: r.key, name: r.name, totalDays: r.totalDays, rushWorkflowKey: r.rushWorkflowKey ?? null,
    isDefault: r.isDefault, active: r.active, position: r.position, stages: byWorkflow.get(r.id) ?? [],
  }));
}

const toPlan = (r) => ({
  workflowKey: r.workflowKey ?? null, workflowName: r.workflowName ?? null, startDate: r.startDate,
  dueAt: r.dueDate, direction: r.direction, stages: Array.isArray(r.stages) ? r.stages : [],
});

/** Tier → drizzle condition matching any of its { type, id } subjects. */
function tierCondition(tier) {
  const byType = new Map();
  for (const s of [].concat(tier ?? [])) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type).push(s.id);
  }
  const parts = [...byType].map(([type, ids]) => and(eq(workflowAssignments.subjectType, type), inArray(workflowAssignments.subjectId, ids)));
  return parts.length ? or(...parts) : null;
}

/**
 * Templates, assignments and saved plans over one db. Template edits never touch
 * saved plans (they are snapshots); deactivated templates still resolve by key.
 */
export function createWorkflowsService(db) {
  const listWorkflows = ({ includeInactive = false } = {}) =>
    loadTemplates(db, includeInactive ? null : eq(workflows.active, true));

  const getWorkflow = async (key) => (await loadTemplates(db, eq(workflows.key, key)))[0] ?? null;

  async function saveWorkflow(template, { id = null } = {}) {
    validateTemplate(template);
    const dup = (key) => new WorkflowError("CONFLICT", `A workflow with the key "${key}" already exists.`);
    await db.transaction(async (tx) => {
      const clash = tx.select({ id: workflows.id }).from(workflows);
      const [taken] = await (id ? clash.where(and(eq(workflows.key, template.key), ne(workflows.id, id))) : clash.where(eq(workflows.key, template.key))).limit(1);
      if (taken) throw dup(template.key);
      const fields = {
        name: template.name, totalDays: template.totalDays, rushWorkflowKey: template.rushWorkflowKey ?? null,
        isDefault: !!template.isDefault, active: template.active !== false, updatedAt: new Date(),
      };
      let workflowId = id;
      try {
        if (id) {
          const [current] = await tx.select({ key: workflows.key }).from(workflows).where(eq(workflows.id, id)).limit(1);
          if (!current) throw new WorkflowError("NOT_FOUND", "That workflow no longer exists.");
          if (current.key !== template.key) throw new WorkflowError("INVALID", "A workflow's key cannot change.");
          await tx.update(workflows).set(fields).where(eq(workflows.id, id));
        } else {
          workflowId = createId();
          const [last] = await tx.select({ position: workflows.position }).from(workflows).orderBy(desc(workflows.position)).limit(1);
          await tx.insert(workflows).values({ id: workflowId, key: template.key, position: (last?.position ?? -1) + 1, ...fields });
        }
      } catch (err) {
        if (err?.code === UNIQUE_VIOLATION) throw dup(template.key);
        throw err;
      }
      if (fields.isDefault) await tx.update(workflows).set({ isDefault: false }).where(and(eq(workflows.isDefault, true), ne(workflows.id, workflowId)));
      await tx.delete(workflowStages).where(eq(workflowStages.workflowId, workflowId));
      await tx.insert(workflowStages).values(template.stages.map((s, position) => ({
        id: createId(), workflowId, position, key: s.key, label: s.label, dayOffset: s.dayOffset, milestone: s.milestone,
      })));
    });
    return getWorkflow(template.key);
  }

  async function setActive(ids, active) {
    if (!ids.length) return 0;
    const rows = await db.update(workflows).set({ active, updatedAt: new Date() }).where(inArray(workflows.id, ids)).returning({ id: workflows.id });
    return (rows ?? []).length;
  }

  async function planFor({ workflowKey = null, startAt, rush = false, dueAt = null }, calendar) {
    const all = workflowKey == null ? [] : await listWorkflows({ includeInactive: true });
    return planWith(Object.fromEntries(all.map((t) => [t.key, t])), { workflowKey, startAt, rush, dueAt }, calendar);
  }

  async function assignmentsFor(subjectType, subjectIds) {
    if (subjectIds && !subjectIds.length) return new Map();
    const where = [eq(workflowAssignments.subjectType, subjectType)];
    if (subjectIds) where.push(inArray(workflowAssignments.subjectId, subjectIds));
    const rows = await db.select().from(workflowAssignments).where(and(...where));
    return new Map(rows.map((r) => [r.subjectId, r.workflowKey]));
  }

  async function setAssignments(subjectType, subjectIds, workflowKey) {
    if (!subjectIds.length) return 0;
    if (workflowKey == null) {
      const gone = await db
        .delete(workflowAssignments)
        .where(and(eq(workflowAssignments.subjectType, subjectType), inArray(workflowAssignments.subjectId, subjectIds)))
        .returning({ id: workflowAssignments.subjectId });
      return (gone ?? []).length;
    }
    if (!(await getWorkflow(workflowKey))) throw new WorkflowError("NOT_FOUND", `Unknown workflow "${workflowKey}".`);
    const rows = [...new Set(subjectIds)].map((subjectId) => ({ subjectType, subjectId, workflowKey, updatedAt: new Date() }));
    await db.insert(workflowAssignments).values(rows).onConflictDoUpdate({
      target: [workflowAssignments.subjectType, workflowAssignments.subjectId],
      set: { workflowKey, updatedAt: new Date() },
    });
    return rows.length;
  }

  /** `tiers`: an array of tiers, each a list of { type, id }. First tier with an active assigned template wins (longest); else the active default; else null. */
  async function workflowForSubjects(tiers) {
    const active = await listWorkflows();
    const byKey = new Map(active.map((t) => [t.key, t]));
    for (const tier of tiers ?? []) {
      const where = tierCondition(tier);
      if (!where) continue;
      const rows = await db.select().from(workflowAssignments).where(where);
      const assigned = [...new Set(rows.map((r) => r.workflowKey))].map((k) => byKey.get(k)).filter(Boolean);
      if (assigned.length) return pickLongest(assigned);
    }
    return active.find((t) => t.isDefault) ?? null;
  }

  /** Upsert inside the caller's transaction `tx`. */
  async function savePlan(tx, recordType, recordId, plan) {
    const values = {
      workflowKey: plan.workflowKey ?? null, workflowName: plan.workflowName ?? null, startDate: plan.startDate,
      dueDate: plan.dueAt, direction: plan.direction, stages: plan.stages ?? [], updatedAt: new Date(),
    };
    await tx.insert(workflowPlans).values({ recordType, recordId, ...values }).onConflictDoUpdate({
      target: [workflowPlans.recordType, workflowPlans.recordId],
      set: values,
    });
  }

  async function plansFor(recordType, recordIds) {
    if (!recordIds?.length) return new Map();
    const rows = await db
      .select()
      .from(workflowPlans)
      .where(and(eq(workflowPlans.recordType, recordType), inArray(workflowPlans.recordId, recordIds)));
    return new Map(rows.map((r) => [r.recordId, toPlan(r)]));
  }

  return {
    planFor, listWorkflows, getWorkflow, saveWorkflow, setActive, assignmentsFor, setAssignments,
    workflowForSubjects, savePlan, plansFor,
  };
}
