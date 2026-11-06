import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { tagBulkActions } from "./tagBulkActions.js";

const DEFS = [
  { id: "t1", label: "Urgent", color: "red", active: true },
  { id: "t2", label: "Check", color: "blue", active: true },
  { id: "t3", label: "Old", color: "slate", active: false },
];
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, orderNumber: 100 + i, tags: i === 0 ? [DEFS[2]] : [] }));

function setup(selected, extra = {}) {
  const client = { post: vi.fn(async (_p, body) => ({ data: { data: { ok: true, failed: [] } } })), put: vi.fn(async () => ({})) };
  const after = vi.fn();
  const actions = tagBulkActions(selected, { recordType: "widget", definitions: DEFS, client, after, ...extra });
  return { actions, client, after, byId: Object.fromEntries(actions.map((a) => [a.id, a])) };
}

test("tagBulkActions posts one request with every selected id", async () => {
  const selected = rows(3);
  const { byId, client, after } = setup(selected);
  assert.deepEqual(byId["tag-add"].choices.map((c) => c.value), ["t1", "t2"], "only active tags can be added");
  const out = await byId["tag-add"].run(selected, "t2");
  assert.equal(client.post.mock.calls.length, 1);
  assert.equal(client.post.mock.calls[0][0], "/tags/widget/apply");
  assert.deepEqual(client.post.mock.calls[0][1], { ids: ["r1", "r2", "r3"], add: ["t2"], remove: [] });
  assert.deepEqual(out, { ok: 3, failed: [] });
  assert.equal(after.mock.calls.length, 1);
});

test("remove offers the labels the selected rows carry, and posts a remove", async () => {
  const selected = rows(2);
  const { byId, client } = setup(selected);
  assert.deepEqual(byId["tag-remove"].choices.map((c) => c.value), ["t3"]);
  await byId["tag-remove"].run(selected, "t3");
  assert.deepEqual(client.post.mock.calls[0][1], { ids: ["r1", "r2"], add: [], remove: ["t3"] });
});

test("rows the server could not find come back named, and are not counted done", async () => {
  const selected = rows(3);
  const { byId, client } = setup(selected, { labelOf: (r) => `#${r.orderNumber}` });
  client.post.mockResolvedValueOnce({ data: { data: { ok: true, failed: [{ id: "r2", message: "not found" }] } } });
  const out = await byId["tag-add"].run(selected, "t1");
  assert.deepEqual(out, { ok: 2, failed: [{ id: "#101", rowId: "r2", message: "not found" }] });
});

test("more than 500 rows go in chunks of 500, and the results add up", async () => {
  const selected = rows(1200);
  const { byId, client } = setup(selected);
  const out = await byId["tag-add"].run(selected, "t1");
  assert.deepEqual(client.post.mock.calls.map((c) => c[1].ids.length), [500, 500, 200]);
  assert.equal(out.ok, 1200);
});

test("a failed request still reloads the list", async () => {
  const selected = rows(1);
  const { byId, client, after } = setup(selected);
  client.post.mockRejectedValueOnce(new Error("boom"));
  await assert.rejects(byId["tag-add"].run(selected, "t1"));
  assert.equal(after.mock.calls.length, 1);
});

test("star stars each selected row for the caller", async () => {
  const selected = rows(2);
  const { byId, client } = setup(selected);
  const out = await byId["tag-star"].run(selected);
  assert.deepEqual(client.put.mock.calls.map((c) => c[0]), ["/tags/widget/r1/star", "/tags/widget/r2/star"]);
  assert.deepEqual(out, { ok: 2, failed: [] });
});
