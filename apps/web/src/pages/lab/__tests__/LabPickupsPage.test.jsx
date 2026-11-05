// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { LabPickupsPage } from "../LabPickupsPage.jsx";

const row = (id, number, status, over = {}) => ({
  id, pickupNumber: number, status, clientName: `Dr ${number}`, companyName: `Practice ${number}`, earliestDate: "2026-11-06",
  latestDate: "2026-11-08", timePreference: "any", boxCount: number, scheduledDate: null, assigneeName: null,
  address: { name: `Practice ${number}`, address1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" },
  notes: "Back door", version: number + 10, createdAt: `2026-11-0${number}T10:00:00Z`, ...over,
});
const REQUESTED = [row("a", 1, "requested"), row("b", 2, "requested")];
const SCHEDULED = [row("c", 3, "scheduled", { scheduledDate: "2026-11-07", address: null })];

beforeEach(() => {
  api.get.mockImplementation((url, cfg) => {
    if (url === "/lab/staff") return Promise.resolve({ data: { data: { staff: [{ id: "s1", name: "Dana Driver" }] } } });
    const one = /^\/lab\/pickups\/(.+)$/.exec(url);
    if (one) {
      const hit = [...REQUESTED, ...SCHEDULED].find((r) => r.id === one[1]);
      return hit ? Promise.resolve({ data: { data: hit } }) : Promise.reject({ response: { status: 404, data: { error: { message: "Pickup not found." } } } });
    }
    const rows = cfg?.params?.status === "open" ? [...REQUESTED, ...SCHEDULED] : [];
    return Promise.resolve({ data: { data: { rows, total: rows.length } } });
  });
  api.post.mockResolvedValue({ data: { data: { ok: true } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = (path = "/lab/pickups") => render(<MemoryRouter initialEntries={[path]}><ToastProvider><LabPickupsPage /></ToastProvider></MemoryRouter>);
const select = (n) => fireEvent.click(screen.getByText(`#${n}`).closest("tr").querySelector("input[type=checkbox]"));

test("default filter is open (requested+scheduled)", async () => {
  mount();
  await screen.findByText("#1");
  const calls = api.get.mock.calls.filter(([u]) => u === "/lab/pickups");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].params.status, "open");
  assert.ok(screen.getByText("#3"));
});

test("bulk Schedule opens ScheduleModal and loops /schedule with each expectedVersion, toasting STALE failures", async () => {
  api.post.mockImplementation((url) => (url === "/lab/pickups/b/schedule"
    ? Promise.reject({ response: { status: 409, data: { error: { code: "STALE", message: "This pickup changed — reload." } } } })
    : Promise.resolve({ data: { data: { ok: true } } })));
  mount();
  await screen.findByText("#1");
  select(1); select(2);
  fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
  const dialog = await screen.findByRole("heading", { name: "Schedule 2 pickups" });
  assert.ok(dialog);
  fireEvent.change(screen.getByLabelText("Pickup date"), { target: { value: "2026-11-09" } });
  await screen.findByRole("option", { name: "Dana Driver" });
  fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "s1" } });
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 2));
  assert.deepEqual(api.post.mock.calls[0], ["/lab/pickups/a/schedule", { scheduledDate: "2026-11-09", assigneeUserId: "s1", expectedVersion: 11 }]);
  assert.equal(api.post.mock.calls[1][1].expectedVersion, 12);
  await screen.findByText(/1 done, 1 failed: #2 This pickup changed/);
});

test("bulk Complete loops /complete", async () => {
  mount();
  await screen.findByText("#1");
  select(3);
  fireEvent.click(screen.getByRole("button", { name: /Complete/ }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0], ["/lab/pickups/c/complete", { expectedVersion: 13 }]);
  await screen.findByText("1 done");
});

test("deep link ?pickup=<id> opens that row", async () => {
  mount("/lab/pickups?pickup=a");
  await screen.findByRole("heading", { name: "Pickup #1" });
  assert.ok(screen.getByText(/1 Main St/));
  assert.ok(screen.getByText("Back door"));
});

test("a row with no address shows the empty note in the detail", async () => {
  mount("/lab/pickups?pickup=c");
  await screen.findByRole("heading", { name: "Pickup #3" });
  assert.ok(screen.getByText("No address on file"));
});

test("a deep link to a missing pickup toasts not found", async () => {
  mount("/lab/pickups?pickup=zzz");
  await screen.findByText("That pickup was not found.");
  assert.equal(screen.queryByRole("heading", { name: /^Pickup #/ }), null);
});

test("Schedule from the detail closes the detail before opening the schedule modal", async () => {
  mount("/lab/pickups?pickup=a");
  await screen.findByRole("heading", { name: "Pickup #1" });
  fireEvent.click(screen.getByRole("button", { name: "Schedule…" }));
  await screen.findByRole("heading", { name: "Schedule 1 pickup" });
  assert.equal(screen.queryByRole("heading", { name: "Pickup #1" }), null);
});
