import { test } from "vitest";
import assert from "node:assert/strict";
import { practiceLabel, practiceKeyFor, parsePartyKey } from "./practices.js";
import * as shared from "../index.js";

test("practiceLabel: name and number, either half alone, nothing", () => {
  assert.equal(practiceLabel({ name: "Smile Co", accountNumber: "A100" }), "Smile Co (A100)");
  assert.equal(practiceLabel({ name: "Smile Co" }), "Smile Co");
  assert.equal(practiceLabel({ name: "Smile Co", accountNumber: "" }), "Smile Co");
  assert.equal(practiceLabel({ name: "Smile Co", accountNumber: null }), "Smile Co");
  assert.equal(practiceLabel({ accountNumber: "A100" }), "A100");
  assert.equal(practiceLabel({ name: "  Smile Co ", accountNumber: " A100 " }), "Smile Co (A100)");
  assert.equal(practiceLabel({}), "");
  assert.equal(practiceLabel(null), "");
  assert.equal(practiceLabel(undefined), "");
});

test("practiceKeyFor: the practice key, else the owner's user key", () => {
  assert.equal(practiceKeyFor({ accountId: "acc1" }), "practice:acc1");
  assert.equal(practiceKeyFor({ accountId: "acc1", ownerId: "u1" }), "practice:acc1");
  assert.equal(practiceKeyFor({ accountId: null, ownerId: "u1" }), "user:u1");
});

test("parsePartyKey round-trips practiceKeyFor and rejects anything else", () => {
  assert.deepEqual(parsePartyKey(practiceKeyFor({ accountId: "acc1" })), { practice: "acc1" });
  assert.deepEqual(parsePartyKey(practiceKeyFor({ ownerId: "u1" })), { userId: "u1" });
  for (const bad of [null, undefined, "", "practice:", "org:x", "acc1"]) assert.equal(parsePartyKey(bad), null, String(bad));
});

test("the package index exports the practice helpers (API and web import them from here)", () => {
  assert.equal(shared.practiceLabel, practiceLabel);
  assert.equal(shared.practiceKeyFor, practiceKeyFor);
  assert.equal(shared.parsePartyKey, parsePartyKey);
});
