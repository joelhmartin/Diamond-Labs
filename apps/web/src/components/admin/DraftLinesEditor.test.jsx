// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const gets = [];
vi.mock("../../config/api.js", () => ({
  default: {
    get: async (...a) => {
      gets.push(a);
      return { data: { data: { reasons: [
        { id: "rs1", label: "Courtesy", appliesTo: "discount", discountPercent: 10, active: true },
        { id: "rs2", label: "Family", appliesTo: "both", discountPercent: null, active: true },
      ] } } };
    },
  },
}));
const { DraftLinesEditor } = await import("./DraftLinesEditor.jsx");

afterEach(cleanup);

const LINES = [{ id: "il1", kind: "item", description: "DDSO Nylon", qty: 1, unitCents: 10000, lineCents: 10000, priceSource: "client", code: "2608" }];

test("Add discount with a percent reason posts op discount", async () => {
  const onEdit = vi.fn(async () => true);
  render(<DraftLinesEditor lines={LINES} onEdit={onEdit} busy={false} />);
  await waitFor(() => screen.getByRole("option", { name: /Courtesy/ }));
  assert.deepEqual(gets[0], ["/lab/adjustment-reasons", { params: { appliesTo: "discount" } }]);
  const button = screen.getByRole("button", { name: "Add discount" });
  assert.equal(button.disabled, true, "needs a reason and a size");
  fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "rs1" } });
  assert.equal(screen.getByLabelText("Discount value").value, "10", "the reason's default percent prefills");
  fireEvent.click(button);
  await waitFor(() => assert.equal(onEdit.mock.calls.length, 1));
  assert.deepEqual(onEdit.mock.calls[0][0], { op: "discount", reasonId: "rs1", percent: 10 });
});

test("a fixed-amount discount with text and no reason sends amountCents", async () => {
  const onEdit = vi.fn(async () => true);
  render(<DraftLinesEditor lines={LINES} onEdit={onEdit} busy={false} />);
  fireEvent.change(screen.getByLabelText("Discount note"), { target: { value: "Loyal client" } });
  fireEvent.change(screen.getByLabelText("Discount type"), { target: { value: "amount" } });
  fireEvent.change(screen.getByLabelText("Discount value"), { target: { value: "25.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Add discount" }));
  await waitFor(() => assert.equal(onEdit.mock.calls.length, 1));
  assert.deepEqual(onEdit.mock.calls[0][0], { op: "discount", text: "Loyal client", amountCents: 2550 });
});
