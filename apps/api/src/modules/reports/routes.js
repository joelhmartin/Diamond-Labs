/**
 * Fastify routes for the reports module, built by a factory so the host injects
 * its registry, database, auth hooks, audit sink and favorites store.
 *
 *   createReportRoutes({ registry, db, preHandler, audit, favorites, tz?, slots? })
 *     audit(request, action, targetId, metadata) records an event (no param values).
 */
import { ERROR_CODES } from "@my-app/shared";
import { runReport, inReadOnlyTx, ReportError, defaultRunSlots } from "./runner.js";
import { streamCsv } from "./csv.js";

export const LOOKUP_LIMIT = 20;
const LOOKUP_TIMEOUT_MS = 5000;

const HTTP = {
  NOT_FOUND: { status: 404, error: ERROR_CODES.NOT_FOUND, message: "Report not found." },
  FORBIDDEN: { status: 403, error: ERROR_CODES.FORBIDDEN, message: "You cannot view this report." },
  INVALID: { status: 400, error: { code: "VALIDATION_ERROR" } },
  UNAVAILABLE: { status: 409, error: ERROR_CODES.REPORT_UNAVAILABLE },
  TIMEOUT: { status: 503, error: ERROR_CODES.REPORT_TIMEOUT },
  BUSY: { status: 503, error: ERROR_CODES.REPORTS_BUSY },
};

/** Send a ReportError in the app's { error: { code, message } } shape; anything else is a logged 500. */
function sendFailure(request, reply, err) {
  const mapped = err instanceof ReportError ? HTTP[err.code] : null;
  if (!mapped) {
    // Log the message only: never the query, which carries report params.
    request.log.error({ err: String(err?.message || err) }, "[Reports] run failed");
    return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR } });
  }
  const message = err.code === "INVALID" ? err.message : mapped.message || mapped.error.message;
  const body = { code: mapped.error.code, message };
  if (err.field) body.field = err.field;
  return reply.code(mapped.status).send({ error: body });
}

export function createReportRoutes({ registry, db, preHandler, audit, favorites, tz = "UTC", slots = defaultRunSlots }) {
  return async function reportRoutes(fastify) {
    const guarded = { preHandler };

    // Attach the failure mapper to every handler below via a small wrapper.
    const handle = (fn) => async (request, reply) => {
      try {
        return await fn(request, reply);
      } catch (err) {
        return sendFailure(request, reply, err);
      }
    };

    fastify.get("/reports", guarded, handle(async (request) => {
      const stars = await favorites.listKeys(db, request.user.id);
      const reports = registry.listReports(request.user).map((r) => ({ ...r, favorite: stars.has(r.key) }));
      return { groups: registry.listGroups(), reports };
    }));

    // Fixed segment "lookups" has a different shape from /reports/:key/..., so the two never collide.
    fastify.get("/reports/lookups/:source", guarded, handle(async (request) => {
      const lookup = registry.getLookup(request.params.source);
      if (!lookup) throw new ReportError("NOT_FOUND", "Lookup not found");
      if (!registry.canView(request.user, lookup)) throw new ReportError("FORBIDDEN");
      const q = String(request.query?.q ?? "");
      const found = await inReadOnlyTx({ db, timeoutMs: LOOKUP_TIMEOUT_MS, slots }, (tx) => lookup.search(tx, q, request.user));
      return (found || []).slice(0, LOOKUP_LIMIT);
    }));

    fastify.get("/reports/:key/run", guarded, handle(async (request) => {
      return runReport({ registry, db, key: request.params.key, query: request.query || {}, actor: request.user, tz, slots });
    }));

    fastify.get("/reports/:key/export.csv", guarded, handle(async (request, reply) => {
      const key = request.params.key;
      return streamCsv({
        registry, db, key, query: request.query || {}, actor: request.user, reply, tz, slots,
        onExport: (paramNames) => audit(request, "report.exported", key, { params: paramNames }),
      });
    }));

    const setFavorite = (on) => handle(async (request) => {
      const def = registry.getReport(request.params.key);
      if (!def) throw new ReportError("NOT_FOUND", "Report not found");
      if (!registry.canView(request.user, def)) throw new ReportError("FORBIDDEN");
      await favorites.set(db, request.user.id, def.key, on);
      return { favorite: on };
    });
    fastify.put("/reports/:key/favorite", guarded, setFavorite(true));
    fastify.delete("/reports/:key/favorite", guarded, setFavorite(false));
  };
}
