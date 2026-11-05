// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { DeliveriesPage } from "../DeliveriesPage.jsx";

const address = { address1: "1 Main St", address2: null, city: "Austin", state: "TX", zip: "78701" };
const STOPS = [
  {
    id: "2026-11-05:practice:P1", day: "2026-11-05", late: true, practice: "Smile Dental", address, phone: "512-555-0100", deliveryNotes: "Back door",
    orders: [
      { id: "o1", orderNumber: 100101, status: "ready_to_ship", version: 4 },
      { id: "o2", orderNumber: 100102, status: "in_production", version: 2 },
    ],
    pickups: [{ id: "p1", pickupNumber: 7, boxCount: 2, version: 3 }],
  },
  {
    id: "2026-11-07:practice:P2", day: "2026-11-07", late: false, practice: "North Ortho", address, phone: null, deliveryNotes: null,
    orders: [{ id: "o3", orderNumber: 100103, status: "ready_to_ship", version: 9 }],
    pickups: [],
  },
];

beforeEach(() => {
  api.get.mockImplementation((url, cfg) => Promise.resolve({ data: { data: { ...cfg.params, stops: STOPS } } }));
  api.post.mockResolvedValue({ data: { data: { ok: true } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); vi.restoreAllMocks(); });

const mount = () => render(<MemoryRouter initialEntries={["/lab/deliveries"]}><ToastProvider><DeliveriesPage /></ToastProvider></MemoryRouter>);
const selectStop = (practice) => fireEvent.click(screen.getByText(practice).closest("tr").querySelector("input[type=checkbox]"));

test("date-range filter defaults today..+6 (CT)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T03:00:00Z")); // still the 5th in Chicago
  mount();
  await screen.findByText("Smile Dental");
  const call = api.get.mock.calls.find(([u]) => u === "/lab/deliveries");
  assert.deepEqual(call[1].params, { from: "2026-11-05", to: "2026-11-11" });
  assert.equal(screen.getByLabelText("From").value, "2026-11-05");
  assert.equal(screen.getByLabelText("To").value, "2026-11-11");
  // Grouped by day; the late stop is flagged.
  assert.ok(screen.getByText(/Thu 11\/05\/2026/));
  assert.ok(screen.getByText(/Sat 11\/07\/2026/));
  assert.ok(screen.getByText("Late"));
});

test("bulk Mark delivered loops /status to shipped for ready orders and toasts skipped ones", async () => {
  mount();
  await screen.findByText("Smile Dental");
  selectStop("Smile Dental");
  selectStop("North Ortho");
  // Shipping issues invoices, so it is a two-click ConfirmButton.
  fireEvent.click(screen.getByRole("button", { name: /Mark delivered/ }));
  assert.equal(api.post.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to mark delivered" }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 2));
  assert.deepEqual(api.post.mock.calls[0], ["/lab/orders/o1/status", { to: "shipped", expectedVersion: 4 }]);
  assert.deepEqual(api.post.mock.calls[1], ["/lab/orders/o3/status", { to: "shipped", expectedVersion: 9 }]);
  await screen.findByText("2 done, 1 failed: #100102 not ready to ship (In production)");
});

test("Pickups collected loops /complete", async () => {
  mount();
  await screen.findByText("Smile Dental");
  selectStop("Smile Dental");
  fireEvent.click(screen.getByRole("button", { name: /Pickups collected/ }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0], ["/lab/pickups/p1/complete", { expectedVersion: 3 }]);
  await screen.findByText("1 done");
});

test("Print route opens the print path with from/to", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  mount();
  await screen.findByText("Smile Dental");
  selectStop("Smile Dental");
  selectStop("North Ortho");
  fireEvent.click(screen.getByRole("button", { name: /Print route/ }));
  assert.equal(open.mock.calls.length, 1);
  assert.equal(open.mock.calls[0][0], "/lab/deliveries/print?from=2026-11-05&to=2026-11-07");
  assert.equal(open.mock.calls[0][1], "_blank");
});
