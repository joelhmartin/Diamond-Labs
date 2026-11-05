// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
const { IntakeQueue } = await import("./IntakeQueue.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const rows = [
  { id: "i1", status: "pending", createdAt: "2026-11-05T15:00:00Z", byName: "Sam", files: [{ id: "f1", originalName: "upper.stl" }, { id: "f2", originalName: "lower.stl" }] },
  { id: "i2", status: "pending", createdAt: "2026-11-05T16:00:00Z", byName: "Alex", files: [{ id: "f3", originalName: "bite.ply" }] },
  { id: "i3", status: "promoted", createdAt: "2026-11-04T16:00:00Z", byName: "Alex", files: [] },
];

const mount = () => render(
  <MemoryRouter><ToastProvider><IntakeQueue basePath="/intake" createHref={(i) => `/orders/new?intake=${i.id}`} /></ToastProvider></MemoryRouter>,
);

test("IntakeQueue Create order links to /orders/new?intake=<id>", async () => {
  get.mockResolvedValue({ data: { data: { rows, total: 3 } } });
  mount();
  await screen.findByText("Sam");
  const links = screen.getAllByRole("link", { name: "Create order" });
  assert.deepEqual(links.map((a) => a.getAttribute("href")), ["/orders/new?intake=i1", "/orders/new?intake=i2"]);
  assert.match(get.mock.calls[0][1].params.status, /pending/);
});

test("bulk discard uses ConfirmButton", async () => {
  get.mockResolvedValue({ data: { data: { rows, total: 3 } } });
  post.mockResolvedValue({ data: { data: { id: "x" } } });
  mount();
  await screen.findByText("Sam");
  screen.getAllByLabelText("Select row").slice(0, 2).forEach((b) => fireEvent.click(b));
  const bulk = await screen.findByRole("button", { name: "Discard selected" });
  fireEvent.click(bulk);
  assert.equal(post.mock.calls.length, 0, "the first click only arms it");
  fireEvent.click(screen.getByRole("button", { name: "Click again to discard" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 2));
  assert.deepEqual(post.mock.calls.map((c) => c[0]), ["/intake/i1/discard", "/intake/i2/discard"]);
});

test("a row Discard also asks twice", async () => {
  get.mockResolvedValue({ data: { data: { rows: [rows[0]], total: 1 } } });
  post.mockResolvedValue({ data: { data: { id: "i1" } } });
  mount();
  await screen.findByText("Sam");
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  assert.equal(post.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to discard" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
});
