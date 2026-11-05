import { validate, validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, receivablesQuerySchema, statementQuerySchema, accountCreditSchema } from "@my-app/shared";
import { paymentsPaused } from "../middleware/payments-paused.js";
import { recordAccountCredit } from "../services/billing/account-credit.service.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";
import { listReceivables } from "../services/billing/statements.service.js";
import { sendStatementFor } from "../services/billing/statement-run.service.js";
import { statementPdfHandler } from "./invoice-detail.handler.js";
import { ADMIN } from "./admin-invoice.routes.js";

/** Admin › Accounts receivable and client statements. Admin-only: the lab role sees no money. */
export default async function receivablesRoutes(fastify) {
  fastify.get("/admin/receivables", { preHandler: [...ADMIN, validateQuery(receivablesQuerySchema)] }, async (request) => ({
    data: await listReceivables(request.query),
  }));

  // Same handler as the doctor's own download; admin names the doctor in the URL.
  fastify.get("/admin/clients/:userId/statement.pdf", { preHandler: [...ADMIN, validateQuery(statementQuerySchema)] }, statementPdfHandler({
    scope: (request) => ({ clientUserId: request.params.userId }),
  }));

  // Account credit: one amount spread over the practice's open invoices. Reason is required and
  // sealed on the ledger rows; no email goes out.
  fastify.post("/admin/clients/:userId/account-credit", { preHandler: [...ADMIN, paymentsPaused, validate(accountCreditSchema)] }, async (request, reply) => {
    try {
      const data = await recordAccountCredit({ clientUserId: request.params.userId, ...request.body, byUserId: request.user.id });
      return reply.code(201).send({ data });
    } catch (err) {
      const r = invoiceErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  });

  // Staff-triggered: a short notice with the closing balance and a portal link. The balance is the
  // practice's, the same figure the doctor's own statement download shows (the admin PDF and AR rows
  // stay per user). Writes statement_sends; an explicit re-send overwrites sent_at.
  fastify.post("/admin/clients/:userId/statement/email", { preHandler: [...ADMIN, validate(statementQuerySchema)] }, async (request, reply) => {
    const out = await sendStatementFor(request.params.userId, request.body.month, { byUserId: request.user.id, ipAddress: request.ip });
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    if (out.status === "no_email") {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "This client has no email address on file." } });
    }
    return { data: { sent: out.status === "sent" } };
  });
}
