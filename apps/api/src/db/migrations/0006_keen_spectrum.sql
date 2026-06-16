CREATE TABLE "rx_case_files" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"case_id" varchar(128) NOT NULL,
	"kind" varchar(30) NOT NULL,
	"original_name" varchar(255),
	"gcs_url" text NOT NULL,
	"content_type" varchar(120),
	"size" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rx_cases" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"case_number" varchar(32) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"seazona_client_id" varchar(100),
	"seazona_account_number" varchar(50),
	"patient_first" varchar(120) NOT NULL,
	"patient_last" varchar(120) NOT NULL,
	"dob" varchar(20),
	"gender" varchar(20),
	"first_device" varchar(40),
	"contact_phone" varchar(30),
	"ship_to" jsonb,
	"records_method" varchar(40),
	"physical_bite" varchar(40),
	"device_key" varchar(60) NOT NULL,
	"device_category" varchar(30) NOT NULL,
	"device_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due_date" varchar(30),
	"rush" boolean DEFAULT false NOT NULL,
	"rush_tier" varchar(40),
	"signature_url" text,
	"general_comments" text,
	"status" varchar(40) DEFAULT 'pending_approval' NOT NULL,
	"seazona_push_status" varchar(40),
	"seazona_order_id" varchar(128),
	"seazona_push_error" text,
	"payload_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rx_case_files_case_id_idx" ON "rx_case_files" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "rx_cases_user_id_idx" ON "rx_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rx_cases_status_idx" ON "rx_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rx_cases_case_number_idx" ON "rx_cases" USING btree ("case_number");