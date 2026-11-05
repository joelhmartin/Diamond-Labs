// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { Composer } from "../Composer.jsx";
import { postMessage } from "../api.js";

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

const file = (name, size = 10) => {
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const pick = (files) => fireEvent.change(screen.getByTestId("file-drop-input"), { target: { files } });
const chips = () => screen.queryAllByTestId("composer-file");

test("Composer rejects a 6th file inline", () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);
  pick([1, 2, 3, 4, 5].map((i) => file(`${i}.pdf`)));
  assert.equal(chips().length, 5);
  pick([file("6.pdf")]);
  assert.match(screen.getByRole("alert").textContent, /up to 5 files/);
  assert.equal(chips().length, 5);
  fireEvent.click(screen.getByRole("button", { name: "Remove 1.pdf" }));
  assert.equal(chips().length, 4);
  assert.equal(onSend.mock.calls.length, 0);
  assert.equal(api.post.mock.calls.length, 0);
});

test("Composer rejects an oversize file inline", () => {
  render(<Composer onSend={vi.fn()} />);
  pick([file("huge.pdf", 20 * 1024 * 1024 + 1)]);
  assert.match(screen.getByRole("alert").textContent, /huge\.pdf.*20 MB/);
  assert.equal(chips().length, 0);
  assert.equal(api.post.mock.calls.length, 0);
});

test("Composer sends FormData with body and files and clears after success", async () => {
  api.post.mockResolvedValue({ data: { data: { id: "m1" } } });
  render(<Composer onSend={(m) => postMessage("t1", m)} />);
  type(" see scan ");
  const a = file("a.pdf");
  const b = file("b.pdf");
  pick([a, b]);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(screen.getByLabelText("Message").value, ""));
  const [path, form] = api.post.mock.calls[0];
  assert.equal(path, "/messages/threads/t1/messages");
  assert.ok(form instanceof FormData);
  assert.equal(form.get("body"), "see scan");
  assert.deepEqual(form.getAll("files").map((f) => f.name), ["a.pdf", "b.pdf"]);
  assert.equal(chips().length, 0);
});
