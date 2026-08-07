import * as seazonaService from "./seazona.service.js";
import { getInvoicePortalPaidStrict } from "./invoice-ledger.service.js";
import { sendPaymentReceipt } from "./email.service.js";
import * as auditService from "./audit.service.js";
import { db } from "../config/database.js";
import { invoicePayments } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";

/** Round to cents consistently (avoids FP drift like 0.1+0.2). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function buildAllocationNotes(allocations, transactionId) {
  const parts = allocations.map(
    (a) => `${a.invoiceNumber || a.invoiceId} $${Number(a.amount).toFixed(2)}`
  );
  return `DOL portal txn ${transactionId} — ${parts.join("; ")}`.slice(0, 500);
}

/**
 * Seazona's "Invoices & Payments" report attributes an account-level payment to
 * specific invoices by parsing the literal token `Invoices <num>, <num>` out of
 * the payment's `referenceNumber` field (verified live 2026-06-10 — it matches
 * on referenceNumber, NOT notes, and by invoice NUMBER, not GUID). Build exactly
 * that token; returns null if no allocation carries an invoice number.
 */
export function buildInvoiceReference(allocations) {
  const numbers = allocations.map((a) => a.invoiceNumber).filter(Boolean);
  return numbers.length ? `Invoices ${numbers.join(", ")}` : null;
}

/**
 * After a successful charge: record ONE account-level payment in Seazona (their
 * payment API has no invoice-level granularity) with notes describing the split,
 * then write one local invoice_payments row per allocated invoice.
 *
 * `source` tags where the charge originated (e.g. "doctor_card", "doctor_hosted",
 * "admin_card", "admin_offline") for the invoice_payments ledger — optional and
 * defaulted so existing callers are unchanged.
 *
 * Returns `{ seazonaPaymentId, ledgerWriteFailed }`. NEVER throws — the card is
 * already charged, so a Seazona or local-ledger write failure is logged loudly
 * (alertable) and reported back as a warning rather than surfaced as a 500
 * (which would invite a re-charge on retry).
 */
export async function recordPaymentAndAllocations({ user, amount, transactionId, allocations, source = null }) {
  let seazonaPaymentId = null;

  // Seazona has no sandbox — createPayment writes to the live system. Only do it
  // for real (production) charges; in sandbox we still write the local ledger so
  // the flow is fully testable without polluting Seazona's production data.
  if (user.seazonaClientId && env.AUTHORIZE_NET_ENV === "production") {
    const res = await seazonaService.createPayment({
      clientId: user.seazonaClientId,
      accountNumber: user.seazonaAccountNumber,
      // `Invoices <num>` token is what Seazona's report matches on to attribute
      // this payment to the invoice(s); the gateway txn id lives in notes. Fall
      // back to the txn id only if no allocation carried an invoice number.
      referenceNumber: buildInvoiceReference(allocations) || transactionId,
      notes: buildAllocationNotes(allocations, transactionId),
      amount,
    });
    // H3 — Seazona's payment-id field name is not firmly known. Accept the
    // plausible shapes; if the call returned a body but no id resolves, log the
    // KEYS ONLY (never values — avoid PHI) so the real field can be learned.
    seazonaPaymentId = res?.paymentId ?? res?.id ?? res?.PaymentId ?? res?.paymentID ?? null;
    if (res && !seazonaPaymentId) {
      console.error(`[Seazona][PAYMENT_ID_SHAPE] keys=${Object.keys(res).join(",")}`);
    }

    // CRITICAL: the card was already charged at Authorize.net. If the Seazona
    // write didn't land, the payment exists at the processor but NOT in the
    // billing system of record — it must be entered manually. This was silently
    // swallowed before. Log a distinct, alertable line (the `[Seazona]` token is
    // what the GCP log-based metric matches) carrying everything needed to
    // reconcile by hand. We do NOT throw — failing here can't un-charge the card.
    if (!seazonaPaymentId) {
      console.error(
        `[Seazona][PAYMENT_WRITE_FAILED] charge ${transactionId} succeeded at Authorize.net but did NOT record in Seazona — manual entry required ` +
          JSON.stringify({
            transactionId,
            clientId: user.seazonaClientId,
            accountNumber: user.seazonaAccountNumber || null,
            amount,
            invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
          })
      );
    }
  }

  // M4 — the card is already charged; a local-ledger insert failure must NOT
  // 500 (that would invite a re-charge on retry). Guard it, log an alertable
  // line carrying ONLY ids/amounts (no card or patient data), and report the
  // charge as succeeded-with-warning.
  let ledgerWriteFailed = false;
  try {
    await db.insert(invoicePayments).values(
      allocations.map((a) => ({
        id: createId(),
        userId: user.id,
        seazonaClientId: user.seazonaClientId || null,
        seazonaInvoiceId: String(a.invoiceId),
        invoiceNumber: a.invoiceNumber ? String(a.invoiceNumber) : null,
        appliedAmount: Number(a.amount).toFixed(2),
        transactionId,
        seazonaPaymentId,
        source,
      }))
    );
  } catch (ledgerErr) {
    ledgerWriteFailed = true;
    console.error(
      `[PAYMENT][LEDGER_WRITE_FAILED] charge ${transactionId} succeeded but the local invoice_payments ledger insert failed — manual reconcile required ` +
        JSON.stringify({
          transactionId,
          seazonaPaymentId,
          userId: user.id,
          amount,
          invoices: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) })),
          error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
        })
    );
  }

  // Payment receipt — soft-fail, never blocks (the card already charged). Covers
  // both saved-card and hosted-card paths since both funnel through here.
  if (user.email) {
    try {
      await sendPaymentReceipt({
        to: user.email,
        amount,
        invoices: allocations.map((a) => ({
          number: a.invoiceNumber || a.invoiceId,
          amount: Number(a.amount),
        })),
        transactionId,
        date: new Date(),
      });
    } catch {
      /* send() never throws; this is belt-and-suspenders */
    }
  }

  // Durable audit trail (who paid what). Soft-fail — the card already charged.
  // Covers both saved-card and hosted paths since both funnel through here.
  await auditService.logSafe({
    userId: user.id,
    action: "payment.charge",
    targetType: "transaction",
    targetId: transactionId,
    metadata: {
      amount,
      invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
      seazonaPaymentId: seazonaPaymentId || null,
      ledgerWriteFailed,
    },
  });

  return { seazonaPaymentId, ledgerWriteFailed };
}

