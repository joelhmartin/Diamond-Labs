// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn() } }));
const { ShipmentsPage } = await import("../ShipmentsPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const reply = (url) => {
  if (url === "/lab/shipments") return { data: { data: { shipments: [], total: 0 } } };
  return { data: { data: { carriers: [] } } };
};
const shipmentCalls = () => get.mock.calls.filter(([url]) => url === "/lab/shipments");

test("ShipmentsPage turns the URL's status, carrier, dates, search and page into the shipments query", async () => {
  get.mockImplementation((url) => Promise.resolve(reply(url)));
  const url = "/admin/shipments?" + new URLSearchParams({
    "shp.status": "label_purchased", "shp.carrier": "ups", "shp.from": "2026-11-01", "shp.to": "2026-11-05", "shp.q": "1Z99", "shp.page": "3",
  });
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><ShipmentsPage /></ToastProvider></MemoryRouter>);
  await waitFor(() => assert.ok(shipmentCalls().length > 0));
  assert.deepEqual(shipmentCalls().at(-1)[1].params, {
    status: "label_purchased", carrier: "ups", from: "2026-11-01", to: "2026-11-05", limit: 20, offset: 40, q: "1Z99",
  });
});

test("ShipmentsPage with no filters sends only the paging", async () => {
  get.mockImplementation((url) => Promise.resolve(reply(url)));
  render(<MemoryRouter initialEntries={["/admin/shipments"]}><ToastProvider><ShipmentsPage /></ToastProvider></MemoryRouter>);
  await waitFor(() => assert.ok(shipmentCalls().length > 0));
  assert.deepEqual(shipmentCalls().at(-1)[1].params, { limit: 20, offset: 0 });
  assert.ok(screen.getByRole("heading", { name: "Shipments" }));
});
