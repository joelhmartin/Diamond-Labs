CREATE TABLE "organization_accounts" (
	"organization_id" varchar(128) NOT NULL,
	"account_id" varchar(128) NOT NULL,
	"added_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_admins" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"organization_id" varchar(128) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"added_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "statement_sends_client_month_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "account_number" varchar(100);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "legacy_client_key" varchar(100);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "account_id" varchar(128);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "account_id" varchar(128);--> statement-breakpoint
ALTER TABLE "rx_cases" ADD COLUMN "account_id" varchar(128);--> statement-breakpoint
ALTER TABLE "statement_sends" ADD COLUMN "subject_key" varchar(160) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_accounts" ADD CONSTRAINT "organization_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_admins" ADD CONSTRAINT "organization_admins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_accounts_account_idx" ON "organization_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "organization_accounts_org_idx" ON "organization_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_admins_org_user_idx" ON "organization_admins" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_admins_user_idx" ON "organization_admins" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_name_lower_idx" ON "organizations" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_account_number_idx" ON "accounts" USING btree ("account_number") WHERE "accounts"."account_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_legacy_client_key_idx" ON "accounts" USING btree ("legacy_client_key") WHERE "accounts"."legacy_client_key" is not null;--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "lab_orders_account_id_idx" ON "lab_orders" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rx_cases_account_id_idx" ON "rx_cases" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_sends_subject_client_month_idx" ON "statement_sends" USING btree ("subject_key","client_user_id","month");