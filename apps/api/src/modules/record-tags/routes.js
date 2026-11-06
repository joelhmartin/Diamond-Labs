import { tagApplySchema, tagDefinitionCreateSchema, tagDefinitionUpdateSchema } from "@my-app/shared";
import { validate } from "../../middleware/validate.js";
import * as defaultService from "./service.js";
import { TagError } from "./rules.js";

const STATUS = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

/** TagError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function tagErrorReply(err) {
  if (!(err instanceof TagError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

const asArray = (g) => (Array.isArray(g) ? g : [g]);

/**
 * Mounts tag definitions, bulk apply and per-user stars for every configured record type.
 *
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} opts
 * @param {Record<string, { exists: (ids: string[]) => Promise<Set<string>>, onChange?: Function, applyGuard?: Function|Function[] }>} opts.recordTypes
 *   `applyGuard`: extra preHandler(s) for that type's apply route, run after staffGuard
 *   (e.g. a type only admins may assign while staff may still read it)
 * @param {Function|Function[]} opts.staffGuard preHandler(s) for read, apply and star routes
 * @param {Function|Function[]} opts.adminGuard preHandler(s) for definition management
 * @param {object} [opts.service] defaults to ./service.js (tests pass a stub)
 * @param {(request, action, targetId, metadata) => void} [opts.audit] optional audit hook (ids/fields only)
 */
export async function recordTagRoutes(fastify, { recordTypes, staffGuard, adminGuard, service = defaultService, audit }) {
  const staff = asArray(staffGuard);
  const admin = asArray(adminGuard);

  // An unknown :recordType is a 404 before anything else runs.
  const knownType = async (request, reply) => {
    if (!Object.hasOwn(recordTypes, request.params.recordType)) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", status: 404, message: "Unknown record type." } });
    }
  };

  // A record type's own applyGuard, if it has one; stops at the first guard that answers.
  const typeApplyGuard = async (request, reply) => {
    for (const guard of asArray(recordTypes[request.params.recordType].applyGuard ?? [])) {
      await guard(request, reply);
      if (reply.sent) return reply;
    }
  };

  const run = async (reply, fn, status = 200) => {
    try {
      return reply.code(status).send({ data: await fn() });
    } catch (err) {
      const r = tagErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  };

  fastify.get("/tags/:recordType/definitions", { preHandler: [...staff, knownType] }, (request, reply) =>
    run(reply, () => service.listDefinitions(request.params.recordType, { includeInactive: request.query?.includeInactive === "true" })));

  fastify.post("/admin/tags/:recordType/definitions", { preHandler: [...admin, knownType, validate(tagDefinitionCreateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const tag = await service.createDefinition({ recordType: request.params.recordType, ...request.body });
      audit?.(request, "tag_definition.created", tag.id, { recordType: tag.recordType });
      return tag;
    }, 201));

  fastify.patch("/admin/tags/:recordType/definitions/:id", { preHandler: [...admin, knownType, validate(tagDefinitionUpdateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const tag = await service.updateDefinition(request.params.id, request.body, request.params.recordType);
      audit?.(request, "tag_definition.updated", tag.id, { recordType: tag.recordType, fields: Object.keys(request.body) });
      return tag;
    }));

  fastify.post("/tags/:recordType/apply", { preHandler: [...staff, knownType, typeApplyGuard, validate(tagApplySchema)] }, (request, reply) =>
    run(reply, () => {
      const { recordType } = request.params;
      const cfg = recordTypes[recordType];
      return service.applyTags({ recordType, ...request.body, byUserId: request.user?.id, exists: cfg.exists, onChange: cfg.onChange });
    }));

  fastify.put("/tags/:recordType/:recordId/star", { preHandler: [...staff, knownType] }, (request, reply) =>
    run(reply, () => service.setStar({ ...request.params, userId: request.user?.id, starred: true })));

  fastify.delete("/tags/:recordType/:recordId/star", { preHandler: [...staff, knownType] }, (request, reply) =>
    run(reply, () => service.setStar({ ...request.params, userId: request.user?.id, starred: false })));
}
