ALTER TABLE "invoice_lines" ADD COLUMN "legacy_description" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "legacy_patient" text;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "legacy_patient" text;