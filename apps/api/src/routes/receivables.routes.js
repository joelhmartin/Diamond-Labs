import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, receivablesQuerySchema, statementQuerySchema } from "@my-app/shared";
import * as auditService from "../services/audit.service.js";
import { sendStatementNotice } from "../services/email.service.js";
import { listReceivables, statementFor } from "../services/billing/statements.service.js";
import { practiceUserIds } from "../services/billing/ledger.service.js";
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

  // Staff-triggered, never automatic: a short notice with the closing balance and a portal link.
  // The balance is the practice's, the same figure the doctor's own statement download shows
  // (the admin PDF and AR rows stay per user).
  fastify.post("/admin/clients/:userId/statement/email", { preHandler: [...ADMIN, validate(statementQuerySchema)] }, async (request, reply) => {
    const [target] = await db.select({ id: users.id, seazonaClientId: users.seazonaClientId }).from(users).where(eq(users.id, request.params.userId));
    if (!target) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    const out = await statementFor(request.params.userId, request.body.month, { clientUserIds: await practiceUserIds(target) });
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    if (!out.client.email) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "This client has no email address on file." } });
    }
    const sent = await sendStatementNotice({ to: out.client.email, monthLabel: out.model.period.label, closingCents: out.model.closingCents });
    auditService.logSafe({ userId: request.user.id, action: "statement.emailed", targetType: "user", targetId: request.params.userId, metadata: { month: request.body.month, closingCents: out.model.closingCents, sent }, ipAddress: request.ip });
    return { data: { sent } };
  });
}