/**
 * Verify every allocated invoice belongs to the doctor's Seazona client, and
 * (optionally, C1) that no allocation exceeds the invoice's remaining balance.
 *
 * Backfills each allocation's invoiceNumber from the live invoice (Seazona's
 * report matches on number, not GUID). Returns `null` when all good, else
 * `{ kind, message }` where kind is "forbidden" (not found / not owned, → 403)
 * or "validation" (cap exceeded, → 422). Uses the SAME live invoice it already
 * fetched for ownership to compute the remaining balance — no extra fetch.
 */
export async function verifyAllocations(allocations, user, { enforceCap = false } = {}) {
  for (const a of allocations) {
    const inv = await seazonaService.getInvoice(a.invoiceId);
    if (!inv) return { kind: "forbidden", message: `Invoice ${a.invoiceNumber || a.invoiceId} not found.` };
    if (!a.invoiceNumber && inv.invoiceNumber != null) a.invoiceNumber = inv.invoiceNumber;
    if (String(inv.clientId) !== String(user.seazonaClientId)) {
      return { kind: "forbidden", message: `Invoice ${a.invoiceNumber || a.invoiceId} does not belong to your account.` };
    }
    if (enforceCap) {
      // C1 — remaining = invoice total minus what's already been applied through
      // the portal ledger for this doctor. The +0.005 tolerance absorbs cent
      // rounding; a fully-paid invoice has remaining ~0 and is therefore blocked.
      // STRICT read on purpose: a DB error here must abort the charge, not
      // silently report "paid so far = 0" and re-open the full balance.
      const paid = await getInvoicePortalPaidStrict(user.id, a.invoiceId);
      const remaining = round2(Number(inv.total || 0) - paid);
      if (Number(a.amount) > remaining + 0.005) {
        return {
          kind: "validation",
          message: `Allocation $${Number(a.amount).toFixed(2)} for invoice ${a.invoiceNumber || a.invoiceId} exceeds its remaining balance of $${remaining.toFixed(2)}.`,
        };
      }
    }
  }
  return null;
}
