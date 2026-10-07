import { test } from "vitest";
import assert from "node:assert/strict";
import { priceDelta, clientLabel } from "./AdminClientPricingPage.jsx";

test("the delta against base is shown as a rounded percentage", () => {
  assert.equal(priceDelta(40500, 45000), "−10%");
  assert.equal(priceDelta(47250, 45000), "+5%");
  assert.equal(priceDelta(45000, 45000), "");
  assert.equal(priceDelta(100, null), "");
  assert.equal(priceDelta(0, 2000), "−100%");
});

test("the page names whose prices these are", () => {
  const users = [
    { id: "u1", name: "Dr. Ana Ruiz", email: "ana@clinic.test", account: { name: "Ruiz Dental" } },
    { id: "u2", name: null, email: "nobody@clinic.test", account: null },
  ];
  assert.deepEqual(clientLabel(users, "u1"), { name: "Dr. Ana Ruiz", email: "ana@clinic.test", practice: "Ruiz Dental" });
  assert.deepEqual(clientLabel(users, "u2"), { name: "nobody@clinic.test", email: null, practice: null });
  assert.equal(clientLabel(users, "zz"), null);
});
