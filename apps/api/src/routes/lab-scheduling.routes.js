import { labWorkflowChangeSchema, labSchedulePreviewQuerySchema } from "@my-app/shared";
import { db } from "../config/database.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { calendarRoutes, calendarErrorReply } from "../modules/business-calendar/routes.js";
import { workflowRoutes, workflowErrorReply } from "../modules/workflows/routes.js";
import * as labOrdersService from "../services/lab/lab-orders.service.js";
import { defaultDueAt, LAB_MILESTONES } from "../services/lab/lab-scheduling.js";
import { STAFF } from "./lab.routes.js";
import { run, audit, labRouteErrorReply } from "./lab-route-helpers.js";

/**
 * Scheduling for the lab: the generic calendar and workflow route factories
 * under /scheduling/* (staff read, admin write), plus the lab's own due-date
 * preview and the per-order workflow switch. Audit metadata: ids, keys, dates.
 */
const ADMIN = [authenticate, requireAdmin];

const mapError = (err) => labRouteErrorReply(err) ?? workflowErrorReply(err) ?? calendarErrorReply(err);

export default async function labSchedulingRoutes(fastify) {
  await fastify.register(calendarRoutes, {
    db, readGuard: STAFF, writeGuard: ADMIN,
    onAudit: (request, action, targetId, metadata) => audit(request, action, targetId, metadata, "calendar"),
  });
  await fastify.register(workflowRoutes, {
    db, readGuard: STAFF, writeGuard: ADMIN, milestones: LAB_MILESTONES,
    onAudit: (request, action, targetId, metadata) => audit(request, action, targetId, metadata, "workflow"),
  });

  // A dry run of the due-date rules for staff order entry (piece 6): nothing is written.
  fastify.get("/lab/schedule/preview", { preHandler: [...STAFF, validateQuery(labSchedulePreviewQuerySchema)] }, (request, reply) =>
    run(reply, () => {
      const { variantIds, rush, workflowKey, requestedDueDate } = request.query;
      return defaultDueAt(db, { variantIds, rush, workflowKey, requestedDueDate });
    }, 200, mapError));

  fastify.post("/lab/orders/:id/workflow", { preHandler: [...STAFF, validate(labWorkflowChangeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { order } = await labOrdersService.changeWorkflow(request.params.id, { ...request.body, byUserId: request.user.id });
      audit(request, "lab_order.workflow_changed", order.id, {
        workflowKey: request.body.workflowKey, keepDueDate: request.body.keepDueDate, dueDate: order.dueDate ?? null, version: order.version,
      });
      return { id: order.id, version: order.version, dueDate: order.dueDate ?? null };
    }, 200, mapError));
}
