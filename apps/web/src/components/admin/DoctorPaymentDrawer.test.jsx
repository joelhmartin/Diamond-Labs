// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("./AdminCardsSection.jsx", () => ({ AdminCardsSection: () => <div>CARDS</div> }));
vi.mock("./AdminChargeSection.jsx", () => ({ AdminChargeSection: () => <div>CHARGE</div> }));
vi.mock("./AdminAutopaySection.jsx", () => ({ AdminAutopaySection: () => <div>AUTOPAY</div> }));
vi.mock("./AdminRecordPaymentSection.jsx", () => ({ AdminRecordPaymentSection: () => <div>RECORD</div> }));
const { DoctorPaymentDrawer } = await import("./DoctorPaymentDrawer.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

const WHO = { userId: "u1", name: "Pat Admin", email: "p@x.test", accountNumber: null };

test("recordOnly (a practice admin who is not a doctor): only Record payment, and the doctor-only AutoPay read is never made", async () => {
  get.mockResolvedValue({ data: { data: [] } });
  render(<DoctorPaymentDrawer doctor={WHO} recordOnly onClose={() => {}} />);
  await screen.findByText("RECORD");
  assert.equal(screen.queryByText("CARDS"), null);
  assert.equal(screen.queryByText("CHARGE"), null);
  assert.equal(screen.queryByText("AUTOPAY"), null);
  await waitFor(() => assert.ok(get.mock.calls.some(([u]) => u === "/admin/clients/u1/invoices")));
  assert.ok(!get.mock.calls.some(([u]) => u.endsWith("/autopay")));
});

test("a doctor still gets every panel", async () => {
  get.mockImplementation((u) => Promise.resolve({ data: { data: u.endsWith("/autopay") ? { cards: [], enrollment: null } : [] } }));
  render(<DoctorPaymentDrawer doctor={WHO} onClose={() => {}} />);
  await screen.findByText("AUTOPAY");
  assert.ok(screen.getByText("CARDS") && screen.getByText("CHARGE") && screen.getByText("RECORD"));
});
