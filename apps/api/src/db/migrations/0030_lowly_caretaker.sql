-- Hand-added (the generator cannot express a backfill): rows the previous revision wrote between migrate and deploy have applied_amount only.
UPDATE "invoice_payments" SET "applied_cents" = round("applied_amount" * 100)::integer WHERE "applied_cents" IS NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" ALTER COLUMN "applied_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" DROP COLUMN "applied_amount";