import { describe, it, expect, vi, afterEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

vi.mock("../config/email.js", () => ({
  mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" },
}));

const { sendAdminApprovalRequest, sendWelcome } = await import("./email.service.js");

/** Stub Mailgun and return the html of the first message sent. */
async function capture(fn) {
  const fetch = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  await fn();
  return new URLSearchParams(fetch.mock.calls[0][1].body).get("html");
}

afterEach(() => vi.unstubAllGlobals());

const BASE = {
  doctorName: "Mallory",
  doctorEmail: "front-desk@practice.example",
  npiNumber: "1234567890",
  companyName: `<a href="https://evil.example">Approve</a>`,
  approveUrl: "https://app.example/api/v1/auth/approve/T?action=approve",
  rejectUrl: "https://app.example/api/v1/auth/approve/T?action=reject",
};

describe("admin approval email — Seazona email match wording (Codex, PR #36)", () => {
  it("never calls an email match verified, and says it is NOT linked yet", async () => {
    const html = await capture(() =>
      sendAdminApprovalRequest({
        ...BASE,
        seazonaEmailMatch: { clientId: "c", accountNumber: "1324", company: "Rago Orthodontics" },
      })
    );
    expect(html).not.toMatch(/verified email/i);
    expect(html).toMatch(/NOT linked yet/);
    expect(html).toMatch(/Rago Orthodontics/);
    expect(html).toMatch(/only after the registrant confirms they control this email address/);
  });

  it("keeps the one-click Approve / Reject links", async () => {
    const html = await capture(() => sendAdminApprovalRequest({ ...BASE, seazonaEmailMatch: null }));
    expect(html).toContain(`href="${BASE.approveUrl}"`);
    expect(html).toContain(`href="${BASE.rejectUrl}"`);
    expect(html).toMatch(/Not linked/);
  });

  it("escapes registrant-supplied fields and labels the company as entered", async () => {
    const html = await capture(() => sendAdminApprovalRequest({ ...BASE, seazonaEmailMatch: null }));
    expect(html).not.toContain(`<a href="https://evil.example">`);
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
    expect(html).toMatch(/Company \(as entered\)/);
  });

  it("the verification email escapes the registrant-supplied name", async () => {
    const html = await capture(() =>
      sendWelcome({ email: "x@y.z", name: "<img src=x>", verifyUrl: "https://app/v?token=t", expiresIn: "7 days" })
    );
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toMatch(/expires in 7 days/);
  });
});
