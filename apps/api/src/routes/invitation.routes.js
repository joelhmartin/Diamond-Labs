import { authenticate } from "../middleware/authenticate.js";
import { requireAccount } from "../middleware/require-account.js";
import { authorize } from "../middleware/authorize.js";
import * as invitationService from "../services/invitation.service.js";

export default async function invitationRoutes(fastify) {
  // Accept invitation
  fastify.post("/:token/accept", {
    preHandler: [authenticate],
  }, async (request) => {
    const result = await invitationService.acceptInvitation(request.params.token, request.user.id);
    return { data: result };
  });

  // Decline invitation
  fastify.post("/:token/decline", {
    preHandler: [authenticate],
  }, async (request) => {
    await invitationService.declineInvitation(request.params.token, request.user.id);
    return { data: { message: "Invitation declined." } };
  });

  // Revoke invitation (requires account context)
  fastify.delete("/:invitationId", {
    preHandler: [authenticate, requireAccount, authorize("users:invite")],
  }, async (request) => {
    await invitationService.revokeInvitation(request.params.invitationId, request.account.id);
    return { data: { message: "Invitation revoked." } };
  });

  // Resend invitation
  fastify.post("/:invitationId/resend", {
    preHandler: [authenticate, requireAccount, authorize("users:invite")],
  }, async (request) => {
    const result = await invitationService.resendInvitation(request.params.invitationId, request.account.id);
    return { data: result };
  });
}
