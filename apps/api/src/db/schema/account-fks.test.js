import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { accounts, invoices, labOrders, rxCases } from "./index.js";

// The lab glue tables' practice column points at accounts (piece 11 residual,
// ruling 41 reversed). RESTRICT: accounts are only ever soft-deleted, so a hard
// delete of a practice that has records is refused instead of orphaning them.
// Generic module tables (apps/api/src/modules/*) carry no such key: they stay host-agnostic.
test("rx_cases, lab_orders and invoices: account_id → accounts.id, on delete restrict", () => {
  for (const table of [rxCases, labOrders, invoices]) {
    const { name, foreignKeys } = getTableConfig(table);
    const fk = foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "account_id"));
    assert.ok(fk, `${name}.account_id has a foreign key`);
    assert.equal(getTableConfig(fk.reference().foreignTable).name, getTableConfig(accounts).name, name);
    assert.equal(fk.onDelete, "restrict", name);
  }
});

test("migration 0046 revokes (never deletes) pending invitations into practices and nulls orphan account ids before the keys", () => {
  const text = readFileSync(new URL("../migrations/0046_practice_residuals_data.sql", import.meta.url), "utf8");
  const statements = text.split("--> statement-breakpoint").map((s) => s.replace(/^--.*$/gm, "").trim());
  assert.match(statements[0], /^UPDATE "invitations" SET "status" = 'revoked'[\s\S]*"status" = 'pending'[\s\S]*"is_client" = true/);
  for (const [i, table] of [[1, "rx_cases"], [2, "lab_orders"], [3, "invoices"]]) {
    assert.match(statements[i], new RegExp(`^UPDATE "${table}" SET "account_id" = NULL[\\s\\S]*NOT EXISTS`), table);
  }
  assert.doesNotMatch(text, /\bDELETE\b/i);
});
