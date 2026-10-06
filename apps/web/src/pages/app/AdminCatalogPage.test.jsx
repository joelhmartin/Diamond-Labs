import { test } from "vitest";
import assert from "node:assert/strict";
import { parsePriceInput, familyBadge } from "./AdminCatalogPage.jsx";

test("admins type dollars; the API gets cents", () => {
  assert.equal(parsePriceInput("199"), 19900);
  assert.equal(parsePriceInput("$1,234.5"), 123450);
  assert.equal(parsePriceInput("0"), 0);
  assert.equal(parsePriceInput(""), null);
  assert.equal(parsePriceInput("abc"), undefined);
  assert.equal(parsePriceInput("-3"), undefined);
  assert.equal(parsePriceInput("1.999"), undefined);
});

test("the family badge says what still needs doing", () => {
  const v = (over) => ({ active: true, basePriceCents: 100, ...over });
  assert.equal(familyBadge({ variants: [v(), v()] }), "2 variants");
  assert.equal(familyBadge({ variants: [v(), v({ basePriceCents: null, active: false })] }), "2 variants · 1 unpriced");
});
