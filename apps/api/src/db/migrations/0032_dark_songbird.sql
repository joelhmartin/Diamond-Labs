ALTER TABLE "shipments" ALTER COLUMN "charge_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "charge_cents" DROP NOT NULL;