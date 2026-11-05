// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
const { SchedulePanel } = await import("./SchedulePanel.jsx");

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({
    data: { data: { workflows: [
      { key: "std", name: "Standard", active: true },
      { key: "fast", name: "Fast track", active: true },
      { key: "old", name: "Retired", active: false },
    ] } },
  });
});

const ORDER = { id: "o1", version: 7 };
const SCHEDULE = {
  workflowKey: "std", workflowName: "Standard", direction: "forward", behind: false, atRisk: false,
  stages: [{ key: "a", label: "Design", targetAt: "2026-11-09", reached: true, late: false }, { key: "b", label: "Mill", targetAt: "2026-11-10", reached: false, late: true }],
};

function mount(props = {}) {
  const onChanged = vi.fn();
  render(<ToastProvider><SchedulePanel order={ORDER} schedule={SCHEDULE} onChanged={onChanged} {...props} /></ToastProvider>);
  return onChanged;
}

test("SchedulePanel posts workflowKey, keepDueDate and expectedVersion", async () => {
  post.mockResolvedValue({ data: { data: { id: "o1", version: 8 } } });
  const onChanged = mount();
  const select = await screen.findByLabelText("Workflow");
  await waitFor(() => assert.ok(screen.getByRole("option", { name: "Fast track" })));
  assert.equal(screen.queryByRole("option", { name: "Retired" }), null);
  fireEvent.change(select, { target: { value: "fast" } });
  fireEvent.click(screen.getByLabelText("Keep due date"));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.deepEqual(post.mock.calls[0], ["/lab/orders/o1/workflow", { workflowKey: "fast", keepDueDate: true, expectedVersion: 7 }]);
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});

test("a stale reply toasts and reloads", async () => {
  post.mockRejectedValue({ response: { status: 409, data: { error: { code: "STALE", message: "This order changed." } } } });
  const onChanged = mount();
  const select = await screen.findByLabelText("Workflow");
  await waitFor(() => assert.ok(screen.getByRole("option", { name: "Fast track" })));
  fireEvent.change(select, { target: { value: "fast" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  assert.ok(await screen.findByText(/This order changed\./));
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});

test("renders without a plan and lists stages with the late one marked", async () => {
  mount({ schedule: null });
  assert.ok(await screen.findByText(/No schedule yet/));
  cleanup();
  mount();
  const late = await screen.findByText("Mill");
  assert.match(late.closest("li").className, /text-red-600/);
});
