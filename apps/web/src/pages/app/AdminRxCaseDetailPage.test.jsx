// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import assert from "node:assert/strict";
import { caseStatusLabel } from "../../lib/rx-case-labels.js";

const api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
let role = "admin";
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a), put: (...a) => api.put(...a), delete: (...a) => api.delete(...a) } }));
vi.mock("../../hooks/useAuth.js", () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock("../../components/ui/Toast.jsx", () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock("../../modules/messaging/index.js", () => ({ RecordThreads: () => null }));
const { AdminRxCaseDetailPage, releaseBlockedReason } = await import("./AdminRxCaseDetailPage.jsx");

test("the release button explains why it is disabled, rather than just being grey", () => {
  const reason = releaseBlockedReason([{ status: "open", noteOnly: false, sourceLabel: "Anterior Pad" }]);
  assert.match(reason, /Anterior Pad/);
});

test("nothing blocking means no reason", () => {
  assert.equal(releaseBlockedReason([{ status: "confirmed", noteOnly: false, seazonaCode: "2608" }]), null);
});

// The server's canRelease deliberately does not trust a line's own `status` — it
// blocks any sendable line with no seazonaCode, whatever the status claims.
// This helper mirrors that whole rule, not half of it: checking only `status`
// would light Release up for a case the server then refuses with a 422, which is
// exactly the dead end the helper exists to prevent.
test("a line claiming 'confirmed' with no product code still blocks", () => {
  assert.match(
    releaseBlockedReason([{ status: "confirmed", noteOnly: false, sourceLabel: "Anterior Pad" }]),
    /Anterior Pad/,
  );
});

test("a note-only line never blocks the release, even while still 'open'", () => {
  assert.equal(
    releaseBlockedReason([
      { status: "confirmed", noteOnly: false, seazonaCode: "2608" },
      { status: "open", noteOnly: true },
    ]),
    null,
  );
});

test("a case with nothing to send is blocked too, same as the server's canRelease gate", () => {
  assert.match(releaseBlockedReason([]), /no lines to release/);
  assert.match(releaseBlockedReason([{ status: "open", noteOnly: true }]), /no lines to release/);
});

test("every case status has a human label", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled"]) {
    assert.ok(caseStatusLabel(s), `no label for ${s}`);
  }
});

// ── Rendered page: the case shows, gating holds, and every destructive step takes two clicks ──

const OPEN_LINE = { id: "l1", name: "Anterior Pad", sourceLabel: "Anterior Pad", status: "open", noteOnly: false };
const OK_LINE = { id: "l2", name: "Night Guard", sourceLabel: "Night Guard", status: "confirmed", noteOnly: false, seazonaCode: "2608" };

function mockCase({ status = "new", lines = [OPEN_LINE, OK_LINE] } = {}) {
  api.get.mockResolvedValue({
    data: { data: { case: { id: "c1", caseNumber: "RX-100", status, patientFirst: "Pat", patientLast: "Ient" }, lines, files: [], prescription: {}, labOrder: null } },
  });
}

async function renderPage() {
  render(
    <MemoryRouter initialEntries={["/cases/c1"]}>
      <Routes>
        <Route path="/cases/:id" element={<AdminRxCaseDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("RX-100");
}

beforeEach(() => {
  role = "admin";
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(cleanup);

test("the page renders the case and its lines", async () => {
  mockCase();
  await renderPage();
  assert.ok(screen.getByText("Night Guard"));
  assert.ok(screen.getByText(/Order lines/));
});

test("the Release card is staff-gated and hidden once cancelled", async () => {
  mockCase();
  await renderPage();
  assert.ok(screen.getByRole("button", { name: /Release to lab/ }));
  cleanup();
  role = "user";
  await renderPage();
  assert.equal(screen.queryByRole("button", { name: /Release to lab/ }), null);
  cleanup();
  role = "admin";
  mockCase({ status: "cancelled" });
  await renderPage();
  assert.equal(screen.queryByRole("button", { name: /Release to lab/ }), null);
});

test("line editing is admin-only: lab staff can release but not add or re-resolve", async () => {
  role = "lab";
  mockCase();
  await renderPage();
  assert.ok(screen.getByRole("button", { name: /Release to lab/ }));
  assert.equal(screen.queryByRole("button", { name: /Re-resolve/ }), null);
  assert.equal(screen.queryByRole("button", { name: /Add line/ }), null);
});

test("Re-resolve needs a second click before it posts", async () => {
  mockCase();
  await renderPage();
  api.post.mockResolvedValue({ data: { data: { lines: [OK_LINE], replaced: 1, kept: 0 } } });
  fireEvent.click(screen.getByRole("button", { name: /Re-resolve/ }));
  assert.equal(api.post.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: /Click again to re-resolve/ }));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], "/admin/rx-cases/c1/re-resolve");
});

test("removing a line needs a second click before it deletes", async () => {
  mockCase({ lines: [OK_LINE] });
  await renderPage();
  api.delete.mockResolvedValue({});
  fireEvent.click(screen.getByLabelText("Delete this line").closest("button"));
  assert.equal(api.delete.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: /Click again to remove/ }));
  await waitFor(() => assert.equal(api.delete.mock.calls.length, 1));
  assert.equal(api.delete.mock.calls[0][0], "/admin/rx-cases/c1/lines/l2");
});

test("a once-off save is one click; an 'always' save (changes future cases) takes two", async () => {
  mockCase({ lines: [OPEN_LINE] });
  await renderPage();
  api.put.mockResolvedValue({ data: { data: { ...OPEN_LINE, noteOnly: true } } });
  const noteLabel = /Not a line item/;
  fireEvent.click(screen.getByRole("button", { name: noteLabel }));
  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  assert.deepEqual(api.put.mock.calls[0][1], { noteOnly: true, scope: "once" });

  // The saved line becomes note-only and the editor closes; reopen it, choose "always".
  fireEvent.click(await screen.findByTitle("Edit this line"));
  fireEvent.click(screen.getByLabelText(/Always \(future cases too\)/));
  fireEvent.click(screen.getByRole("button", { name: noteLabel }));
  assert.equal(api.put.mock.calls.length, 1, "first click only arms it");
  fireEvent.click(screen.getByRole("button", { name: /changes ALL future prescriptions/ }));
  await waitFor(() => assert.equal(api.put.mock.calls.length, 2));
  assert.deepEqual(api.put.mock.calls[1][1], { noteOnly: true, scope: "always" });
});
