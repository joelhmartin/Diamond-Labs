// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../../components/ui/Toast.jsx";

const createThread = vi.hoisted(() => vi.fn());
vi.mock("../api.js", async (orig) => ({ ...(await orig()), createThread }));

import { NewThreadModal } from "../NewThreadModal.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const OPTIONS = [{ key: "p:1", label: "North" }, { key: "p:2", label: "South" }];

test("a sender with several parties must choose one, and the thread is created for it", async () => {
  createThread.mockResolvedValue({ id: "t1" });
  const onCreated = vi.fn();
  render(<ToastProvider><NewThreadModal open onClose={() => {}} partyOptions={OPTIONS} onCreated={onCreated} /></ToastProvider>);
  const body = screen.getByRole("textbox", { name: /message/i });
  fireEvent.change(body, { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(createThread.mock.calls.length, 0);
  fireEvent.change(screen.getByLabelText("For"), { target: { value: "p:2" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(createThread.mock.calls.length, 1));
  assert.equal(createThread.mock.calls[0][0].party, "p:2");
});
