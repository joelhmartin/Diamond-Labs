// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { RecordThreads } from "../RecordThreads.jsx";

const T = (id, over) => ({ id, subject: `Subj ${id}`, lastMessageAt: "2026-11-05T15:00:00Z", messageCount: 3, unread: false, ...over });

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

beforeEach(() => {
  api.get.mockImplementation(async (url, cfg) => ({
    data: { data: { rows: cfg.params.folder === "inbox" ? [T("t1", { unread: true })] : [T("t2")], total: 1 } },
  }));
  api.post.mockResolvedValue({ data: { data: { id: "t9" } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("lists the record's threads and \"New message\" creates one on the record", async () => {
  render(
    <MemoryRouter>
      <ToastProvider>
        <RecordThreads recordType="widget" recordId="w7" side="host" threadPath={(id) => `/threads/${id}`} newThreadLabel="New message" />
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText("Subj t1");
  screen.getByText("Subj t2");
  assert.ok(api.get.mock.calls.every(([, c]) => c.params.recordType === "widget" && c.params.recordId === "w7"));
  fireEvent.click(screen.getByRole("button", { name: "New message" }));
  fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Hello there" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.deepEqual(api.post.mock.calls[0], ["/messages/threads", { recordType: "widget", recordId: "w7", body: "Hello there" }]));
  await waitFor(() => assert.equal(screen.getByTestId("where").textContent, "/threads/t9"));
});
