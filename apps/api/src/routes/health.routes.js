import { authenticate } from "../middleware/authenticate.js";
import * as seazonaService from "../services/seazona.service.js";

export default async function healthRoutes(fastify) {
  // Public liveness only. Returns a bare 200 with no internal detail — the old
  // response leaked DB connectivity state, which is recon for an attacker and
  // isn't needed by the GCP health check (a 200 is the whole contract). No DB or
  // external call here, so a dependency blip never trips the probe (which would
  // otherwise kill the container).
  fastify.get("/health", async () => {
    return { status: "ok" };
  });

  // Deep check incl. a live Seazona probe. AUTHENTICATED — upstream reachability
  // is internal recon and must not be public. Separate from /health so a Seazona
  // outage never trips a liveness probe (which would kill the container), and so
  // the cost of the external call is only paid when explicitly requested. A
  // degraded Seazona returns HTTP 503 so external monitors can alert on the code.
  fastify.get("/health/seazona", { preHandler: [authenticate] }, async (request, reply) => {
    const seazona = await seazonaService.checkHealth();
    if (!seazona.ok) {
      // Distinct, alertable token — the GCP log-based metric matches `[Seazona]`.
      request.log.error({ status: seazona.status }, "[Seazona] health probe FAILED — billing API unreachable");
      reply.code(503);
    }
    return {
      data: {
        status: seazona.ok ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        services: {
          seazona: seazona.ok ? "connected" : "unreachable",
          seazonaStatus: seazona.status,
        },
      },
    };
  });
}
