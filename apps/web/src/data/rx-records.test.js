import { test } from "vitest";
import assert from "node:assert/strict";
import { RECORDS_METHODS, PHYSICAL_BITE, FIRST_DEVICE, RUSH_TIERS } from "./rx-records.js";

test("records methods match the canonical 12", () => {
  assert.equal(RECORDS_METHODS.length, 12);
  for (const m of ["Physical Bite Registration", "3SHAPE", "SHINING 3D", "PLANMECA", "ALL OTHER SCANNERS"])
    assert.ok(RECORDS_METHODS.some((r) => r.label === m), `missing ${m}`);
});
test("first-device has 3 options incl previous/new records", () => {
  assert.deepEqual(FIRST_DEVICE, ["Yes", "No, use PREVIOUS RECORDS", "No, use NEW RECORDS"]);
});
test("physical-bite has the 3 canonical handling options", () => {
  assert.deepEqual(PHYSICAL_BITE.map((o) => o.value), ["no_digital", "wait_physical", "start_verify"]);
});
test("rush tiers carry per-material price", () => {
  assert.equal(RUSH_TIERS.nylon.price, 150);
  assert.equal(RUSH_TIERS.biomedPmtAcrylic.price, 75);
});
test("every records method has an /images/ img path", () => {
  assert.ok(RECORDS_METHODS.every((r) => r.img && r.img.startsWith("/images/")));
});
