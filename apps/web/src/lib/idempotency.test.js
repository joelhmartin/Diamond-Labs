import { test } from "vitest";
import assert from "node:assert/strict";
import { createAttemptKey, chargeSignature } from "./idempotency.js";

const counter = () => { let n = 0; return () => `k${++n}`; };

test("a retry of the same charge reuses the key", () => {
  const a = createAttemptKey(counter());
  const sig = chargeSignature({ card: "c1", cents: 500, allocations: [{ invoiceId: "i1", amountCents: 500 }] });
  assert.equal(a.keyFor(sig), a.keyFor(sig));
});

test("a changed amount, card or allocation gets a new key", () => {
  const a = createAttemptKey(counter());
  const k1 = a.keyFor(chargeSignature({ card: "c1", cents: 500 }));
  assert.notEqual(a.keyFor(chargeSignature({ card: "c1", cents: 600 })), k1);
  assert.notEqual(a.keyFor(chargeSignature({ card: "c2", cents: 600 })), k1);
});

test("reset after success rotates the key even for an identical charge", () => {
  const a = createAttemptKey(counter());
  const sig = chargeSignature({ card: "c1", cents: 500 });
  const k1 = a.keyFor(sig);
  a.reset();
  assert.notEqual(a.keyFor(sig), k1);
});
