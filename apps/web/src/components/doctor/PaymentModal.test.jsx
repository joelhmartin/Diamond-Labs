// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../config/api.js", () => ({ default: api }));
vi.mock("./HostedPaymentForm.jsx", () => ({ HostedPaymentForm: () => null }));

import { PaymentModal } from "./PaymentModal.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("invoices from two practices go out as ONE saved-card charge", async () => {
  api.get.mockResolvedValue({ data: { data: [{ paymentProfileId: "pp1", cardType: "Visa", cardNumber: "XXXX1111", isDefault: true }] } });
  api.post.mockResolvedValue({ data: { data: {} } });
  const onSuccess = vi.fn();
  const invoices = [
    { id: "n1", invoiceNumber: 201, balanceCents: 5000, dueDate: "2026-11-01", ownerName: "North Dental" },
    { id: "s1", invoiceNumber: 301, balanceCents: 4000, dueDate: "2026-11-02", ownerName: "South Dental" },
  ];
  render(<ToastProvider><PaymentModal invoices={invoices} onClose={() => {}} onSuccess={onSuccess} /></ToastProvider>);
  assert.ok(screen.getByText("North Dental"));
  assert.ok(screen.getByText("South Dental"));
  fireEvent.click(await screen.findByRole("button", { name: /Saved card/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Pay $90.00" }));
  await waitFor(() => assert.equal(onSuccess.mock.calls.length, 1));
  assert.equal(api.post.mock.calls.length, 1);
  const [url, body] = api.post.mock.calls[0];
  assert.equal(url, "/payments/charge-saved");
  assert.equal(body.amountCents, 9000);
  assert.deepEqual(body.allocations.map((a) => [a.invoiceId, a.amountCents]), [["n1", 5000], ["s1", 4000]]);
});
