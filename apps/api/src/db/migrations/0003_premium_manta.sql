CREATE TABLE "products" (
	"seazona_product_id" varchar(100) PRIMARY KEY NOT NULL,
	"code" varchar(100),
	"name" text,
	"taxable" boolean DEFAULT false NOT NULL,
	"price" numeric(12, 2),
	"image_url" text,
	"description" text,
	"purchasable" boolean DEFAULT false NOT NULL,
	"category" varchar(100),
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "products_code_idx" ON "products" USING btree ("code");--> statement-breakpoint
CREATE INDEX "products_purchasable_idx" ON "products" USING btree ("purchasable");