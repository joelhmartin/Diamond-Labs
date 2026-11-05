CREATE TABLE "pickups" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"pickup_number" integer NOT NULL,
	"client_user_id" varchar(128) NOT NULL,
	"party_key" varchar(160) NOT NULL,
	"requested_by_user_id" varchar(128) NOT NULL,
	"earliest_date" date NOT NULL,
	"latest_date" date NOT NULL,
	"time_preference" varchar(8) NOT NULL,
	"box_count" integer NOT NULL,
	"notes" text,
	"address" jsonb,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"scheduled_date" date,
	"assignee_user_id" varchar(128),
	"completed_at" timestamp with time zone,
	"completed_by_user_id" varchar(128),
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"source" varchar(10) DEFAULT 'portal' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickups_pickup_number_unique" UNIQUE("pickup_number")
);
--> statement-breakpoint
CREATE INDEX "pickups_status_scheduled_idx" ON "pickups" USING btree ("status","scheduled_date");--> statement-breakpoint
CREATE INDEX "pickups_party_created_idx" ON "pickups" USING btree ("party_key","created_at" DESC NULLS LAST);