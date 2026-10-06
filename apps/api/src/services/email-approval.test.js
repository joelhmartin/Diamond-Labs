import { describe, it, expect, vi, afterEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

vi.mock("../config/email.js", () => ({
  mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" },
}));

const { sendAdminApprovalRequest, sendWelcome, sendInvitation, headerSafe } = await import("./email.service.js");

/** Stub Mailgun and return the form fields of the first message sent. */
async function capture(fn) {
  const fetch = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  await fn();
  return new URLSearchParams(fetch.mock.calls[0][1].body);
}
const htmlOf = async (fn) => (await capture(fn)).get("html");

afterEach(() => vi.unstubAllGlobals());

const BASE = {
  doctorName: "Mallory",
  doctorEmail: "front-desk@practice.example",
  npiNumber: "1234567890",
  companyName: `<a href="https://evil.example">Approve</a>`,
  approveUrl: "https://app.example/api/v1/auth/approve/T?action=approve",
  approveUnlinkedUrl: "https://app.example/api/v1/auth/approve/T?action=approve_unlinked",
  rejectUrl: "https://app.example/api/v1/auth/approve/T?action=reject",
};
const MATCH = { clientId: "c", accountNumber: "1324", company: "Rago Orthodontics" };

describe("admin approval email — the admin decides on a named Seazona client", () => {
  it("names the exact client (Seazona company + account) and says it is NOT linked", async () => {
    const html = await htmlOf(() => sendAdminApprovalRequest({ ...BASE, seazonaEmailMatch: MATCH }));
    expect(html).not.toMatch(/verified email/i);
    expect(html).toMatch(/NOT linked/);
    expect(html).toMatch(/Rago Orthodontics<\/strong> \(acct 1324\)/);
    expect(html).toMatch(/only once the registrant also verifies their email/);
  });

  it("offers approve-and-link (naming the client) and approve-without-linking", async () => {
    const html = await htmlOf(() => sendAdminApprovalRequest({ ...BASE, seazonaEmailMatch: MATCH }));
    expect(html).toContain(`href="${BASE.approveUrl}"`);
    expect(html).toMatch(/Approve &amp; link Rago Orthodontics \(acct 1324\)/);
    expect(html).toContain(`href="${BASE.approveUnlinkedUrl}"`);
    expect(html).toContain(`href="${BASE.rejectUrl}"`);
  });

  it("no match: plain one-click Approve / Reject, no unlinked option", async () => {
    const html = await htmlOf(() =>
      sendAdminApprovalRequest({ ...BASE, approveUnlinkedUrl: null, seazonaEmailMatch: null })
    );
    expect(html).toContain(`href="${BASE.approveUrl}"`);
    expect(html).toMatch(/>Approve<\/a>/);
    expect(html).not.toMatch(/Approve without linking/);
    expect(html).toMatch(/Not linked/);
  });

  it("escapes registrant-supplied fields and labels the company as entered", async () => {
    const html = await htmlOf(() => sendAdminApprovalRequest({ ...BASE, seazonaEmailMatch: null }));
    expect(html).not.toContain(`<a href="https://evil.example">`);
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
    expect(html).toMatch(/Company \(as entered\)/);
  });

  it("the verification email escapes the registrant-supplied name", async () => {
    const html = await htmlOf(() =>
      sendWelcome({ email: "x@y.z", name: "<img src=x>", verifyUrl: "https://app/v?token=t", expiresIn: "7 days" })
    );
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toMatch(/expires in 7 days/);
  });
});

/** CodeRabbit (PR #36): registrant input reached the Subject header raw. */
describe("email header sanitizing", () => {
  it("headerSafe strips CR/LF, other control chars and Unicode line separators", () => {
    expect(headerSafe("Mallory\r\nBcc: victim@example.com")).toBe("Mallory Bcc: victim@example.com");
    expect(headerSafe("a\u0000b\u0007c\u007Fd\u0085e\u2028f\u2029g\tz")).toBe("a b c d e f g z");
    expect(headerSafe(null)).toBe("");
  });

  it("headerSafe caps the length with an ellipsis", () => {
    const out = headerSafe("x".repeat(500), 80);
    expect(out).toHaveLength(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("the approval subject carries no line breaks and a capped name", async () => {
    const form = await capture(() =>
      sendAdminApprovalRequest({ ...BASE, doctorName: `Mallory\r\nBcc: a@b.c${"y".repeat(300)}`, seazonaEmailMatch: null })
    );
    const subject = form.get("subject");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.startsWith("New Doctor Registration — Mallory Bcc: a@b.c")).toBe(true);
    expect(subject.length).toBeLessThanOrEqual("New Doctor Registration — ".length + 80);
  });

  it("send() sanitizes every subject and recipient, not just the approval email", async () => {
    const form = await capture(() =>
      sendInvitation({
        email: "invitee@example.com\r\nBcc: x@evil.example",
        inviterName: "Ann",
        accountName: "Acme\r\nX-Injected: 1",
        acceptUrl: "https://app/accept",
      })
    );
    expect(form.get("subject")).toBe("You're invited to join Acme X-Injected: 1");
    expect(form.get("to")).not.toMatch(/[\r\n]/);
  });
});
