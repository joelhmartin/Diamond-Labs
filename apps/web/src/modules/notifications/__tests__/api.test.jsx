// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { markReadMany } from "../api.js";

afterEach(() => vi.clearAllMocks());

test("markReadMany sends at most 200 ids per request and covers every id", async () => {
  api.post.mockResolvedValue({ data: { data: { updated: 1 } } });
  const ids = Array.from({ length: 450 }, (_, i) => `n${i}`);
  await markReadMany(ids);
  assert.deepEqual(api.post.mock.calls.map(([, b]) => b.ids.length), [200, 200, 50]);
  assert.deepEqual(api.post.mock.calls.flatMap(([, b]) => b.ids), ids);
});
