import { test } from "vitest";
import assert from "node:assert/strict";
import { pageOf, sliceRows, containsPattern, prefixPattern } from "./list-query.js";

test("pageOf: only a limit makes a page, offset defaults to 0", () => {
  assert.equal(pageOf({}), null);
  assert.equal(pageOf({ offset: 20 }), null);
  assert.deepEqual(pageOf({ limit: 25 }), { limit: 25, offset: 0 });
  assert.deepEqual(pageOf({ limit: 25, offset: 50 }), { limit: 25, offset: 50 });
});

test("sliceRows applies offset before limit", () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(sliceRows(rows, { limit: 2, offset: 1 }), [2, 3]);
  assert.deepEqual(sliceRows(rows, { limit: 2, offset: 4 }), [5]);
  assert.deepEqual(sliceRows(rows, { limit: 2, offset: 9 }), []);
});

test("patterns make the user's wildcards literal", () => {
  assert.equal(containsPattern("50%_a\\"), "%50\\%\\_a\\\\%");
  assert.equal(prefixPattern("10"), "10%");
});
