// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
let modalProps = null;
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn() } }));
vi.mock("../../hooks/usePaymentsPaused.js", () => ({ usePaymentsPaused: () => false }));
vi.mock("../../components/billing/StatementDownload.jsx", () => ({ StatementDownload: () => null }));
vi.mock("../../components/doctor/PaymentModal.jsx", () => ({
  PaymentModal: (props) => { modalProps = props; return <div>PAYMENT MODAL</div>; },
}));
const { InvoicesPage } = await import("./InvoicesPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); modalProps = null; });

const row = (id, n, over) => ({
  id, invoiceNumber: n, status: "issued", balanceCents: 5000, totalCents: 5000,
  dueDate: "2099-01-01", issuedAt: "2026-01-01T12:00:00Z", labOrderNumber: null, patientInitials: "AB", ...over,
});
const INVOICES = [
  row("i1", 101),
  row("i2", 102, { status: "paid", balanceCents: 0 }),
  row("i3", 103, { balanceCents: 2500, totalCents: 2500 }),
];

function mount() {
  get.mockResolvedValue({ data: { data: INVOICES } });
  render(<MemoryRouter><ToastProvider><InvoicesPage /></ToastProvider></MemoryRouter>);
}

test('doctor InvoicesPage: only payable invoices are selectable and "Pay selected" opens the payment modal with them', async () => {
  mount();
  await screen.findByText("#101");
  const boxes = screen.getAllByLabelText("Select row");
  // The paid invoice (second row) can't be selected.
  fireEvent.click(boxes[1]);
  assert.equal(screen.queryByText(/selected/), null);
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[2]);
  fireEvent.click(await screen.findByRole("button", { name: /Pay selected/ }));
  await screen.findByText("PAYMENT MODAL");
  assert.deepEqual(modalProps.invoices.map((i) => i.id).sort(), ["i1", "i3"]);
  assert.deepEqual(modalProps.invoices.find((i) => i.id === "i3"), { id: "i3", invoiceNumber: 103, balanceCents: 2500, dueDate: "2099-01-01" });
});

test("doctor InvoicesPage: search by invoice number narrows the list", async () => {
  mount();
  await screen.findByText("#101");
  fireEvent.change(screen.getByLabelText(/invoice/i, { selector: "input" }), { target: { value: "103" } });
  await waitFor(() => assert.equal(screen.queryByText("#101"), null));
  assert.ok(screen.getByText("#103"));
});
