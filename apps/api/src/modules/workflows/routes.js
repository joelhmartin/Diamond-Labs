import {
  workflowTemplateSchema, workflowActiveSchema, workflowAssignmentsSchema, workflowAssignmentsQuerySchema, workflowPreviewSchema,
} from "@my-app/shared";
import { validate, validateQuery } from "../../middleware/validate.js";
import { getCalendar } from "../business-calendar/service.js";
import { WorkflowError } from "./errors.js";
import { createWorkflowsService } from "./service.js";

const STATUS = { INVALID: 400, NOT_FOUND: 404, CONFLICT: 409 };

/** WorkflowError → { status, body } in the repo's `{ error: { code, status, message } }` shape; anything else is not ours (null). */
export function workflowErrorReply(err) {
  if (!(err instanceof WorkflowError)) return null;
  const status = STATUS[err.code] ?? 400;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

async function run(reply, fn, status = 200) {
  try {
    return reply.code(status).send({ data: await fn() });
  } catch (err) {
    const r = workflowErrorReply(err);
    if (r) return reply.code(r.status).send(r.body);
    throw err;
  }
}

/**
 * Workflow templates, assignments and a plan preview.
 *
 *   GET  {prefix}                          { workflows, milestones }        (readGuard)
 *   POST {prefix}                          create a whole template          (writeGuard)
 *   PUT  {prefix}/:id                      replace a whole template         (writeGuard)
 *   POST {prefix}/active                   { ids, active }                  (writeGuard)
 *   GET  {prefix}/assignments?subjectType  [{ subjectId, workflowKey }]     (readGuard)
 *   PUT  {prefix}/assignments              { subjectType, subjectIds, workflowKey | null } (writeGuard)
 *   POST {prefix}/preview                  a plan using the stored calendar (readGuard)
 *
 * The host passes `db`, the guards (preHandler functions or arrays), the
 * `milestones` ([{ value, label }]) a stage may name, and
 * `onAudit(request, action, targetId, metadata)` which runs after each write
 * (metadata: ids and keys only).
 */
export async function workflowRoutes(fastify, options = {}) {
  const {
    db = fastify.db, prefix = "/scheduling/workflows", readGuard, writeGuard, calendarKey = "default", milestones = [], onAudit,
  } = options;
  if (!db) throw new Error("workflowRoutes needs a `db`.");
  if (!readGuard || !writeGuard) throw new Error("workflowRoutes needs a readGuard and a writeGuard.");
  const read = [].concat(readGuard);
  const write = [].concat(writeGuard);
  const service = createWorkflowsService(db);
  const allowed = new Set(milestones.map((m) => m.value));
  const audit = async (request, action, targetId, metadata) => { if (onAudit) await onAudit(request, action, targetId, metadata); };

  const checkMilestones = (template) => {
    const unknown = template.stages.find((s) => !allowed.has(s.milestone));
    if (unknown) throw new WorkflowError("INVALID", `Stage "${unknown.key}" uses an unknown milestone "${unknown.milestone}".`);
  };

  fastify.get(prefix, { preHandler: read }, (_request, reply) =>
    run(reply, async () => ({ workflows: await service.listWorkflows({ includeInactive: true }), milestones })));

  fastify.post(prefix, { preHandler: [...write, validate(workflowTemplateSchema)] }, (request, reply) =>
    run(reply, async () => {
      checkMilestones(request.body);
      const saved = await service.saveWorkflow(request.body);
      await audit(request, "workflow.create", saved.id, { key: saved.key, totalDays: saved.totalDays });
      return saved;
    }, 201));

  fastify.post(`${prefix}/active`, { preHandler: [...write, validate(workflowActiveSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { ids, active } = request.body;
      const count = await service.setActive(ids, active);
      await audit(request, "workflow.active", "bulk", { ids, active, count });
      return { count };
    }));

  fastify.get(`${prefix}/assignments`, { preHandler: [...read, validateQuery(workflowAssignmentsQuerySchema)] }, (request, reply) =>
    run(reply, async () => {
      const map = await service.assignmentsFor(request.query.subjectType);
      return { assignments: [...map].map(([subjectId, workflowKey]) => ({ subjectId, workflowKey })) };
    }));

  fastify.put(`${prefix}/assignments`, { preHandler: [...write, validate(workflowAssignmentsSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { subjectType, subjectIds, workflowKey } = request.body;
      const count = await service.setAssignments(subjectType, subjectIds, workflowKey);
      await audit(request, "workflow.assign", subjectType, { subjectType, subjectIds, workflowKey, count });
      return { count };
    }));

  fastify.post(`${prefix}/preview`, { preHandler: [...read, validate(workflowPreviewSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { workflowKey, startAt, rush, dueAt } = request.body;
      const calendar = await getCalendar(db, calendarKey);
      return service.planFor({ workflowKey, startAt: startAt ? new Date(startAt) : new Date(), rush, dueAt: dueAt ?? null }, calendar);
    }));

  fastify.put(`${prefix}/:id`, { preHandler: [...write, validate(workflowTemplateSchema)] }, (request, reply) =>
    run(reply, async () => {
      checkMilestones(request.body);
      const saved = await service.saveWorkflow(request.body, { id: request.params.id });
      await audit(request, "workflow.update", saved.id, { key: saved.key, totalDays: saved.totalDays });
      return saved;
    }));
}
