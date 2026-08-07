import { runJob, JobLockedError } from "../runner.js";
import { listJobs } from "../registry.js";
import { env } from "../../config/env.js";

/**
 * HTTP trigger for schedulers that invoke over the network.
 *
 * Guarded by a shared secret rather than session auth — the caller is Cloud
 * Scheduler, not a person. Mounted OUTSIDE /api/v1 under /internal so it is
 * never confused with the public API surface.
 */
export function registerJobTriggerRoutes(fastify) {
  fastify.post("/internal/jobs/:name/run", async (request, reply) => {
    const secret = env.JOBS_TRIGGER_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: { code: "TRIGGER_DISABLED", message: "Job trigger is not configured." } });
    }
    const presented = request.headers["x-jobs-trigger-secret"];
    // Length-independent comparison is unnecessary here (the secret is not
    // user-derived), but a strict equality check on a missing header must fail.
    if (!presented || presented !== secret) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid trigger secret." } });
    }

    const name = String(request.params.name);
    // Dry run unless explicitly told otherwise, so a misconfigured scheduler
    // cannot charge anyone.
    const dryRun = request.body?.dryRun !== false;

    try {
      const result = await runJob(name, { dryRun, trigger: "schedule", log: request.log });
      return { data: result };
    } catch (err) {
      if (err instanceof JobLockedError) {
        return reply.code(409).send({ error: { code: "JOB_RUNNING", message: err.message } });
      }
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
    }
  });

  fastify.get("/internal/jobs", async () => ({ data: { jobs: listJobs() } }));
}
