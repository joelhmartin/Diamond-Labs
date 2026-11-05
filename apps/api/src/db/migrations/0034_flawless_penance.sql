CREATE TABLE "client_price_lists" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"client_user_id" varchar(128) NOT NULL,
	"price_list_id" varchar(128) NOT NULL,
	"position" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"price_list_id" varchar(128) NOT NULL,
	"variant_id" varchar(128) NOT NULL,
	"price_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_price_lists_client_list_idx" ON "client_price_lists" USING btree ("client_user_id","price_list_id");--> statement-breakpoint
CREATE INDEX "client_price_lists_list_idx" ON "client_price_lists" USING btree ("price_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_list_variant_idx" ON "price_list_items" USING btree ("price_list_id","variant_id");--> statement-breakpoint
CREATE INDEX "price_list_items_variant_idx" ON "price_list_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_name_lower_idx" ON "price_lists" USING btree (lower("name"));