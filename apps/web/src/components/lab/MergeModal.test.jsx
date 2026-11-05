// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast.jsx";

const posts = [];
let postReply = async () => ({});
vi.mock("../../config/api.js", () => ({ default: { post: (...a) => { posts.push(a); return postReply(...a); } } }));
const { MergeModal, mergeBulkAction } = await import("./MergeModal.jsx");

afterEach(cleanup);
beforeEach(() => {
  posts.length = 0;
  postReply = async () => ({ data: { data: { primary: { id: "o2", orderNumber: 100102, version: 5 }, merged: [{ id: "o1", orderNumber: 100101 }] } } });
});

const ROWS = [
  { id: "o1", orderNumber: 100101, version: 3, practice: "Smile Co", deviceSummary: "Night guard" },
  { id: "o2", orderNumber: 100102, version: 4, practice: "Smile Co", deviceSummary: "Splint" },
];

test("MergeModal requires choosing a primary and a second click", async () => {
  const onMerged = vi.fn();
  render(<ToastProvider><MergeModal rows={ROWS} onClose={vi.fn()} onMerged={onMerged} /></ToastProvider>);
  const merge = screen.getByRole("button", { name: "Merge 2 orders" });
  assert.equal(merge.disabled, true, "nothing happens until a primary is chosen");
  assert.ok(screen.getByText(/edits there \(price overrides, manual lines, discounts\) are dropped/), "warns that the others' draft edits are lost");

  fireEvent.click(screen.getByLabelText(/#100102/));
  assert.equal(merge.disabled, false);
  fireEvent.click(merge);
  assert.equal(posts.length, 0, "the first click only arms it");
  fireEvent.click(screen.getByRole("button", { name: "Click again to merge 2 orders into #100102" }));

  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0], ["/lab/orders/merge", { primaryId: "o2", otherIds: ["o1"], versions: { o1: 3, o2: 4 } }]);
  await waitFor(() => assert.equal(onMerged.mock.calls.length, 1));
  assert.ok(await screen.findByText("Merged 2 orders into #100102"));
});

test("the bulk Merge… action is enabled for 2–5 selected and opens the modal with them", () => {
  const open = vi.fn();
  const action = mergeBulkAction(open);
  assert.equal(action.label, "Merge…");
  assert.equal(action.disabled(ROWS.slice(0, 1)), true);
  assert.equal(action.disabled(ROWS), false);
  assert.equal(action.disabled(Array.from({ length: 6 }, (_, i) => ({ id: `x${i}` }))), true);
  action.run(ROWS);
  assert.deepEqual(open.mock.calls[0][0], ROWS);
});
