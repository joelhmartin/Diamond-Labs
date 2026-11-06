import { validate, validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, receivablesQuerySchema, statementQuerySchema, accountCreditSchema } from "@my-app/shared";
import { paymentsPaused } from "../middleware/payments-paused.js";
import { recordAccountCredit } from "../services/billing/account-credit.service.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";
import { listReceivables } from "../services/billing/statements.service.js";
import { sendStatementFor } from "../services/billing/statement-run.service.js";
import { singlePracticeOf } from "../services/billing/statement-subjects.js";
import { statementPdfHandler } from "./invoice-detail.handler.js";
import { ADMIN } from "./admin-invoice.routes.js";

/** Admin › Accounts receivable and client statements. Admin-only: the lab role sees no money. */
export default async function receivablesRoutes(fastify) {
  fastify.get("/admin/receivables", { preHandler: [...ADMIN, validateQuery(receivablesQuerySchema)] }, async (request) => ({
    data: await listReceivables(request.query),
  }));

  // Same handler as the client's own download; admin names the practice in the URL.
  fastify.get("/admin/practices/:id/statement.pdf", { preHandler: [...ADMIN, validateQuery(statementQuerySchema)] }, statementPdfHandler({
    subject: (request) => ({ subject: "account", subjectId: request.params.id }),
  }));

  // Thin wrapper: the client's one practice (404 none, 422 more than one: use the practice's own).
  fastify.get("/admin/clients/:userId/statement.pdf", { preHandler: [...ADMIN, validateQuery(statementQuerySchema)] }, statementPdfHandler({
    subject: async (request) => ({ subject: "account", subjectId: await singlePracticeOf(request.params.userId) }),
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

  // Staff-triggered: a short notice with the practice's closing balance and a portal link, to every
  // approved doctor of the practice now. Writes statement_sends (per practice and recipient); an
  // explicit re-send overwrites sent_at.
  fastify.post("/admin/practices/:id/statement/email", { preHandler: [...ADMIN, validate(statementQuerySchema)] }, async (request, reply) => {
    const out = await sendStatementFor({ accountId: request.params.id }, request.body.month, { byUserId: request.user.id, ipAddress: request.ip });
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    const count = (status) => out.results.filter((r) => r.status === status).length;
    if (!out.results.length) return noEmail(reply, "This practice has no approved doctor to send to.");
    if (count("no_email") === out.results.length) return noEmail(reply, "No one at this practice has an email address on file.");
    return { data: { sent: count("sent"), failed: count("failed"), noEmail: count("no_email") } };
  });

  // Thin wrapper: the client's one practice's statement, to that client (404 none, 422 more than one).
  // A client the run would not send to (not an active, approved doctor) reads as 404, as before.
  fastify.post("/admin/clients/:userId/statement/email", { preHandler: [...ADMIN, validate(statementQuerySchema)] }, async (request, reply) => {
    const accountId = await singlePracticeOf(request.params.userId);
    const out = await sendStatementFor({ accountId, recipientUserIds: [request.params.userId] }, request.body.month, { byUserId: request.user.id, ipAddress: request.ip });
    const [result] = out?.results ?? [];
    if (!result) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    if (result.status === "no_email") return noEmail(reply, "This client has no email address on file.");
    return { data: { sent: result.status === "sent" } };
  });
}

const noEmail = (reply, message) => reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message } });
