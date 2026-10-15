UPDATE "invoice_payments" SET "applied_cents" = round("applied_amount" * 100)::integer WHERE "applied_cents" IS NULL;
