import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

const cfg = vi.hoisted(() => ({ admins: ["a@example.com", "b@example.com"] }));
vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({
  env: {
    APP_ENV: "production",
    NODE_ENV: "test",
    EMAIL_FROM: "noreply@example.com",
    get ADMIN_NOTIFICATION_EMAIL() { return cfg.admins; },
  },
}));

const email = await import("./email.service.js");
const stub = () => { const f = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", f); return f; };
const form = (f) => new URLSearchParams(f.mock.calls[0][1].body);
const rx = { caseNumber: "RX-1", practiceName: "Dr X", deviceSummary: "Orthotic", unmappedCount: 2, caseUrl: "https://p.example/admin/rx-cases/1" };

afterEach(() => { vi.unstubAllGlobals(); cfg.admins = ["a@example.com", "b@example.com"]; });

test("the Rx notice goes to every admin in ONE message", async () => {
  const f = stub();
  assert.equal(await email.sendRxSubmissionReceived(rx), true);
  assert.equal(f.mock.calls.length, 1);
  assert.equal(form(f).get("to"), "a@example.com, b@example.com");
  assert.match(form(f).get("html"), /before this case can be released to the lab/);
});

test("no admins configured: nothing is sent", async () => {
  cfg.admins = undefined;
  const f = stub();
  assert.equal(await email.sendRxSubmissionReceived(rx), false);
  assert.equal(f.mock.calls.length, 0);
});

test("the AutoPay failure copy BCCs every admin", async () => {
  const f = stub();
  await email.sendAutopayFailure({ email: "dr@x.com", name: "Dr", amount: 10, reason: "declined", paused: false });
  assert.equal(form(f).get("to"), "dr@x.com");
  assert.equal(form(f).get("bcc"), "a@example.com, b@example.com");
});

test("the doctor-registration request goes to every admin", async () => {
  const f = stub();
  await email.sendAdminApprovalRequest({ doctorName: "Dr Y", doctorEmail: "y@x.com", approveUrl: "https://p/a", rejectUrl: "https://p/r" });
  assert.equal(form(f).get("to"), "a@example.com, b@example.com");
});
