process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { encryptField } = await import("../lib/crypto.js");
const { keyMatches, assertImportKey, assertTargetKey, KEY_CHECK_PLAINTEXT } = await import("./key-check.js");
const { ImportRefusal } = await import("./import-errors.js");

const keyCheck = { id: "id", value: "value" }; // stand-in table; fakeTx ignores it

test("keyMatches: the right key opens, anything else does not (never throws)", () => {
  assert.equal(keyMatches(encryptField("x"), "x"), true);
  assert.equal(keyMatches(encryptField("x"), "y"), false);
  assert.equal(keyMatches(encryptField("x")), true);
  assert.equal(keyMatches(`enc:v1:${"A".repeat(60)}`), false, "sealed under another key");
  assert.equal(keyMatches("Smith"), false, "plaintext is not a key check");
});

test("the import DB key check is written once, then verified", async () => {
  const fresh = fakeTx({ selects: [[]] });
  assert.equal(await assertImportKey(fresh, { keyCheck }), "created");
  const insert = fresh.log.find((e) => e.op === "insert");
  assert.equal(insert.values.id, "phi");
  assert.equal(keyMatches(insert.values.value, KEY_CHECK_PLAINTEXT), true);

  const ok = fakeTx({ selects: [[{ id: "phi", value: encryptField(KEY_CHECK_PLAINTEXT) }]] });
  assert.equal(await assertImportKey(ok, { keyCheck }), "verified");

  const other = fakeTx({ selects: [[{ id: "phi", value: `enc:v1:${"A".repeat(60)}` }]] });
  await assert.rejects(assertImportKey(other, { keyCheck }), ImportRefusal);
});

test("a target must hold a sealed value the current key opens", async () => {
  await assertTargetKey({ execute: async () => [{ v: encryptField("Test") }] });
  await assert.rejects(assertTargetKey({ execute: async () => [] }), /no sealed rx_cases row/);
  await assert.rejects(assertTargetKey({ execute: async () => [{ v: `enc:v1:${"A".repeat(60)}` }] }), /does not open/);
});

test("assertTargetKey: a scrubbed staging target with nothing sealed may load; a sealed value the key cannot open still refuses", async () => {
  await assertTargetKey({ execute: async () => [] }, { allowUnsealed: true });
  await assert.rejects(assertTargetKey({ execute: async () => [{ v: `enc:v1:${"A".repeat(60)}` }] }, { allowUnsealed: true }), /does not open/);
});
