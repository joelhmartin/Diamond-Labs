// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/Toast.jsx";

const get = vi.fn();
const post = vi.fn();
let role = "admin";
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
vi.mock("../../hooks/useAuth.js", () => ({ useAuth: () => ({ user: { id: "me", role } }) }));
const { ClientRepPicker } = await import("./ClientRepPicker.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); role = "admin"; });

const REPS = [{ id: "r1", label: "Alice", color: "blue", active: true }, { id: "r2", label: "Bob", color: "red", active: true }];
const mount = (client) => render(<MemoryRouter><ToastProvider><ClientRepPicker client={client} onClose={() => {}} onChanged={() => {}} /></ToastProvider></MemoryRouter>);

test("picking a rep applies the client_rep tag to the client", async () => {
  get.mockResolvedValue({ data: { data: REPS } });
  post.mockResolvedValue({ data: { data: {} } });
  mount({ id: "c1", name: "Dr C", repTags: [] });
  fireEvent.click(await screen.findByRole("button", { name: "Alice" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.deepEqual(post.mock.calls[0], ["/tags/client_rep/apply", { ids: ["c1"], add: ["r1"], remove: [] }]);
});

test("choosing another rep swaps the old one out (single-select)", async () => {
  get.mockResolvedValue({ data: { data: REPS } });
  post.mockResolvedValue({ data: { data: {} } });
  mount({ id: "c1", name: "Dr C", repTags: [REPS[0]] });
  fireEvent.click(await screen.findByRole("button", { name: "Bob" }));
  await waitFor(() => assert.equal(post.mock.calls.length, 1));
  assert.deepEqual(post.mock.calls[0][1], { ids: ["c1"], add: ["r2"], remove: ["r1"] });
});

test("a lab-role user does not see the picker", () => {
  role = "lab";
  const { container } = mount({ id: "c1", name: "Dr C", repTags: [] });
  assert.equal(container.textContent, "");
  assert.equal(get.mock.calls.length, 0);
});
