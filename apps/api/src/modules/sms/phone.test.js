import { test } from "vitest";
import assert from "node:assert/strict";
import { normalizePhone, maskPhone } from "./phone.js";

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
