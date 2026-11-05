CREATE TABLE "workflow_assignments" (
	"subject_type" varchar(40) NOT NULL,
	"subject_id" varchar(128) NOT NULL,
	"workflow_key" varchar(60) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_assignments_subject_type_subject_id_pk" PRIMARY KEY("subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_plans" (
	"record_type" varchar(40) NOT NULL,
	"record_id" varchar(128) NOT NULL,
	"workflow_key" varchar(60),
	"workflow_name" varchar(120),
	"start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"direction" varchar(10) DEFAULT 'forward' NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_plans_record_type_record_id_pk" PRIMARY KEY("record_type","record_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(128) NOT NULL,
	"position" integer NOT NULL,
	"key" varchar(60) NOT NULL,
	"label" varchar(120) NOT NULL,
	"day_offset" integer NOT NULL,
	"milestone" varchar(60) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"total_days" integer DEFAULT 0 NOT NULL,
	"rush_workflow_key" varchar(60),
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workflow_plans_type_due_idx" ON "workflow_plans" USING btree ("record_type","due_date");--> statement-breakpoint
CREATE INDEX "workflow_stages_workflow_idx" ON "workflow_stages" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_key_idx" ON "workflows" USING btree ("key");