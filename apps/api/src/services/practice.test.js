import { test } from "vitest";
import assert from "node:assert/strict";
import { practiceKeyFor, partyKeysFor } from "./practice.js";
import { canActOnInvoice } from "./billing/invoice-rules.js";

test("practiceKeyFor uses seazonaClientId else user id", () => {
  assert.equal(practiceKeyFor({ id: "u1", seazonaClientId: "C-9" }), "practice:C-9");
  assert.equal(practiceKeyFor({ id: "u1", seazonaClientId: null }), "user:u1");
  assert.equal(practiceKeyFor({ id: "u1" }), "user:u1");
  assert.deepEqual(partyKeysFor({ id: "u1", seazonaClientId: "C-9" }), ["user:u1", "practice:C-9"]);
  assert.deepEqual(partyKeysFor({ id: "u1", seazonaClientId: null }), ["user:u1"]);
});

test("partyKeysFor agrees with canActOnInvoice", () => {
  const owners = [{ id: "U", seazonaClientId: "X" }, { id: "U", seazonaClientId: null }];
  const requesters = [
    { id: "R", seazonaClientId: "X" }, // same practice
    { id: "R", seazonaClientId: "Y" }, // another practice
    { id: "R", seazonaClientId: null },
    { id: "U", seazonaClientId: "X" }, // the owner themself
    { id: "U", seazonaClientId: null },
  ];
  for (const U of owners) {
    for (const R of requesters) {
      if (R.id === U.id && R.seazonaClientId !== U.seazonaClientId) continue; // one user has one seazonaClientId
      const rule = canActOnInvoice(R, { clientUserId: U.id }, U.seazonaClientId);
      const keys = partyKeysFor(R).includes(practiceKeyFor(U));
      assert.equal(keys, rule, `owner ${JSON.stringify(U)} requester ${JSON.stringify(R)}`);
    }
  }
});
