CREATE TABLE "shipment_events" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"shipment_id" varchar(128) NOT NULL,
	"status" varchar(20) NOT NULL,
	"description" text,
	"location" varchar(120),
	"occurred_at" timestamp with time zone NOT NULL,
	"source" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"carrier" varchar(20) NOT NULL,
	"service_code" varchar(40),
	"service_name" varchar(80),
	"carrier_shipment_id" varchar(80),
	"tracking_number" varchar(60),
	"status" varchar(20) DEFAULT 'label_created' NOT NULL,
	"charge_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"parcel" jsonb NOT NULL,
	"ship_to" jsonb NOT NULL,
	"ship_from" jsonb,
	"label_format" varchar(8),
	"label_data" text,
	"created_by_user_id" varchar(128),
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"last_tracked_at" timestamp with time zone,
	"tracking_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "shipment_id" varchar(128);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "shipment_id" varchar(128);--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipments_tracking_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "shipments_purchased_idx" ON "shipments" USING btree ("purchased_at");--> statement-breakpoint
CREATE INDEX "invoice_lines_shipment_idx" ON "invoice_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "lab_order_events_type_to_idx" ON "lab_order_events" USING btree ("type","to_value");--> statement-breakpoint
CREATE INDEX "lab_orders_shipment_idx" ON "lab_orders" USING btree ("shipment_id");