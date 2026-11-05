CREATE TABLE "adjustment_reasons" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"applies_to" varchar(10) NOT NULL,
	"label" varchar(80) NOT NULL,
	"discount_percent" integer,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_order_line_materials" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"lab_order_id" varchar(128) NOT NULL,
	"lab_order_line_id" varchar(128) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"material" varchar(120) NOT NULL,
	"lot_number" varchar(60),
	"created_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_files" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"record_type" varchar(40) NOT NULL,
	"record_id" varchar(128) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"original_name" varchar(500) NOT NULL,
	"storage_url" varchar(1000) NOT NULL,
	"content_type" varchar(200),
	"size" integer NOT NULL,
	"created_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_stars" (
	"record_type" varchar(40) NOT NULL,
	"record_id" varchar(128) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_stars_record_type_record_id_user_id_pk" PRIMARY KEY("record_type","record_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "record_tags" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"record_type" varchar(40) NOT NULL,
	"record_id" varchar(128) NOT NULL,
	"tag_id" varchar(128) NOT NULL,
	"created_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_definitions" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"record_type" varchar(40) NOT NULL,
	"label" varchar(40) NOT NULL,
	"color" varchar(20) DEFAULT 'slate' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "patient_name" text;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "pan_number" varchar(30);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "delivery_method" varchar(20);--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "enclosures" text;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN "remake_reason_id" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX "adjustment_reasons_label_idx" ON "adjustment_reasons" USING btree (lower("label"));--> statement-breakpoint
CREATE INDEX "lab_order_line_materials_order_idx" ON "lab_order_line_materials" USING btree ("lab_order_id");--> statement-breakpoint
CREATE INDEX "lab_order_line_materials_material_idx" ON "lab_order_line_materials" USING btree ("material");--> statement-breakpoint
CREATE INDEX "record_files_record_idx" ON "record_files" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_tags_record_tag_idx" ON "record_tags" USING btree ("record_type","record_id","tag_id");--> statement-breakpoint
CREATE INDEX "record_tags_tag_idx" ON "record_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_definitions_type_label_idx" ON "tag_definitions" USING btree ("record_type",lower("label"));--> statement-breakpoint
CREATE INDEX "lab_orders_pan_idx" ON "lab_orders" USING btree ("pan_number");