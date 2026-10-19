import { test } from "vitest";
import assert from "node:assert/strict";
import { labIdentity, DEFAULT_LAB_NAME } from "./lab-identity.js";

const FULL = {
  LAB_NAME: "Diamond Orthotic Laboratory", LAB_PHONE: "210-555-0199", LAB_ADDRESS_LINE1: "1 Lab Way", LAB_ADDRESS_LINE2: "",
  LAB_CITY: "San Antonio", LAB_STATE: "tx", LAB_ZIP: "78205",
};

test("the lab's name has one default and one override", () => {
  assert.equal(labIdentity({}).name, DEFAULT_LAB_NAME);
  assert.equal(DEFAULT_LAB_NAME, "Diamond Orthotic Laboratory");
  assert.equal(labIdentity({ LAB_NAME: "  Acme Lab " }).name, "Acme Lab");
});

test("the ship-from exists only when every required LAB_* value is set, and says which are missing", () => {
  const partial = labIdentity({ ...FULL, LAB_CITY: " ", LAB_PHONE: undefined });
  assert.equal(partial.address, null);
  assert.deepEqual(partial.missing, ["LAB_CITY", "LAB_PHONE"]);
  const full = labIdentity(FULL);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.address, {
    name: "Diamond Orthotic Laboratory", company: "Diamond Orthotic Laboratory", phone: "210-555-0199",
    address1: "1 Lab Way", address2: null, city: "San Antonio", state: "TX", postalCode: "78205", country: "US",
  });
});
