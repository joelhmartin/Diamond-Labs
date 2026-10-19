import { test } from "vitest";
import assert from "node:assert/strict";
import {
  planShippable, shipmentReference, planShippingCharge, assertOrdersVoidable, shipToFromClient, shipToFromShopOrder,
} from "./lab-shipping-rules.js";
import { ShippingError } from "../shipping/shipping-errors.js";

const o = (over) => ({ id: "lo1", orderNumber: 100245, status: "ready_to_ship", source: "rx_case", clientUserId: "doc1", isRemake: false, shipmentId: null, ...over });
const notShippable = (e) => e instanceof ShippingError && e.code === "NOT_SHIPPABLE";
const label = { carrier: "ups", serviceName: "UPS Ground", trackingNumber: "1Z999AA10123456784", chargeCents: 1142 };

test("shippable: ready, unlabelled orders of one client, returned lowest number first", () => {
  const out = planShippable([o({ id: "b", orderNumber: 100246 }), o({ id: "a" })], ["a", "b"]);
  assert.deepEqual(out.map((x) => x.id), ["a", "b"]);
});

test("shippable: every reason is listed, so staff fix them all at once", () => {
  assert.throws(() => planShippable([o({ status: "quality_check" }), o({ id: "b", orderNumber: 100246, shipmentId: "sh0" })], ["lo1", "b"]), (e) =>
    notShippable(e) && e.problems.length === 2 && /#100245 is not ready to ship/.test(e.problems[0]) && /#100246 already has a label/.test(e.problems[1]));
  assert.throws(() => planShippable([o()], ["lo1", "gone"]), (e) => notShippable(e) && /no longer exists/.test(e.message));
});

test("shippable: one client per box; a guest shop order ships alone", () => {
  assert.throws(() => planShippable([o(), o({ id: "b", orderNumber: 100246, clientUserId: "doc2" })], ["lo1", "b"]), notShippable);
  assert.throws(() => planShippable([o({ clientUserId: null }), o({ id: "b", orderNumber: 100246, clientUserId: null })], ["lo1", "b"]), notShippable);
  assert.equal(planShippable([o({ clientUserId: null, source: "shop_order" })], ["lo1"]).length, 1);
});

test("the label reference is order numbers only, within the carriers' 30 characters", () => {
  assert.equal(shipmentReference([100246, 100245]), "Order 100245, 100246");
  assert.equal(shipmentReference([100245, 100246, 100247, 100248]), "Orders 100245 +3");
});

test("charge policy none adds nothing", () => {
  assert.deepEqual(planShippingCharge({ policy: "none", flatCents: 0, label, orders: [o()] }), { add: false, reason: "policy_none" });
});

test("carrier_cost: the label's charge, on the lowest-numbered NON-REMAKE Rx order", () => {
  const plan = planShippingCharge({ policy: "carrier_cost", flatCents: 0, label, orders: [o({ id: "r", orderNumber: 100100, isRemake: true }), o({ id: "x", orderNumber: 100300 }), o()] });
  assert.deepEqual(plan, { add: true, labOrderId: "lo1", orderNumber: 100245, unitCents: 1142, description: "Shipping — UPS Ground 1Z999AA10123456784" });
});

test("flat: the configured amount; $0 adds nothing", () => {
  assert.equal(planShippingCharge({ policy: "flat", flatCents: 1500, label, orders: [o()] }).unitCents, 1500);
  assert.deepEqual(planShippingCharge({ policy: "flat", flatCents: 0, label, orders: [o()] }), { add: false, reason: "zero" });
});

test("flat: a manual shipment (courier, hand delivery) adds no line", () => {
  const manual = { carrier: "manual", serviceName: "Courier", trackingNumber: null, chargeCents: 0 };
  assert.deepEqual(planShippingCharge({ policy: "flat", flatCents: 1500, label: manual, orders: [o()] }), { add: false, reason: "manual" });
});

test("carrier_cost with a charge the carrier didn't report: no line, and the order to note (R5a); flat is unaffected", () => {
  const unknown = { ...label, chargeCents: null };
  assert.deepEqual(planShippingCharge({ policy: "carrier_cost", flatCents: 0, label: unknown, orders: [o()] }), {
    add: false, reason: "charge_unknown", labOrderId: "lo1", orderNumber: 100245,
  });
  assert.equal(planShippingCharge({ policy: "flat", flatCents: 900, label: unknown, orders: [o()] }).unitCents, 900);
});

test("remakes and shop orders never carry the shipping line", () => {
  assert.deepEqual(planShippingCharge({ policy: "carrier_cost", flatCents: 0, label, orders: [o({ isRemake: true })] }), { add: false, reason: "all_remakes" });
  assert.deepEqual(planShippingCharge({ policy: "carrier_cost", flatCents: 0, label, orders: [o({ source: "shop_order" })] }), { add: false, reason: "no_billable_order" });
});

test("void needs every order still waiting at ready_to_ship", () => {
  assert.doesNotThrow(() => assertOrdersVoidable([o({ shipmentId: "sh1" })]));
  assert.throws(() => assertOrdersVoidable([o({ status: "shipped" })]), (e) => e.code === "VOID_REFUSED" && /#100245/.test(e.message));
});

test("ship-to from a doctor's profile: practice as company, the doctor as the person; none without an address", () => {
  const client = { name: "Dr. Ada Smile", practice: "Smile Dental", phone: "512-555-0100", address1: "100 Main St", address2: null, city: "Austin", state: "tx", zip: "78701" };
  assert.deepEqual(shipToFromClient(client), {
    name: "Dr. Ada Smile", company: "Smile Dental", phone: "512-555-0100", address1: "100 Main St", address2: null,
    city: "Austin", state: "TX", postalCode: "78701", country: "US", residential: false,
  });
  assert.equal(shipToFromClient({ ...client, address1: null }), null);
  assert.equal(shipToFromClient(null), null);
});

test("ship-to from a shop order: the checkout's address and phone", () => {
  const shop = { phone: "210-555-0111", shipping: { name: "Pat Smith", address1: "5 Elm", city: "Waco", state: "TX", postalCode: "76701" } };
  assert.deepEqual(shipToFromShopOrder(shop), {
    name: "Pat Smith", company: null, phone: "210-555-0111", address1: "5 Elm", address2: null, city: "Waco", state: "TX", postalCode: "76701", country: "US", residential: true,
  });
  assert.equal(shipToFromShopOrder(null), null);
});
