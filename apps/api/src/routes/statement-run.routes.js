import { validate, validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, statementQuerySchema, statementRunSchema } from "@my-app/shared";
import { openMonth, previewStatementRun, runStatements } from "../services/billing/statement-run.service.js";
import { ADMIN } from "./admin-invoice.routes.js";

// The run (and its preview, to match the panel) covers closed months only; the single per-client send is not limited.
const openMonthReply = (reply) => reply.code(422).send({ error: ERROR_CODES.STATEMENT_MONTH_OPEN });

/** Admin › Receivables › Monthly statements: preview and send the month's notices. Admin-only (R6, spec "Statements run"). */
export default async function statementRunRoutes(fastify) {
  fastify.get("/admin/statements/run", { preHandler: [...ADMIN, validateQuery(statementQuerySchema)] }, async (request, reply) => {
    if (openMonth(request.query.month)) return openMonthReply(reply);
    return { data: await previewStatementRun(request.query.month) };
  });

  // Sends to everyone in the preview not yet sent and with an email (or only the ids given).
  // Idempotent per (client, month): a double-click or a retry sends nothing twice.
  fastify.post("/admin/statements/run", { preHandler: [...ADMIN, validate(statementRunSchema)] }, async (request, reply) => {
    if (openMonth(request.body.month)) return openMonthReply(reply);
    return { data: await runStatements({ month: request.body.month, clientUserIds: request.body.clientUserIds, byUserId: request.user.id }) };
  });
}
