// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { ThreadView } from "../ThreadView.jsx";

const THREAD = { id: "t1", recordLabel: "Widget 7", recordPath: "/widgets/7", partyLabel: "Acme", subject: "Fit question", completedAt: null, archivedAt: null };
const MESSAGES = [
  { id: "m1", authorName: "Pat Party", authorSide: "party", body: "First hello", createdAt: "2026-11-05T15:00:00Z", attachments: [] },
  { id: "m2", authorName: "Hank Host", authorSide: "host", body: "Second reply", createdAt: "2026-11-05T16:00:00Z", attachments: [] },
];

beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { thread: THREAD, messages: MESSAGES } } });
  api.post.mockResolvedValue({ data: { data: { id: "m3" } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = (side = "host") => render(
  <MemoryRouter><ToastProvider><ThreadView threadId="t1" side={side} /></ToastProvider></MemoryRouter>,
);

test("renders messages oldest first with side alignment", async () => {
  mount("host");
  const first = await screen.findByText("First hello");
  const second = screen.getByText("Second reply");
  assert.ok(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(first.closest("[data-side]").getAttribute("data-own"), "false");
  assert.equal(second.closest("[data-side]").getAttribute("data-own"), "true");
  assert.match(second.closest("[data-side]").className, /ml-auto/);
});

test("header links the record and sending a reply posts JSON then reloads", async () => {
  mount("host");
  const link = await screen.findByRole("link", { name: "Widget 7" });
  assert.equal(link.getAttribute("href"), "/widgets/7");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.deepEqual(api.post.mock.calls[0], ["/messages/threads/t1/messages", { body: "Thanks" }]));
  await waitFor(() => assert.equal(api.get.mock.calls.length, 2));
});

test("host sees Complete, party sees Archive", async () => {
  mount("host");
  await screen.findByText("First hello");
  assert.ok(screen.getByRole("button", { name: "Complete" }));
  cleanup();
  mount("party");
  await screen.findByText("First hello");
  assert.ok(screen.getByRole("button", { name: "Archive" }));
});

test("ThreadView attachment chip links to /messages/attachments/:id", async () => {
  const withFile = [{ ...MESSAGES[0], attachments: [{ id: "f1", fileName: "scan.pdf", contentType: "application/pdf", sizeBytes: 2048 }] }, MESSAGES[1]];
  api.get.mockResolvedValue({ data: { data: { thread: THREAD, messages: withFile } } });
  mount("party");
  const chip = await screen.findByRole("link", { name: /scan\.pdf/ });
  assert.equal(chip.getAttribute("href"), "/api/v1/messages/attachments/f1");
  assert.equal(chip.getAttribute("target"), "_blank");

  // A click fetches the signed link with the session token (a bare navigation would carry none).
  const tab = { location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab);
  api.get.mockResolvedValueOnce({ data: { data: { url: "https://signed.example/f1" } } });
  fireEvent.click(chip);
  await waitFor(() => assert.equal(tab.location.href, "https://signed.example/f1"));
  assert.deepEqual(api.get.mock.calls.at(-1), ["/messages/attachments/f1", { params: { as: "json" } }]);
  open.mockRestore();
});
