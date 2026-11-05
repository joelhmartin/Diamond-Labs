// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { DeliveryRoutePrintPage } from "../DeliveryRoutePrintPage.jsx";

const address = { address1: "1 Main St", address2: null, city: "Austin", state: "TX", zip: "78701" };
const stop = (id, day, practice, orders, pickups = []) => ({ id, day, late: false, practice, address, phone: "512", deliveryNotes: null, orders, pickups });

beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { from: "2026-11-05", to: "2026-11-07", stops: [
    stop("s1", "2026-11-05", "Alpha Dental", [{ id: "o1", orderNumber: 100101, status: "ready_to_ship", version: 1 }]),
    stop("s2", "2026-11-05", "Beta Ortho", [], [{ id: "p1", pickupNumber: 7, boxCount: 3, version: 1 }]),
    stop("s3", "2026-11-07", "Gamma Smiles", [{ id: "o2", orderNumber: 100102, status: "in_production", version: 1 }]),
  ] } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

test("the print sheet reads from/to, has a section per day with numbered stops and blank Time / Signed columns", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<MemoryRouter initialEntries={["/lab/deliveries/print?from=2026-11-05&to=2026-11-07"]}><DeliveryRoutePrintPage /></MemoryRouter>);
  await screen.findByText("Alpha Dental");
  assert.deepEqual(api.get.mock.calls[0], ["/lab/deliveries", { params: { from: "2026-11-05", to: "2026-11-07" } }]);
  const sections = screen.getAllByRole("table");
  assert.equal(sections.length, 2);
  assert.ok(screen.getByRole("heading", { name: /Thu 11\/05\/2026 · 2 stops/ }));
  assert.ok(screen.getByRole("heading", { name: /Sat 11\/07\/2026 · 1 stop/ }));
  const first = within(sections[0]).getAllByRole("row");
  assert.equal(first[1].cells[0].textContent, "1");
  assert.equal(first[2].cells[0].textContent, "2");
  assert.equal(first[1].cells[4].textContent, "#100101");
  assert.equal(first[2].cells[5].textContent, "#7: 3");
  assert.ok(within(sections[0]).getByRole("columnheader", { name: "Time" }));
  assert.ok(within(sections[0]).getByRole("columnheader", { name: "Signed" }));
  // The second day's numbering restarts.
  assert.equal(within(sections[1]).getAllByRole("row")[1].cells[0].textContent, "1");
  fireEvent.click(screen.getByRole("button", { name: /Print/ }));
  assert.equal(print.mock.calls.length, 1);
});
