import { test } from "vitest";
import assert from "node:assert/strict";
import { CASE_STATUSES, canRelease, canTransition, isFrozen, releaseRefusal } from "./case-gates.js";

test("canRelease refuses a case whose only sendable lines are model/lab services", () => {
  const lines = [
    { mapKey: "service:model-fab", seazonaCode: "2367", status: "confirmed", noteOnly: false },
    { mapKey: "service:model-fab", seazonaCode: "2367", status: "confirmed", noteOnly: false },
  ];
  const r = canRelease(lines);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no appliance line/);
  assert.equal(canRelease([...lines, { mapKey: "primary:ddso:nylon", seazonaCode: "2608", status: "confirmed", noteOnly: false }]).ok, true);
});

test("released is a case status, and a released case is frozen like a pushed one", () => {
  assert.ok(CASE_STATUSES.includes("released"));
  assert.equal(isFrozen("released"), true);
  assert.equal(isFrozen("pushed"), true);
  assert.equal(isFrozen("in_review"), false);
});

test("only the release route moves a case to released; nothing moves it back", () => {
  assert.equal(canTransition("in_review", "released"), false);
  assert.equal(canTransition("in_review", "pushed"), false, "pushed is legacy — no new case may enter it");
  assert.equal(canTransition("released", "in_review"), false);
  assert.equal(canTransition("released", "cancelled"), false);
  assert.equal(canTransition("failed", "in_review"), true);
});

test("a case whose Seazona push never confirmed is not released until staff say they checked", () => {
  const stuck = { status: "failed", seazonaPushStatus: "pushing" };
  const r = releaseRefusal(stuck);
  assert.equal(r.status, 409);
  assert.equal(r.error.code, "LEGACY_PUSH_UNCONFIRMED");
  assert.match(r.error.message, /Check Seazona/);
  assert.equal(releaseRefusal(stuck, { confirmNotInSeazona: true }), null);
});

test("release refuses released, legacy-pushed and cancelled cases with distinct codes", () => {
  assert.equal(releaseRefusal({ status: "released" }).error.code, "CASE_ALREADY_RELEASED");
  assert.equal(releaseRefusal({ status: "pushed" }).error.code, "CASE_ALREADY_PUSHED");
  assert.equal(releaseRefusal({ status: "cancelled" }).error.code, "CASE_CANCELLED");
  assert.equal(releaseRefusal({ status: "in_review", seazonaPushStatus: null }), null);
  assert.equal(releaseRefusal({ status: "new", seazonaPushStatus: "failed" }), null);
});
