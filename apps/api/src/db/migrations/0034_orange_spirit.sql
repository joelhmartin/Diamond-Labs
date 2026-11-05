CREATE TABLE "calendar_holidays" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"calendar_key" varchar(60) NOT NULL,
	"date" date NOT NULL,
	"label" varchar(80) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"timezone" varchar(60) DEFAULT 'UTC' NOT NULL,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"closed_weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacity_basis" varchar(10) DEFAULT 'none' NOT NULL,
	"capacity_by_weekday" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holidays_key_date_idx" ON "calendar_holidays" USING btree ("calendar_key","date");