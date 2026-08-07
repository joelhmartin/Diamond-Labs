import { mailgun } from "../config/email.js";
import { env } from "../config/env.js";

/**
 * Dispatch an email through Mailgun's HTTP API. Returns `true` when the message
 * was accepted, `false` when no Mailgun config is present (dev no-op — we log
 * instead of sending) or the send was rejected. NEVER throws, so fire-and-forget
 * callers are unaffected and the receipt flow can report honestly whether an
 * email actually went out.
 */
async function send({ to, cc, subject, html, text }) {
  if (!mailgun) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    if (env.NODE_ENV === "development") {
      console.log(`[EMAIL] Body preview (first 200 chars): ${html?.slice(0, 200)}`);
    }
    return false;
  }

  const form = new URLSearchParams();
  form.set("from", env.EMAIL_FROM);
  form.set("to", to);
  if (cc) form.set("cc", cc);
  form.set("subject", subject);
  if (html) form.set("html", html);
  if (text) form.set("text", text);

  try {
    const res = await fetch(`${mailgun.apiBase}/v3/${mailgun.domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${mailgun.apiKey}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[EMAIL] Mailgun rejected message to ${to} (subject: ${subject}): ${res.status} ${body.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[EMAIL] Mailgun send failed to ${to} (subject: ${subject}): ${String(err?.message || err)}`);
    return false;
  }
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

