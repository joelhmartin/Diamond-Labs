// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
const { MonthlyStatementsPanel } = await import("./MonthlyStatementsPanel.jsx");
const { labToday, recentMonths } = await import("../../lib/invoices.js");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const row = (id, extra) => ({
  clientUserId: id, name: `Dr ${id}`, practice: `Practice ${id}`, accountNumber: id, email: `${id}@x.test`,
  openingCents: 0, closingCents: 1000, activityCount: 1, alreadySentAt: null, planned: "send", ...extra,
});
const ROWS = [
  row("a"), row("b", { closingCents: 0 }),
  row("c", { alreadySentAt: "2026-11-01T15:00:00Z", planned: "already_sent" }),
  row("d", { email: null, planned: "no_email" }),
  row("e", { planned: "unconfirmed" }),
];

function mount() {
  get.mockResolvedValue({ data: { data: ROWS } });
  render(<MemoryRouter><ToastProvider><MonthlyStatementsPanel onClose={() => {}} /></ToastProvider></MemoryRouter>);
}

test("the preview loads last month by default", async () => {
  mount();
  await screen.findByText("Practice a");
  const lastMonth = recentMonths(labToday(), 2)[1].value;
  assert.deepEqual(get.mock.calls[0], ["/admin/statements/run", { params: { month: lastMonth } }]);
  assert.ok(screen.getByText("No email"));
});

test("the month picker offers closed months only (the run refuses the current month)", async () => {
  mount();
  await screen.findByText("Practice a");
  const values = [...screen.getByRole("combobox", { name: /month/i }).querySelectorAll("option")].map((o) => o.value);
  const [current, last] = recentMonths(labToday(), 2).map((m) => m.value);
  assert.ok(!values.includes(current), "the current month is not offered");
  assert.equal(values[0], last);
  assert.equal(values.length, 12);
});

test("a send that was never confirmed says so and points to the single send", async () => {
  mount();
  assert.ok(await screen.findByText("Unconfirmed — check and use Email statement"));
});

test("the panel's Send button needs two clicks and names the count", async () => {
  post.mockResolvedValue({ data: { data: { sent: 2, skipped: 2, failed: 0 } } });
  mount();
  const send = await screen.findByRole("button", { name: "Send 2 statements" });
  fireEvent.click(send);
  assert.equal(post.mock.calls.length, 0, "the first click only arms it");
  fireEvent.click(await screen.findByRole("button", { name: /click again/i }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  const lastMonth = recentMonths(labToday(), 2)[1].value;
  assert.deepEqual(post.mock.calls[0], ["/admin/statements/run", { month: lastMonth }]);
  await screen.findByText(/2 sent/);
  await waitFor(() => assert.equal(get.mock.calls.length, 2), "the preview reloads after a run");
});

test("nothing to send disables the button", async () => {
  get.mockResolvedValue({ data: { data: [row("c", { alreadySentAt: "2026-11-01T15:00:00Z", planned: "already_sent" })] } });
  render(<MemoryRouter><ToastProvider><MonthlyStatementsPanel onClose={() => {}} /></ToastProvider></MemoryRouter>);
  const send = await screen.findByRole("button", { name: "Send 0 statements" });
  assert.equal(send.disabled, true);
});
