import {
  createOrganizationSchema, updateOrganizationSchema, organizationAccountsSchema, organizationAdminSchema, listOrganizationsQuerySchema,
} from "@my-app/shared";
import { validate, validateQuery } from "../../middleware/validate.js";
import { OrganizationError } from "./rules.js";

const STATUS = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

/** OrganizationError -> HTTP reply ({ status, body }); anything else is not ours (null). */
export function organizationErrorReply(err) {
  if (!(err instanceof OrganizationError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

const asArray = (g) => (Array.isArray(g) ? g : [g]);

/**
 * Admin CRUD routes for organizations. Returns a Fastify plugin; register it
 * under the prefix the app chooses (e.g. `/api/v1/admin/organizations`).
 *
 * @param {object} opts
 * @param {ReturnType<import("./service.js").createOrganizationsService>} opts.service
 * @param {Function|Function[]} opts.guard preHandler(s) applied to every route
 * @param {(ids: string[]) => Promise<{ id: string }[]>} opts.describeAccounts labels for the detail view; an id it does not return is treated as not existing
 * @param {(userId: string) => Promise<boolean>} [opts.userExists] optional check before granting an admin
 */
export function createOrganizationsRoutes({ service, guard, describeAccounts, userExists }) {
  const pre = asArray(guard);
  const accountsExist = async (ids) => new Set((await describeAccounts(ids)).map((a) => a.id));

  return async function organizationsRoutes(fastify) {
    const run = async (reply, fn, status = 200) => {
      try {
        return reply.code(status).send({ data: await fn() });
      } catch (err) {
        const r = organizationErrorReply(err);
        if (r) return reply.code(r.status).send(r.body);
        throw err;
      }
    };
    const actor = (request) => request.user?.id ?? null;

    fastify.get("/", { preHandler: [...pre, validateQuery(listOrganizationsQuerySchema)] }, (request, reply) =>
      run(reply, () => service.listOrganizations(request.query)));

    fastify.post("/", { preHandler: [...pre, validate(createOrganizationSchema)] }, (request, reply) =>
      run(reply, () => service.createOrganization({ ...request.body, byUserId: actor(request) }), 201));

    fastify.get("/:id", { preHandler: pre }, (request, reply) =>
      run(reply, async () => {
        const org = await service.getOrganization(request.params.id);
        return { ...org, accounts: await describeAccounts(org.accountIds) };
      }));

    fastify.patch("/:id", { preHandler: [...pre, validate(updateOrganizationSchema)] }, (request, reply) =>
      run(reply, () => service.updateOrganization(request.params.id, request.body, actor(request))));

    fastify.post("/:id/accounts", { preHandler: [...pre, validate(organizationAccountsSchema)] }, (request, reply) =>
      run(reply, () => service.addAccounts(request.params.id, request.body.accountIds, { byUserId: actor(request), exists: accountsExist })));

    fastify.delete("/:id/accounts/:accountId", { preHandler: pre }, (request, reply) =>
      run(reply, async () => {
        await service.removeAccount(request.params.id, request.params.accountId, { byUserId: actor(request) });
        return { ok: true };
      }));

    fastify.post("/:id/admins", { preHandler: [...pre, validate(organizationAdminSchema)] }, (request, reply) =>
      run(reply, async () => {
        await service.addAdmin(request.params.id, request.body.userId, { byUserId: actor(request), exists: userExists });
        return { ok: true };
      }));

    fastify.delete("/:id/admins/:userId", { preHandler: pre }, (request, reply) =>
      run(reply, async () => {
        await service.removeAdmin(request.params.id, request.params.userId, { byUserId: actor(request) });
        return { ok: true };
      }));
  };
}
