import { listPracticesQuerySchema } from "@my-app/shared";
import { validateQuery } from "../middleware/validate.js";
import { listPractices } from "../services/practices.service.js";
import { ADMIN } from "./admin-invoice.routes.js";

/**
 * Admin > Practices. Admin-only (the lab role sees no money and no groups).
 * `service` and `guard` are injectable so the route is tested without a database.
 */
export function createAdminPracticesRoutes({ service = { listPractices }, guard = ADMIN } = {}) {
  return async function adminPracticesRoutes(fastify) {
    // Paged list of client accounts; `memberUserId` narrows it to the practices a login belongs to.
    fastify.get("/admin/practices", { preHandler: [...guard, validateQuery(listPracticesQuerySchema)] }, async (request) => ({
      data: await service.listPractices(request.query),
    }));
  };
}

export default createAdminPracticesRoutes();
