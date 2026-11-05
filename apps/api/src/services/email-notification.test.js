import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

const cfg = vi.hoisted(() => ({ appEnv: "production", to: undefined, mailgun: true }));
vi.mock("../config/email.js", () => ({
  get mailgun() { return cfg.mailgun ? { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } : null; },
}));
vi.mock("../config/env.js", () => ({
  env: {
    get APP_ENV() { return cfg.appEnv; },
    get STAGING_EMAIL_TO() { return cfg.to; },
    NODE_ENV: "test", EMAIL_FROM: "noreply@example.com", APP_URL: "https://portal.example",
  },
}));

const email = await import("./email.service.js");
const capture = () => { const f = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", f); return f; };
const sent = (f) => new URLSearchParams(f.mock.calls[0][1].body);

afterEach(() => {
  vi.unstubAllGlobals();
  cfg.appEnv = "production";
  cfg.to = undefined;
  cfg.mailgun = true;
});

test("sendNotificationEmail escapes heading/line and links actionUrl", async () => {
  const f = capture();
  const ok = await email.sendNotificationEmail({
    to: "user@x.com", subject: "Thing 7", heading: "Thing <b>7</b> happened", line: `Tom & "Jerry" <script>`,
    actionUrl: "https://portal.example/things/7?a=1&b=2",
  });
  assert.deepEqual(ok, { ok: true, reason: null });
  assert.equal(f.mock.calls.length, 1);
  const p = sent(f);
  assert.equal(p.get("to"), "user@x.com");
  assert.equal(p.get("subject"), "Thing 7");
  const html = p.get("html");
  assert.match(html, /Thing &lt;b&gt;7&lt;\/b&gt; happened/);
  assert.match(html, /Tom &amp; &quot;Jerry&quot; &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<b>7/);
  assert.match(html, /href="https:\/\/portal\.example\/things\/7\?a=1&amp;b=2"/);
  assert.match(html, />Open</);
  const text = p.get("text");
  assert.match(text, /Thing <b>7<\/b> happened/);
  assert.match(text, /Open: https:\/\/portal\.example\/things\/7\?a=1&b=2/);
});

test("a custom actionLabel is escaped; a non-http actionUrl renders no button", async () => {
  const f = capture();
  await email.sendNotificationEmail({ to: "u@x.com", subject: "S", heading: "H", line: "L", actionUrl: "javascript:alert(1)", actionLabel: "<View>" });
  const p = sent(f);
  assert.doesNotMatch(p.get("html"), /href=/);
  assert.doesNotMatch(p.get("text"), /javascript:/);
  f.mockClear();
  await email.sendNotificationEmail({ to: "u@x.com", subject: "S", heading: "H", line: "L", actionUrl: "https://portal.example/x", actionLabel: "<View>" });
  assert.match(sent(f).get("html"), />&lt;View&gt;</);
});

test("it renders only the values it is given: no other body text", async () => {
  const f = capture();
  await email.sendNotificationEmail({
    to: "u@x.com", subject: "S", heading: "H1", line: "L1", actionUrl: null,
    patientName: "Zelda Quimby", notes: "plantar fasciitis",
  });
  const p = sent(f);
  const everything = [p.get("subject"), p.get("text"), p.get("html")].join("\n");
  for (const leaked of ["Zelda", "plantar"]) assert.ok(!everything.includes(leaked), `${leaked} must not be rendered`);
  assert.equal(p.get("text"), "H1\nL1");
});

test("no recipient sends nothing", async () => {
  const f = capture();
  assert.deepEqual(await email.sendNotificationEmail({ to: "", subject: "S", heading: "H", line: "L" }), { ok: false, reason: "undeliverable" });
  assert.equal(f.mock.calls.length, 0);
});

test("it goes through deliver (staging rewrite applies)", async () => {
  cfg.appEnv = "staging";
  cfg.to = "qa@example.com";
  const f = capture();
  await email.sendNotificationEmail({ to: "real@party.com", subject: "Thing 7", heading: "H", line: "L", actionUrl: null });
  const p = sent(f);
  assert.equal(p.get("to"), "qa@example.com");
  assert.match(p.get("subject"), /^\[STAGING → real@party\.com\] Thing 7/);
});

const msg = (to = "real@party.com") => ({ to, subject: "S", heading: "H", line: "L", actionUrl: null });

test("staging with no STAGING_EMAIL_TO is suppressed, not a failure", async () => {
  cfg.appEnv = "staging";
  const f = capture();
  assert.deepEqual(await email.sendNotificationEmail(msg()), { ok: false, reason: "suppressed" });
  assert.equal(f.mock.calls.length, 0);
});

test("no Mailgun config (dev) is unconfigured, not a failure", async () => {
  cfg.mailgun = false;
  const f = capture();
  assert.deepEqual(await email.sendNotificationEmail(msg()), { ok: false, reason: "unconfigured" });
  assert.equal(f.mock.calls.length, 0);
});

test("only .invalid recipients is undeliverable; a Mailgun refusal is rejected; a throw is error", async () => {
  capture();
  assert.deepEqual(await email.sendNotificationEmail(msg("user+1@example.invalid")), { ok: false, reason: "undeliverable" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, text: async () => "bad" })));
  assert.deepEqual(await email.sendNotificationEmail(msg()), { ok: false, reason: "rejected" });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
  assert.deepEqual(await email.sendNotificationEmail(msg()), { ok: false, reason: "error" });
});

test("the other senders still return a plain boolean", async () => {
  capture();
  assert.equal(await email.sendInvoiceNotice({ to: "u@x.com", invoiceId: "i1", invoiceNumber: 1, totalCents: 100, balanceCents: 100, dueDate: null }), true);
  cfg.mailgun = false;
  assert.equal(await email.sendInvoiceNotice({ to: "u@x.com", invoiceId: "i1", invoiceNumber: 1, totalCents: 100, balanceCents: 100, dueDate: null }), false);
});
