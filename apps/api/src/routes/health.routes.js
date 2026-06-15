import { db } from "../config/database.js";
import { sql } from "drizzle-orm";
import * as seazonaService from "../services/seazona.service.js";

export default async function healthRoutes(fastify) {
  // Liveness: DB only, no external calls — safe to hit frequently / from probes.
  fastify.get("/health", async () => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      // db unreachable
    }

    return {
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          database: dbOk ? "connected" : "disconnected",
        },
      },
    };
  });

  // Deep check incl. a live Seazona probe. Separate from /health so a Seazona
  // outage never trips a liveness probe (which would kill the container), and so
  // the cost of the external call is only paid when explicitly requested. A
  // degraded Seazona returns HTTP 503 so external monitors can alert on the code.
  fastify.get("/health/seazona", async (request, reply) => {
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
