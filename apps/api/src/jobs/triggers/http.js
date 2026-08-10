import { timingSafeEqual } from "node:crypto";
import { runJob, JobLockedError } from "../runner.js";
import { listJobs } from "../registry.js";
import { env } from "../../config/env.js";

// This secret is a static bearer credential presented over the open internet
// (this route has no ingress restriction — see module docstring). A plain
// `===` compares byte-by-byte and returns as soon as it finds a mismatch, so
// the response time leaks how many leading bytes an attacker's guess got
// right — exactly the primitive a remote timing attack uses to recover a
// static secret one byte at a time. `timingSafeEqual` compares in constant
// time regardless of where (or whether) the buffers differ.
//
// timingSafeEqual throws on a buffer-length mismatch, so lengths are checked
// first. That early return is not a reintroduced oracle: unlike a byte-value
// mismatch, a length mismatch reveals nothing about the secret's contents,
// and both branches below produce the exact same 401 response.
function secretMatches(presented, secret) {
  if (typeof presented !== "string") return false;
  const presentedBuf = Buffer.from(presented);
  const secretBuf = Buffer.from(secret);
  if (presentedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(presentedBuf, secretBuf);
}

/**
 * Shared guard for every /internal/jobs route. Sends the response itself
 * (503 if the trigger isn't configured, 401 if the secret doesn't match) and
 * returns false so the caller can bail out; returns true when the request
 * may proceed. Centralized so the routes below cannot drift out of sync on
 * which ones are actually guarded.
 */
function requireTriggerSecret(request, reply) {
  const secret = env.JOBS_TRIGGER_SECRET;
  if (!secret) {
    reply.code(503).send({ error: { code: "TRIGGER_DISABLED", message: "Job trigger is not configured." } });
    return false;
  }
  const presented = request.headers["x-jobs-trigger-secret"];
  if (!secretMatches(presented, secret)) {
    reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid trigger secret." } });
    return false;
  }
  return true;
}

/**
 * HTTP trigger for schedulers that invoke over the network.
 *
 * Guarded by a shared secret rather than session auth — the caller is Cloud
 * Scheduler, not a person. Mounted OUTSIDE /api/v1 under /internal so it is
 * never confused with the public API surface. This Fastify instance also
 * serves the public SPA with no ingress restriction in front of it, so
 * /internal/jobs/* is internet-reachable and the secret check below is the
 * only thing standing between it and anyone.
 */
export function registerJobTriggerRoutes(fastify) {
  fastify.post("/internal/jobs/:name/run", async (request, reply) => {
    if (!requireTriggerSecret(request, reply)) return;

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
      // runJob only throws for an unknown job name or JobLockedError (see
      // runner.js). Anything else is a genuine unexpected failure — it must
      // be logged and surfaced as a 500, not silently presented as 404.
      if (err.message?.startsWith("Unknown job")) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
      }
      request.log.error({ err, job: name }, "unexpected error running job trigger");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Unexpected error running job." } });
    }
  });

  fastify.get("/internal/jobs", async (request, reply) => {
    if (!requireTriggerSecret(request, reply)) return;
    return { data: { jobs: listJobs() } };
  });
}
