// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn() } }));
const { AdminPracticesPage } = await import("./AdminPracticesPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

test("the Group filter loads every group, paging past 200", async () => {
  const groups = Array.from({ length: 230 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}` }));
  get.mockImplementation((url, { params } = {}) => Promise.resolve({ data: { data: url === "/admin/organizations"
    ? { rows: groups.slice(params.offset, params.offset + params.limit), total: groups.length }
    : { rows: [], total: 0 } } }));
  render(<MemoryRouter><ToastProvider><AdminPracticesPage /></ToastProvider></MemoryRouter>);
  await waitFor(() => assert.equal(get.mock.calls.filter(([u]) => u === "/admin/organizations").length, 2));
  assert.deepEqual(get.mock.calls.filter(([u]) => u === "/admin/organizations").map(([, c]) => c.params.offset), [0, 200]);
});

test("a failed group load is reported, not silently emptied", async () => {
  get.mockImplementation((url) => (url === "/admin/organizations"
    ? Promise.reject({ response: { data: { error: { message: "boom" } } } })
    : Promise.resolve({ data: { data: { rows: [], total: 0 } } })));
  render(<MemoryRouter><ToastProvider><AdminPracticesPage /></ToastProvider></MemoryRouter>);
  await screen.findByText(/Groups could not be loaded/);
});
