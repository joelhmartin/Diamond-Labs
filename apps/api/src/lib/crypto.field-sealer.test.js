import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { fieldSealer, decryptField } = await import("./crypto.js");

test("fieldSealer encrypts only its fields, skips null and absent ones, and opens them back", () => {
  const { seal, open } = fieldSealer(["notes", "reason"]);
  const sealed = seal({ id: "x", notes: "Jane Doe's case", reason: null, total: 5 });
  assert.notEqual(sealed.notes, "Jane Doe's case");
  assert.equal(decryptField(sealed.notes), "Jane Doe's case");
  assert.equal(sealed.reason, null);
  assert.equal(sealed.total, 5);
  assert.ok(!("notes" in seal({ id: "x" })));
  assert.deepEqual(open(sealed), { id: "x", notes: "Jane Doe's case", reason: null, total: 5 });
});
