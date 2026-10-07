CREATE TABLE "client_prices" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"client_user_id" varchar(128) NOT NULL,
	"variant_id" varchar(128) NOT NULL,
	"price_cents" integer NOT NULL,
	"source" varchar(12) NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" varchar(128),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_families" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" varchar(100),
	"image_url" text,
	"channel" varchar(10) DEFAULT 'shop' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"option_id" varchar(128) NOT NULL,
	"value" varchar(120) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"family_id" varchar(128) NOT NULL,
	"name" varchar(60) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variant_option_values" (
	"variant_id" varchar(128) NOT NULL,
	"option_value_id" varchar(128) NOT NULL,
	CONSTRAINT "product_variant_option_values_variant_id_option_value_id_pk" PRIMARY KEY("variant_id","option_value_id")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"family_id" varchar(128) NOT NULL,
	"code" varchar(60),
	"name" text NOT NULL,
	"base_price_cents" integer,
	"taxable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"catalog_id" varchar(100),
	"legacy_seazona_product_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "catalog_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_id" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX "client_prices_client_variant_idx" ON "client_prices" USING btree ("client_user_id","variant_id");--> statement-breakpoint
CREATE INDEX "client_prices_variant_idx" ON "client_prices" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_families_slug_idx" ON "product_families" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_option_values_option_idx" ON "product_option_values" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "product_options_family_idx" ON "product_options" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_value_idx" ON "product_variant_option_values" USING btree ("option_value_id");--> statement-breakpoint
CREATE INDEX "product_variants_family_idx" ON "product_variants" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_code_idx" ON "product_variants" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_catalog_id_idx" ON "product_variants" USING btree ("catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_legacy_idx" ON "product_variants" USING btree ("legacy_seazona_product_id");