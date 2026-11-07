import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.MAILGUN_API_KEY = "test-key";
process.env.MAILGUN_DOMAIN = "mg.example.com";
process.env.ADMIN_NOTIFICATION_EMAIL = "lab@example.com";

const { sendContactMessage } = await import("./email.service.js");

afterEach(() => vi.unstubAllGlobals());

function stubMailgun() {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return () => new URLSearchParams(fetchMock.mock.calls[0][1].body);
}

test("goes to the lab, replies go to the sender, and visitor input is escaped", async () => {
  const sentForm = stubMailgun();
  const ok = await sendContactMessage({
    name: "<b>Dr</b>",
    email: "doc@example.com\r\nBcc: x@y.z",
    message: "<script>alert(1)</script>\nline two",
    subject: "General Question",
  });
  const form = sentForm();
  assert.equal(ok, true);
  assert.equal(form.get("to"), "lab@example.com");
  assert.equal(form.get("h:Reply-To"), "doc@example.com Bcc: x@y.z");
  assert.match(form.get("subject"), /General Question/);
  assert.ok(!form.get("html").includes("<script>"));
  assert.ok(!form.get("html").includes("<b>Dr</b>"));
  assert.ok(form.get("html").includes("&lt;script&gt;"));
});
