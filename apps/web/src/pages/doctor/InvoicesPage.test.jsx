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
const { useAccountStore } = await import("../../stores/account.store.js");

afterEach(() => { cleanup(); get.mockReset(); modalProps = null; useAccountStore.getState().clearClientScope(); sessionStorage.clear(); });

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
  fireEvent.click(await screen.findByRole("button", { name: "Pay selected ($75.00)" }));
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

const acct = (id, name, n, payable = true) => ({ id, name, accountNumber: n, organizationId: "g1", via: "org-admin", role: payable ? "admin" : "viewer", payable });
const setScope = (accounts, organizations = []) => useAccountStore.setState({ clientScope: { accounts, organizations }, practiceScope: "all", clientScopeLoaded: true });
const MULTI = [
  row("n1", 201, { accountId: "a1", accountName: "North Dental", accountNumber: "1001" }),
  row("s1", 301, { accountId: "a2", accountName: "South Dental", accountNumber: "1002", balanceCents: 4000, totalCents: 4000 }),
];
function mountMulti(accounts, organizations) {
  setScope(accounts, organizations);
  get.mockResolvedValue({ data: { data: MULTI, meta: { balanceCents: 9000 } } });
  render(<MemoryRouter><ToastProvider><InvoicesPage /></ToastProvider></MemoryRouter>);
}

test("All practices shows the Practice column and combined balance", async () => {
  mountMulti([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002")]);
  await screen.findByText("#201");
  assert.ok(screen.getByRole("columnheader", { name: /Practice/ }));
  const cells = screen.getAllByRole("cell").map((c) => c.textContent);
  assert.ok(cells.includes("North Dental (1001)"));
  assert.ok(cells.includes("South Dental (1002)"));
  assert.ok(screen.getByText("$90.00"));
  assert.match(document.body.textContent, /Balance due, all practices/);
  // "All practices" asks for no account: the server returns the whole scope.
  assert.equal(get.mock.calls[0][1], undefined);
});

test("pay selects invoices from two practices and hands both to one payment", async () => {
  mountMulti([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002")]);
  await screen.findByText("#201");
  for (const box of screen.getAllByLabelText("Select row")) fireEvent.click(box);
  fireEvent.click(await screen.findByRole("button", { name: "Pay selected ($90.00)" }));
  await screen.findByText("PAYMENT MODAL");
  assert.deepEqual(modalProps.invoices.map((i) => [i.id, i.ownerName]).sort(), [["n1", "North Dental"], ["s1", "South Dental"]]);
});

test("viewer rows are not selectable for pay", async () => {
  mountMulti([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002", false)]);
  await screen.findByText("#201");
  const [north, south] = screen.getAllByLabelText("Select row");
  fireEvent.click(south);
  assert.equal(screen.queryByText(/selected/), null);
  fireEvent.click(north);
  assert.ok(await screen.findByRole("button", { name: "Pay selected ($50.00)" }));
  assert.ok(screen.getByText("View only"));
});

test("one practice in view asks the API for that practice only", async () => {
  setScope([acct("a1", "North Dental", "1001"), acct("a2", "South Dental", "1002")]);
  useAccountStore.getState().setPracticeScope("a2");
  get.mockResolvedValue({ data: { data: [MULTI[1]], meta: { balanceCents: 4000 } } });
  render(<MemoryRouter><ToastProvider><InvoicesPage /></ToastProvider></MemoryRouter>);
  await screen.findByText("#301");
  assert.deepEqual(get.mock.calls[0], ["/invoices", { params: { account: "a2" } }]);
});
