CREATE TABLE "fetch_runs" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"entity" varchar(20) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"status" varchar(10) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"request_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"planned_ids" jsonb,
	"cursor" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"kind" varchar(30) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_check" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parity_reports" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"target" varchar(20) NOT NULL,
	"clean" boolean NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seazona_records" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"entity" varchar(20) NOT NULL,
	"seazona_id" varchar(128) NOT NULL,
	"payload" text NOT NULL,
	"last_modified" varchar(40),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetch_run_id" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "import_files_kind_sha_idx" ON "import_files" USING btree ("kind","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "seazona_records_entity_id_idx" ON "seazona_records" USING btree ("entity","seazona_id");--> statement-breakpoint
CREATE INDEX "seazona_records_run_idx" ON "seazona_records" USING btree ("fetch_run_id");