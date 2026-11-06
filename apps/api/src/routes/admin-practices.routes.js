import { listPracticesQuerySchema, updatePracticeSchema, addPracticeMemberSchema, setPracticeMemberRoleSchema } from "@my-app/shared";
import { validate, validateQuery } from "../middleware/validate.js";
import * as practices from "../services/practices.service.js";
import { ADMIN } from "./admin-invoice.routes.js";

/**
 * Admin > Practices. Admin-only (the lab role sees no money and no groups).
 * `service` and `guard` are injectable so the route is tested without a database.
 */
export function createAdminPracticesRoutes({ service = practices, guard = ADMIN } = {}) {
  return async function adminPracticesRoutes(fastify) {
    // Paged list of client accounts; `memberUserId` narrows it to the practices a login belongs to.
    fastify.get("/admin/practices", { preHandler: [...guard, validateQuery(listPracticesQuerySchema)] }, async (request) => ({
      data: await service.listPractices(request.query),
    }));

    const actor = (request) => request.user?.id ?? null;

    // Lab account number: 409 ACCOUNT_NUMBER_TAKEN when another practice has it; empty clears it.
    fastify.patch("/admin/practices/:id", { preHandler: [...guard, validate(updatePracticeSchema)] }, async (request) => ({
      data: await service.setAccountNumber(request.params.id, request.body.accountNumber, actor(request)),
    }));

    // Practice staff: the active logins with a role. The owner is listed but cannot be changed.
    fastify.get("/admin/practices/:id/members", { preHandler: guard }, async (request) => ({
      data: await service.listMembers(request.params.id),
    }));

    fastify.post("/admin/practices/:id/members", { preHandler: [...guard, validate(addPracticeMemberSchema)] }, async (request, reply) =>
      reply.code(201).send({ data: await service.addMember(request.params.id, request.body, actor(request)) }));

    fastify.patch("/admin/practices/:id/members/:userId", { preHandler: [...guard, validate(setPracticeMemberRoleSchema)] }, async (request) => ({
      data: await service.setMemberRole(request.params.id, request.params.userId, request.body.role, actor(request)),
    }));

    fastify.delete("/admin/practices/:id/members/:userId", { preHandler: guard }, async (request) => ({
      data: await service.removeMember(request.params.id, request.params.userId, actor(request)),
    }));
  };
}

export default createAdminPracticesRoutes();
