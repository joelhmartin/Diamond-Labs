ALTER TABLE "rx_cases" ALTER COLUMN "patient_first" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "patient_last" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "dob" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "contact_phone" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "ship_to" SET DATA TYPE text USING "ship_to"::text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "form_data" SET DATA TYPE text USING "form_data"::text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "device_options" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "device_options" SET DATA TYPE text USING "device_options"::text;--> statement-breakpoint
ALTER TABLE "rx_cases" ALTER COLUMN "device_options" DROP NOT NULL;
