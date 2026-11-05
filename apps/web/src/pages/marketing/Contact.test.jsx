import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { postContactMessage } from "./Contact.jsx";

afterEach(() => vi.unstubAllGlobals());

function formData(entries) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

test("posts the filled-in fields and leaves out blank optional ones", async () => {
  const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await postContactMessage(formData({ name: "A Doctor", phone: "", email: "doc@example.com", message: "Hi", website: "" }));
  const [url, init] = fetchMock.mock.calls[0];
  assert.equal(url, "/api/v1/contact");
  assert.deepEqual(JSON.parse(init.body), { name: "A Doctor", email: "doc@example.com", message: "Hi" });
});

test("a rejected send throws, so the form can never show success for it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
  await assert.rejects(postContactMessage(formData({ name: "A" })), /503/);
});
