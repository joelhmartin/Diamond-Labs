import { createInviteSchema, updateRoleSchema } from "@my-app/shared";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAccount } from "../middleware/require-account.js";
import { authorize } from "../middleware/authorize.js";
import * as membershipService from "../services/membership.service.js";
import * as invitationService from "../services/invitation.service.js";

export default async function memberRoutes(fastify) {
  // List members
  fastify.get("/:accountId/members", {
    preHandler: [authenticate, requireAccount, authorize("users:read")],
  }, async (request) => {
    const members = await membershipService.listMembers(request.params.accountId, request.query);
    return { data: members };
  });

  // Invite member
  fastify.post("/:accountId/members/invite", {
    preHandler: [authenticate, requireAccount, authorize("users:invite"), validate(createInviteSchema)],
  }, async (request) => {
    const invitation = await invitationService.createInvitation({
      accountId: request.params.accountId,
      invitedById: request.user.id,
      email: request.body.email,
      role: request.body.role,
    });
    return { data: invitation };
  });

  // Update member role
  fastify.patch("/:accountId/members/:memberId/role", {
    preHandler: [authenticate, requireAccount, authorize("roles:assign"), validate(updateRoleSchema)],
  }, async (request) => {
    const result = await membershipService.updateMemberRole(
      request.params.memberId,
      request.body.role,
      request.params.accountId,
    );
    return { data: result };
  });

  // Remove member
  fastify.delete("/:accountId/members/:memberId", {
    preHandler: [authenticate, requireAccount, authorize("users:remove")],
  }, async (request) => {
    await membershipService.removeMember(request.params.memberId, request.params.accountId);
    return { data: { message: "Member removed." } };
  });

  // Suspend member
  fastify.post("/:accountId/members/:memberId/suspend", {
    preHandler: [authenticate, requireAccount, authorize("users:update")],
  }, async (request) => {
    await membershipService.suspendMember(request.params.memberId, request.params.accountId);
    return { data: { message: "Member suspended." } };
  });

  // Reactivate member
  fastify.post("/:accountId/members/:memberId/reactivate", {
    preHandler: [authenticate, requireAccount, authorize("users:update")],
  }, async (request) => {
    await membershipService.reactivateMember(request.params.memberId, request.params.accountId);
    return { data: { message: "Member reactivated." } };
  });
}
