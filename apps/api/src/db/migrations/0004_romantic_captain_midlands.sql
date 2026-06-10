ALTER TABLE "products" ADD COLUMN "catalog_id" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "products_catalog_id_idx" ON "products" USING btree ("catalog_id");