export async function sendAdminApprovalRequest({
  doctorName,
  doctorEmail,
  npiNumber,
  companyName,
  approveUrl,
  rejectUrl,
  seazonaLink,
  suggestedSeazonaClient,
}) {
  // Approving grants access to a Seazona client's invoices — which carry patient
  // names (PHI). Show the admin exactly which client, if any, this account is
  // linked to, so approval is an informed decision rather than a blind one.
  const linkRow = seazonaLink
    ? `<tr><td style="padding:6px 12px;font-weight:bold;">Seazona account</td><td style="padding:6px 12px;">Linked by verified email — ${esc(seazonaLink.company || "account")} (acct ${esc(seazonaLink.accountNumber || "—")})</td></tr>`
    : `<tr><td style="padding:6px 12px;font-weight:bold;">Seazona account</td><td style="padding:6px 12px;">Not linked</td></tr>`;

  const suggestionBlock = suggestedSeazonaClient
    ? `<p style="margin:16px 0;padding:12px;border-left:4px solid #f59e0b;background:#fffbeb;">
         <strong>Possible match, NOT linked.</strong> This registration's phone number matches
         Seazona client ${esc(suggestedSeazonaClient.company || "—")}
         (acct ${esc(suggestedSeazonaClient.accountNumber || "—")}).
         A phone number is public information, so we do not link on it automatically.
         Verify this is the same practice and link it manually before approving.
       </p>`
    : "";

  await send({
    to: env.ADMIN_NOTIFICATION_EMAIL,
    subject: `New Doctor Registration — ${doctorName}`,
    html: `
      <h1>New Doctor Registration Request</h1>
      <p>A new doctor has requested access to Diamond Labs:</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 12px;font-weight:bold;">Name</td><td style="padding:6px 12px;">${esc(doctorName)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">Email</td><td style="padding:6px 12px;">${esc(doctorEmail)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">NPI Number</td><td style="padding:6px 12px;">${esc(npiNumber)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;">Company</td><td style="padding:6px 12px;">${esc(companyName)}</td></tr>
        ${linkRow}
      </table>
      ${suggestionBlock}
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

/**
 * AutoPay charge failed. Sent to the doctor; the lab is copied via
 * ADMIN_NOTIFICATION_EMAIL so a paused enrollment does not go unnoticed.
 */
export async function sendAutopayFailure({ email, name, amount, reason, paused }) {
  return send({
    to: email,
    cc: env.ADMIN_NOTIFICATION_EMAIL,
    subject: paused ? "AutoPay paused — payment failed" : "AutoPay payment failed",
    html: `
      <h1>We couldn't process your AutoPay payment</h1>
      <p>Hello${name ? `, ${esc(name)}` : ""} — your scheduled AutoPay payment of
         <strong>$${Number(amount).toFixed(2)}</strong> did not go through.</p>
      <p style="color:#5a6b7b;">Reason: ${esc(reason)}</p>
      ${paused
        ? `<p style="padding:12px;border-left:4px solid #f59e0b;background:#fffbeb;">
             We've <strong>paused</strong> your AutoPay after repeated failures. Update your
             card and contact the lab to resume — no further attempts will be made until then.
           </p>`
        : `<p>We'll try again in a couple of days. You can also update your card or pay
             manually from your portal at any time.</p>`}
      <p><a href="${env.APP_URL}/doctor/saved-cards" style="display:inline-block;padding:12px 24px;background:#13AEEF;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;">Update your card</a></p>
    `,
  });
}

/**
 * Escape user-supplied strings before interpolating into email HTML.
 *
 * Used by the receipts AND by the admin approval request, whose name/NPI/company
 * come straight from the PUBLIC doctor-registration body and render next to
 * one-click Approve/Reject links — unescaped, a registrant could inject a decoy
 * "Approve" anchor pointing at their own URL, or hide the real Reject button.
 */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/**
 * Doctor invoice-payment receipt. Sent (soft-fail) after a successful invoice
 * payment is recorded — covers both the saved-card and hosted-card flows.
 * `invoices` are { number, amount } per invoice the charge was applied to.
 */
export async function sendPaymentReceipt({ to, amount, invoices = [], transactionId, date }) {
  if (!to) return false;
  const when = (date instanceof Date ? date : new Date()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const rows = invoices
    .map(
      (i) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;">Invoice ${esc(i.number)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;text-align:right;">${money(i.amount)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2733;">
      <h1 style="font-size:20px;margin:0 0 4px;">Payment received</h1>
      <p style="margin:0 0 20px;color:#5a6b7b;font-size:13px;">Thank you — your payment to Diamond Orthotic Laboratory was processed on ${when}.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Invoice</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Applied</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td style="padding:12px;text-align:right;font-weight:700;font-size:15px;">Total charged</td>
            <td style="padding:12px;text-align:right;font-weight:700;font-size:15px;">${money(amount)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin:0 0 24px;font-size:12px;color:#8a98a6;">
        Payment reference: <span style="font-family:monospace;">${esc(transactionId || "—")}</span>
      </p>
      <p style="margin:0;font-size:13px;color:#5a6b7b;line-height:1.6;">
        Questions about this payment? Contact the lab and reference the payment id above.
      </p>
    </div>
  `;

  return send({ to, subject: "Payment received — Diamond Orthotic Laboratory", html });
}

/**
 * Doctor refund receipt. Sent (soft-fail) after an admin refunds/voids a recorded
 * payment. Mirrors sendPaymentReceipt. `invoices` are { number, amount } per
 * invoice the refund was applied against (amount is the positive refunded value).
 */
export async function sendRefundReceipt({ to, amount, invoices = [], transactionId, date }) {
  if (!to) return false;
  const when = (date instanceof Date ? date : new Date()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const rows = invoices
    .map(
      (i) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;">Invoice ${esc(i.number)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#1a2733;text-align:right;">${money(i.amount)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2733;">
      <h1 style="font-size:20px;margin:0 0 4px;">Refund issued</h1>
      <p style="margin:0 0 20px;color:#5a6b7b;font-size:13px;">A refund from Diamond Orthotic Laboratory was issued on ${when}. It may take a few business days to appear on your statement.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Invoice</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8a98a6;border-bottom:2px solid #eef1f4;">Refunded</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td style="padding:12px;text-align:right;font-weight:700;font-size:15px;">Total refunded</td>
            <td style="padding:12px;text-align:right;font-weight:700;font-size:15px;">${money(amount)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin:0 0 24px;font-size:12px;color:#8a98a6;">
        Original payment reference: <span style="font-family:monospace;">${esc(transactionId || "—")}</span>
      </p>
      <p style="margin:0;font-size:13px;color:#5a6b7b;line-height:1.6;">
        Questions about this refund? Contact the lab and reference the payment id above.
      </p>
    </div>
  `;

  return send({ to, subject: "Refund issued — Diamond Orthotic Laboratory", html });
}
