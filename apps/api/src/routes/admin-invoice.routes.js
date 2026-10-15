import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validateQuery } from "../middleware/validate.js";
import { invoiceListQuerySchema, clientInvoicesQuerySchema } from "@my-app/shared";
import { listInvoices, listClientInvoices } from "../services/billing/invoice-queries.js";
import { adminInvoiceView } from "../services/billing/invoice-views.js";
import { invoiceDetailHandler } from "./invoice-detail.handler.js";

/** Billing is admin-only: the lab role sees no money. */
export const ADMIN = [authenticate, requireAdmin];

export default async function adminInvoiceRoutes(fastify) {
  // Admin > Invoices (filters: status, needs-price, client, number).
  fastify.get("/admin/invoices", { preHandler: [...ADMIN, validateQuery(invoiceListQuerySchema)] }, async (request) => ({
    data: await listInvoices(request.query),
  }));

  fastify.get("/admin/invoices/:id", { preHandler: ADMIN }, invoiceDetailHandler({ mayRead: () => true, view: adminInvoiceView, withActivity: true }));

  // One client's invoices: the drawer, Record payment and the AR row link.
  fastify.get("/admin/clients/:userId/invoices", { preHandler: [...ADMIN, validateQuery(clientInvoicesQuerySchema)] }, async (request) => ({
    data: await listClientInvoices([request.params.userId], { includeDrafts: !request.query.open, openOnly: request.query.open }),
  }));
}
