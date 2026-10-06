import { runJob, JobLockedError } from "../runner.js";
import { env } from "../../config/env.js";

const TICK_MS = 60 * 1000;

/**
 * In-process trigger for LOCAL DEVELOPMENT ONLY.
 *
 * Never registered in production: a setInterval inside the API breaks with more
 * than one Cloud Run instance and dies on cold start, which is not acceptable
 * for money movement. Production uses Cloud Scheduler -> Cloud Run Job.
 * Always dry-runs.
 */
export function startIntervalTrigger({ log } = {}) {
  if (env.NODE_ENV === "production") {
    throw new Error("The interval trigger must never run in production — use the Cloud Run Job.");
  }

  const timer = setInterval(async () => {
    try {
      await runJob("autopay", { dryRun: true, trigger: "interval", log });
    } catch (err) {
      if (!(err instanceof JobLockedError)) log?.error?.({ err }, "interval trigger failed");
    }
  }, TICK_MS);

  timer.unref?.();
  log?.info?.("AutoPay interval trigger started (dev only, dry-run)");
  return () => clearInterval(timer);
}
