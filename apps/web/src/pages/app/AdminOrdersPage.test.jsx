// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn() } }));
const { AdminOrdersPage } = await import("./AdminOrdersPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const reply = (url) => {
  if (url === "/lab/orders") return { data: { data: { orders: [], total: 0 } } };
  if (url === "/lab/departments") return { data: { data: { departments: [] } } };
  if (url === "/lab/staff") return { data: { data: { staff: [] } } };
  return { data: { data: [] } }; // tag definitions
};
const ordersCalls = () => get.mock.calls.filter(([url]) => url === "/lab/orders");

test("AdminOrdersPage turns the URL's filters, search and page into the orders query", async () => {
  get.mockImplementation((url) => Promise.resolve(reply(url)));
  const url = "/admin/orders?" + new URLSearchParams({
    "ord.status": "in_production", "ord.source": "rx", "ord.rush": "1", "ord.starred": "1", "ord.dueBefore": "2026-11-30",
    "ord.q": "smile", "ord.page": "2",
  });
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><AdminOrdersPage /></ToastProvider></MemoryRouter>);
  await waitFor(() => assert.ok(ordersCalls().length > 0));
  const [, opts] = ordersCalls().at(-1);
  assert.deepEqual(opts.params, {
    limit: 20, offset: 20, q: "smile", includeClosed: "true",
    status: "in_production", source: "rx", dueBefore: "2026-11-30", rush: "true", starred: "true",
  });
});

test("AdminOrdersPage with no filters asks for every order, closed ones included, and nothing else", async () => {
  get.mockImplementation((url) => Promise.resolve(reply(url)));
  render(<MemoryRouter initialEntries={["/admin/orders"]}><ToastProvider><AdminOrdersPage /></ToastProvider></MemoryRouter>);
  await waitFor(() => assert.ok(ordersCalls().length > 0));
  assert.deepEqual(ordersCalls().at(-1)[1].params, { limit: 20, offset: 0, includeClosed: "true" });
  assert.ok(await screen.findByText("No orders match."));
});
