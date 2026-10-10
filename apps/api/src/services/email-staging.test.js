import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cfg = vi.hoisted(() => ({ appEnv: "development", to: undefined }));
vi.mock("../config/email.js", () => ({
  mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" },
}));
vi.mock("../config/env.js", () => ({
  env: {
    get APP_ENV() { return cfg.appEnv; },
    get STAGING_EMAIL_TO() { return cfg.to; },
    NODE_ENV: "test",
    EMAIL_FROM: "noreply@example.com",
  },
}));

const email = await import("./email.service.js");
const SRC = fileURLToPath(new URL("..", import.meta.url));
const emailSrc = readFileSync(new URL("./email.service.js", import.meta.url), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
  cfg.appEnv = "development";
  cfg.to = undefined;
});

function stub() {
  const f = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", f);
  return f;
}
const form = (f, i = 0) => new URLSearchParams(f.mock.calls[i][1].body);

test("staging: receipt goes only to STAGING_EMAIL_TO with prefixed subject", async () => {
  cfg.appEnv = "staging";
  cfg.to = "qa@example.com";
  const f = stub();
  await email.sendPaymentReceipt({ to: "real-doctor@practice.com", amount: 10, invoices: [], transactionId: "t", date: new Date() });
  assert.equal(f.mock.calls.length, 1);
  const p = form(f);
  assert.equal(p.get("to"), "qa@example.com");
  assert.match(p.get("subject"), /^\[STAGING → real-doctor@practice\.com\] /);
  assert.equal(p.get("bcc"), null);
  assert.equal(p.get("cc"), null);
});

test("staging without STAGING_EMAIL_TO sends nothing (fail closed)", async () => {
  cfg.appEnv = "staging";
  const f = stub();
  const ok = await email.sendWelcome({ email: "real@x.com", name: "N", verifyUrl: "https://x" });
  assert.equal(ok, false);
  assert.equal(f.mock.calls.length, 0);
});

test("non-staging: message is delivered exactly as before", async () => {
  const f = stub();
  await email.sendWelcome({ email: "real@x.com", name: "N", verifyUrl: "https://x" });
  const p = form(f);
  assert.equal(p.get("to"), "real@x.com");
  assert.doesNotMatch(p.get("subject"), /STAGING/);
});

test("every exported send* function ends up in deliver(), which is the only Mailgun caller", () => {
  // Exactly one network call in the whole file, and it sits inside deliver().
  assert.equal(emailSrc.match(/\bfetch\(/g).length, 1);
  const deliverStart = emailSrc.indexOf("async function deliver(");
  assert.ok(deliverStart > -1);
  const nextTop = emailSrc.indexOf("\n}\n", deliverStart);
  const fetchAt = emailSrc.indexOf("fetch(");
  assert.ok(fetchAt > deliverStart && fetchAt < nextTop, "fetch must live inside deliver()");
  // No second mail primitive left behind under the old name.
  assert.equal(/function send\(/.test(emailSrc), false);
  assert.ok(emailSrc.includes("stagingRewrite("), "deliver() must apply stagingRewrite");

  // Each exported sender body must call deliver( and never fetch directly.
  const parts = emailSrc.split(/\nexport (?:async )?function /).slice(1);
  const senders = parts.filter((p) => /^send[A-Z]/.test(p));
  assert.ok(senders.length >= 10, "expected to find the sender functions");
  for (const body of senders) {
    const name = body.match(/^\w+/)[0];
    assert.ok(/\bdeliver\(/.test(body), `${name} must send via deliver()`);
    assert.equal(/\bfetch\(/.test(body), false, `${name} must not call fetch directly`);
  }
});

test("nothing outside email.service.js uses the Mailgun config or endpoint", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".js") || p.endsWith(".test.js")) continue;
      if (p.endsWith("services/email.service.js") || p.endsWith("config/email.js")) continue;
      const s = readFileSync(p, "utf8");
      if (/config\/email\.js|api\.mailgun|\/v3\/.*\/messages/.test(s)) offenders.push(p);
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
