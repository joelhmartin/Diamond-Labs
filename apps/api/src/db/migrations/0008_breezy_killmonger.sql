CREATE TABLE "rx_code_overrides" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"map_key" varchar(200) NOT NULL,
	"seazona_code" varchar(60) NOT NULL,
	"seazona_product_id" varchar(128),
	"seazona_name" varchar(255),
	"note" text,
	"confirmed_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rx_code_overrides_map_key_idx" ON "rx_code_overrides" USING btree ("map_key");