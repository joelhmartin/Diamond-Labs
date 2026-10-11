import {
  ERROR_CODES, STAFF_ROLES, labOrderListQuerySchema, labStatusChangeSchema, labFieldChangeSchema, labRemakeSchema,
  labDepartmentCreateSchema, labDepartmentUpdateSchema, groupRxAnswers, getRxForm,
} from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole, requireAdmin } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import * as labOrdersService from "../services/lab/lab-orders.service.js";
import * as departmentsService from "../services/lab/departments.service.js";
import { buildTicketModel } from "../services/lab/ticket-model.js";
import { renderTicketPdf } from "../services/lab/ticket-pdf.js";
import { labErrorReply } from "../services/lab/lab-errors.js";
import * as auditService from "../services/audit.service.js";

/**
 * Every lab route: signed in, and lab staff or admin. Pricing, payments,
 * users and the catalog editor stay admin-only in their own modules.
 */
export const STAFF = [authenticate, requireRole(...STAFF_ROLES)];

export default async function labRoutes(fastify) {
  async function run(reply, fn, status = 200) {
    try {
      const data = await fn();
      return reply.code(status).send({ data });
    } catch (err) {
      const r = labErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }

  // Audit metadata is ids/fields/versions only — never decrypted free text.
  const audit = (request, action, targetId, metadata, targetType = "lab_order") =>
    auditService.logSafe({ userId: request.user.id, action, targetType, targetId, metadata, ipAddress: request.ip });

  fastify.get("/lab/orders", { preHandler: [...STAFF, validateQuery(labOrderListQuerySchema)] }, async (request) => ({
    data: await labOrdersService.listLabOrders(request.query), // { orders, truncated }
  }));

  fastify.get("/lab/orders/:id", { preHandler: STAFF }, async (request, reply) => {
    let detail;
    try {
      detail = await labOrdersService.getLabOrderDetail(request.params.id);
    } catch (err) {
      // Decrypt failures land here — never echo the error (it can carry PHI context).
      request.log.error({ labOrderId: request.params.id, err: err.message }, "lab order detail failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to load order." } });
    }
    if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    audit(request, "lab_order.read", detail.order.id);
    return { data: detail };
  });

  // The work ticket: built on request from live data and never stored — it
  // carries the patient's name. Every print is audit-logged (ids only).
  fastify.get("/lab/orders/:id/ticket.pdf", { preHandler: STAFF }, async (request, reply) => {
    let pdf;
    let orderNumber;
    try {
      const detail = await labOrdersService.getLabOrderDetail(request.params.id);
      if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
      const answerGroups = detail.rxCase ? groupRxAnswers(getRxForm(detail.rxCase.formType), detail.rxCase.formData) : [];
      pdf = await renderTicketPdf(buildTicketModel(detail, { answerGroups, generatedAt: new Date() }));
      orderNumber = detail.order.orderNumber;
    } catch (err) {
      // Never echo the error: decrypt/render failures can carry PHI context.
      request.log.error({ labOrderId: request.params.id, err: err.message }, "work ticket render failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the work ticket." } });
    }
    audit(request, "lab_order.ticket_printed", request.params.id, { orderNumber });
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="work-ticket-${orderNumber}.pdf"`)
      .header("Cache-Control", "no-store")
      .send(pdf);
  });
  fastify.post("/lab/orders/:id/status", { preHandler: [...STAFF, validate(labStatusChangeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { order } = await labOrdersService.changeStatus(request.params.id, { ...request.body, byUserId: request.user.id });
      audit(request, "lab_order.status_changed", order.id, { to: order.status, version: order.version });
      return { id: order.id, status: order.status, version: order.version };
    }));

  fastify.patch("/lab/orders/:id", { preHandler: [...STAFF, validate(labFieldChangeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { order, changed } = await labOrdersService.changeField(request.params.id, { ...request.body, byUserId: request.user.id });
      if (changed) audit(request, "lab_order.updated", order.id, { field: request.body.field, version: order.version });
      return { id: order.id, version: order.version };
    }));

  fastify.post("/lab/orders/:id/remake", { preHandler: [...STAFF, validate(labRemakeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { labOrder } = await labOrdersService.remakeOrder(request.params.id, { ...request.body, byUserId: request.user.id });
      audit(request, "lab_order.remade", request.params.id, { remakeId: labOrder.id, orderNumber: labOrder.orderNumber });
      return { labOrder };
    }, 201));

  fastify.get("/lab/departments", { preHandler: STAFF }, async (request) => ({
    data: { departments: await departmentsService.listDepartments({ includeInactive: request.query?.includeInactive === "true" }) },
  }));

  fastify.get("/lab/staff", { preHandler: STAFF }, async () => ({
    data: { staff: await labOrdersService.listAssignableStaff() },
  }));

  fastify.post("/admin/lab/departments", { preHandler: [authenticate, requireAdmin, validate(labDepartmentCreateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const department = await departmentsService.createDepartment(request.body);
      audit(request, "lab_department.created", department?.id ?? null, { name: request.body.name }, "lab_department");
      return { department };
    }, 201));

  fastify.patch("/admin/lab/departments/:id", { preHandler: [authenticate, requireAdmin, validate(labDepartmentUpdateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const department = await departmentsService.updateDepartment(request.params.id, request.body);
      audit(request, "lab_department.updated", request.params.id, { fields: Object.keys(request.body) }, "lab_department");
      return { department };
    }));
}
