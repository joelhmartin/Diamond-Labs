ALTER TABLE "approval_tokens" ADD COLUMN "seazona_client_id" varchar(100);--> statement-breakpoint
ALTER TABLE "approval_tokens" ADD COLUMN "seazona_client_label" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_seazona_client_id" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_seazona_account_number" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_seazona_link_approved_at" timestamp with time zone;