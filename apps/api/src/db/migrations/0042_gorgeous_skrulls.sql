CREATE TABLE "message_participants" (
	"thread_id" varchar(128) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"side" varchar(10) NOT NULL,
	"last_read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_participants_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"record_type" varchar(40),
	"record_id" varchar(128),
	"party_key" varchar(160) NOT NULL,
	"subject" text,
	"created_by_user_id" varchar(128) NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_message_side" varchar(10) NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"thread_id" varchar(128) NOT NULL,
	"author_user_id" varchar(128) NOT NULL,
	"author_side" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"event" varchar(80) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"user_id" varchar(128),
	"target_masked" varchar(40),
	"status" varchar(20) NOT NULL,
	"reason" varchar(200),
	"record_type" varchar(40),
	"record_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" varchar(128) NOT NULL,
	"event" varchar(80) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_event_channel_pk" PRIMARY KEY("user_id","event","channel")
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"event" varchar(80) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"address" varchar(320) NOT NULL,
	"label" varchar(80),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"event" varchar(80) NOT NULL,
	"record_type" varchar(40),
	"record_id" varchar(128),
	"title" varchar(160) NOT NULL,
	"link" varchar(300),
	"collapse_key" varchar(200) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE INDEX "message_threads_party_last_idx" ON "message_threads" USING btree ("party_key","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_threads_record_idx" ON "message_threads" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "message_threads_completed_last_idx" ON "message_threads" USING btree ("completed_at","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_created_idx" ON "notification_deliveries" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipients_event_channel_address_uq" ON "notification_recipients" USING btree ("event","channel","address");--> statement-breakpoint
CREATE INDEX "notifications_user_read_updated_idx" ON "notifications" USING btree ("user_id","read_at","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_collapse_unread_uq" ON "notifications" USING btree ("user_id","collapse_key") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "pickups_status_scheduled_idx" ON "pickups" USING btree ("status","scheduled_date");--> statement-breakpoint
CREATE INDEX "pickups_party_created_idx" ON "pickups" USING btree ("party_key","created_at" DESC NULLS LAST);