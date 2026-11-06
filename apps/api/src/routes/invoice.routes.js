import { authenticate } from "../middleware/authenticate.js";
import { requireClientPortal } from "../middleware/require-role.js";
import { listClientInvoices } from "../services/billing/invoice-queries.js";
import { doctorInvoiceRow, doctorInvoiceView } from "../services/billing/invoice-views.js";
import { canActOnInvoice } from "../services/billing/invoice-rules.js";
import { clientScopeOf, requestedAccounts, requestedStatementSubject } from "../services/client-scope.js";
import { validateQuery } from "../middleware/validate.js";
import { statementDownloadQuerySchema } from "@my-app/shared";
import { invoiceDetailHandler, invoicePdfHandler, statementPdfHandler } from "./invoice-detail.handler.js";

/**
 * A client's invoices, from our tables, read through the login's practice
 * scope (services/client-scope.js): every practice the login may see, or the
 * one `?account=` names. An account outside the scope, and an invoice of a
 * practice outside it, read as 404. A draft is not a bill and is never shown.
 * Every response is built from an allow-list (invoice-views.js).
 */
export const CLIENT_PORTAL = [authenticate, requireClientPortal];

/** May this login read (and so download) this invoice? Paying also needs the account payable (verifyAllocations). */
export function clientMayRead(user, detail) {
  return detail.invoice.status !== "draft" && canActOnInvoice(clientScopeOf(user), detail.invoice);
}

export default async function invoiceRoutes(fastify) {
  // `?account=` absent or "all" → the whole scope; an id in scope → that practice; else 404 (requestedAccounts throws).
  fastify.get("/invoices", { preHandler: CLIENT_PORTAL }, async (request) => {
    const rows = (await listClientInvoices(requestedAccounts(clientScopeOf(request.user), request.query.account))).map(doctorInvoiceRow);
    return { data: rows, meta: { balanceCents: rows.reduce((sum, r) => sum + r.balanceCents, 0) } };
  });

  fastify.get("/invoices/:id", { preHandler: CLIENT_PORTAL }, invoiceDetailHandler({ mayRead: clientMayRead, view: doctorInvoiceView }));

  // Printable copy of the same invoice, same access rule: built on request, never stored.
  fastify.get("/invoices/:id/pdf", { preHandler: CLIENT_PORTAL }, invoicePdfHandler({ mayRead: clientMayRead }));

  // A practice's monthly statement, through the login's scope: `?account=<id>` in scope → that
  // practice's; absent/"all" → the login's one practice (422 "Choose a practice." with several);
  // `?account=organization:<orgId>` → the combined group statement, only for an active admin of
  // that active group with combinedStatement on. Anything else → 404. No drafts, no patient
  // names, never cached. Registered beside /invoices/:id; Fastify matches the static path first.
  fastify.get("/invoices/statement.pdf", { preHandler: [...CLIENT_PORTAL, validateQuery(statementDownloadQuerySchema)] }, statementPdfHandler({
    subject: (request) => requestedStatementSubject(clientScopeOf(request.user), request.query.account),
  }));
}
