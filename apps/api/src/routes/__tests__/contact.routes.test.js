import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const sendContactMessage = vi.fn();
vi.mock("../../services/email.service.js", () => ({ sendContactMessage }));

const contactRoutes = (await import("../contact.routes.js")).default;

const VALID = { name: "A Doctor", email: "doc@example.com", message: "Do you make the ONP?" };

async function post(payload) {
  const app = Fastify();
  await app.register(contactRoutes, { prefix: "/api/v1" });
  return app.inject({ method: "POST", url: "/api/v1/contact", payload });
}

beforeEach(() => {
  sendContactMessage.mockReset();
  sendContactMessage.mockResolvedValue(true);
});

test("a valid message is emailed and reports success", async () => {
  const res = await post({ ...VALID, subject: "General Question", practice: "Smile Co" });
  assert.equal(res.statusCode, 200);
  assert.equal(sendContactMessage.mock.calls[0][0].practice, "Smile Co");
});

test("when the email does not go out, the visitor is told it failed", async () => {
  sendContactMessage.mockResolvedValue(false);
  const res = await post(VALID);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, "CONTACT_NOT_SENT");
});

test("missing or malformed required fields are rejected without sending", async () => {
  for (const bad of [{ ...VALID, name: " " }, { ...VALID, email: "nope" }, { ...VALID, message: "" }, { ...VALID, subject: "Other" }]) {
    assert.equal((await post(bad)).statusCode, 422);
  }
  assert.equal(sendContactMessage.mock.calls.length, 0);
});

test("a filled honeypot looks successful but sends nothing", async () => {
  const res = await post({ ...VALID, website: "http://spam.example" });
  assert.equal(res.statusCode, 200);
  assert.equal(sendContactMessage.mock.calls.length, 0);
});
