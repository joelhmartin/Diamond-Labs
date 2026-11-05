ALTER TABLE "lab_orders" ADD COLUMN "merged_into_order_id" varchar(128);--> statement-breakpoint
CREATE INDEX "lab_orders_merged_into_idx" ON "lab_orders" USING btree ("merged_into_order_id");