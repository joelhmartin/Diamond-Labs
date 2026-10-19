import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { shipments, shipmentEvents, labOrders, invoiceLines } from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migration = (prefix) => {
  const f = readdirSync(migrationsDir).find((n) => n.startsWith(prefix) && n.endsWith(".sql"));
  assert.ok(f, `no ${prefix}* migration`);
  return readFileSync(join(migrationsDir, f), "utf8");
};

test("a shipment carries the carrier, money in cents, snapshots and the label", () => {
  has(shipments, [
    "id", "carrier", "serviceCode", "serviceName", "carrierShipmentId", "trackingNumber", "status", "chargeCents", "currency",
    "parcel", "shipTo", "shipFrom", "labelFormat", "labelData", "createdByUserId", "purchasedAt", "shippedAt", "deliveredAt",
    "voidedAt", "lastTrackedAt", "trackingError", "createdAt", "updatedAt",
  ]);
  assert.equal(shipments.chargeCents.columnType, "PgInteger");
  assert.equal(shipments.chargeCents.notNull, false, "null = no readable charge");
  assert.equal(shipments.status.default, "label_created");
  assert.equal(shipments.labelData.notNull, false, "a manual shipment has no label");
  assert.equal(shipments.trackingNumber.notNull, false, "a hand delivery has no tracking number");
});

test("shipment events are the append-only timeline", () => {
  has(shipmentEvents, ["id", "shipmentId", "status", "description", "location", "occurredAt", "source", "createdAt"]);
  assert.equal(shipmentEvents.shipmentId.notNull, true);
});

test("an order points at its current shipment; an invoice line remembers which shipment added it", () => {
  assert.equal(labOrders.shipmentId.notNull, false);
  assert.equal(invoiceLines.shipmentId.notNull, false);
});

test("0031 creates both tables and indexes the two new pointers", () => {
  const sql = migration("0031_");
  assert.match(sql, /CREATE TABLE "shipments"/);
  assert.match(sql, /CREATE TABLE "shipment_events"/);
  assert.match(sql, /ALTER TABLE "lab_orders" ADD COLUMN "shipment_id" varchar\(128\);/);
  assert.match(sql, /ALTER TABLE "invoice_lines" ADD COLUMN "shipment_id" varchar\(128\);/);
  assert.match(sql, /CREATE INDEX "lab_orders_shipment_idx"/);
  assert.match(sql, /CREATE INDEX "invoice_lines_shipment_idx"/);
  assert.match(sql, /CREATE INDEX "shipments_status_idx"/);
  assert.match(sql, /CREATE INDEX "lab_order_events_type_to_idx" ON "lab_order_events" USING btree \("type","to_value"\)/);
});
