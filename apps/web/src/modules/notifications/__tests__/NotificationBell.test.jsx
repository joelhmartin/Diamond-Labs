// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../../config/api.js", () => ({ default: api }));

import { NotificationBell } from "../NotificationBell.jsx";

const row = (i, over = {}) => ({ id: `n${i}`, title: `Alert ${i}`, link: `/things/${i}`, count: 1, readAt: null, updatedAt: "2026-11-05T15:00:00Z", ...over });
let unread = 5;

beforeEach(() => {
  unread = 5;
  api.get.mockImplementation(async (url, cfg) => {
    if (url === "/notifications/unread-count") return { data: { data: { count: unread } } };
    if (url === "/notifications") return { data: { data: { rows: Array.from({ length: cfg.params.limit }, (_, i) => row(i + 1)), total: 20 } } };
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockResolvedValue({ data: { data: { updated: 5 } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = () => render(<MemoryRouter><NotificationBell to="/notifications" /></MemoryRouter>);

test("shows the unread badge (99+ cap)", async () => {
  unread = 250;
  mount();
  await screen.findByText("99+");
  cleanup();
  unread = 7;
  mount();
  await screen.findByText("7");
});

test("opening lists the latest 8", async () => {
  mount();
  await screen.findByText("5");
  fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
  await screen.findByText("Alert 1");
  assert.equal(screen.getAllByText(/^Alert \d+$/).length, 8);
  const listCall = api.get.mock.calls.find(([u]) => u === "/notifications");
  assert.equal(listCall[1].params.limit, 8);
  assert.equal(screen.getByRole("link", { name: /see all/i }).getAttribute("href"), "/notifications");
});

test("Mark all read posts { all: true } and zeroes the badge", async () => {
  mount();
  await screen.findByText("5");
  fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
  fireEvent.click(await screen.findByRole("button", { name: /mark all read/i }));
  await waitFor(() => assert.deepEqual(api.post.mock.calls[0], ["/notifications/read", { all: true }]));
  await waitFor(() => assert.equal(screen.queryByText("5"), null));
});
