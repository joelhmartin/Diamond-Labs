import { test } from "vitest";
import assert from "node:assert/strict";
import { parsePriceInput, familyBadge, canActivate, variantDeleteCheck, valueDeleteCheck } from "./AdminCatalogPage.jsx";

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

test("shop variants need a price to activate; lab-billed ones may rely on client prices", () => {
  assert.equal(canActivate({ channel: "shop" }, {}, null).ok, false);
  assert.equal(canActivate({ channel: "both" }, {}, null).ok, false);
  assert.equal(canActivate({ channel: "shop" }, {}, 0).ok, true);
  const rx = canActivate({ channel: "rx" }, {}, null);
  assert.equal(rx.ok, true);
  assert.match(rx.note, /negotiated price/);
  assert.equal(canActivate({ channel: "rx" }, {}, 500).note, null);
});

test("delete is offered by the same rule the API enforces, using the variant's usage counts", () => {
  const blank = { id: "b", name: "Mute PMT", active: false, basePriceCents: null, code: null, clientPriceCount: 0, orderItemCount: 0, optionValueIds: ["pmt"] };
  const sold = { ...blank, id: "s", name: "Mute Nylon", orderItemCount: 2, optionValueIds: ["nylon"] };
  const family = { variants: [blank, sold] };
  assert.equal(variantDeleteCheck(family, blank).ok, true);
  assert.match(variantDeleteCheck(family, sold).reason, /past orders/);
  assert.match(variantDeleteCheck({ variants: [blank] }, blank).reason, /only variant/);

  const option = { id: "m", name: "Material", values: [{ id: "pmt" }, { id: "nylon" }] };
  assert.equal(valueDeleteCheck(family, option, "pmt").ok, true);
  assert.match(valueDeleteCheck(family, option, "nylon").reason, /Mute Nylon/);
  assert.match(valueDeleteCheck(family, { ...option, values: [{ id: "pmt" }] }, "pmt").reason, /only value/);
});
