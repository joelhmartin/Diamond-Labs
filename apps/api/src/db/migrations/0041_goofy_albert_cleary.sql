CREATE TABLE "intakes" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"channel" varchar(40) DEFAULT 'upload' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"parser_key" varchar(40) DEFAULT 'generic' NOT NULL,
	"hints" text,
	"promoted_record_type" varchar(40),
	"promoted_record_id" varchar(128),
	"created_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" varchar(128),
	"decided_at" timestamp with time zone,
	"discard_reason" text
);
--> statement-breakpoint
CREATE INDEX "intakes_status_created_idx" ON "intakes" USING btree ("status","created_at");