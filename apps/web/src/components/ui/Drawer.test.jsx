// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Drawer } from "./Drawer.jsx";

afterEach(cleanup);

test("Escape closes, focus moves into the panel, and a click outside closes but a click inside does not", () => {
  const onClose = vi.fn();
  render(<Drawer onClose={onClose} label="Details"><button type="button">Inside</button></Drawer>);
  const dialog = screen.getByRole("dialog", { name: "Details" });
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.activeElement, dialog);
  fireEvent.click(screen.getByText("Inside"));
  assert.equal(onClose.mock.calls.length, 0);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(onClose.mock.calls.length, 1);
  fireEvent.click(dialog.parentElement);
  assert.equal(onClose.mock.calls.length, 2);
});
