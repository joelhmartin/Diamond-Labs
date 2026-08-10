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

function errorMessage(err) {
  return err?.stack || err?.message || String(err);
}

/**
 * Run a registered job, recording its lifecycle in `job_runs`.
 *
 * Never throws for a handler failure, nor for a `job_runs` write failure on
 * either side of it — a trigger (Cloud Scheduler, an admin click) must get a
 * recorded outcome, not a stack trace or an unhandled rejection. It DOES
 * throw for programmer errors: unknown job name, or a concurrent run of the
 * same job.
 *
 * The lock is kv_store-backed, and because config/redis.js is Postgres-backed
 * that makes it durable and multi-instance-safe — two overlapping invocations
 * cannot both sweep. The lock is released in `finally` so ANY failure below
 * the acquire (insert, handler, update) still frees it for the next run.
 */
export async function runJob(name, { dryRun = true, trigger = "manual", actorUserId = null, log } = {}) {
  const job = getJob(name);
  if (!job) throw new Error(`Unknown job "${name}"`);

  const lockKey = `job:lock:${name}`;
  const locked = await redis.set(lockKey, "1", "EX", JOB_LOCK_TTL, "NX");
  if (!locked) throw new JobLockedError(name);

  const runId = createId();

  try {
    try {
      // Known limitation, not reconciled here: if this process dies mid-run
      // (Cloud Run Job timeout, OOM, deploy) this row is left in "running"
      // forever — nothing ever transitions it to succeeded/failed. The lock
      // above is TTL-bounded so a later run still proceeds regardless, but a
      // stale "running" row will mislead any UI that reads job_runs to
      // answer "is this running right now?". The admin jobs page (a later
      // task) must not trust a "running" status by itself as proof of
      // liveness — cross-check against startedAt/the lock, or add sweeping.
      await db.insert(jobRuns).values({
        id: runId,
        jobName: name,
        trigger,
        status: "running",
        dryRun,
        actorUserId,
      });
    } catch (err) {
      // The insert is the very first DB write of the run. If it fails
      // (connection blip, pool exhaustion, transient Cloud SQL error) there
      // is no row to update either, so there's nothing left to record —
      // just report the failure and let the outer `finally` release the
      // lock. Propagating here would violate the "never throws for a
      // failure" contract just as much as a handler throw would.
      const message = errorMessage(err);
      log?.error?.({ err, job: name, runId }, "failed to record job start");
      return { runId, status: "failed", summary: null, error: message };
    }

    let summary;
    try {
      summary = (await job.handler({ dryRun, log, runId })) ?? {};
    } catch (err) {
      // The handler failed. The run's outcome is "failed" regardless of
      // whether we can also persist that fact — so recording failure here
      // must not replace or hide the original handler error.
      const message = errorMessage(err);
      try {
        await db
          .update(jobRuns)
          .set({ status: "failed", finishedAt: new Date(), error: message })
          .where(eq(jobRuns.id, runId));
      } catch (recordErr) {
        log?.error?.({ err: recordErr, job: name, runId }, "failed to record job failure");
      }
      log?.error?.({ err, job: name, runId }, "job failed");
      return { runId, status: "failed", summary: null, error: message };
    }

    // The handler succeeded. If the DB write that records that fails, the
    // run itself still succeeded — the outcome is what the handler did, not
    // whether we managed to write a row about it. Reporting "failed" here
    // would be actively dangerous for AutoPay: the sweep really did charge
    // people, and a caller seeing "failed" could be tempted to re-run it,
    // charging them again. So on a recording failure we still return
    // status "succeeded" with the real summary, plus an explicit
    // `recordingFailed` flag and a loud log line for follow-up.
    try {
      await db
        .update(jobRuns)
        .set({ status: "succeeded", finishedAt: new Date(), summary })
        .where(eq(jobRuns.id, runId));
      return { runId, status: "succeeded", summary, error: null };
    } catch (recordErr) {
      log?.error?.({ err: recordErr, job: name, runId }, "job succeeded but failed to record the result");
      return { runId, status: "succeeded", summary, error: null, recordingFailed: true };
    }
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}
