import { test } from "vitest";
import assert from "node:assert/strict";
import { assertSafeData, NotificationDataError, maskAddress } from "./data-guard.js";

test("accepts flat primitives and primitive arrays", () => {
  const data = { number: 42, label: "A-100", rush: true, none: null, numbers: [1, 2, 3], tags: ["x", "y"] };
  assert.equal(assertSafeData(data), data);
  assert.deepEqual(assertSafeData({}), {});
});

test("rejects nested objects, >200-char strings and >2KB payloads", () => {
  assert.throws(() => assertSafeData({ nested: { a: 1 } }), NotificationDataError);
  assert.throws(() => assertSafeData({ list: [{ a: 1 }] }), NotificationDataError);
  assert.throws(() => assertSafeData({ list: [[1]] }), NotificationDataError);
  assert.throws(() => assertSafeData({ text: "x".repeat(201) }), NotificationDataError);
  assert.throws(() => assertSafeData({ list: ["x".repeat(201)] }), NotificationDataError);
  assert.doesNotThrow(() => assertSafeData({ text: "x".repeat(200) }));
  const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "y".repeat(150)]));
  assert.throws(() => assertSafeData(big), /2 ?KB|2048/);
});

test("rejects non-objects, functions, dates and non-finite numbers", () => {
  assert.throws(() => assertSafeData(null), NotificationDataError);
  assert.throws(() => assertSafeData([1]), NotificationDataError);
  assert.throws(() => assertSafeData("x"), NotificationDataError);
  assert.throws(() => assertSafeData({ f: () => 1 }), NotificationDataError);
  assert.throws(() => assertSafeData({ d: new Date() }), NotificationDataError);
  assert.throws(() => assertSafeData({ n: Number.NaN }), NotificationDataError);
});

test("the error names the offending key, never the value", () => {
  try {
    assertSafeData({ secretish: "z".repeat(300) });
    assert.fail("should throw");
  } catch (err) {
    assert.ok(err instanceof NotificationDataError);
    assert.match(err.message, /secretish/);
    assert.ok(!err.message.includes("zzzz"));
  }
});

test("maskAddress shows the last four digits of a phone and the first letter and domain of an email", () => {
  assert.equal(maskAddress("+15125551234"), "•••1234");
  assert.equal(maskAddress("jane.doe@example.com"), "j•••@example.com");
  assert.equal(maskAddress(""), "•••");
  assert.equal(maskAddress(null), "•••");
  assert.equal(maskAddress("abc"), "•••");
});
