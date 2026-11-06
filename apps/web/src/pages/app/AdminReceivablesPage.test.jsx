// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
vi.mock("../../components/billing/StatementDownload.jsx", () => ({ StatementDownload: () => null }));
const { AdminReceivablesPage } = await import("./AdminReceivablesPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const bucket = (current, late) => ({ current, "1-30": late, "31-60": 0, "61-90": 0, "90+": 0 });
const ROWS = [
  { accountId: "a1", ownerUserId: "u1", name: "Alpha Dental", accountNumber: "1001", organizationId: "g1", organizationName: "North Group", balanceCents: 10000, pastDueCents: 4000, buckets: bucket(6000, 4000), oldestDueDate: "2026-09-01" },
  { accountId: "a2", ownerUserId: "u2", name: "Beta Ortho", accountNumber: "1002", organizationId: "g1", organizationName: "North Group", balanceCents: 5000, pastDueCents: 0, buckets: bucket(5000, 0), oldestDueDate: null },
  { accountId: "a3", ownerUserId: "u3", name: "Gamma Perio", accountNumber: "1003", organizationId: null, organizationName: null, balanceCents: 2000, pastDueCents: 2000, buckets: bucket(0, 2000), oldestDueDate: "2026-10-01" },
];
const UNASSIGNED = { accountId: null, unassigned: true, ownerUserId: "u9", name: "Old Client", accountNumber: null, organizationId: null, organizationName: null, balanceCents: 700, pastDueCents: 700, buckets: bucket(0, 700), oldestDueDate: "2026-08-01" };
const GROUPS = [{ organizationId: "g1", name: "North Group", balanceCents: 15000, totalCents: 15000, pastDueCents: 4000, buckets: bucket(11000, 4000), oldestDueDate: "2026-09-01", openInvoices: 2, accountIds: ["a1", "a2"] }];

function mount() {
  get.mockResolvedValue({ data: { data: { rows: ROWS, groups: GROUPS, asOf: "2026-10-28", totals: {} } } });
  render(<MemoryRouter><ToastProvider><AdminReceivablesPage /></ToastProvider></MemoryRouter>);
}

test("past-due filter hides current-only clients and the totals row follows it", async () => {
  mount();
  await screen.findByText("Alpha Dental");
  assert.ok(screen.getByText("Total (3 practices)"));
  fireEvent.click(screen.getByRole("button", { name: "Past due only" }));
  await waitFor(() => assert.equal(screen.queryByText("Beta Ortho"), null));
  assert.ok(screen.getByText("Total (2 practices)"));
});

test('"Monthly statements" replaces the old per-row bulk email and opens the run panel', async () => {
  mount();
  await screen.findByText("Alpha Dental");
  for (const box of screen.getAllByLabelText("Select row")) fireEvent.click(box);
  assert.equal(screen.queryByRole("button", { name: "Email statements" }), null);
  get.mockResolvedValue({ data: { data: [] } });
  fireEvent.click(screen.getByRole("button", { name: "Monthly statements" }));
  await waitFor(() => assert.ok(get.mock.calls.some((c) => c[0] === "/admin/statements/run")));
  assert.ok(await screen.findByRole("button", { name: "Send 0 statements" }));
});

test("rows are per practice and the statement actions use the practice routes", async () => {
  mount();
  await screen.findByText("Alpha Dental");
  assert.deepEqual(get.mock.calls[0], ["/admin/receivables", { params: { pastDueOnly: "false", groupBy: "organization" } }]);
  assert.ok(screen.getByText("Beta Ortho"));
  const link = within(screen.getByText("Alpha Dental").closest("tr")).getByRole("link", { name: "Invoices" });
  assert.match(link.getAttribute("href"), /inv\.accountId=a1/);
  post.mockResolvedValue({ data: { data: { sent: 1, failed: 0, noEmail: 0 } } });
  const row = screen.getByText("Alpha Dental").closest("tr");
  fireEvent.click(within(row).getByRole("button", { name: "Email statement" }));
  fireEvent.click(within(row).getByRole("button", { name: /^Email .*\?$/ }));
  await waitFor(() => assert.equal(post.mock.calls[0][0], "/admin/practices/a1/statement/email"));
});

test("By group toggle expands a group to its practices", async () => {
  mount();
  await screen.findByText("Alpha Dental");
  fireEvent.click(screen.getByRole("button", { name: "By group" }));
  await waitFor(() => assert.equal(screen.queryByText("Alpha Dental"), null));
  assert.ok(screen.getByText("North Group"));
  assert.ok(screen.getByText("Gamma Perio"), "an ungrouped practice stays a plain row");
  assert.equal(screen.getAllByRole("button", { name: "Expand row" }).length, 1, "only the group row expands");
  assert.ok(screen.getByText("Total (3 practices)"), "the footer counts practices, not rows");
  fireEvent.click(screen.getByRole("button", { name: "Expand row" }));
  assert.ok(await screen.findByText("Alpha Dental"));
  assert.ok(screen.getByText("Beta Ortho"));
});

test("an unassigned row (client, no practice) keeps invoices by client and credit, with no statement actions", async () => {
  get.mockResolvedValue({ data: { data: { rows: [...ROWS, UNASSIGNED], groups: GROUPS, asOf: "2026-10-28", totals: {} } } });
  render(<MemoryRouter><ToastProvider><AdminReceivablesPage /></ToastProvider></MemoryRouter>);
  const row = (await screen.findByText("Old Client")).closest("tr");
  assert.match(within(row).getByRole("link", { name: "Invoices" }).getAttribute("href"), /inv\.clientUserId=u9/);
  assert.equal(within(row).queryByRole("button", { name: "Email statement" }), null);
  assert.ok(within(row).getByRole("button", { name: /Account credit/ }));
  assert.ok(screen.getByText("Total (4 practices)"));
});

test("Account credit… on a practice row credits that practice only (never its owner's whole scope); an Unassigned row credits the client's unassigned invoices", async () => {
  get.mockImplementation(async (url) => (url === "/admin/receivables"
    ? { data: { data: { rows: [...ROWS, UNASSIGNED], groups: GROUPS, asOf: "2026-10-28", totals: {} } } }
    : { data: { data: [{ id: "i1", invoiceNumber: 1, dueDate: null, balanceCents: 500 }] } }));
  render(<MemoryRouter><ToastProvider><AdminReceivablesPage /></ToastProvider></MemoryRouter>);
  const alpha = (await screen.findByText("Alpha Dental")).closest("tr");
  fireEvent.click(within(alpha).getByRole("button", { name: /Account credit/ }));
  await waitFor(() => assert.ok(get.mock.calls.some((c) => c[0] === "/admin/practices/a1/account-credit/invoices")));
  assert.ok(!get.mock.calls.some((c) => /\/admin\/clients\/u1/.test(c[0])), "never the owner's client path");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  const old = screen.getByText("Old Client").closest("tr");
  fireEvent.click(within(old).getByRole("button", { name: /Account credit/ }));
  await waitFor(() => assert.ok(get.mock.calls.some((c) => c[0] === "/admin/clients/u9/account-credit/invoices")));
});
