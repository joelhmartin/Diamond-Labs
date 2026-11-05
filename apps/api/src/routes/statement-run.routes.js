import { validate, validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, statementQuerySchema, statementRunSchema } from "@my-app/shared";
import { futureMonth, previewStatementRun, runStatements } from "../services/billing/statement-run.service.js";
import { ADMIN } from "./admin-invoice.routes.js";

const futureReply = (reply) =>
  reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "A statement month can't be after the current month." } });

/** Admin › Receivables › Monthly statements: preview and send the month's notices. Admin-only (R6, spec "Statements run"). */
export default async function statementRunRoutes(fastify) {
  fastify.get("/admin/statements/run", { preHandler: [...ADMIN, validateQuery(statementQuerySchema)] }, async (request, reply) => {
    if (futureMonth(request.query.month)) return futureReply(reply);
    return { data: await previewStatementRun(request.query.month) };
  });

  // Sends to everyone in the preview not yet sent and with an email (or only the ids given).
  // Idempotent per (client, month): a double-click or a retry sends nothing twice.
  fastify.post("/admin/statements/run", { preHandler: [...ADMIN, validate(statementRunSchema)] }, async (request, reply) => {
    if (futureMonth(request.body.month)) return futureReply(reply);
    return { data: await runStatements({ month: request.body.month, clientUserIds: request.body.clientUserIds, byUserId: request.user.id }) };
  });
}
