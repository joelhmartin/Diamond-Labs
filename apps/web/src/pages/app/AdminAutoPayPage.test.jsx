// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn(), put: vi.fn() } }));
const { AdminAutoPayPage } = await import("./AdminAutoPayPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const row = (userId, name, over = {}) => ({
  userId, doctorName: name, doctorEmail: `${userId}@example.test`, accountNumber: `10${userId.length}`, amount: "100.00", dayOfMonth: 5,
  enabled: true, status: "active", consecutiveFailures: 0, lastChargedAt: null, ...over,
});
const ENROLLMENTS = [
  row("u1", "Dr Active"),
  row("u2", "Dr Paused", { status: "paused", pausedReason: "card declined" }),
  row("u3", "Dr Off", { enabled: false }),
  row("u4", "Dr Done", { status: "completed" }),
];

async function mount() {
  get.mockResolvedValue({ data: { data: { enrollments: ENROLLMENTS, minAmount: 0, liveRun: false } } });
  render(<MemoryRouter><ToastProvider><AdminAutoPayPage /></ToastProvider></MemoryRouter>);
  await screen.findByText("Dr Active");
}
const shown = () => ENROLLMENTS.map((r) => r.doctorName).filter((n) => screen.queryByText(n));

test("AutoPay lists every enrollment, then the Status filter keeps one state at a time", async () => {
  await mount();
  assert.deepEqual(shown(), ["Dr Active", "Dr Paused", "Dr Off", "Dr Done"]);
  const status = screen.getByRole("combobox", { name: "Status" });
  fireEvent.change(status, { target: { value: "paused" } });
  assert.deepEqual(shown(), ["Dr Paused"]);
  fireEvent.change(status, { target: { value: "disabled" } });
  assert.deepEqual(shown(), ["Dr Off"], "a disabled enrollment is not 'active' even though its status is");
  fireEvent.change(status, { target: { value: "completed" } });
  assert.deepEqual(shown(), ["Dr Done"]);
});

test("AutoPay search matches the doctor's email, and Reset brings everything back", async () => {
  await mount();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "u3@example" } });
  assert.deepEqual(shown(), ["Dr Off"]);
  fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
  assert.equal(shown().length, 4);
});
