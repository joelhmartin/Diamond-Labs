import { test } from "vitest";
import assert from "node:assert/strict";
import { normalizePhone, maskPhone } from "./phone.js";
import * as shared from "../index.js";

test("the package root exports the one phone rule", () => {
  assert.equal(shared.normalizePhone, normalizePhone);
  assert.equal(shared.maskPhone, maskPhone);
});

test("ten digits, or eleven with the leading 1, or + and 8 to 15 digits", () => {
  assert.equal(normalizePhone("5125551234"), "+15125551234");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("+1 555 123 456"), null, "+1 needs eleven digits");
  assert.equal(normalizePhone("25125551234"), null);
});

test("normalizes (555) 123-4567, 555.123.4567, +1 555 123 4567 to +15551234567", () => {
  for (const input of ["(555) 123-4567", "555.123.4567", "+1 555 123 4567", "1-555-123-4567"]) {
    assert.equal(normalizePhone(input), "+15551234567", input);
  }
});

test("rejects short, long and letter input", () => {
  for (const input of ["555123", "+1 555 123 45678901234", "555-CALL-NOW", "", null, undefined]) {
    assert.equal(normalizePhone(input), null, String(input));
  }
});

test("maskPhone keeps only the last four digits", () => {
  assert.equal(maskPhone("+15551234567"), "•••4567");
  assert.equal(maskPhone(null), "•••");
});
