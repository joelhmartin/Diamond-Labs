import { test } from "vitest";
import assert from "node:assert/strict";
import { priceDelta } from "./AdminClientPricingPage.jsx";

test("the delta against base is shown as a rounded percentage", () => {
  assert.equal(priceDelta(40500, 45000), "−10%");
  assert.equal(priceDelta(47250, 45000), "+5%");
  assert.equal(priceDelta(45000, 45000), "");
  assert.equal(priceDelta(100, null), "");
  assert.equal(priceDelta(0, 2000), "−100%");
});
