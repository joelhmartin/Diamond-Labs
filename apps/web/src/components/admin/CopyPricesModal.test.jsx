// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../config/api.js", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
const { CopyPricesModal } = await import("./CopyPricesModal.jsx");

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const USERS = [
  { id: "src", role: "doctor", name: "Dr. Source", email: "src@x.test" },
  { id: "t1", role: "doctor", name: "Dr. Target", email: "t1@x.test" },
  { id: "adm", role: "admin", name: "An Admin", email: "adm@x.test" },
];
const PREVIEW = {
  targets: [{
    clientUserId: "t1",
    changes: [
      { variantId: "v1", beforeCents: 45000, beforeSource: "client", afterCents: 50000, afterSource: "client" },
      { variantId: "v2", beforeCents: null, beforeSource: "base", afterCents: 8000, afterSource: "list" },
    ],
    listsBefore: [], listsAfter: [{ listId: "L1", name: "Gold", archived: false }],
  }],
  failed: [],
  previewHash: "a".repeat(64),
};

function mount(props = {}) {
  get.mockImplementation(async (path) => {
    if (path === "/admin/users") return { data: { data: { users: USERS } } };
    if (path === "/admin/catalog/families") return { data: { data: { families: [{ name: "Crowns", variants: [{ id: "v1", name: "Zirconia" }, { id: "v2", name: "PFM" }] }] } } };
    throw new Error(`unexpected GET ${path}`);
  });
  const onDone = vi.fn();
  render(<MemoryRouter><CopyPricesModal targetIds={["t1"]} onDone={onDone} onClose={() => {}} {...props} /></MemoryRouter>);
  return { onDone };
}

async function previewIt() {
  const select = await screen.findByLabelText("Copy from");
  await screen.findByRole("option", { name: /Dr. Source/ });
  fireEvent.change(select, { target: { value: "src" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
  await screen.findByText("Dr. Target");
}

test("the source picker offers clients only, never the targets", async () => {
  mount();
  await screen.findByRole("option", { name: /Dr. Source/ });
  assert.equal(screen.queryByRole("option", { name: /Dr. Target/ }), null);
  assert.equal(screen.queryByRole("option", { name: /An Admin/ }), null);
});

test("preview shows one row per target with its change count, expanding to before and after", async () => {
  post.mockResolvedValue({ data: { data: PREVIEW } });
  mount();
  await previewIt();
  assert.deepEqual(post.mock.calls[0], ["/admin/prices/copy/preview", { fromClientUserId: "src", toClientUserIds: ["t1"], mode: "replace" }]);
  assert.ok(screen.getByText("2 changes"));
  fireEvent.click(screen.getByRole("button", { name: "Expand row" }));
  assert.ok(await screen.findByText("Crowns — Zirconia"));
  assert.ok(screen.getByText("$450.00"));
  assert.ok(screen.getByText("$500.00"));
});

test("modal applies only after ConfirmButton's second click", async () => {
  post.mockResolvedValueOnce({ data: { data: PREVIEW } }).mockResolvedValueOnce({ data: { data: { ok: 1, failed: [] } } });
  const { onDone } = mount();
  await previewIt();
  const apply = screen.getByRole("button", { name: /Copy to 1 client/ });
  fireEvent.click(apply);
  assert.equal(post.mock.calls.length, 1, "first click only arms it");
  fireEvent.click(await screen.findByRole("button", { name: /Click again to copy to 1 client/ }));
  await waitFor(() => assert.equal(post.mock.calls.length, 2));
  assert.deepEqual(post.mock.calls[1], ["/admin/prices/copy", { fromClientUserId: "src", toClientUserIds: ["t1"], mode: "replace", previewHash: PREVIEW.previewHash }]);
  await waitFor(() => assert.deepEqual(onDone.mock.calls[0][0], { ok: 1, failed: [] }));
});

test("a stale plan sends the admin back to preview with a message", async () => {
  const stale = Object.assign(new Error("stale"), { response: { data: { error: { code: "STALE", message: "Prices changed since the preview. Preview the copy again." } } } });
  post.mockResolvedValueOnce({ data: { data: PREVIEW } }).mockRejectedValueOnce(stale);
  mount();
  await previewIt();
  fireEvent.click(screen.getByRole("button", { name: /Copy to 1 client/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Click again to copy to 1 client/ }));
  assert.ok(await screen.findByText(/Prices changed since the preview/));
  assert.equal(screen.queryByRole("button", { name: /Copy to 1 client/ }), null, "the stale preview is dropped");
});
