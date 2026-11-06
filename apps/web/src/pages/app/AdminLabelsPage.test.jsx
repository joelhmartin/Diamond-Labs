// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), patch: vi.fn() } }));
const { AdminLabelsPage } = await import("./AdminLabelsPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

test("Labels admin edits order labels by default and switches to sales reps (client_rep)", async () => {
  get.mockResolvedValue({ data: { data: [] } });
  post.mockResolvedValue({ data: { data: {} } });
  render(<MemoryRouter><ToastProvider><AdminLabelsPage /></ToastProvider></MemoryRouter>);
  await waitFor(() => assert.ok(get.mock.calls.some(([p]) => p === "/tags/lab_order/definitions")));
  assert.equal(screen.getByRole("tab", { name: "Order labels" }).getAttribute("aria-selected"), "true");
  fireEvent.click(screen.getByRole("tab", { name: "Sales reps" }));
  await waitFor(() => assert.ok(get.mock.calls.some(([p]) => p === "/tags/client_rep/definitions")));
  assert.equal(screen.getByRole("tab", { name: "Sales reps" }).getAttribute("aria-selected"), "true");
});
