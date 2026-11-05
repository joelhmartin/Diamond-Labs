import { Readable } from "node:stream";
import { runExport, previewExport } from "./export.service.js";

const MAX_PREVIEW = 200;

/** The query minus paging; what is left are the source's params. */
function splitQuery(query = {}) {
  const { limit, offset, ...params } = query;
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), MAX_PREVIEW);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);
  return { params, limit: lim, offset: off };
}

/**
 * Fastify plugin factory for the export endpoints:
 *   GET <prefix>                              the registry listing
 *   GET <prefix>/:source/preview              one page plus total
 *   GET <prefix>/:source/download.:format     streamed file
 * `preHandler` guards every route. `audit({ actorId, sourceKey, formatKey,
 * params, rowCount })` runs once a download stream ends (or is abandoned).
 */
export function createExportsRoutes({ registry, db, preHandler, audit, pathPrefix = "/exports" }) {
  return async function exportsRoutes(fastify) {
    const opts = { preHandler };

    fastify.get(pathPrefix, opts, async () => ({ data: registry.list() }));

    fastify.get(`${pathPrefix}/:source/preview`, opts, async (request) => {
      const { params, limit, offset } = splitQuery(request.query);
      return { data: await previewExport({ registry, db, sourceKey: request.params.source, params, limit, offset }) };
    });

    fastify.get(`${pathPrefix}/:source/download.:format`, opts, async (request, reply) => {
      const { source: sourceKey, format: formatKey } = request.params;
      const run = await runExport({ registry, db, sourceKey, formatKey, params: request.query });

      async function* audited() {
        try {
          yield* run.stream;
        } finally {
          try {
            await audit?.({ actorId: request.user?.id ?? null, sourceKey, formatKey, params: run.params, rowCount: await run.countPromise });
          } catch (err) {
            request.log.error({ err: String(err?.message || err) }, "export audit failed");
          }
        }
      }

      reply.header("Content-Disposition", `attachment; filename="${run.filename}"`);
      reply.header("Cache-Control", "no-store");
      return reply.type(run.contentType).send(Readable.from(audited()));
    });
  };
}
