// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { InboxTable } from "../InboxTable.jsx";

const row = (id, over = {}) => ({
  id, recordType: "widget", recordId: `w${id}`, recordLabel: `Widget ${id}`, partyKey: "org:1", partyLabel: "Acme",
  subject: `Subject ${id}`, lastMessageAt: "2026-11-05T15:00:00Z", lastMessageSide: "party", messageCount: 2,
  unread: false, completedAt: null, archivedAt: null, ...over,
});
const ROWS = [row("t1", { unread: true }), row("t2")];
const FOLDERS = [{ value: "inbox", label: "Inbox" }, { value: "completed", label: "Completed" }];

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { rows: ROWS, total: 45 } } });
  api.post.mockResolvedValue({ data: { data: { ok: true } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = (props = {}) => render(
  <MemoryRouter>
    <ToastProvider>
      <InboxTable side="host" threadPath={(id) => `/threads/${id}`} folders={FOLDERS} bulk={["read", "unread", "complete", "reopen"]} {...props} />
      <Where />
    </ToastProvider>
  </MemoryRouter>,
);

test("folder switch refetches with folder param and resets page", async () => {
  mount();
  await screen.findByText("Subject t1");
  assert.equal(api.get.mock.calls[0][1].params.folder, "inbox");
  fireEvent.click(screen.getByLabelText("Next page"));
  await waitFor(() => assert.ok(api.get.mock.calls.some(([, c]) => c.params.offset === 20)));
  fireEvent.click(screen.getByRole("button", { name: "Completed" }));
  await waitFor(() => {
    const last = api.get.mock.calls.at(-1)[1].params;
    assert.equal(last.folder, "completed");
    assert.equal(last.offset, 0);
  });
});

test("unread rows render bold with a dot", async () => {
  mount();
  const subject = await screen.findByText("Subject t1");
  assert.equal(screen.getAllByLabelText("Unread").length, 1);
  assert.match(subject.className, /font-semibold/);
  assert.doesNotMatch(screen.getByText("Subject t2").className, /font-semibold/);
});

test("bulk Complete loops POST /complete per selected thread and toasts failures", async () => {
  api.post.mockImplementation(async (url) => {
    if (url.includes("t2")) throw { response: { data: { error: { message: "Nope" } } } };
    return { data: { data: { ok: true } } };
  });
  mount();
  await screen.findByText("Subject t1");
  const boxes = screen.getAllByLabelText(/^Select (?!page|group|all)/);
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  fireEvent.click(await screen.findByRole("button", { name: /^complete$/i }));
  await waitFor(() => assert.deepEqual(api.post.mock.calls.map((c) => c[0]), ["/messages/threads/t1/complete", "/messages/threads/t2/complete"]));
  await screen.findByText(/1 done, 1 failed/);
});

test("row click navigates to threadPath", async () => {
  mount();
  fireEvent.click(await screen.findByText("Subject t2"));
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/threads/t2"));
});

test("Unread filter sends unread=true and the party side hides the Party column", async () => {
  mount({ side: "party" });
  await screen.findByText("Subject t1");
  assert.equal(screen.queryByText("Party"), null);
  fireEvent.click(screen.getByRole("button", { name: /unread only/i }));
  await waitFor(() => assert.ok(api.get.mock.calls.some(([, c]) => c.params.unread === "true")));
});
