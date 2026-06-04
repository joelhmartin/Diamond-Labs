CREATE TABLE "invoice_payments" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"seazona_client_id" varchar(100),
	"seazona_invoice_id" varchar(128) NOT NULL,
	"invoice_number" varchar(50),
	"applied_amount" numeric(12, 2) NOT NULL,
	"transaction_id" varchar(100) NOT NULL,
	"seazona_payment_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invoice_payments_user_id_idx" ON "invoice_payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_seazona_invoice_id_idx" ON "invoice_payments" USING btree ("seazona_invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_transaction_id_idx" ON "invoice_payments" USING btree ("transaction_id");