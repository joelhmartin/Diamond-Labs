ALTER TABLE "order_items" ADD COLUMN "price_source" varchar(10);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "priced_for_user_id" varchar(128);