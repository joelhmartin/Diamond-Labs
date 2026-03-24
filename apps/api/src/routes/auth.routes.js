import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  magicLinkSchema,
  magicLinkVerifySchema,
  mfaVerifySchema,
  mfaEnableSchema,
  mfaDisableSchema,
} from "@my-app/shared";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/authenticate.js";
import * as authService from "../services/auth.service.js";
import { getGoogleAuthUrl, generateOAuthState, exchangeGoogleCode, getGoogleUser } from "../lib/oauth.js";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";

const REFRESH_COOKIE = "refresh_token";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v1/auth",
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

export default async function authRoutes(fastify) {
  // Register
  fastify.post("/register", { preHandler: [validate(registerSchema)] }, async (request, reply) => {
    const result = await authService.register(request.body);
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return {
      data: {
        user: result.user,
        accessToken: result.accessToken,
      },
    };
  });

  // Login
  fastify.post("/login", { preHandler: [validate(loginSchema)] }, async (request, reply) => {
    const result = await authService.login({
      ...request.body,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    if (result.mfaRequired) {
      return { data: { mfaRequired: true, mfaToken: result.mfaToken } };
    }

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return {
      data: {
        user: result.user,
        accessToken: result.accessToken,
      },
    };
  });

  // Logout
  fastify.post("/logout", async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE];
    await authService.logout(refreshToken);
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    return { data: { message: "Logged out." } };
  });

  // Refresh
  fastify.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      return reply.code(401).send({ error: { code: "REFRESH_TOKEN_INVALID", message: "No refresh token.", status: 401 } });
    }

    const result = await authService.refresh({
      refreshToken,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return { data: { accessToken: result.accessToken } };
  });

  // Forgot password
  fastify.post("/forgot-password", { preHandler: [validate(forgotPasswordSchema)] }, async (request) => {
    await authService.forgotPassword(request.body.email);
    // Always return success to prevent email enumeration
    return { data: { message: "If an account exists, a reset email has been sent." } };
  });

  // Reset password
  fastify.post("/reset-password", { preHandler: [validate(resetPasswordSchema)] }, async (request) => {
    await authService.resetPassword(request.body);
    return { data: { message: "Password has been reset." } };
  });

  // Verify email
  fastify.post("/verify-email", { preHandler: [validate(verifyEmailSchema)] }, async (request) => {
    await authService.verifyEmail(request.body.token);
    return { data: { message: "Email verified." } };
  });

  // Magic link: send
  fastify.post("/magic-link", { preHandler: [validate(magicLinkSchema)] }, async (request) => {
    await authService.requestMagicLink(request.body.email);
    return { data: { message: "If an account exists, a magic link has been sent." } };
  });

  // Magic link: verify
  fastify.post("/magic-link/verify", { preHandler: [validate(magicLinkVerifySchema)] }, async (request, reply) => {
    const result = await authService.verifyMagicLink({
      token: request.body.token,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return { data: { user: result.user, accessToken: result.accessToken } };
  });

  // MFA: setup
  fastify.post("/mfa/setup", { preHandler: [authenticate] }, async (request) => {
    const result = await authService.setupMfa(request.user.id);
    return { data: result };
  });

  // MFA: verify (during login)
  fastify.post("/mfa/verify", { preHandler: [validate(mfaVerifySchema)] }, async (request, reply) => {
    const result = await authService.verifyMfa({
      mfaToken: request.body.mfaToken,
      code: request.body.code,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return { data: { user: result.user, accessToken: result.accessToken } };
  });

  // MFA: enable
  fastify.post("/mfa/enable", { preHandler: [authenticate, validate(mfaEnableSchema)] }, async (request) => {
    await authService.enableMfa(request.user.id, request.body.code);
    return { data: { message: "MFA enabled." } };
  });

  // MFA: disable
  fastify.post("/mfa/disable", { preHandler: [authenticate, validate(mfaDisableSchema)] }, async (request) => {
    await authService.disableMfa(request.user.id, request.body.password);
    return { data: { message: "MFA disabled." } };
  });

  // OAuth: Google redirect
  fastify.get("/oauth/google", async (request, reply) => {
    const state = generateOAuthState();
    await redis.set(`oauth_state:${state}`, "1", "EX", 600);
    const url = getGoogleAuthUrl(state);
    return reply.redirect(url);
  });

  // OAuth: Google callback
  fastify.get("/oauth/google/callback", async (request, reply) => {
    const { code, state } = request.query;
    const stored = await redis.get(`oauth_state:${state}`);
    if (!stored) {
      return reply.code(400).send({ error: { code: "INVALID_STATE", message: "Invalid OAuth state.", status: 400 } });
    }
    await redis.del(`oauth_state:${state}`);

    try {
      const tokens = await exchangeGoogleCode(code);
      const googleUser = await getGoogleUser(tokens.access_token);

      // Find or create user
      const { db } = await import("../config/database.js");
      const { users, accounts, memberships } = await import("../db/schema/index.js");
      const { eq } = await import("drizzle-orm");
      const { createId } = await import("../lib/id.js");
      const { signAccessToken, generateRefreshToken } = await import("../lib/tokens.js");

      let [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, googleUser.email))
        .limit(1);

      if (!user) {
        const userId = createId();
        await db.insert(users).values({
          id: userId,
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          avatarUrl: googleUser.picture || null,
          emailVerifiedAt: new Date(),
          status: "active",
        });

        const accountId = createId();
        const { slugify } = await import("@my-app/shared");
        const slug = slugify(googleUser.name || "account") || `account-${accountId.slice(0, 8)}`;
        await db.insert(accounts).values({
          id: accountId,
          name: `${googleUser.name || "My"}'s Account`,
          slug,
          ownerId: userId,
          status: "active",
        });

        await db.insert(memberships).values({
          id: createId(),
          userId,
          accountId,
          role: "owner",
          status: "active",
        });

        user = { id: userId, email: googleUser.email, name: googleUser.name };
      }

      const accessToken = await signAccessToken({ sub: user.id });
      const refreshToken = generateRefreshToken();
      // Import createSession inline to create the session
      const { hashToken } = await import("../lib/tokens.js");
      const sessionId = createId();
      await db.insert((await import("../db/schema/index.js")).sessions).values({
        id: sessionId,
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      reply.setCookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
      // Redirect to frontend with access token
      return reply.redirect(`${env.APP_URL}/auth/oauth-callback?token=${accessToken}`);
    } catch (err) {
      request.log.error(err);
      return reply.redirect(`${env.APP_URL}/auth/login?error=oauth_failed`);
    }
  });
}
