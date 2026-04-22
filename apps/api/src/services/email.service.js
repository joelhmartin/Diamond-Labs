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

export async function sendAdminApprovalRequest({ doctorName, doctorEmail, npiNumber, companyName, approveUrl, rejectUrl }) {
  await send({
    to: env.ADMIN_NOTIFICATION_EMAIL,
    subject: `New Doctor Registration — ${doctorName}`,
    html: `
      <h1>New Doctor Registration Request</h1>
      <p>A new doctor has requested access to Diamond Labs:</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 12px;font-weight:bold;">Name</td><td style="padding:6px 12px;">${doctorName}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">Email</td><td style="padding:6px 12px;">${doctorEmail}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">NPI Number</td><td style="padding:6px 12px;">${npiNumber}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">Company</td><td style="padding:6px 12px;">${companyName}</td></tr>
      </table>
      <p style="margin:24px 0;">
        <a href="${approveUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;margin-right:12px;">Approve</a>
        <a href="${rejectUrl}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">Reject</a>
      </p>
      <p style="color:#666;font-size:13px;">This link expires in 7 days.</p>
    `,
  });
}

export async function sendDoctorApproved({ email, name, loginUrl }) {
  await send({
    to: email,
    subject: "Your Diamond Labs account has been approved",
    html: `
      <h1>Welcome, Dr. ${name}!</h1>
      <p>Your Diamond Labs account has been approved. You can now sign in and access all doctor features.</p>
      <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Sign In</a></p>
    `,
  });
}

export async function sendDoctorRejected({ email, name }) {
  await send({
    to: email,
    subject: "Diamond Labs account update",
    html: `
      <h1>Account Update</h1>
      <p>Dear ${name},</p>
      <p>Unfortunately, your Diamond Labs registration request was not approved at this time. If you believe this is an error, please contact our support team.</p>
    `,
  });
}
