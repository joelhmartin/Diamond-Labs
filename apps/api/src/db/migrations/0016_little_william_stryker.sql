CREATE TABLE "rx_case_lines" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"case_id" varchar(128) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"seazona_code" varchar(60),
	"seazona_product_id" varchar(128),
	"name" varchar(255),
	"arch" varchar(20),
	"map_key" varchar(200),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"origin" varchar(20) DEFAULT 'auto' NOT NULL,
	"note_only" boolean DEFAULT false NOT NULL,
	"source_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rx_case_lines_case_id_idx" ON "rx_case_lines" USING btree ("case_id");