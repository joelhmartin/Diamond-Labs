CREATE TYPE "public"."autopay_attempt_status" AS ENUM('skipped', 'would_charge', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."autopay_status" AS ENUM('active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."job_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_run_trigger" AS ENUM('schedule', 'manual', 'interval', 'cli');--> statement-breakpoint
CREATE TABLE "autopay_attempts" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"enrollment_id" varchar(128) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"job_run_id" varchar(128),
	"cycle_key" varchar(16) NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" "autopay_attempt_status" NOT NULL,
	"amount_attempted" numeric(12, 2),
	"amount_charged" numeric(12, 2),
	"transaction_id" varchar(100),
	"allocations" jsonb,
	"failure_reason" varchar(500),
	"dry_run" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopay_enrollments" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"day_of_month" integer NOT NULL,
	"payment_profile_id" varchar(100) NOT NULL,
	"status" "autopay_status" DEFAULT 'active' NOT NULL,
	"paused_reason" varchar(255),
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"min_amount_override" numeric(12, 2),
	"last_run_at" timestamp with time zone,
	"last_charged_at" timestamp with time zone,
	"created_by_user_id" varchar(128),
	"updated_by_user_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"trigger" "job_run_trigger" NOT NULL,
	"status" "job_run_status" DEFAULT 'running' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text,
	"actor_user_id" varchar(128)
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "source" varchar(32);--> statement-breakpoint
CREATE INDEX "autopay_attempts_enrollment_idx" ON "autopay_attempts" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "autopay_attempts_user_idx" ON "autopay_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "autopay_attempts_cycle_idx" ON "autopay_attempts" USING btree ("enrollment_id","cycle_key");--> statement-breakpoint
CREATE INDEX "autopay_attempts_job_run_idx" ON "autopay_attempts" USING btree ("job_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "autopay_enrollments_user_id_idx" ON "autopay_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "autopay_enrollments_enabled_day_idx" ON "autopay_enrollments" USING btree ("enabled","day_of_month");--> statement-breakpoint
CREATE INDEX "job_runs_job_name_idx" ON "job_runs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "job_runs_started_at_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "users_seazona_client_id_idx" ON "users" USING btree ("seazona_client_id");