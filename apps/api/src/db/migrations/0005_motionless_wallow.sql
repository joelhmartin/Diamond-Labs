CREATE TABLE "order_items" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"order_id" varchar(128) NOT NULL,
	"catalog_id" varchar(100),
	"seazona_product_id" varchar(100),
	"name" text,
	"unit_price" numeric(12, 2) NOT NULL,
	"qty" integer NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(30),
	"shipping" jsonb NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"tax" numeric(12, 2) NOT NULL,
	"shipping_cost" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"transaction_id" varchar(100) NOT NULL,
	"auth_code" varchar(50),
	"status" varchar(30) DEFAULT 'paid' NOT NULL,
	"seazona_client_id" varchar(100),
	"seazona_order_id" varchar(128),
	"seazona_push_status" varchar(40) DEFAULT 'pending' NOT NULL,
	"seazona_push_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "orders" USING btree ("email");--> statement-breakpoint
CREATE INDEX "orders_transaction_id_idx" ON "orders" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "orders_seazona_push_status_idx" ON "orders" USING btree ("seazona_push_status");