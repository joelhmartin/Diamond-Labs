// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/Toast.jsx";
import { BoardTableView } from "./BoardTableView.jsx";
import { groupByStatus } from "../../lib/lab-board.js";

afterEach(cleanup);

const CARDS = [
  { id: "a", orderNumber: 101, status: "received", practice: "Alpha Dental", deviceSummary: "Crown", version: 1, overdue: true, dueDate: "2026-10-01" },
  { id: "b", orderNumber: 102, status: "received", practice: "Beta Dental", deviceSummary: "Bridge", version: 2 },
  { id: "c", orderNumber: 103, status: "shipped", practice: "Gamma", deviceSummary: "Night guard", version: 3 },
];

function mount(extra = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BoardTableView columns={groupByStatus(CARDS)} busyId={null} onMove={() => {}} onChanged={() => {}} {...extra} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

test("sections start collapsed; clicking a header expands it and shows its rows with move buttons", () => {
  mount();
  assert.equal(screen.queryByText("#101"), null);
  const header = screen.getByRole("button", { name: /Received/ });
  assert.equal(header.getAttribute("aria-expanded"), "false");
  assert.ok(within(header).getByText(/1 overdue/));
  fireEvent.click(header);
  assert.ok(screen.getByText("#101"));
  assert.ok(screen.getByText("#102"));
  assert.equal(screen.queryByText("#103"), null);
  assert.equal(screen.getAllByRole("button", { name: "→ In production" }).length, 2);
});

test('selecting two rows offers "Move to <label>" for their common move', async () => {
  const post = vi.fn(async () => ({}));
  const onChanged = vi.fn();
  mount({ post, onChanged });
  fireEvent.click(screen.getByRole("button", { name: /Received/ }));
  const boxes = screen.getAllByRole("checkbox", { name: "Select row" });
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  const action = screen.getByRole("button", { name: /Move to In production/ });
  fireEvent.click(action);
  await waitFor(() => assert.equal(post.mock.calls.length, 2));
  assert.deepEqual(post.mock.calls[1], ["b", { to: "in_production", expectedVersion: 2 }]);
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});
