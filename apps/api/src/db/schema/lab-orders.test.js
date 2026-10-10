import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { labOrders, labOrderLines, labOrderEvents, labDepartments, userRoleEnum } from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};

test("lab orders carry the production fields the board, ticket and doctor view read", () => {
  has(labOrders, [
    "id", "orderNumber", "source", "sourceId", "clientUserId", "status", "heldFrom", "departmentId",
    "assigneeUserId", "dueDate", "rush", "rushTier", "isRemake", "remakeOfOrderId", "holdReason", "labNotes",
    "version", "receivedAt", "startedAt", "shippedAt", "cancelledAt", "createdAt", "updatedAt",
  ]);
  assert.equal(labOrders.version.notNull, true);
  assert.equal(labOrders.clientUserId.notNull, false, "guest shop orders have no client");
  assert.equal(labOrders.orderNumber.notNull, true);
});

test("lines are a snapshot, events are the history, departments are the lab's own", () => {
  has(labOrderLines, ["id", "labOrderId", "position", "variantId", "code", "name", "arch", "qty", "noteOnly", "sourceLabel"]);
  has(labOrderEvents, ["id", "labOrderId", "type", "from", "to", "byUserId", "note", "at"]);
  has(labDepartments, ["id", "name", "position", "active"]);
});

test("the user role enum gains lab, appended (existing values keep their order)", () => {
  assert.deepEqual(userRoleEnum.enumValues, ["user", "doctor", "admin", "lab"]);
});

// drizzle's migrator applies every pending migration in ONE transaction, and
// Postgres can't USE an enum value added in the same transaction. So the
// migration that adds 'lab' must be the only SQL that mentions it.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

test("no migration uses the 'lab' role value — it is only ever added", () => {
  const hits = [];
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    for (const line of sql.split("\n")) if (line.includes("'lab'")) hits.push(`${f}: ${line.trim()}`);
  }
  assert.equal(hits.length, 1, `expected exactly the ADD VALUE line, got:\n${hits.join("\n")}`);
  assert.match(hits[0], /ALTER TYPE "public"\."user_role" ADD VALUE 'lab';/);
});

test("a remake may share its source; an original may not (partial unique index)", () => {
  // Pin to the migration that creates the index, not "the latest file".
  const file = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()
    .find((n) => readFileSync(join(migrationsDir, n), "utf8").includes("lab_orders_source_idx"));
  assert.ok(file, "a migration creates lab_orders_source_idx");
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX "lab_orders_source_idx" ON "lab_orders" USING btree \("source","source_id"\) WHERE is_remake = false/);
  assert.match(sql, /CREATE UNIQUE INDEX "lab_orders_order_number_idx"/);
});
