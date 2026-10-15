import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { listClientInvoices } from "../services/billing/invoice-queries.js";
import { doctorInvoiceRow, doctorInvoiceView } from "../services/billing/invoice-views.js";
import { practiceUserIds } from "../services/billing/ledger.service.js";
import { canActOnInvoice } from "../services/billing/invoice-rules.js";
import { validateQuery } from "../middleware/validate.js";
import { statementQuerySchema } from "@my-app/shared";
import { invoiceDetailHandler, invoicePdfHandler, statementPdfHandler } from "./invoice-detail.handler.js";

/**
 * A doctor's invoices, from our tables (own-the-lab piece 3). A doctor sees
 * their practice's invoices: canActOnInvoice is the one rule (Spec correction
 * 6). A draft is not a bill and is never shown. Every response is built from
 * an allow-list (invoice-views.js).
 */
export const DOCTOR = [authenticate, requireApprovedDoctor];

/** May this doctor read (and so download or pay) this invoice? */
function mayRead(user, detail) {
  return detail.invoice.status !== "draft" && canActOnInvoice(user, detail.invoice, detail.client?.seazonaClientId ?? null);
}

export default async function invoiceRoutes(fastify) {
  fastify.get("/invoices", { preHandler: DOCTOR }, async (request) => ({
    data: (await listClientInvoices(await practiceUserIds(request.user))).map(doctorInvoiceRow),
  }));

  fastify.get("/invoices/:id", { preHandler: DOCTOR }, invoiceDetailHandler({ mayRead, view: doctorInvoiceView }));

  // Printable copy of the same invoice, same access rule: built on request, never stored.
  fastify.get("/invoices/:id/pdf", { preHandler: DOCTOR }, invoicePdfHandler({ mayRead }));

  // The doctor's monthly statement for their practice: no drafts, no patient names, never cached.
  // Registered beside /invoices/:id; Fastify matches the static path first.
  fastify.get("/invoices/statement.pdf", { preHandler: [...DOCTOR, validateQuery(statementQuerySchema)] }, statementPdfHandler({
    scope: async (request) => ({ clientUserId: request.user.id, clientUserIds: await practiceUserIds(request.user) }),
  }));
}
