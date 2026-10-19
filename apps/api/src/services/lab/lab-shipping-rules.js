import { CARRIER_LABELS } from "@my-app/shared";
import { ShippingError } from "../shipping/shipping-errors.js";

/**
 * Pure lab-shipping rules: which orders may share a box, what the label's
 * reference says, what a shipment adds to the bill, and the ship-to a form
 * starts from. No DB and no clock.
 */

/**
 * The orders staff picked → sorted lowest number first, or NOT_SHIPPABLE with
 * every reason (so staff fix them all at once). Each must be at ready_to_ship
 * with no label, and all must belong to one client; a shop order (guest
 * or registered) ships alone. Checked before the carrier is called and re-checked
 * per order inside the persisting transaction (planShipmentLink).
 */
export function planShippable(orders, requestedIds) {
  const problems = [];
  const found = new Set(orders.map((o) => o.id));
  if (requestedIds.some((id) => !found.has(id))) problems.push("An order in this shipment no longer exists.");
  const sorted = [...orders].sort((a, b) => a.orderNumber - b.orderNumber);
  for (const o of sorted) {
    if (o.status !== "ready_to_ship") problems.push(`Order #${o.orderNumber} is not ready to ship.`);
    if (o.shipmentId) problems.push(`Order #${o.orderNumber} already has a label.`);
  }
  // A shop order has its own checkout address (even a registered doctor's), and the form applies ONE ship-to to the box.
  if (sorted.length > 1 && sorted.some((o) => o.source === "shop_order")) {
    problems.push("A shop order ships on its own: its customer's address is its own, so it can't share a box.");
  }
  const clients = new Set(sorted.map((o) => o.clientUserId ?? null));
  if (sorted.length > 1 && (clients.size > 1 || clients.has(null))) {
    problems.push("Orders in one box must belong to the same client, and a guest order ships on its own.");
  }
  if (problems.length) throw new ShippingError("NOT_SHIPPABLE", problems[0], { problems });
  return sorted;
}

/** The label's reference: order numbers only (never a patient, device or Rx text), ≤ 30 characters. */
export function shipmentReference(orderNumbers) {
  const nums = [...orderNumbers].sort((a, b) => a - b);
  const full = `Order ${nums.join(", ")}`;
  return full.length <= 30 ? full : `Orders ${nums[0]} +${nums.length - 1}`;
}

/** Orders that can carry the shipping line (Rx, not a remake), lowest number first: [0] is THE target. */
export function billableOrders(orders) {
  return orders.filter((o) => o.source === "rx_case" && !o.isRemake).sort((a, b) => a.orderNumber - b.orderNumber);
}

/**
 * SHIPPING_CHARGE_POLICY → the one shipping line a new shipment adds, or why
 * none. Shop orders paid their shipping at checkout and remakes are free, so
 * neither carries it: the line goes on the lowest-numbered non-remake Rx order.
 */
export function planShippingCharge({ policy, flatCents, label, orders }) {
  if (policy === "none") return { add: false, reason: "policy_none" };
  const billable = billableOrders(orders);
  if (billable.length === 0) return { add: false, reason: orders.every((o) => o.isRemake) ? "all_remakes" : "no_billable_order" };
  // R5a: the carrier reported no readable charge. Never bill $0 silently: the caller
  // leaves a note on this order so staff add the line by hand.
  if (policy === "carrier_cost" && label.chargeCents == null) {
    return { add: false, reason: "charge_unknown", labOrderId: billable[0].id, orderNumber: billable[0].orderNumber };
  }
  // A manual shipment (courier, hand delivery) has no carrier charge, and a flat fee for it would bill a hand delivery.
  if (policy === "flat" && label.carrier === "manual") return { add: false, reason: "manual" };
  const unitCents = policy === "flat" ? flatCents : label.chargeCents;
  if (!Number.isSafeInteger(unitCents) || unitCents <= 0) return { add: false, reason: "zero" };
  const what = [label.serviceName || CARRIER_LABELS[label.carrier], label.trackingNumber].filter(Boolean).join(" ");
  return { add: true, labOrderId: billable[0].id, orderNumber: billable[0].orderNumber, unitCents, description: `Shipping — ${what}`.slice(0, 255) };
}

/** Voiding needs every order on the label still waiting at ready_to_ship. */
export function assertOrdersVoidable(orders) {
  const moved = orders.find((o) => o.status !== "ready_to_ship");
  if (moved) throw new ShippingError("VOID_REFUSED", `Order #${moved.orderNumber} is no longer ready to ship, so its label can't be voided.`);
}

const upper = (s) => String(s ?? "").trim().toUpperCase();

/** A doctor (statements.service loadClient) → the ship-to: practice as company, the doctor as the person. */
export function shipToFromClient(client) {
  if (!client?.address1) return null;
  return {
    name: client.name ?? "", company: client.practice ?? null, phone: client.phone ?? null,
    address1: client.address1, address2: client.address2 ?? null, city: client.city ?? "",
    state: upper(client.state), postalCode: client.zip ?? "", country: "US",
    // A practice is a commercial address; staff tick "residential" in the form for a home office (P8).
    residential: false,
  };
}

/** A shop order (orders.shipping + orders.phone) → the ship-to. */
export function shipToFromShopOrder(shop) {
  const s = shop?.shipping;
  if (!s?.address1) return null;
  return {
    name: s.name ?? "", company: s.company ?? null, phone: shop.phone ?? null,
    address1: s.address1, address2: s.address2 ?? null, city: s.city ?? "",
    state: upper(s.state), postalCode: s.postalCode ?? "", country: "US",
    // A shop checkout ships to a person's address (P8).
    residential: true,
  };
}
