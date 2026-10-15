import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import {
  invoiceListQuerySchema, clientInvoicesQuerySchema, invoiceEditSchema, invoiceIssueSchema,
  invoiceVoidSchema, invoiceCreditSchema, manualPaymentSchema,
} from "@my-app/shared";
import * as actions from "../services/billing/invoice-actions.service.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";
import { listInvoices, listClientInvoices } from "../services/billing/invoice-queries.js";
import { adminInvoiceView } from "../services/billing/invoice-views.js";
import { invoiceDetailHandler } from "./invoice-detail.handler.js";

/** Billing is admin-only: the lab role sees no money. */
export const ADMIN = [authenticate, requireAdmin];

export default async function adminInvoiceRoutes(fastify) {
  async function run(reply, fn, status = 200) {
    try {
      return reply.code(status).send({ data: await fn() });
    } catch (err) {
      const r = invoiceErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }

  // Admin > Invoices (filters: status, needs-price, client, number).
  fastify.get("/admin/invoices", { preHandler: [...ADMIN, validateQuery(invoiceListQuerySchema)] }, async (request) => ({
    data: await listInvoices(request.query),
  }));

  fastify.get("/admin/invoices/:id", { preHandler: ADMIN }, invoiceDetailHandler({ mayRead: () => true, view: adminInvoiceView, withActivity: true }));

  // One client's invoices: the drawer, Record payment and the AR row link.
  fastify.get("/admin/clients/:userId/invoices", { preHandler: [...ADMIN, validateQuery(clientInvoicesQuerySchema)] }, async (request) => ({
    data: await listClientInvoices([request.params.userId], { includeDrafts: !request.query.open, openOnly: request.query.open }),
  }));

  // Draft editing: one edit per request, always with the version the editor saw.
  fastify.patch("/admin/invoices/:id/lines", { preHandler: [...ADMIN, validate(invoiceEditSchema)] }, (request, reply) =>
    run(reply, async () => {
      const inv = await actions.editDraft(request.params.id, { ...request.body, byUserId: request.user.id });
      return { id: inv.id, version: inv.version, totalCents: inv.totalCents };
    }));

  fastify.post("/admin/invoices/:id/issue", { preHandler: [...ADMIN, validate(invoiceIssueSchema)] }, (request, reply) =>
    run(reply, async () => {
      const inv = await actions.issueInvoice(request.params.id, { ...request.body, byUserId: request.user.id });
      return { id: inv.id, status: inv.status, version: inv.version, dueDate: inv.dueDate };
    }));

  fastify.post("/admin/invoices/:id/void", { preHandler: [...ADMIN, validate(invoiceVoidSchema)] }, (request, reply) =>
    run(reply, async () => {
      const inv = await actions.voidInvoice(request.params.id, { ...request.body, byUserId: request.user.id });
      return { id: inv.id, status: inv.status, version: inv.version };
    }));

  fastify.post("/admin/invoices/:id/credit", { preHandler: [...ADMIN, validate(invoiceCreditSchema)] }, (request, reply) =>
    run(reply, () => actions.recordCredit(request.params.id, { ...request.body, byUserId: request.user.id }), 201));

  // "Record payment" on a client: check, cash, ACH or other.
  fastify.post("/admin/clients/:userId/payments", { preHandler: [...ADMIN, validate(manualPaymentSchema)] }, (request, reply) =>
    run(reply, () => actions.recordManualPayment({ clientUserId: request.params.userId, ...request.body, byUserId: request.user.id }), 201));
}
