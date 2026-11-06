// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { AlertCenter } from "../AlertCenter.jsx";
import { ROW_BOX } from "../../../components/ui/data-table/testing.js";

const ROWS = [
  { id: "n1", title: "Order 100 shipped", link: "/orders/100", count: 1, readAt: null, updatedAt: "2026-11-05T15:00:00Z" },
  { id: "n2", title: "Order 101 shipped", link: "/orders/101", count: 3, readAt: "2026-11-05T16:00:00Z", updatedAt: "2026-11-05T15:30:00Z" },
];

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { rows: ROWS, total: 2 } } });
  api.post.mockResolvedValue({ data: { data: { updated: 1 } } });
  api.delete.mockResolvedValue({ data: { data: { ok: true } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = () => render(
  <MemoryRouter><ToastProvider><AlertCenter /><Where /></ToastProvider></MemoryRouter>,
);

test("row click navigates to link and marks read", async () => {
  mount();
  fireEvent.click(await screen.findByText("Order 100 shipped"));
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/orders/100"));
  assert.deepEqual(api.post.mock.calls[0], ["/notifications/read", { ids: ["n1"] }]);
});

test("bulk Mark read posts the selected ids", async () => {
  mount();
  await screen.findByText("Order 100 shipped");
  const boxes = screen.getAllByLabelText(ROW_BOX);
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  fireEvent.click(await screen.findByRole("button", { name: /mark read/i }));
  await waitFor(() => assert.deepEqual(api.post.mock.calls[0], ["/notifications/read", { ids: ["n1", "n2"] }]));
});

test("Dismiss is a ConfirmButton (two clicks)", async () => {
  mount();
  await screen.findByText("Order 100 shipped");
  fireEvent.click(screen.getAllByRole("button", { name: /^dismiss$/i })[0]);
  assert.equal(api.delete.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: /click again/i }));
  await waitFor(() => assert.deepEqual(api.delete.mock.calls[0], ["/notifications/n1"]));
});

test("Unread filter sends unread=true", async () => {
  mount();
  await screen.findByText("Order 100 shipped");
  assert.equal(api.get.mock.calls[0][1].params.unread, undefined);
  fireEvent.click(screen.getByRole("button", { name: /unread only/i }));
  await waitFor(() => assert.ok(api.get.mock.calls.some(([, c]) => c.params.unread === "true")));
});
