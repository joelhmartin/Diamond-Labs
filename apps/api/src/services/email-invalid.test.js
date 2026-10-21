import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({ env: { APP_ENV: "development", NODE_ENV: "test", EMAIL_FROM: "noreply@example.com" } }));

const email = await import("./email.service.js");
afterEach(() => vi.unstubAllGlobals());

const stub = () => {
  const f = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", f);
  return f;
};
const receipt = (to) => email.sendPaymentReceipt({ to, amountCents: 100, invoices: [], transactionId: "t", date: new Date() });

test("a placeholder login (.invalid) is never sent mail", async () => {
  const f = stub();
  await receipt("client-c-3005@seazona-clients.invalid");
  assert.equal(f.mock.calls.length, 0);
});

test(".invalid recipients are dropped from a list; the rest still get it", async () => {
  const f = stub();
  await receipt(["doc@practice.test", "client-x@seazona-clients.invalid"]);
  assert.equal(f.mock.calls.length, 1);
  assert.equal(new URLSearchParams(f.mock.calls[0][1].body).get("to"), "doc@practice.test");
});
