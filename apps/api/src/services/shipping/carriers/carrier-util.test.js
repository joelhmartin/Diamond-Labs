import { test } from "vitest";
import assert from "node:assert/strict";
import { cut, digits, dollarsToCents, emptyTrackResult, asList } from "./carrier-util.js";

test("cut trims, truncates, and drops empties", () => {
  assert.equal(cut("  abcdef ", 3), "abc");
  assert.equal(cut("   ", 5), undefined);
  assert.equal(cut(null, 5), undefined);
});

test("digits keeps digits only, capped", () => {
  assert.equal(digits("(210) 555-0100"), "2105550100");
  assert.equal(digits("1234567890123456789", 15).length, 15);
  assert.equal(digits("n/a"), undefined);
});

test("dollars become cents once; garbage is null", () => {
  assert.equal(dollarsToCents("11.42"), 1142);
  assert.equal(dollarsToCents(9.99), 999);
  assert.equal(dollarsToCents("abc"), null);
  assert.equal(dollarsToCents(null), null);
});

test("emptyTrackResult and asList", () => {
  assert.deepEqual(emptyTrackResult("1Z"), { trackingNumber: "1Z", status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [] });
  assert.deepEqual(asList(null), []);
  assert.deepEqual(asList({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asList([1]), [1]);
});

test("already-voided matcher: genuine answers succeed; refusals (even ones containing 'already') do not", async () => {
  const { isAlreadyVoidedAnswer } = await import("./carrier-util.js");
  for (const [code, msg] of [["SHIPMENT.ALREADY.CANCELLED", "x"], [null, "Shipment has already been voided"], [null, "Already cancelled"], ["ALREADY_VOIDED", null]]) {
    assert.equal(isAlreadyVoidedAnswer(code, msg), true, `${code} ${msg}`);
  }
  for (const [code, msg] of [
    ["SHIPMENT.ALREADY.TENDERED.CANNOT.CANCEL", "x"], ["SHIPMENT.ALREADY.PICKEDUP.CANCEL.NOTALLOWED", "x"],
    [null, "Cannot void, package in transit"], [null, "Shipment already cancelled or has been tendered"], [null, "Shipment already picked up"],
  ]) {
    assert.equal(isAlreadyVoidedAnswer(code, msg), false, `${code} ${msg}`);
  }
});
