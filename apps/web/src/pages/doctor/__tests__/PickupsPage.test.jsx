// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { PickupsPage } from "../PickupsPage.jsx";

const row = (id, number, status, over = {}) => ({
  id, pickupNumber: number, status, earliestDate: "2026-11-06", latestDate: "2026-11-08", timePreference: "am",
  boxCount: 2, scheduledDate: status === "scheduled" ? "2026-11-07" : null, address: null, version: 1, createdAt: `2026-11-0${number}T10:00:00Z`, ...over,
});
const ROWS = [row("a", 1, "requested"), row("b", 2, "scheduled"), row("c", 3, "completed"), row("d", 4, "cancelled")];

beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { rows: ROWS, total: 4 } } });
  api.post.mockResolvedValue({ data: { data: { id: "a", status: "cancelled", version: 2 } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = () => render(<MemoryRouter><ToastProvider><PickupsPage /></ToastProvider></MemoryRouter>);

test("lists practice pickups in a DataTable", async () => {
  mount();
  await screen.findByText("#1");
  assert.equal(api.get.mock.calls[0][0], "/pickups");
  assert.ok(screen.getByText("#4"));
  assert.equal(screen.getAllByText("11/06/2026 – 11/08/2026").length, 4);
  assert.equal(screen.getAllByText("Scheduled").length >= 1, true);
  assert.ok(screen.getByRole("button", { name: "Request a pickup" }));
});

test("Cancel is a ConfirmButton and only on requested/scheduled rows", async () => {
  mount();
  await screen.findByText("#1");
  const cancels = screen.getAllByRole("button", { name: "Cancel" });
  assert.equal(cancels.length, 2);
  fireEvent.click(cancels[0]);
  assert.equal(api.post.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to cancel" }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0], ["/pickups/a/cancel", { expectedVersion: 1 }]);
});
