// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useUnreadPoll } from "../useUnreadPoll.js";

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => { vi.useFakeTimers(); setVisibility("visible"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("polls every interval while visible", async () => {
  const fetchCount = vi.fn().mockResolvedValue(3);
  const { result } = renderHook(() => useUnreadPoll(fetchCount, { intervalMs: 1000 }));
  await act(async () => {});
  assert.equal(fetchCount.mock.calls.length, 1);
  assert.equal(result.current.count, 3);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  assert.equal(fetchCount.mock.calls.length, 4);
});

test("does not poll while hidden and refreshes on becoming visible", async () => {
  const fetchCount = vi.fn().mockResolvedValue(1);
  renderHook(() => useUnreadPoll(fetchCount, { intervalMs: 1000 }));
  await act(async () => {});
  const before = fetchCount.mock.calls.length;
  await act(async () => { setVisibility("hidden"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  assert.equal(fetchCount.mock.calls.length, before);
  await act(async () => { setVisibility("visible"); });
  assert.equal(fetchCount.mock.calls.length, before + 1);
});
