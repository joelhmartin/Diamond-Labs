import { resend } from "../config/email.js";
import { env } from "../config/env.js";

async function send({ to, subject, html }) {
  if (!resend) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    if (env.NODE_ENV === "development") {
      console.log(`[EMAIL] Body preview (first 200 chars): ${html?.slice(0, 200)}`);
    }
    return;
  }

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
  });
}

export async function sendWelcome({ email, name, verifyUrl }) {
  await send({
    to: email,
    subject: "Welcome! Please verify your email",
    html: `
      <h1>Welcome, ${name}!</h1>
      <p>Thanks for signing up. Please verify your email address by clicking the link below:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Verify Email</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  });
}

export async function sendInvitation({ email, inviterName, accountName, acceptUrl }) {
  await send({
    to: email,
    subject: `You're invited to join ${accountName}`,
    html: `
      <h1>You've been invited!</h1>
      <p>${inviterName} has invited you to join <strong>${accountName}</strong>.</p>
      <p><a href="${acceptUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
      <p>This invitation expires in 7 days.</p>
    `,
  });
}

export async function sendMagicLink({ email, magicLinkUrl }) {
  await send({
    to: email,
    subject: "Your sign-in link",
    html: `
      <h1>Sign in</h1>
      <p>Click the link below to sign in to your account:</p>
      <p><a href="${magicLinkUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Sign In</a></p>
      <p>This link expires in 15 minutes.</p>
    `,
  });
}

export async function sendPasswordReset({ email, resetUrl }) {
  await send({
    to: email,
    subject: "Reset your password",
    html: `
      <h1>Password Reset</h1>
      <p>Click the link below to reset your password:</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}
