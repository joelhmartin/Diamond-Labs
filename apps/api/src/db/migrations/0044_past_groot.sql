DROP INDEX "statement_sends_client_month_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "account_number" varchar(100);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "legacy_client_key" varchar(100);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "account_id" varchar(128);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "account_id" varchar(128);--> statement-breakpoint
ALTER TABLE "rx_cases" ADD COLUMN "account_id" varchar(128);--> statement-breakpoint
ALTER TABLE "statement_sends" ADD COLUMN "subject_key" varchar(160) DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_account_number_idx" ON "accounts" USING btree ("account_number") WHERE "accounts"."account_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_legacy_client_key_idx" ON "accounts" USING btree ("legacy_client_key") WHERE "accounts"."legacy_client_key" is not null;--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "lab_orders_account_id_idx" ON "lab_orders" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rx_cases_account_id_idx" ON "rx_cases" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_sends_subject_client_month_idx" ON "statement_sends" USING btree ("subject_key","client_user_id","month");