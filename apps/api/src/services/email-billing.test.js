import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({
  env: { APP_ENV: "production", NODE_ENV: "test", EMAIL_FROM: "noreply@example.com", APP_URL: "https://portal.example" },
}));

const email = await import("./email.service.js");
const src = readFileSync(new URL("./email.service.js", import.meta.url), "utf8");
const capture = () => { const f = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", f); return f; };
const sent = (f) => new URLSearchParams(f.mock.calls[0][1].body);

test("the invoice notice: amount, due date and a portal link — no PDF, no patient", async () => {
  const f = capture();
  const ok = await email.sendInvoiceNotice({ to: "dr@x.com", invoiceId: "inv1", invoiceNumber: 500001, totalCents: 42000, balanceCents: 30000, dueDate: "2026-11-14" });
  assert.equal(ok, true);
  const p = sent(f);
  assert.match(p.get("subject"), /Invoice #500001/);
  assert.match(p.get("html"), /\$300\.00/);
  assert.match(p.get("html"), /11\/14\/2026/);
  assert.match(p.get("html"), /https:\/\/portal\.example\/doctor\/invoices\/inv1/);
  assert.equal(p.get("attachment"), null);
  vi.unstubAllGlobals();
});

test("the statement notice: month and closing balance, linking to the portal", async () => {
  const f = capture();
  await email.sendStatementNotice({ to: "dr@x.com", monthLabel: "October 2026", closingCents: 26000 });
  const p = sent(f);
  assert.match(p.get("subject"), /October 2026/);
  assert.match(p.get("html"), /\$260\.00/);
  assert.match(p.get("html"), /https:\/\/portal\.example\/doctor\/invoices/);
  vi.unstubAllGlobals();
});

test("neither notice can carry patient data or a file", () => {
  for (const fn of ["sendInvoiceNotice", "sendStatementNotice"]) {
    const start = src.indexOf(`export async function ${fn}`);
    const body = src.slice(start, src.indexOf("\nexport ", start + 1));
    assert.doesNotMatch(body, /patient|attachment/i, fn);
  }
});
