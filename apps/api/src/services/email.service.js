import { resend } from "../config/email.js";
import { env } from "../config/env.js";

/**
 * Dispatch an email through Resend. Returns `true` when the message was actually
 * handed to Resend, `false` when there's no API key configured (dev no-op — we
 * log instead of sending). Existing callers ignore the return value; the receipt
 * flow uses it to report honestly whether an email really went out.
 */
async function send({ to, subject, html, text }) {
  if (!resend) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    if (env.NODE_ENV === "development") {
      console.log(`[EMAIL] Body preview (first 200 chars): ${html?.slice(0, 200)}`);
    }
    return false;
  }

  // The Resend SDK does NOT throw on API errors (bad key, invalid sender domain,
  // rate limit, etc.) — it resolves with `{ data, error }`. Returning false (never
  // throwing) keeps existing fire-and-forget callers unaffected while letting the
  // receipt flow report honestly whether the email actually went out.
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
  });
  if (error) {
    console.error(`[EMAIL] Resend rejected message to ${to} (subject: ${subject}):`, error);
    return false;
  }
  return true;
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

/** Invite a Seazona-imported client to activate their new portal account. */
export async function sendPortalInvitation({ email, name, activateUrl }) {
  await send({
    to: email,
    subject: "Activate your Diamond Orthotic Laboratory portal",
    html: `
      <h1>Welcome${name ? `, ${name}` : ""}!</h1>
      <p>We've moved Diamond Orthotic Laboratory to a new doctor portal. Your account is waiting — just set a password to get started.</p>
      <p>From your new portal you'll be able to submit Digital Rx cases, view invoices, track orders, and manage saved payment methods.</p>
      <p><a href="${activateUrl}" style="display:inline-block;padding:14px 28px;background:#13AEEF;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;">Create your password</a></p>
      <p style="color:#666;font-size:13px;">This activation link expires in 7 days. If you weren't expecting this, you can ignore it.</p>
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

/** Escape user-supplied strings before interpolating into the receipt HTML. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  const v = Number(n);
  return `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
}

/**
 * Guest catalog order receipt. Sent (soft-fail) by POST /payments/checkout after a
 * successful charge + local order record. Returns whether an email was actually
 * dispatched (false in dev with no RESEND_API_KEY) so the checkout response can tell
 * the shopper the truth about whether a receipt went out.
 *
 * `items` are the resolved order lines: { name, qty, unitPrice, lineTotal }.
 * `shipping` is the address object collected at checkout.
 */
export async function sendOrderReceipt({
  to,
  orderNumber,
  items = [],
  subtotal,
  tax,
  shippingCost,
  total,
  shipping = {},
  transactionId,
}) {
  const rows = items
    .map(
      (l) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;">${esc(l.name)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;text-align:center;">${esc(l.qty)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;text-align:right;">${money(l.unitPrice)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;text-align:right;">${money(l.lineTotal)}</td>
        </tr>`
    )
    .join("");

  const addressLines = [
    shipping.name,
    shipping.practice,
    [shipping.address1, shipping.address2].filter(Boolean).join(", "),
    [shipping.city, shipping.state, shipping.postalCode].filter(Boolean).join(", "),
    shipping.country,
  ]
    .filter(Boolean)
    .map((line) => esc(line))
    .join("<br/>");

  const totalsRow = (label, value, bold) => `
    <tr>
      <td style="padding:4px 12px;text-align:right;color:#5a6b7b;${bold ? "font-weight:700;color:#1a2733;font-size:15px;" : ""}">${esc(label)}</td>
      <td style="padding:4px 12px;text-align:right;color:#1a2733;width:120px;${bold ? "font-weight:700;font-size:15px;" : ""}">${value}</td>
    </tr>`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a2733;">
      <div style="background:#13AEEF;border-radius:16px 16px 0 0;padding:28px 32px;">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Diamond Orthotic Laboratory</h1>
        <p style="margin:4px 0 0;color:#eaf8ff;font-size:13px;">Order confirmation &amp; receipt</p>
      </div>
      <div style="border:1px solid #eef1f4;border-top:none;border-radius:0 0 16px 16px;padding:28px 32px;">
        <p style="margin:0 0 4px;color:#5a6b7b;font-size:13px;">Thanks for your order. We've received your payment and your order is being processed.</p>
        <p style="margin:16px 0 24px;font-size:13px;color:#5a6b7b;">
          Order number<br/>
          <strong style="font-size:18px;color:#1a2733;font-family:monospace;letter-spacing:0.5px;">${esc(orderNumber)}</strong>
        </p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
          <thead>
            <tr>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Item</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Qty</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Price</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <table style="width:100%;border-collapse:collapse;margin:8px 0 24px;">
          ${totalsRow("Subtotal", money(subtotal))}
          ${totalsRow("Tax", money(tax))}
          ${totalsRow("Shipping", money(shippingCost))}
          ${totalsRow("Total", money(total), true)}
        </table>

        <div style="background:#f6f9fb;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
          <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;">Shipping to</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#1a2733;">${addressLines || "—"}</p>
        </div>

        <p style="margin:0 0 24px;font-size:12px;color:#8a98a6;">
          Payment reference: <span style="font-family:monospace;">${esc(transactionId || "—")}</span>
        </p>

        <p style="margin:0;font-size:13px;color:#5a6b7b;line-height:1.6;">
          Questions about your order? Contact the lab and reference your order number above and we'll be happy to help.
        </p>
      </div>
    </div>
  `;

  return send({
    to,
    subject: `Your Diamond Orthotic Laboratory order — ${orderNumber}`,
    html,
  });
}
