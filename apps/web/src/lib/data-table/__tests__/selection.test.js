import { test } from "vitest";
import assert from "node:assert/strict";
import { emptySelection, clickRow, setPage, selectAll, prune, clear } from "../selection.js";

const ids = (sel) => [...sel.ids].sort();
const ORDER = ["a", "b", "c", "d"];

test("toggle adds then removes an id and moves the anchor", () => {
  let sel = clickRow(emptySelection(), { id: "a", orderedIds: ORDER, toggle: true });
  assert.deepEqual(ids(sel), ["a"]);
  assert.equal(sel.anchor, "a");
  sel = clickRow(sel, { id: "c", orderedIds: ORDER, toggle: true });
  assert.deepEqual(ids(sel), ["a", "c"]);
  assert.equal(sel.anchor, "c");
  sel = clickRow(sel, { id: "a", orderedIds: ORDER, toggle: true });
  assert.deepEqual(ids(sel), ["c"]);
  assert.equal(sel.anchor, "a");
});

test("replace selects only the clicked row", () => {
  let sel = selectAll(emptySelection(), ["a", "b", "c"]);
  sel = clickRow(sel, { id: "d", orderedIds: ORDER, replace: true });
  assert.deepEqual(ids(sel), ["d"]);
  assert.equal(sel.anchor, "d");
});

test("shift-click selects the inclusive range from the anchor in visible order", () => {
  let sel = clickRow(emptySelection(), { id: "b", orderedIds: ORDER, toggle: true });
  sel = clickRow(sel, { id: "d", orderedIds: ORDER, range: true });
  assert.deepEqual(ids(sel), ["b", "c", "d"]);
  assert.equal(sel.anchor, "b", "the anchor stays put so the range can be re-extended");
  // backwards from the same anchor adds, never drops
  sel = clickRow(sel, { id: "a", orderedIds: ORDER, range: true });
  assert.deepEqual(ids(sel), ["a", "b", "c", "d"]);
  // visible order wins, not id order
  let s2 = clickRow(emptySelection(), { id: "d", orderedIds: ["d", "a", "c", "b"], toggle: true });
  s2 = clickRow(s2, { id: "c", orderedIds: ["d", "a", "c", "b"], range: true });
  assert.deepEqual(ids(s2), ["a", "c", "d"]);
});

test("shift-click with an off-page anchor toggles only the clicked row", () => {
  let sel = clickRow(emptySelection(), { id: "z", orderedIds: ["x", "y", "z"], toggle: true });
  sel = clickRow(sel, { id: "c", orderedIds: ORDER, range: true });
  assert.deepEqual(ids(sel), ["c", "z"]);
  assert.equal(sel.anchor, "c");
  // no anchor at all behaves the same
  const s2 = clickRow(emptySelection(), { id: "b", orderedIds: ORDER, range: true });
  assert.deepEqual(ids(s2), ["b"]);
});

test("setPage on selects every page id; off removes only page ids", () => {
  let sel = selectAll(emptySelection(), ["x"]);
  sel = setPage(sel, ["a", "b"], true);
  assert.deepEqual(ids(sel), ["a", "b", "x"]);
  sel = setPage(sel, ["a", "b"], false);
  assert.deepEqual(ids(sel), ["x"]);
});

test("selection prunes ids no longer present", () => {
  let sel = clickRow(selectAll(emptySelection(), ["a", "b", "c"]), { id: "c", orderedIds: ORDER, toggle: true });
  sel = clickRow(sel, { id: "c", orderedIds: ORDER, toggle: true });
  sel = prune(sel, ["a", "d"]);
  assert.deepEqual(ids(sel), ["a"]);
  assert.equal(sel.anchor, null, "an anchor that left the list is dropped");
  assert.deepEqual(ids(prune(sel, new Set(["a"]))), ["a"], "accepts a Set");
});

test("clear empties the selection and never mutates its input", () => {
  const before = selectAll(emptySelection(), ["a"]);
  const after = clickRow(before, { id: "b", orderedIds: ORDER, toggle: true });
  assert.deepEqual(ids(before), ["a"]);
  assert.deepEqual(ids(after), ["a", "b"]);
  assert.deepEqual(ids(clear()), []);
  assert.equal(clear().anchor, null);
});
