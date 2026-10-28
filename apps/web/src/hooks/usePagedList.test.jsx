// @vitest-environment jsdom
import { test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedList } from "./usePagedList.js";

const rows = Array.from({ length: 50 }, (_, i) => i);

test("filter change returns to page 1 and clearing it stays on page 1", () => {
  const { result, rerender } = renderHook(({ f }) => usePagedList(f ? rows.slice(0, 5) : rows, { resetKeys: [f], initialPageSize: 10 }), { initialProps: { f: "" } });
  act(() => result.current.pagination.setPage(2));
  expect(result.current.pagination.page).toBe(2);
  rerender({ f: "x" });
  expect(result.current.pagination.page).toBe(1);
  rerender({ f: "" });
  expect(result.current.pagination.page).toBe(1);
});

test("page state is clamped when the list shrinks without a reset key", () => {
  const { result, rerender } = renderHook(({ n }) => usePagedList(rows.slice(0, n), { initialPageSize: 10 }), { initialProps: { n: 50 } });
  act(() => result.current.pagination.setPage(5));
  rerender({ n: 15 });
  expect(result.current.pagination.page).toBe(2);
  rerender({ n: 50 });
  expect(result.current.pagination.page).toBe(2);
});
