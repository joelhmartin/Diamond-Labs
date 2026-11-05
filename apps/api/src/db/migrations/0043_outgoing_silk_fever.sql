CREATE INDEX "invoice_lines_variant_idx" ON "invoice_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_paid_on_idx" ON "invoice_payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "invoice_payments_created_at_idx" ON "invoice_payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invoices_status_issued_idx" ON "invoices" USING btree ("status","issued_at");--> statement-breakpoint
CREATE INDEX "invoices_client_issued_idx" ON "invoices" USING btree ("client_user_id","issued_at");--> statement-breakpoint
CREATE INDEX "lab_order_events_at_idx" ON "lab_order_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "lab_order_events_type_at_idx" ON "lab_order_events" USING btree ("type","at");--> statement-breakpoint
CREATE INDEX "lab_orders_received_idx" ON "lab_orders" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "lab_orders_shipped_idx" ON "lab_orders" USING btree ("shipped_at") WHERE shipped_at is not null;--> statement-breakpoint
CREATE INDEX "lab_orders_client_received_idx" ON "lab_orders" USING btree ("client_user_id","received_at");--> statement-breakpoint
CREATE INDEX "lab_orders_open_due_idx" ON "lab_orders" USING btree ("due_date") WHERE status not in ('shipped', 'cancelled');--> statement-breakpoint
CREATE INDEX "lab_orders_department_idx" ON "lab_orders" USING btree ("department_id") WHERE department_id is not null;--> statement-breakpoint
CREATE INDEX "lab_orders_assignee_idx" ON "lab_orders" USING btree ("assignee_user_id") WHERE assignee_user_id is not null;--> statement-breakpoint
CREATE INDEX "shipments_shipped_idx" ON "shipments" USING btree ("shipped_at");