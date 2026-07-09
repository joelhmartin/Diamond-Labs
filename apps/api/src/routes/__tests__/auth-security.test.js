import { describe, it, expect } from "vitest";
import { updateRoleSchema } from "@my-app/shared";

// env.js validates required vars at import time; postgres-js connects lazily, so
// providing throwaway values lets us import the route module without a DB.
process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { escapeHtml } = await import("../auth.routes.js");

describe("escapeHtml (A1 stored XSS)", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x&y's")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&amp;y&#39;s&quot;)&lt;/script&gt;",
    );
  });

  it("neutralizes an attribute-breakout payload", () => {
    expect(escapeHtml(`" onmouseover="alert(1)`)).toBe(
      "&quot; onmouseover=&quot;alert(1)",
    );
  });

  it("coerces null/undefined to an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("updateRoleSchema (A2 owner privilege escalation)", () => {
  it("rejects a request to assign the 'owner' role", () => {
    expect(updateRoleSchema.safeParse({ role: "owner" }).success).toBe(false);
  });

  it("accepts every non-owner assignable role", () => {
    for (const role of ["admin", "manager", "member", "viewer"]) {
      expect(updateRoleSchema.safeParse({ role }).success).toBe(true);
    }
  });
});
