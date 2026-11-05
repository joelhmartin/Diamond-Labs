import { lookupQuerySchema } from "@my-app/shared";
import { validateQuery } from "../../middleware/validate.js";

/**
 * GET {path}?code=... → { data: { code, hits } }
 *
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} opts
 * @param {ReturnType<import("./registry.js").createLookupRegistry>} opts.registry
 * @param {string} [opts.path]
 * @param {Function|Function[]} opts.guard preHandler(s) for the route
 */
export async function barcodeLookupRoutes(fastify, { registry, path = "/lookup", guard }) {
  const guards = Array.isArray(guard) ? guard : [guard];
  fastify.get(path, { preHandler: [...guards, validateQuery(lookupQuerySchema)] }, async (request) => ({
    data: await registry.lookup(request.query.code),
  }));
}
