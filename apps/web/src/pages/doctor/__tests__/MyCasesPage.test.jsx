// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { MyCasesPage } from "../MyCasesPage.jsx";

// 25 cases: more than one page, so a linked case can sit past page 1.
const CASES = Array.from({ length: 25 }, (_, i) => ({
  id: `c${i + 1}`, caseNumber: `RX-${String(i + 1).padStart(3, "0")}`, patientName: null, deviceSummary: "Night guard",
  submittedAt: "2026-11-01T10:00:00Z", status: "Submitted", isRemake: false, dueDate: null, tracking: null,
}));

let threadsFor = {};
beforeEach(() => {
  threadsFor = {};
  api.get.mockImplementation(async (url, opts) => {
    if (url === "/rx/cases") return { data: { data: CASES } };
    if (url === "/messages/threads") {
      const p = opts?.params ?? {};
      const rows = p.folder === "inbox" ? (threadsFor[p.recordId] ?? []) : [];
      return { data: { data: { rows, total: rows.length } } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockResolvedValue({ data: { data: { id: "t-new" } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

const mount = (url = "/doctor/cases") => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/doctor/cases" element={<><MyCasesPage /><Where /></>} />
        <Route path="/doctor/messages/:id" element={<Where />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

const highlighted = () => screen.getAllByRole("row").filter((tr) => tr.getAttribute("aria-current") === "true");
const rowOf = (caseNumber) => screen.getByText(caseNumber).closest("tr");

test("?case=<id> brings that case into view and highlights its row, even past the first page", async () => {
  mount("/doctor/cases?case=c25");
  await waitFor(() => assert.equal(highlighted().length, 1));
  assert.match(highlighted()[0].textContent, /RX-025/);
});

test("?case=<id> for a case that is not in the list is toasted as not found", async () => {
  mount("/doctor/cases?case=nope");
  await screen.findByText("That case was not found.");
  assert.equal(screen.queryAllByRole("row").filter((tr) => tr.getAttribute("aria-current") === "true").length, 0);
  await waitFor(() => assert.doesNotMatch(screen.getByTestId("where").textContent, /case=/));
});

test("Message the lab opens the case's existing thread without creating one", async () => {
  threadsFor = { c2: [{ id: "t9", lastMessageAt: "2026-11-02T10:00:00Z" }] };
  mount();
  await screen.findByText("RX-002");
  fireEvent.click(within(rowOf("RX-002")).getByRole("button", { name: /message the lab/i }));
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/doctor/messages/t9"));
  assert.equal(api.post.mock.calls.length, 0);
});

test("Message the lab with no thread yet opens the new-thread modal and creates it on the case", async () => {
  mount();
  await screen.findByText("RX-003");
  fireEvent.click(within(rowOf("RX-003")).getByRole("button", { name: /message the lab/i }));
  await screen.findByText("Message the lab about RX-003");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Shade question" } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], "/messages/threads");
  assert.deepEqual(api.post.mock.calls[0][1], { recordType: "rx_case", recordId: "c3", body: "Shade question" });
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/doctor/messages/t-new"));
});
