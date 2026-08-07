import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { jobRuns } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { getJob } from "./registry.js";

const JOB_LOCK_TTL = 60 * 60; // 1h — longer than any sweep should take

export class JobLockedError extends Error {
  constructor(name) {
    super(`Job "${name}" is already running`);
    this.name = "JobLockedError";
  }
}

/**
 * Run a registered job, recording its lifecycle in `job_runs`.
 *
 * Never throws for a handler failure — a trigger (Cloud Scheduler, an admin
 * click) should get a recorded outcome, not a stack trace. It DOES throw for
 * programmer errors: unknown job, or a concurrent run.
 *
 * The lock is kv_store-backed, and because config/redis.js is Postgres-backed
 * that makes it durable and multi-instance-safe — two overlapping invocations
 * cannot both sweep.
 */
export async function runJob(name, { dryRun = true, trigger = "manual", actorUserId = null, log } = {}) {
  const job = getJob(name);
  if (!job) throw new Error(`Unknown job "${name}"`);

  const lockKey = `job:lock:${name}`;
  const locked = await redis.set(lockKey, "1", "EX", JOB_LOCK_TTL, "NX");
  if (!locked) throw new JobLockedError(name);

  const runId = createId();
  await db.insert(jobRuns).values({
    id: runId,
    jobName: name,
    trigger,
    status: "running",
    dryRun,
    actorUserId,
  });

  try {
    const summary = (await job.handler({ dryRun, log, runId })) ?? {};
    await db
      .update(jobRuns)
      .set({ status: "succeeded", finishedAt: new Date(), summary })
      .where(eq(jobRuns.id, runId));
    return { runId, status: "succeeded", summary, error: null };
  } catch (err) {
    const message = err?.stack || err?.message || String(err);
    await db
      .update(jobRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(jobRuns.id, runId));
    log?.error?.({ err, job: name }, "job failed");
    return { runId, status: "failed", summary: null, error: message };
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}
