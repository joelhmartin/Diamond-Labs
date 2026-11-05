// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast.jsx";

// A plain recorder, not vi.fn(): vitest 2 re-throws a rejected mock result as an unhandled error.
const calls = [];
let reply = async () => ({});
const patch = { get mock() { return { calls }; }, mockReset() { calls.length = 0; reply = async () => ({}); }, mockResolvedValue(v) { reply = async () => v; }, mockImplementation(f) { reply = f; } };
vi.mock("../../config/api.js", () => ({ default: { patch: (...a) => { calls.push(a); return reply(...a); } } }));
const { ProductionPanel } = await import("./ProductionPanel.jsx");

afterEach(cleanup);
beforeEach(() => patch.mockReset());

const ORDER = { id: "lo-1", version: 4, status: "received", panNumber: null, deliveryMethod: null, enclosures: [] };

function mount(onChanged = vi.fn(), order = ORDER) {
  render(<ToastProvider><ProductionPanel order={order} onChanged={onChanged} /></ToastProvider>);
  return onChanged;
}

test("ticking Digital and entering a date PATCHes enclosures with that item", async () => {
  patch.mockResolvedValue({});
  const onChanged = mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "Digital" }));
  fireEvent.change(screen.getByLabelText("Digital date"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Save enclosed items" }));
  await waitFor(() => assert.equal(patch.mock.calls.length, 1));
  assert.deepEqual(patch.mock.calls[0], ["/lab/orders/lo-1", { field: "enclosures", value: [{ kind: "digital", date: "2026-10-01" }], expectedVersion: 4 }]);
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});

test("a STALE reply shows the reload toast and reloads the order", async () => {
  const stale = Object.assign(new Error("stale"), { response: { status: 409, data: { error: { code: "STALE", message: "This order changed — reload." } } } });
  patch.mockImplementation(async () => { throw stale; });
  const onChanged = mount();
  fireEvent.change(screen.getByLabelText("Pan number"), { target: { value: "P-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  assert.ok(await screen.findByText(/This order changed — reload\. The latest version has been loaded\./));
  assert.equal(onChanged.mock.calls.length, 1);
  assert.deepEqual(patch.mock.calls[0][1], { field: "pan", value: "P-12", expectedVersion: 4 });
});

test("delivery saves on change; a shipped order's fields are locked", async () => {
  patch.mockResolvedValue({});
  mount();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ups" } });
  await waitFor(() => assert.deepEqual(patch.mock.calls[0][1], { field: "delivery", value: "ups", expectedVersion: 4 }));
  cleanup();
  mount(vi.fn(), { ...ORDER, status: "shipped" });
  assert.equal(screen.getByLabelText("Pan number").disabled, true);
  assert.equal(screen.getByRole("checkbox", { name: "Digital" }).disabled, true);
});
