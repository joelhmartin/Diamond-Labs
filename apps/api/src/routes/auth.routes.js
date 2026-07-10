import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  mfaVerifySchema,
  mfaEnableSchema,
  mfaDisableSchema,
  doctorRegisterSchema,
} from "@my-app/shared";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/authenticate.js";
import * as authService from "../services/auth.service.js";
import { env } from "../config/env.js";

const REFRESH_COOKIE = "refresh_token";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/api/v1/auth",
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

// Escape a string for safe interpolation into HTML text/attribute contexts.
// Prevents stored XSS from attacker-controlled values (e.g. the doctor's `name`,
// which comes from the public registration form) reaching the approval pages.
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Strict CSP for the approval HTML pages: no scripts, no external anything; only
// the inline styles these pages actually use.
const APPROVAL_CSP = "default-src 'none'; style-src 'unsafe-inline'";

function renderApprovalError(reply, message, statusCode = 400) {
  reply
    .type("text/html")
    .header("Content-Security-Policy", APPROVAL_CSP)
    .code(statusCode)
    .send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;">
        <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:400px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626;">Error</h1>
          <p style="color:#64748b;margin:0;">${escapeHtml(message || "This link is invalid or has expired.")}</p>
        </div>
      </body>
      </html>
    `);
}

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

    if (result.pendingApproval) {
      return { data: { pendingApproval: true } };
    }

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

  // Doctor registration
  fastify.post("/register/doctor", { preHandler: [validate(doctorRegisterSchema)] }, async (request) => {
    const result = await authService.registerDoctor(request.body);
    return { data: result };
  });

  // Admin approval — GET renders a CONFIRMATION page (side-effect-free). It must
  // NOT consume the token: mail scanners and link prefetchers hit GET links, and
  // a state-mutating GET would auto-approve an unvetted doctor. The actual
  // approve/reject happens on the POST below (triggered by a human clicking a
  // button), which is what consumes the token.
  fastify.get("/approve/:token", async (request, reply) => {
    const { token } = request.params;

    try {
      const preview = await authService.getApprovalPreview(token);
      const safeName = escapeHtml(preview.doctorName);
      const safeToken = encodeURIComponent(token);
      const approveUrl = `/api/v1/auth/approve/${safeToken}?action=approve`;
      const rejectUrl = `/api/v1/auth/approve/${safeToken}?action=reject`;

      reply
        .type("text/html")
        .header("Content-Security-Policy", APPROVAL_CSP)
        .send(`
          <!DOCTYPE html>
          <html>
          <head><title>Review doctor</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
          <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;">
            <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:400px;">
              <h1 style="margin:0 0 8px;font-size:20px;">Review registration</h1>
              <p style="color:#64748b;margin:0 0 24px;">Approve or reject Dr. ${safeName}'s account?</p>
              <div style="display:flex;gap:12px;justify-content:center;">
                <form method="POST" action="${approveUrl}" style="margin:0;">
                  <button type="submit" style="cursor:pointer;border:none;border-radius:10px;padding:12px 24px;font-size:15px;color:white;background:#16a34a;">Approve</button>
                </form>
                <form method="POST" action="${rejectUrl}" style="margin:0;">
                  <button type="submit" style="cursor:pointer;border:none;border-radius:10px;padding:12px 24px;font-size:15px;color:white;background:#dc2626;">Reject</button>
                </form>
              </div>
            </div>
          </body>
          </html>
        `);
    } catch (err) {
      renderApprovalError(reply, err.message, err.statusCode || 400);
    }
  });

  // Admin approval — POST performs the actual approve/reject and consumes the
  // token. Action is carried in the query string of the form's action URL.
  fastify.post("/approve/:token", async (request, reply) => {
    const { token } = request.params;
    const action = request.query.action;

    try {
      const result = await authService.processApproval(token, action);
      const status = result.approved ? "approved" : "rejected";
      const color = result.approved ? "#16a34a" : "#dc2626";
      const safeName = escapeHtml(result.doctorName);

      reply
        .type("text/html")
        .header("Content-Security-Policy", APPROVAL_CSP)
        .send(`
          <!DOCTYPE html>
          <html>
          <head><title>Doctor ${status}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
          <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;">
            <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:400px;">
              <div style="width:48px;height:48px;border-radius:50%;background:${color};margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
                <span style="color:white;font-size:24px;">${result.approved ? "✓" : "✕"}</span>
              </div>
              <h1 style="margin:0 0 8px;font-size:20px;">Doctor ${status}</h1>
              <p style="color:#64748b;margin:0;">Dr. ${safeName}'s account has been ${status}.</p>
            </div>
          </body>
          </html>
        `);
    } catch (err) {
      renderApprovalError(reply, err.message, err.statusCode || 400);
    }
  });
}
