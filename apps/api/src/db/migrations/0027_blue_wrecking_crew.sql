ALTER TYPE "public"."user_role" ADD VALUE 'lab';--> statement-breakpoint
CREATE TABLE "lab_departments" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_order_events" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"lab_order_id" varchar(128) NOT NULL,
	"type" varchar(20) NOT NULL,
	"from_value" varchar(128),
	"to_value" varchar(128),
	"by_user_id" varchar(128),
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_order_lines" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"lab_order_id" varchar(128) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"variant_id" varchar(128),
	"code" varchar(60),
	"name" text NOT NULL,
	"arch" varchar(20),
	"qty" integer DEFAULT 1 NOT NULL,
	"note_only" boolean DEFAULT false NOT NULL,
	"source_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_orders" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"order_number" integer NOT NULL,
	"source" varchar(20) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"client_user_id" varchar(128),
	"status" varchar(30) DEFAULT 'received' NOT NULL,
	"held_from" varchar(30),
	"department_id" varchar(128),
	"assignee_user_id" varchar(128),
	"due_date" date,
	"rush" boolean DEFAULT false NOT NULL,
	"rush_tier" varchar(40),
	"is_remake" boolean DEFAULT false NOT NULL,
	"remake_of_order_id" varchar(128),
	"hold_reason" text,
	"lab_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lab_departments_name_idx" ON "lab_departments" USING btree ("name");--> statement-breakpoint
CREATE INDEX "lab_order_events_order_idx" ON "lab_order_events" USING btree ("lab_order_id","at");--> statement-breakpoint
CREATE INDEX "lab_order_lines_order_idx" ON "lab_order_lines" USING btree ("lab_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_orders_order_number_idx" ON "lab_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_orders_source_idx" ON "lab_orders" USING btree ("source","source_id") WHERE is_remake = false;--> statement-breakpoint
CREATE INDEX "lab_orders_source_lookup_idx" ON "lab_orders" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "lab_orders_status_idx" ON "lab_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lab_orders_client_idx" ON "lab_orders" USING btree ("client_user_id");