import { describe, it, expect } from "vitest";

// env.js validates required vars at import time; nothing here touches the DB.
process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { signAccessToken, verifyAccessToken, signMfaToken, verifyMfaToken } =
  await import("./tokens.js");

/**
 * Regression guard for the MFA-bypass token-confusion bug.
 *
 * Every JWT we mint is signed with the same secret and algorithm, so the only
 * thing separating "you passed the password step" from "you are fully
 * authenticated" is the `type` claim. verifyAccessToken used to check nothing,
 * which meant the short-lived mfaToken handed out BEFORE the second factor was
 * accepted as a full session token: password alone became account takeover.
 */
describe("token type confusion", () => {
  it("rejects an MFA token presented as an access token", async () => {
    const mfaToken = await signMfaToken("user_victim_123");

    await expect(verifyAccessToken(mfaToken)).rejects.toThrow(/access token type/i);
  });

  it("rejects an access token presented as an MFA token", async () => {
    const accessToken = await signAccessToken({ sub: "user_victim_123" });

    await expect(verifyMfaToken(accessToken)).rejects.toThrow(/MFA token type/i);
  });

  it("still accepts each token at its own verifier", async () => {
    const accessToken = await signAccessToken({ sub: "user_1" });
    const mfaToken = await signMfaToken("user_1");

    await expect(verifyAccessToken(accessToken)).resolves.toMatchObject({
      sub: "user_1",
      type: "access",
    });
    await expect(verifyMfaToken(mfaToken)).resolves.toMatchObject({
      sub: "user_1",
      type: "mfa",
    });
  });

  it("rejects a legacy access token that carries no type claim", async () => {
    // Tokens minted before the type claim existed must fail closed rather than
    // be grandfathered in — the client refreshes and gets a conforming one.
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const legacy = await new SignJWT({ sub: "user_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyAccessToken(legacy)).rejects.toThrow(/access token type/i);
  });
});
