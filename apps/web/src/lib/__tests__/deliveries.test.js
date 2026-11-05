import { test } from "vitest";
import assert from "node:assert/strict";
import { planMarkDelivered, deliveryRangeOf, deliveryPrintPath, defaultDeliveryRange, addressLine, ordersLabel, dayLabel } from "../deliveries.js";

const stop = (id, day, orders, pickups = []) => ({ id, day, practice: "P", orders, pickups });
const o = (id, orderNumber, status, version = 1) => ({ id, orderNumber, status, version });

test("planMarkDelivered moves ready orders and reports the rest", () => {
  const plan = planMarkDelivered([
    stop("s1", "2026-11-05", [o("a", 101, "ready_to_ship", 3), o("b", 102, "in_production"), o("c", 103, "shipped")]),
    stop("s2", "2026-11-06", [o("d", 104, "ready_to_ship", 7), o("e", 105, "on_hold")]),
  ]);
  assert.deepEqual(plan.moves, [{ id: "a", orderNumber: 101, version: 3 }, { id: "d", orderNumber: 104, version: 7 }]);
  // Already shipped is done, not a failure.
  assert.deepEqual(plan.skipped, [
    { orderNumber: 102, reason: "not ready to ship (In production)" },
    { orderNumber: 105, reason: "not ready to ship (On hold)" },
  ]);
  assert.deepEqual(planMarkDelivered([]), { moves: [], skipped: [] });
});

test("defaultDeliveryRange is today in Chicago through six days later", () => {
  // 03:00 UTC on the 6th is still the 5th in Chicago.
  assert.deepEqual(defaultDeliveryRange(new Date("2026-11-06T03:00:00Z")), { from: "2026-11-05", to: "2026-11-11" });
});

test("deliveryRangeOf spans the selected stops' days; the print path carries from/to", () => {
  const range = deliveryRangeOf([stop("x", "2026-11-07", []), stop("y", "2026-11-05", []), stop("z", "2026-11-06", [])]);
  assert.deepEqual(range, { from: "2026-11-05", to: "2026-11-07" });
  assert.equal(deliveryPrintPath(range), "/lab/deliveries/print?from=2026-11-05&to=2026-11-07");
});

test("addressLine and ordersLabel are plain one-liners", () => {
  assert.equal(addressLine({ address1: "1 Main St", address2: "Suite 2", city: "Austin", state: "TX", zip: "78701" }), "1 Main St, Suite 2, Austin TX 78701");
  assert.equal(addressLine(null), "No address on file");
  assert.equal(dayLabel("2026-11-05"), "Thu 11/05/2026");
  assert.equal(ordersLabel([o("a", 101, "x"), o("b", 102, "y")]), "#101, #102");
});
