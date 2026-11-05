// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { PickupRequestModal } from "../PickupRequestModal.jsx";

// 2026-11-05 18:00 UTC is still Nov 5 in Chicago; 04:00 UTC on Nov 6 is Nov 5 too.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-06T04:00:00Z") });
  api.get.mockResolvedValue({ data: { data: { clients: [{ id: "u1", label: "Acme Dental (Dr. A)" }] } } });
  api.post.mockResolvedValue({ data: { data: { id: "p1", pickupNumber: 7 } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

const mount = (props = {}) => {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<ToastProvider><PickupRequestModal open onClose={onClose} onCreated={onCreated} {...props} /></ToastProvider>);
  return { onClose, onCreated };
};

test("earliest defaults to today (CT) and latest to +2 days", () => {
  mount();
  assert.equal(screen.getByLabelText("Earliest date").value, "2026-11-05");
  assert.equal(screen.getByLabelText("Latest date").value, "2026-11-07");
});

test("client-side validation mirrors the rules (window > 14 days shows an inline error)", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Latest date"), { target: { value: "2026-11-25" } });
  fireEvent.click(screen.getByRole("button", { name: "Request pickup" }));
  assert.match(screen.getByRole("alert").textContent, /at most 14 days/);
  assert.equal(api.post.mock.calls.length, 0);
});

test("submit posts the body and closes", async () => {
  const { onClose, onCreated } = mount();
  fireEvent.change(screen.getByLabelText("Boxes"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "am" } });
  fireEvent.click(screen.getByRole("button", { name: "Request pickup" }));
  await waitFor(() => assert.equal(onClose.mock.calls.length, 1));
  assert.deepEqual(api.post.mock.calls[0], ["/pickups", { earliestDate: "2026-11-05", latestDate: "2026-11-07", timePreference: "am", boxCount: 3 }]);
  assert.equal(onCreated.mock.calls[0][0].pickupNumber, 7);
});

test("staff mode needs a client and posts to /lab/pickups with clientUserId", async () => {
  const { onClose } = mount({ staff: true });
  fireEvent.click(screen.getByRole("button", { name: "Create pickup" }));
  assert.match(screen.getByRole("alert").textContent, /Choose the client/);
  await screen.findByRole("option", { name: "Acme Dental (Dr. A)" });
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: "u1" } });
  fireEvent.click(screen.getByRole("button", { name: "Create pickup" }));
  await waitFor(() => assert.equal(onClose.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], "/lab/pickups");
  assert.equal(api.post.mock.calls[0][1].clientUserId, "u1");
});
