import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { MAX_ORDERS_PER_SHIPMENT, trackingUrl } from "@my-app/shared";
import { db } from "../../config/database.js";
import { labOrders, labOrderEvents, orders, users } from "../../db/schema/index.js";
import { loadClient } from "../billing/statements.service.js";
import { carrierRegistry } from "../shipping/carrier-registry.js";
import { listShipments, SHIPMENT_LIST_LIMIT } from "../shipping/shipments.service.js";
import { shipToFromClient, shipToFromShopOrder } from "./lab-shipping-rules.js";

/** Lab-order reads for shipping. Allow-listed columns only: no notes, no patient data. */
const ORDER_COLS = {
  id: labOrders.id, orderNumber: labOrders.orderNumber, status: labOrders.status, source: labOrders.source,
  sourceId: labOrders.sourceId, clientUserId: labOrders.clientUserId, isRemake: labOrders.isRemake,
  shipmentId: labOrders.shipmentId, version: labOrders.version,
};

export function loadOrders(ids, database = db) {
  return database.select(ORDER_COLS).from(labOrders).where(inArray(labOrders.id, ids));
}

export function ordersOnShipment(shipmentId, database = db) {
  return database.select(ORDER_COLS).from(labOrders).where(eq(labOrders.shipmentId, shipmentId)).orderBy(asc(labOrders.orderNumber));
}

async function shopOrderFor(labOrder, database) {
  if (labOrder?.source !== "shop_order") return null;
  const [s] = await database
    .select({ id: orders.id, orderNumber: orders.orderNumber, email: orders.email, phone: orders.phone, shipping: orders.shipping })
    .from(orders)
    .where(eq(orders.id, labOrder.sourceId));
  return s ?? null;
}

/**
 * What the Ship form opens with: the order, a ship-to (the shop checkout's
 * address, else the doctor's profile), the profile's delivery hint, the
 * client's other ready, unlabelled orders (ship together) and each carrier's
 * enabled state.
 */
export async function shipContext(labOrderId, database = db) {
  const [order] = await loadOrders([labOrderId], database);
  if (!order) return null;
  const client = order.clientUserId ? await loadClient(order.clientUserId, database) : null;
  const shop = await shopOrderFor(order, database);
  const siblings = order.clientUserId
    ? await database
        .select({ id: labOrders.id, orderNumber: labOrders.orderNumber, source: labOrders.source, isRemake: labOrders.isRemake })
        .from(labOrders)
        .where(and(
          eq(labOrders.clientUserId, order.clientUserId), eq(labOrders.status, "ready_to_ship"),
          isNull(labOrders.shipmentId), ne(labOrders.id, order.id),
        ))
        .orderBy(asc(labOrders.orderNumber))
        .limit(MAX_ORDERS_PER_SHIPMENT - 1)
    : [];
  return {
    order: { id: order.id, orderNumber: order.orderNumber, status: order.status, source: order.source, shipmentId: order.shipmentId },
    shipTo: shipToFromShopOrder(shop) ?? shipToFromClient(client),
    deliveryHint: client?.deliveryMethod || client?.deliveryNotes ? { method: client.deliveryMethod, notes: client.deliveryNotes } : null,
    siblings,
    carriers: carrierRegistry().status(),
  };
}

/**
 * Who gets the shipped email: the client doctor, else the shop order's email (a guest).
 * `shopOrderNumber` is the customer's own order number (DOL-…) for a shop-order box.
 */
export async function shipmentRecipient(boxed, database = db) {
  const first = boxed[0];
  if (!first) return null;
  const shop = await shopOrderFor(first, database);
  const email = first.clientUserId ? (await loadClient(first.clientUserId, database))?.email : shop?.email;
  return email ? { email, shopOrderNumber: shop?.orderNumber ?? null } : null;
}

/**
 * Admin › Shipments rows: the shipment summary, the orders it carried (from
 * the "shipment" link events, so a voided label still shows what it was for),
 * who bought it, the public tracking link, and which actions apply. The ship-to
 * is reduced to a name.
 */
export async function listShipmentsForLab(filters = {}, database = db) {
  const rows = await listShipments(filters, database);
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await database
        .selectDistinct({ shipmentId: labOrderEvents.to, labOrderId: labOrders.id, orderNumber: labOrders.orderNumber })
        .from(labOrderEvents)
        .innerJoin(labOrders, eq(labOrders.id, labOrderEvents.labOrderId))
        .where(and(eq(labOrderEvents.type, "shipment"), inArray(labOrderEvents.to, ids)))
        .orderBy(asc(labOrders.orderNumber))
    : [];
  const userIds = [...new Set(rows.map((r) => r.createdByUserId).filter(Boolean))];
  const names = new Map(
    userIds.length ? (await database.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]) : [],
  );
  const byShipment = new Map();
  for (const l of links) {
    if (!byShipment.has(l.shipmentId)) byShipment.set(l.shipmentId, []);
    byShipment.get(l.shipmentId).push({ id: l.labOrderId, orderNumber: l.orderNumber });
  }
  return {
    shipments: rows.map(({ shipTo, ...s }) => ({
      ...s,
      shipToName: shipTo?.company || shipTo?.name || null,
      trackingUrl: trackingUrl(s.carrier, s.trackingNumber),
      orders: byShipment.get(s.id) ?? [],
      createdByName: names.get(s.createdByUserId) ?? null,
      canVoid: s.status === "label_created" && !s.shippedAt,
      canMarkShipped: !s.shippedAt && s.status !== "voided",
    })),
    truncated: rows.length >= SHIPMENT_LIST_LIMIT,
  };
}
