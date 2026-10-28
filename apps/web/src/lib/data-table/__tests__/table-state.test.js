import { test } from "vitest";
import assert from "node:assert/strict";
import { applyClient, pageSlice, isEmptyFilterValue, paginationProps } from "../table-state.js";

const ROWS = [
  { id: "1", name: "Bravo", status: "open", total: 30, tags: ["rush"] },
  { id: "2", name: "alpha", status: "paid", total: 5, tags: [] },
  { id: "3", name: "Charlie", status: "open", total: null, tags: ["rush", "remake"] },
  { id: "4", name: "Delta", status: "void", total: 12, tags: ["remake"] },
];
const columns = [
  { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { id: "total", header: "Total", cell: (r) => r.total, sortValue: (r) => r.total },
  { id: "status", header: "Status", cell: (r) => r.status },
];
const filterDefs = [
  { id: "status", label: "Status", type: "multiselect", match: (r, v) => v.includes(r.status) },
  { id: "rush", label: "Rush", type: "toggle", match: (r) => r.tags.includes("rush") },
  { id: "tag", label: "Tag", type: "select", match: (r, v) => r.tags.includes(v) },
];
const searchFn = (r, q) => r.name.toLowerCase().includes(q.toLowerCase());
const run = (opts) => applyClient(ROWS, { columns, filterDefs, searchFn, filters: {}, ...opts }).map((r) => r.id);

test("applyClient searches, filters (skipping empty values) and sorts asc/desc with sortValue", () => {
  assert.deepEqual(run({}), ["1", "2", "3", "4"], "nothing set returns the input order");
  assert.deepEqual(run({ q: "  ALPHA " }), ["2"], "q is trimmed before searchFn");
  assert.deepEqual(run({ q: "   " }), ["1", "2", "3", "4"], "a blank q does not search");
  assert.deepEqual(run({ filters: { status: ["open", "void"] } }), ["1", "3", "4"]);
  assert.deepEqual(run({ filters: { status: [], rush: false, tag: "" } }), ["1", "2", "3", "4"], "empty values skip");
  assert.deepEqual(run({ filters: { status: ["open"], rush: true, tag: "remake" } }), ["3"], "filters combine with AND");
  assert.deepEqual(run({ q: "a", filters: { rush: true } }), ["1", "3"]);
  assert.deepEqual(run({ sort: { id: "name", dir: "asc" } }), ["2", "1", "3", "4"], "strings sort case-insensitively");
  assert.deepEqual(run({ sort: { id: "name", dir: "desc" } }), ["4", "3", "1", "2"]);
  assert.deepEqual(run({ sort: { id: "total", dir: "asc" } }), ["2", "4", "1", "3"], "numbers sort numerically, blanks last");
  assert.deepEqual(run({ sort: { id: "total", dir: "desc" } }), ["1", "4", "2", "3"], "blanks stay last descending too");
  assert.deepEqual(run({ sort: { id: "status", dir: "asc" } }), ["1", "2", "3", "4"], "a column without sortValue leaves order alone");
  assert.equal(ROWS[0].id, "1", "the input is not mutated");
});

test("pageSlice returns the right window and an empty array past the end", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(pageSlice(rows, 1, 20), rows.slice(0, 20));
  assert.deepEqual(pageSlice(rows, 2, 20), [20, 21, 22, 23, 24]);
  assert.deepEqual(pageSlice(rows, 3, 20), []);
});

test("isEmptyFilterValue treats blank, false and empty lists as unset", () => {
  for (const v of [undefined, null, "", "  ", false, []]) assert.equal(isEmptyFilterValue(v), true, JSON.stringify(v));
  for (const v of ["x", true, ["a"], 0]) assert.equal(isEmptyFilterValue(v), false, JSON.stringify(v));
});

const noop = () => {};
const pp = (total, page, pageSize = 10) => {
  const { setPage, setPageSize, ...rest } = paginationProps({ total, page, pageSize, setPage: noop, setPageSize: noop });
  return rest;
};

test("paginationProps: no rows is one empty page", () => {
  assert.deepEqual(pp(0, 1), { page: 1, pageSize: 10, total: 0, totalPages: 1, rangeStart: 0, rangeEnd: 0 });
});

test("paginationProps: an exact multiple fills the last page", () => {
  assert.deepEqual(pp(30, 3), { page: 3, pageSize: 10, total: 30, totalPages: 3, rangeStart: 21, rangeEnd: 30 });
  assert.deepEqual(pp(31, 4), { page: 4, pageSize: 10, total: 31, totalPages: 4, rangeStart: 31, rangeEnd: 31 });
});

test("paginationProps: a page past the end clamps to the last page", () => {
  assert.deepEqual(pp(25, 9), { page: 3, pageSize: 10, total: 25, totalPages: 3, rangeStart: 21, rangeEnd: 25 });
});

test("paginationProps: changing the page size goes back to page 1", () => {
  const calls = [];
  const p = paginationProps({ total: 50, page: 4, pageSize: 10, setPage: (n) => calls.push(["page", n]), setPageSize: (n) => calls.push(["size", n]) });
  p.setPageSize(50);
  assert.deepEqual(calls, [["size", 50], ["page", 1]]);
});
