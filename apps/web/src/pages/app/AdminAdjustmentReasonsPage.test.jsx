// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

const REASONS = [
  { id: "r1", appliesTo: "remake", label: "Lab error", discountPercent: 100, active: true, position: 10 },
  { id: "r2", appliesTo: "discount", label: "Courtesy", discountPercent: null, active: false, position: 20 },
];
const patches = [];
const posts = [];
vi.mock("../../config/api.js", () => ({
  default: {
    get: async () => ({ data: { data: { reasons: REASONS } } }),
    patch: async (...a) => { patches.push(a); return { data: { data: {} } }; },
    post: async (...a) => { posts.push(a); return { data: { data: {} } }; },
  },
}));
const { AdminAdjustmentReasonsPage } = await import("./AdminAdjustmentReasonsPage.jsx");

afterEach(cleanup);
beforeEach(() => { patches.length = 0; posts.length = 0; });

const mount = () => render(<MemoryRouter><ToastProvider><AdminAdjustmentReasonsPage /></ToastProvider></MemoryRouter>);

test("reasons page deactivates via ConfirmButton", async () => {
  mount();
  await screen.findByDisplayValue("Lab error");
  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  assert.equal(patches.length, 0, "the first click only arms it");
  fireEvent.click(screen.getByRole("button", { name: "Click again to deactivate" }));
  await waitFor(() => assert.equal(patches.length, 1));
  assert.deepEqual(patches[0], ["/admin/lab/adjustment-reasons/r1", { active: false }]);
});

test("an inactive reason can be reactivated and a new one added with its default percent", async () => {
  mount();
  await screen.findByDisplayValue("Courtesy");
  fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
  await waitFor(() => assert.deepEqual(patches[0], ["/admin/lab/adjustment-reasons/r2", { active: true }]));
  fireEvent.change(screen.getByLabelText("New reason"), { target: { value: "Goodwill" } });
  fireEvent.change(screen.getByLabelText("New reason default percent"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0][1], { label: "Goodwill", appliesTo: "remake", discountPercent: 25, position: 30 });
});
