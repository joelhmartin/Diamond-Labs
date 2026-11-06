// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const get = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: vi.fn() } }));
const { AdminPracticesPage } = await import("./AdminPracticesPage.jsx");

afterEach(() => { cleanup(); get.mockReset(); });

test("a failed group load is reported, not silently emptied", async () => {
  get.mockImplementation((url) => (url === "/admin/organizations"
    ? Promise.reject({ response: { data: { error: { message: "boom" } } } })
    : Promise.resolve({ data: { data: { rows: [], total: 0 } } })));
  render(<MemoryRouter><ToastProvider><AdminPracticesPage /></ToastProvider></MemoryRouter>);
  await screen.findByText(/Groups could not be loaded/);
});
