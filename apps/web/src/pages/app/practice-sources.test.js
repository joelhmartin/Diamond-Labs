import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { usersSource } = await import("./practice-sources.js");

afterEach(() => get.mockReset());

test("usersSource.list pages server-side: search, page, active only, and the already-chosen ids go in the request", async () => {
  get.mockResolvedValue({ data: { data: { users: [{ id: "u1", name: "Dana", email: "d@x.test" }, { id: "u2", name: null, email: "e@x.test" }], total: 57 } } });
  const out = await usersSource.list({ q: "da", limit: 10, offset: 20, excludeIds: ["x", "y"] });
  assert.deepEqual(get.mock.calls[0], ["/admin/users", { params: { limit: 10, offset: 20, status: "active", q: "da", excludeIds: "x,y" } }]);
  assert.equal(out.total, 57);
  assert.deepEqual(out.rows, [{ id: "u1", label: "Dana", detail: "d@x.test" }, { id: "u2", label: "e@x.test", detail: null }]);
});

test("usersSource.labels asks only for the wanted ids, in chunks, any status", async () => {
  get.mockImplementation((_u, { params }) => Promise.resolve({ data: { data: { users: params.ids.split(",").map((id) => ({ id, name: `N${id}`, email: "" })) } } }));
  const ids = Array.from({ length: 130 }, (_, i) => `u${i}`);
  const out = await usersSource.labels(ids);
  assert.equal(get.mock.calls.length, 3);
  assert.equal(Object.keys(out).length, 130);
  assert.equal(get.mock.calls[0][1].params.status, undefined);
});
