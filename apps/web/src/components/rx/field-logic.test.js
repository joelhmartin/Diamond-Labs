import test from "node:test";
import assert from "node:assert/strict";
import { shouldShow } from "./field-logic.js";

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
