import { test } from "vitest";
import assert from "node:assert/strict";
import { practiceKeyFor, partyKeysFor, defaultPartyKey, parsePartyKey, newPartyKey, practiceLabel } from "./practice.js";
import { canActForAccount } from "./client-scope-rules.js";

const scoped = (id, ...accountIds) => ({ id, scope: { accountIds, payable: new Set(accountIds), via: new Map(), roles: new Map(), organizations: [] } });

test("practiceKeyFor: practice:<accountId>, else the owner's user key", () => {
  assert.equal(practiceKeyFor({ accountId: "a1", ownerId: "u1" }), "practice:a1");
  assert.equal(practiceKeyFor({ accountId: null, ownerId: "u1" }), "user:u1");
  assert.equal(practiceKeyFor({ ownerId: "u1" }), "user:u1");
});

test("partyKeysFor lists user key plus every scoped practice key", () => {
  assert.deepEqual(partyKeysFor(scoped("u1", "a1", "a2")), ["user:u1", "practice:a1", "practice:a2"]);
  assert.deepEqual(partyKeysFor(scoped("u1")), ["user:u1"]);
  // No scope on the user (not through authenticate): only their own key, never a practice.
  assert.deepEqual(partyKeysFor({ id: "u1", seazonaClientId: "C-9" }), ["user:u1"]);
});

test("defaultPartyKey: the one practice in scope, else the login's own key", () => {
  assert.equal(defaultPartyKey(scoped("u1", "a1")), "practice:a1");
  assert.equal(defaultPartyKey(scoped("u1", "a1", "a2")), "user:u1", "several practices: the caller must choose");
  assert.equal(defaultPartyKey(scoped("u1")), "user:u1");
});

test("partyKeysFor agrees with canActForAccount", () => {
  const records = [{ accountId: "a1", ownerId: "U" }, { accountId: "a2", ownerId: "U" }, { accountId: null, ownerId: "U" }];
  const requesters = [scoped("R", "a1"), scoped("R", "a1", "a2"), scoped("R"), scoped("U", "a2")];
  for (const rec of records) {
    for (const R of requesters) {
      if (rec.accountId == null) continue; // keyed to the owner: covered below
      const keys = partyKeysFor(R).includes(practiceKeyFor(rec));
      assert.equal(keys, canActForAccount(R.scope, rec.accountId), `${JSON.stringify(rec)} ${R.id}:${R.scope.accountIds}`);
    }
  }
  // A record with no practice is its owner's alone.
  assert.equal(partyKeysFor(scoped("U")).includes(practiceKeyFor(records[2])), true);
  assert.equal(partyKeysFor(scoped("R", "a1")).includes(practiceKeyFor(records[2])), false);
});

test("parsePartyKey is unchanged", () => {
  assert.deepEqual(parsePartyKey("practice:a1"), { practice: "a1" });
  assert.deepEqual(parsePartyKey("user:u1"), { userId: "u1" });
  assert.equal(parsePartyKey("org:x"), null);
});

test("newPartyKey: a named practice in scope, the one practice, or 422 \"Choose a practice.\" in All practices", () => {
  const two = scoped("u1", "a1", "a2");
  assert.equal(newPartyKey(two, "a2"), "practice:a2");
  for (const all of [undefined, null, "all"]) {
    assert.throws(() => newPartyKey(two, all), (e) => e.statusCode === 422 && e.code === "PRACTICE_REQUIRED" && e.message === "Choose a practice.", String(all));
  }
  assert.equal(newPartyKey(scoped("u1", "a1")), "practice:a1");
  assert.equal(newPartyKey(scoped("u1")), "user:u1", "no practice yet: the login's own key");
  // Out of scope (and an empty value, which names no practice) reads as not found, never widened.
  for (const bad of ["", "a9", "organization:o1", ["a1"]]) {
    assert.throws(() => newPartyKey(two, bad), (e) => e.statusCode === 404 && e.code === "NOT_FOUND", String(bad));
  }
  assert.throws(() => newPartyKey(scoped("u1"), "a1"), (e) => e.statusCode === 404);
});

test("practiceLabel: the account name with its number", () => {
  assert.equal(practiceLabel({ name: "Smile Dental", accountNumber: "1042" }), "Smile Dental (1042)");
  assert.equal(practiceLabel({ name: " Smile Dental ", accountNumber: null }), "Smile Dental");
  assert.equal(practiceLabel({ name: "", accountNumber: "1042" }), "1042");
  assert.equal(practiceLabel({ name: null, accountNumber: null }), "");
});
