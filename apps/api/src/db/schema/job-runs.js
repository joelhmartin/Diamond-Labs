import { pgTable, varchar, boolean, timestamp, jsonb, text, pgEnum, index } from "drizzle-orm/pg-core";

export const jobRunStatusEnum = pgEnum("job_run_status", ["running", "succeeded", "failed"]);
export const jobRunTriggerEnum = pgEnum("job_run_trigger", ["schedule", "manual", "interval", "cli"]);

export const jobRuns = pgTable("job_runs", {
  id: varchar("id", { length: 128 }).primaryKey(),
  jobName: varchar("job_name", { length: 100 }).notNull(),
  trigger: jobRunTriggerEnum("trigger").notNull(),
  status: jobRunStatusEnum("status").notNull().default("running"),
  dryRun: boolean("dry_run").notNull().default(true),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summary: jsonb("summary"),
  error: text("error"),
  actorUserId: varchar("actor_user_id", { length: 128 }),
}, (table) => [
  index("job_runs_job_name_idx").on(table.jobName),
  index("job_runs_started_at_idx").on(table.startedAt),
]);
