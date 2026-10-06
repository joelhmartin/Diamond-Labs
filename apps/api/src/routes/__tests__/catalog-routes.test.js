import { test } from "vitest";
import assert from "node:assert/strict";
import { pricingErrorReply } from "../catalog.routes.js";
import { PricingError } from "../../lib/pricing.js";

test("a pricing refusal becomes a 422 that names the item and the reason", () => {
  const r = pricingErrorReply(new PricingError("UNPRICED", "Item has no price yet.", "v9"));
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  assert.equal(r.body.error.reason, "UNPRICED");
  assert.equal(r.body.error.variantId, "v9");
  assert.equal(r.body.error.message, "Item has no price yet.");
});
