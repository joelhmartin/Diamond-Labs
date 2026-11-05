// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("../config/api.js", () => ({ default: { get: (...a) => get(...a) } }));
const { useResource } = await import("./useResource.js");

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const reply = (data) => ({ data: { data } });

beforeEach(() => get.mockReset());

test("a reload that finishes after a newer reload does not overwrite it", async () => {
  const first = deferred();
  const second = deferred();
  get.mockResolvedValueOnce(reply("initial")).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useResource("/x"));
  await waitFor(() => expect(result.current.data).toBe("initial"));
  act(() => { result.current.reload(); });
  act(() => { result.current.reload(); });
  await act(async () => { second.resolve(reply("newest")); });
  await act(async () => { first.resolve(reply("older")); });
  expect(result.current.data).toBe("newest");
});

test("a reload that settles after unmount sets no state", async () => {
  const pending = deferred();
  get.mockResolvedValueOnce(reply("initial")).mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(() => useResource("/x"));
  await waitFor(() => expect(result.current.data).toBe("initial"));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  act(() => { result.current.reload(); });
  unmount();
  await act(async () => { pending.resolve(reply("late")); });
  expect(errorSpy).not.toHaveBeenCalled();
  expect(result.current.data).toBe("initial");
  errorSpy.mockRestore();
});
