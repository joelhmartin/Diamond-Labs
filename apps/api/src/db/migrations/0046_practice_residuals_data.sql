-- Piece 11 residuals (own-the-lab follow-ups, task 3). Data only; the schema
-- change (account_id foreign keys) is the next, generated migration.
--
-- 1. A practice (is_client account) is managed by staff only, so a pending
--    invitation into one can never be accepted (assertNotClientAccount). Revoke
--    them: a status change, kept for the record. From now on the practice
--    backfill revokes them as it marks an account client
--    (invitation.service.js revokePendingInvitations).
UPDATE "invitations" SET "status" = 'revoked', "updated_at" = now()
WHERE "status" = 'pending'
  AND "account_id" IN (SELECT "id" FROM "accounts" WHERE "is_client" = true);--> statement-breakpoint
-- 2. Before account_id gains a foreign key to accounts: an account_id naming
--    no account (possible only through manual SQL; accounts are only ever
--    soft-deleted) is set to NULL. Both read the same today: in nobody's
--    client scope (scope checks fail closed), visible to staff only. NULL is
--    the documented "not yet mapped" state, which db:backfill-practices fills
--    from the owner's practice. Expected to match no row.
UPDATE "rx_cases" SET "account_id" = NULL
WHERE "account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = "rx_cases"."account_id");--> statement-breakpoint
UPDATE "lab_orders" SET "account_id" = NULL
WHERE "account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = "lab_orders"."account_id");--> statement-breakpoint
UPDATE "invoices" SET "account_id" = NULL
WHERE "account_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = "invoices"."account_id");
