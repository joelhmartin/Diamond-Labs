import { test, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({
  env: { APP_ENV: "production", NODE_ENV: "test", EMAIL_FROM: "noreply@example.com", APP_URL: "https://portal.example" },
}));

const email = await import("./email.service.js");
const capture = () => { const f = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", f); return f; };
const sent = (f) => new URLSearchParams(f.mock.calls[0][1].body);

test("one shipped email per box: every order number, the carrier, the tracking number and the link", async () => {
  const f = capture();
  const ok = await email.sendShippedNotice({
    to: "dr@x.com", orderNumbers: [100245, 100246], carrier: "UPS", trackingNumber: "1Z999AA10123456784",
    trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784",
  });
  assert.equal(ok, true);
  assert.equal(f.mock.calls.length, 1);
  const p = sent(f);
  assert.equal(p.get("to"), "dr@x.com");
  assert.equal(p.get("subject"), "Your order has shipped — Diamond Orthotic Laboratory");
  const html = p.get("html");
  assert.match(html, /#100245, #100246/);
  assert.match(html, /UPS/);
  assert.match(html, /1Z999AA10123456784/);
  assert.match(html, /href="https:\/\/www\.ups\.com\/track\?loc=en_US&amp;tracknum=1Z999AA10123456784"/);
  const text = p.get("text");
  assert.match(text, /#100245, #100246/);
  assert.match(text, /1Z999AA10123456784/);
  vi.unstubAllGlobals();
});

test("a manual shipment names the carrier staff typed and has no link; no tracking number means no email", async () => {
  const f = capture();
  await email.sendShippedNotice({ to: "dr@x.com", orderNumbers: [100245], carrier: "Lone Star Courier", trackingNumber: "LS-1", trackingUrl: null });
  const html = sent(f).get("html");
  assert.match(html, /Lone Star Courier/);
  assert.doesNotMatch(html, /href=/);
  assert.equal(await email.sendShippedNotice({ to: "dr@x.com", orderNumbers: [1], carrier: "UPS", trackingNumber: null }), false);
  assert.equal(f.mock.calls.length, 1);
  vi.unstubAllGlobals();
});

test("the shipped email renders only order numbers, carrier and tracking — patient-looking input never appears", async () => {
  const f = capture();
  await email.sendShippedNotice({
    to: "dr@x.com", orderNumbers: [100245], carrier: "UPS", trackingNumber: "1Z999AA10123456784", trackingUrl: null,
    patientFirst: "Zelda", patientLast: "Quimby", patientName: "Zelda Quimby", deviceSummary: "Orthotic, 3/4 length",
    caseNumber: "RX-00042", formData: { notes: "plantar fasciitis" }, attachments: [{ filename: "rx.pdf" }],
  });
  const p = sent(f);
  const everything = [p.get("subject"), p.get("text"), p.get("html")].join("\n");
  for (const leaked of ["Zelda", "Quimby", "Orthotic, 3/4", "RX-00042", "plantar", "rx.pdf"]) {
    assert.ok(!everything.includes(leaked), `${leaked} must not be rendered`);
  }
  assert.match(everything, /#100245/);
  assert.equal(p.get("attachment"), null);
  vi.unstubAllGlobals();
});

test("the tracking button renders only for an https link", async () => {
  const f = capture();
  await email.sendShippedNotice({ to: "dr@x.com", orderNumbers: [1], carrier: "UPS", trackingNumber: "1Z1", trackingUrl: "javascript:alert(1)" });
  const p = sent(f);
  assert.doesNotMatch(p.get("html"), /href=/);
  assert.doesNotMatch(p.get("text"), /javascript:/);
  vi.unstubAllGlobals();
});
