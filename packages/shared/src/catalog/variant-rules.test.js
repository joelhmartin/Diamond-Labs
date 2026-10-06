import { test } from "vitest";
import assert from "node:assert/strict";
import { canDeleteVariant, canDeleteOptionValue } from "./variant-rules.js";

const blank = { name: "Mute PMT", active: false, basePriceCents: null, code: null };

test("only a blank placeholder variant may be deleted", () => {
  assert.deepEqual(canDeleteVariant({ variant: blank }), { ok: true });
  assert.deepEqual(canDeleteVariant({ variant: { ...blank, code: "" } }), { ok: true });
  assert.equal(canDeleteVariant({ variant: { ...blank, active: true } }).ok, false);
  assert.equal(canDeleteVariant({ variant: { ...blank, basePriceCents: 0 } }).ok, false); // $0.00 is a price
  assert.match(canDeleteVariant({ variant: { ...blank, code: "2119" } }).reason, /lab code/);
});

test("a variant with client prices or order history is never deleted (no FKs to catch it)", () => {
  assert.match(canDeleteVariant({ variant: blank, clientPriceCount: 2 }).reason, /2 client prices/);
  assert.match(canDeleteVariant({ variant: blank, clientPriceCount: 1 }).reason, /1 client price use/);
  assert.match(canDeleteVariant({ variant: blank, orderItemCount: 1 }).reason, /past orders/);
});

test("a family's only variant is not deleted", () => {
  assert.equal(canDeleteVariant({ variant: blank, familyVariantCount: 1 }).ok, false);
  assert.equal(canDeleteVariant({ variant: blank, familyVariantCount: 2 }).ok, true);
});

test("an option value goes only with deletable variants, and never the last one", () => {
  assert.match(canDeleteOptionValue({ optionValueCount: 1, variants: [] }).reason, /only value/);
  assert.deepEqual(canDeleteOptionValue({ optionValueCount: 2, variants: [] }), { ok: true });
  assert.deepEqual(canDeleteOptionValue({ optionValueCount: 2, variants: [{ ...blank, clientPriceCount: 0, orderItemCount: 0 }] }), { ok: true });
  const blocked = canDeleteOptionValue({ optionValueCount: 3, variants: [{ ...blank, clientPriceCount: 0, orderItemCount: 4 }] });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /^Mute PMT: .*past orders/);
});
