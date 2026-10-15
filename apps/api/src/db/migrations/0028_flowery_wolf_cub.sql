CREATE TABLE "invoice_lines" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(128) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" varchar(12) DEFAULT 'item' NOT NULL,
	"variant_id" varchar(128),
	"code" varchar(60),
	"description" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_cents" integer NOT NULL,
	"line_cents" integer NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"price_source" varchar(10) NOT NULL,
	"price_note" text,
	"lab_order_line_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"invoice_number" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"client_user_id" varchar(128),
	"lab_order_id" varchar(128),
	"legacy_seazona_invoice_id" varchar(128),
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone,
	"due_date" date,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" ALTER COLUMN "seazona_invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" ALTER COLUMN "applied_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "invoice_id" varchar(128);--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "applied_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "reference" varchar(100);--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "note" text;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_lab_order_idx" ON "invoices" USING btree ("lab_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_legacy_seazona_idx" ON "invoices" USING btree ("legacy_seazona_invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_user_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments" USING btree ("invoice_id");