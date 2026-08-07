import { test } from "vitest";
import assert from "node:assert/strict";
import { shouldShow } from "./field-logic.js";
import { shouldShow as formLogicShouldShow } from "../../data/forms/form-logic.js";

test("shouldShow: true when no showIf", () => {
  assert.equal(shouldShow({ key: "a" }, {}), true);
  assert.equal(shouldShow({ key: "a" }, { a: "anything" }), true);
});

test("shouldShow: false when showIf.equals not met", () => {
  const field = { key: "b", showIf: { key: "a", equals: "yes" } };
  assert.equal(shouldShow(field, { a: "no" }), false);
  assert.equal(shouldShow(field, {}), false);
});

test("shouldShow: true when showIf.equals met", () => {
  const field = { key: "b", showIf: { key: "a", equals: "yes" } };
  assert.equal(shouldShow(field, { a: "yes" }), true);
});

test("shouldShow: prefix matches by string prefix", () => {
  const field = { key: "b", showIf: { key: "a", prefix: "Upper" } };
  assert.equal(shouldShow(field, { a: "Upper Arch" }), true);
  assert.equal(shouldShow(field, { a: "Lower Arch" }), false);
  // non-string value never matches prefix
  assert.equal(shouldShow(field, { a: 42 }), false);
  assert.equal(shouldShow(field, {}), false);
});

/* ── one predicate, not three ──────────────────────────────────────────────
   FormRenderer pre-filters with form-logic.js's shouldShow while FormField
   re-checks with this module's. When they were separate implementations, this
   one knew nothing about `showIf.includes` and fell through to `true` — the
   same half-fixed split that caused a Critical in Task 9. It now re-exports
   form-logic.js, so there is nothing left to keep in sync. */

test("field-logic re-exports form-logic's predicate — same function, not a copy", () => {
  assert.equal(shouldShow, formLogicShouldShow);
});

test("shouldShow understands showIf.includes (a multi-select gate)", () => {
  const field = { key: "b", showIf: { key: "devicesToOrder", includes: "ortho" } };
  assert.equal(shouldShow(field, { devicesToOrder: ["ddso", "ortho"] }), true);
  assert.equal(shouldShow(field, { devicesToOrder: ["ddso"] }), false);
  // a single-select answer equal to the value also counts
  assert.equal(shouldShow(field, { devicesToOrder: "ortho" }), true);
  assert.equal(shouldShow(field, {}), false);
});

test("a null/undefined field never throws", () => {
  assert.equal(shouldShow(null, {}), true);
  assert.equal(shouldShow(undefined, {}), true);
});
