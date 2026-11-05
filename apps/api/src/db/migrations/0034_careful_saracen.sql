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
CREATE INDEX "notification_deliveries_created_idx" ON "notification_deliveries" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipients_event_channel_address_uq" ON "notification_recipients" USING btree ("event","channel","address");--> statement-breakpoint
CREATE INDEX "notifications_user_read_updated_idx" ON "notifications" USING btree ("user_id","read_at","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_collapse_unread_uq" ON "notifications" USING btree ("user_id","collapse_key") WHERE read_at is null;