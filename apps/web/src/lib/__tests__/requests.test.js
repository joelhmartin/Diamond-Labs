import { test } from "vitest";
import assert from "node:assert/strict";
import { isStale, errorText, blobErrorText } from "../requests.js";

test("a 409 STALE is recognised so the page can reload instead of retrying", () => {
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "STALE" } } } }), true);
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "CONFLICT" } } } }), false);
  assert.equal(errorText({ response: { data: { error: { message: "Nope." } } } }), "Nope.");
  assert.equal(errorText({}), "Something went wrong.");
});

test("a failed blob request surfaces the server's message", async () => {
  const blob = new Blob([JSON.stringify({ error: { message: "Ticket unavailable." } })]);
  assert.equal(await blobErrorText({ response: { data: blob } }), "Ticket unavailable.");
  assert.equal(await blobErrorText({ response: { data: new Blob(["not json"]) }, message: "boom" }), "boom");
  assert.equal(await blobErrorText({ message: "offline" }), "offline");
});
