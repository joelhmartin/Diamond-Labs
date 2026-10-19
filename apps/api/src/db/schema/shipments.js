import { pgTable, varchar, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// Shipments (own-the-lab piece 4): one bought label (UPS / FedEx) or one
// staff-recorded hand-off (manual). GENERIC: nothing here knows a lab order.
// lab_orders.shipment_id points here (one shipment can carry several orders);
// invoice_lines.shipment_id marks the shipping line a shipment added.
//
// `status` is the normalised vocabulary in packages/shared shipping.js; the
// carrier code tables live in services/shipping/carriers/carrier-status.js.
// Money is integer cents (what the carrier billed us).
//
// shipTo / labelData hold a practice or customer address, never a patient:
// labels carry order numbers only. No DB foreign keys (repo convention).

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const shipments = pgTable("shipments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // ups | fedex | manual
  carrier: varchar("carrier", { length: 20 }).notNull(),
  serviceCode: varchar("service_code", { length: 40 }),
  // "UPS Ground", "FedEx 2Day", or the carrier name staff typed (manual).
  serviceName: varchar("service_name", { length: 80 }),
  // What void needs: UPS ShipmentIdentificationNumber / FedEx master tracking number.
  carrierShipmentId: varchar("carrier_shipment_id", { length: 80 }),
  trackingNumber: varchar("tracking_number", { length: 60 }),
  status: varchar("status", { length: 20 }).notNull().default("label_created"),
  chargeCents: integer("charge_cents").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  // { preset, weightOz, lengthIn, widthIn, heightIn }
  parcel: jsonb("parcel").notNull(),
  // Address snapshots (packages/shared shipping.schema.js shippingAddressSchema).
  shipTo: jsonb("ship_to").notNull(),
  shipFrom: jsonb("ship_from"),
  // gif | png | zpl; null for a manual shipment.
  labelFormat: varchar("label_format", { length: 8 }),
  // Base64, exactly as the carrier returned it.
  labelData: text("label_data"),
  createdByUserId: varchar("created_by_user_id", { length: 128 }),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  // Set once, when the box left (Mark shipped or the first carrier movement).
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  lastTrackedAt: timestamp("last_tracked_at", { withTimezone: true }),
  // The carrier's last tracking error text (retried on the next sync).
  trackingError: text("tracking_error"),
  ...stamps,
}, (t) => [
  index("shipments_status_idx").on(t.status),
  index("shipments_tracking_idx").on(t.trackingNumber),
  index("shipments_purchased_idx").on(t.purchasedAt),
]);

/** Append-only; drives the shipment timeline. source: carrier | staff */
export const shipmentEvents = pgTable("shipment_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  shipmentId: varchar("shipment_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 120 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source: varchar("source", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("shipment_events_shipment_idx").on(t.shipmentId, t.occurredAt)]);
