// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast.jsx";

const puts = [];
vi.mock("../../config/api.js", () => ({
  default: {
    get: async () => ({ data: { data: { suggestions: ["Acrylic", "Zirconia"] } } }),
    put: async (...a) => { puts.push(a); return { data: { data: { materials: [] } } }; },
  },
}));
const { MaterialsRow } = await import("./MaterialsRow.jsx");

afterEach(cleanup);
beforeEach(() => { puts.length = 0; });

const LINE = { id: "l1", name: "Night guard", materials: [{ id: "m1", material: "Acrylic", lotNumber: "A1", position: 0 }] };

test("saving replaces the line's materials with the edited list", async () => {
  const onChanged = vi.fn();
  render(<ToastProvider><MaterialsRow order={{ id: "lo-1", status: "shipped" }} line={LINE} onChanged={onChanged} /></ToastProvider>);
  assert.equal(screen.getByLabelText("Material 1").value, "Acrylic");
  fireEvent.click(screen.getByRole("button", { name: "Add material" }));
  fireEvent.change(screen.getByLabelText("Material 2"), { target: { value: "Zirconia" } });
  fireEvent.change(screen.getByLabelText("Lot number 2"), { target: { value: "Z9" } });
  fireEvent.click(screen.getByRole("button", { name: "Save materials" }));
  await waitFor(() => assert.equal(puts.length, 1));
  assert.deepEqual(puts[0], ["/lab/orders/lo-1/lines/l1/materials", { materials: [{ material: "Acrylic", lot: "A1" }, { material: "Zirconia", lot: "Z9" }] }]);
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});

test("a cancelled order's materials are read-only", () => {
  render(<ToastProvider><MaterialsRow order={{ id: "lo-1", status: "cancelled" }} line={LINE} /></ToastProvider>);
  assert.equal(screen.getByLabelText("Material 1").disabled, true);
  assert.equal(screen.queryByRole("button", { name: "Save materials" }), null);
});
