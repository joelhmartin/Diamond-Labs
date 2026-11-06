import { test } from "vitest";
import assert from "node:assert/strict";
import { fetchAllRows } from "../server.js";

test("fetchAllRows pages until total rows are in, past any single page", async () => {
  const data = Array.from({ length: 450 }, (_, i) => ({ id: i }));
  const calls = [];
  const rows = await fetchAllRows(async ({ limit, offset }) => { calls.push(offset); return { rows: data.slice(offset, offset + limit), total: data.length }; });
  assert.equal(rows.length, 450);
  assert.deepEqual(calls, [0, 200, 400]);
});

test("fetchAllRows stops on an empty page even if total overstates", async () => {
  const rows = await fetchAllRows(async ({ offset }) => ({ rows: offset ? [] : [{ id: 1 }], total: 99 }));
  assert.equal(rows.length, 1);
});

test("fetchAllRows of an empty list is empty", async () => {
  assert.deepEqual(await fetchAllRows(async () => ({ rows: [], total: 0 })), []);
});
