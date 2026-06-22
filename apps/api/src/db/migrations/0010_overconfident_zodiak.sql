ALTER TABLE "rx_cases" ALTER COLUMN "device_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "device_category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rx_cases" ADD COLUMN "form_type" varchar(40) DEFAULT 'digital' NOT NULL;--> statement-breakpoint
ALTER TABLE "rx_cases" ADD COLUMN "form_data" jsonb;