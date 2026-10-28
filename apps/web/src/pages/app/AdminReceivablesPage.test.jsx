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
  { clientUserId: "c1", practice: "Alpha Dental", name: "A", balanceCents: 10000, pastDueCents: 4000, buckets: bucket(6000, 4000), oldestDueDate: "2026-09-01" },
  { clientUserId: "c2", practice: "Beta Ortho", name: "B", balanceCents: 5000, pastDueCents: 0, buckets: bucket(5000, 0), oldestDueDate: null },
];

function mount() {
  get.mockResolvedValue({ data: { data: { rows: ROWS, asOf: "2026-10-28", totals: {} } } });
  render(<MemoryRouter><ToastProvider><AdminReceivablesPage /></ToastProvider></MemoryRouter>);
}

test("past-due filter hides current-only clients and the totals row follows it", async () => {
  mount();
  await screen.findByText("Alpha Dental");
  assert.ok(screen.getByText("Total (2 clients)"));
  fireEvent.click(screen.getByRole("button", { name: "Past due only" }));
  await waitFor(() => assert.equal(screen.queryByText("Beta Ortho"), null));
  assert.ok(screen.getByText("Total (1 clients)"));
});

test('bulk "Email statements" posts once per selected client and reports failures', async () => {
  post.mockResolvedValueOnce({ data: { data: { sent: true } } }).mockRejectedValueOnce(new Error("boom"));
  mount();
  await screen.findByText("Alpha Dental");
  for (const box of screen.getAllByLabelText("Select row")) fireEvent.click(box);
  fireEvent.click(await screen.findByRole("button", { name: "Email statements" }));
  fireEvent.click(await screen.findByRole("button", { name: /click again/i }));
  await waitFor(() => assert.equal(post.mock.calls.length, 2));
  assert.deepEqual(post.mock.calls.map((c) => c[0]).sort(), ["/admin/clients/c1/statement/email", "/admin/clients/c2/statement/email"]);
  await screen.findByText(/1 done, 1 failed/);
});
