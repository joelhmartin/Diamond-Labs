CREATE TABLE "statement_sends" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"client_user_id" varchar(128) NOT NULL,
	"month" char(7) NOT NULL,
	"closing_cents" integer,
	"status" varchar(10) NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" varchar(128),
	"run_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "statement_sends_client_month_idx" ON "statement_sends" USING btree ("client_user_id","month");