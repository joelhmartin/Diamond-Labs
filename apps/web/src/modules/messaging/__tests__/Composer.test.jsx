// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Composer } from "../Composer.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const type = (v) => fireEvent.change(screen.getByLabelText("Message"), { target: { value: v } });

test("disables Send for empty body", () => {
  render(<Composer onSend={vi.fn()} />);
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  type("   ");
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  type("hi");
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false);
});

test("shows the 5000-char counter near the limit", () => {
  render(<Composer onSend={vi.fn()} />);
  type("a".repeat(100));
  assert.equal(screen.queryByText(/\/ 5000/), null);
  type("a".repeat(4600));
  assert.ok(screen.getByText("4600 / 5000"));
});

test("clears after a successful send and passes { body }", async () => {
  const onSend = vi.fn().mockResolvedValue();
  render(<Composer onSend={onSend} />);
  type("  hello ");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(screen.getByLabelText("Message").value, ""));
  assert.deepEqual(onSend.mock.calls[0], [{ body: "hello" }]);
});

test("keeps the text and shows the error when sending fails", async () => {
  const onSend = vi.fn().mockRejectedValue({ response: { data: { error: { message: "Too long" } } } });
  render(<Composer onSend={onSend} />);
  type("hello");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Too long");
  assert.equal(screen.getByLabelText("Message").value, "hello");
});
