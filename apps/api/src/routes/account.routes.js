import { createAccountSchema, updateAccountSchema } from "@my-app/shared";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAccount } from "../middleware/require-account.js";
import { authorize } from "../middleware/authorize.js";
import * as accountService from "../services/account.service.js";

export default async function accountRoutes(fastify) {
  // Create a new account
  fastify.post("/", {
    preHandler: [authenticate, validate(createAccountSchema)],
  }, async (request) => {
    const account = await accountService.createAccount({
      ...request.body,
      userId: request.user.id,
    });
    return { data: account };
  });

  // Get account details
  fastify.get("/:accountId", {
    preHandler: [authenticate, requireAccount, authorize("settings:read")],
  }, async (request) => {
    return { data: request.account };
  });

  // Update account
  fastify.patch("/:accountId", {
    preHandler: [authenticate, requireAccount, authorize("settings:update"), validate(updateAccountSchema)],
  }, async (request) => {
    const account = await accountService.updateAccount(request.params.accountId, request.body);
    return { data: account };
  });

  // Delete account (owner only)
  fastify.delete("/:accountId", {
    preHandler: [authenticate, requireAccount],
  }, async (request, reply) => {
    await accountService.deleteAccount(request.params.accountId, request.user.id);
    return { data: { message: "Account deleted." } };
  });
}
