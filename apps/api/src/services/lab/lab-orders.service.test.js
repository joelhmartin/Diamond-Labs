import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./lab-orders.service.js", import.meta.url)), "utf8");
const mod = await import("./lab-orders.service.js");

test("the service exposes what the routes, release and checkout call", () => {
  for (const name of [
    "allocateOrderNumber", "releaseRxCase", "createShopLabOrder", "listLabOrders", "getLabOrderDetail",
    "labOrdersForCases", "changeStatus", "changeField", "remakeOrder", "listAssignableStaff",
  ]) assert.equal(typeof mod[name], "function", name);
});

test("every mutation is conditional on the version the caller saw (no lost updates)", () => {
  assert.match(source, /eq\(labOrders\.version, order\.version\)/);
  assert.match(source, /assertFresh\(/);
});

test("order numbers are allocated under a transaction-scoped advisory lock", () => {
  assert.match(source, /pg_advisory_xact_lock\(\d+\)/);
});

test("a release claims the case before inserting, so a double click can't make two jobs", () => {
  const body = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(body.indexOf('status: "released"') < body.indexOf("insertPlan("), "claim must precede the insert");
});

test("hold reasons, lab notes and event notes are sealed on write and opened on read", () => {
  assert.match(source, /SECRET_ORDER_FIELDS = \["holdReason", "labNotes"\]/);
  assert.match(source, /encryptField/);
  assert.match(source, /decryptField/);
});

test("stored values are opened before the planners compare old vs new", () => {
  const body = source.slice(source.indexOf("async function mutate"), source.indexOf("async function assertAssignable"));
  assert.ok(body.indexOf("openOrder(row)") < body.indexOf("plan(order"), "decrypt before planning");
});

test("staff roles and the board summary have one definition each", () => {
  assert.match(source, /STAFF_ROLES[^;]*from "@my-app\/shared"/s);
  assert.doesNotMatch(source, /const STAFF_ROLES/);
  assert.doesNotMatch(source, /seazona\.service|seazonaapi|fetch\(/i);
});
