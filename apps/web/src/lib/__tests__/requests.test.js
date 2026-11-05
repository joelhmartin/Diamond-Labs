import { test } from "vitest";
import assert from "node:assert/strict";
import { isStale, errorText, blobErrorText, saveFile, dispositionFilename } from "../requests.js";

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

test("saveFile throws the server's message from a failed blob download", async () => {
  const body = new Blob([JSON.stringify({ error: { code: "REPORTS_BUSY", message: "Reports are busy. Try again shortly." } })]);
  const api = { get: async () => { throw { response: { status: 503, data: body } }; } };
  await assert.rejects(saveFile(api, "/x.csv", {}, "x.csv"), { message: "Reports are busy. Try again shortly." });
});

test("dispositionFilename reads quoted and bare names", () => {
  assert.equal(dispositionFilename('attachment; filename="r-2026-11-05.csv"'), "r-2026-11-05.csv");
  assert.equal(dispositionFilename("attachment; filename=a.csv"), "a.csv");
  assert.equal(dispositionFilename(undefined), null);
});
