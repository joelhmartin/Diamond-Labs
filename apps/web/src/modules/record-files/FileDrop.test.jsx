// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FileDrop } from "./FileDrop.jsx";

afterEach(cleanup);

const file = (name, size = 10) => {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
};

function drop(files) {
  fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files } });
}

test("rejects a file over 75 MB with an inline message and does not call onFiles", () => {
  const onFiles = vi.fn();
  render(<FileDrop onFiles={onFiles} />);
  drop([file("big.stl", 75 * 1024 * 1024 + 1)]);
  assert.match(screen.getByRole("alert").textContent, /big\.stl.*75 MB/);
  assert.equal(onFiles.mock.calls.length, 0);
});

test("drop of 2 files calls onFiles with both", () => {
  const onFiles = vi.fn();
  render(<FileDrop onFiles={onFiles} />);
  const a = file("a.stl");
  const b = file("b.jpg");
  drop([a, b]);
  assert.equal(onFiles.mock.calls.length, 1);
  assert.deepEqual(onFiles.mock.calls[0][0], [a, b]);
  assert.equal(screen.queryByRole("alert"), null);
});

test("more files than maxFiles is refused inline", () => {
  const onFiles = vi.fn();
  render(<FileDrop maxFiles={1} onFiles={onFiles} />);
  drop([file("a"), file("b")]);
  assert.match(screen.getByRole("alert").textContent, /up to 1 file/);
  assert.equal(onFiles.mock.calls.length, 0);
});
