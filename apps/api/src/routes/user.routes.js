import { updateProfileSchema, changePasswordSchema } from "@my-app/shared";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/authenticate.js";
import * as userService from "../services/user.service.js";

export default async function userRoutes(fastify) {
  // Get current user profile
  fastify.get("/me", { preHandler: [authenticate] }, async (request) => {
    const user = await userService.getProfile(request.user.id);
    return { data: user };
  });

  // Update profile
  fastify.patch("/me", {
    preHandler: [authenticate, validate(updateProfileSchema)],
  }, async (request) => {
    const user = await userService.updateProfile(request.user.id, request.body);
    return { data: user };
  });

  // Change password
  fastify.patch("/me/password", {
    preHandler: [authenticate, validate(changePasswordSchema)],
  }, async (request) => {
    await userService.changePassword(request.user.id, request.body);
    return { data: { message: "Password changed." } };
  });

  // List user's accounts
  fastify.get("/me/accounts", { preHandler: [authenticate] }, async (request) => {
    const accounts = await userService.getUserAccounts(request.user.id);
    return { data: accounts };
  });

  // List pending invitations
  fastify.get("/me/invitations", { preHandler: [authenticate] }, async (request) => {
    const invitations = await userService.getUserInvitations(request.user.id);
    return { data: invitations };
  });

  // List active sessions
  fastify.get("/me/sessions", { preHandler: [authenticate] }, async (request) => {
    const sessions = await userService.getUserSessions(request.user.id);
    return { data: sessions };
  });

  // Revoke a session
  fastify.delete("/me/sessions/:sessionId", { preHandler: [authenticate] }, async (request) => {
    await userService.revokeSession(request.params.sessionId, request.user.id);
    return { data: { message: "Session revoked." } };
  });
}
