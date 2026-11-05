// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/Toast.jsx";

const posts = [];
let postReply = async () => ({});
vi.mock("../../config/api.js", () => ({
  default: {
    get: async () => ({ data: { data: { families: [{ id: "fam1", name: "Night guard", variants: [{ id: "var1", code: "NG1", name: "Hard night guard" }] }] } } }),
    post: (...a) => { posts.push(a); return postReply(...a); },
  },
}));
const { LinesEditor } = await import("./LinesEditor.jsx");

afterEach(cleanup);
beforeEach(() => { posts.length = 0; postReply = async () => ({ data: { data: {} } }); });

const ORDER = { id: "lo-1", version: 7, status: "received" };
const LINES = [{ id: "l1", qty: 2, code: "NG1", name: "Hard night guard", arch: "upper" }];

function mount(onChanged = vi.fn(), order = ORDER) {
  render(<MemoryRouter><ToastProvider><LinesEditor order={order} lines={LINES} onChanged={onChanged} /></ToastProvider></MemoryRouter>);
  return onChanged;
}

test("LinesEditor qty change sends expectedVersion and reloads on STALE", async () => {
  const stale = Object.assign(new Error("stale"), { response: { status: 409, data: { error: { code: "STALE", message: "This order changed — reload." } } } });
  postReply = async () => { throw stale; };
  const onChanged = mount();
  const qty = screen.getByLabelText("Quantity of Hard night guard");
  fireEvent.change(qty, { target: { value: "3" } });
  fireEvent.blur(qty);
  assert.ok(await screen.findByText(/This order changed — reload\. The latest version has been loaded\./));
  assert.deepEqual(posts[0], ["/lab/orders/lo-1/lines", { op: "update", lineId: "l1", qty: 3, expectedVersion: 7 }]);
  assert.equal(onChanged.mock.calls.length, 1);
});

test("removing a line asks twice, then posts remove", async () => {
  const onChanged = mount();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  assert.equal(posts.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Click again to remove" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0][1], { op: "remove", lineId: "l1", expectedVersion: 7 });
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});

test("adding a catalog line posts add; an issued invoice's refusal is shown", async () => {
  postReply = async () => { throw Object.assign(new Error("x"), { response: { status: 422, data: { error: { message: "Invoice already issued, so lines can't change." } } } }); };
  mount();
  await waitFor(() => screen.getByRole("option", { name: "Night guard" }));
  fireEvent.change(screen.getByLabelText("Product family"), { target: { value: "fam1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add line" }));
  assert.ok(await screen.findByText(/Invoice already issued/));
  assert.deepEqual(posts[0][1], { op: "add", variantId: "var1", qty: 1, expectedVersion: 7 });
});

test("a shipped order's lines are locked", () => {
  mount(vi.fn(), { ...ORDER, status: "shipped" });
  assert.equal(screen.getByLabelText("Quantity of Hard night guard").disabled, true);
  assert.equal(screen.queryByRole("button", { name: "Add line" }), null);
});
