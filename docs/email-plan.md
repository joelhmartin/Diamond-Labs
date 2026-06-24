# Email Plan — Diamond Orthotic Lab Portal

_Drafted 2026-06-24. Focus: purchase / payment "success" emails first._

## Infrastructure (already in place)
- **Provider:** Resend, via `apps/api/src/services/email.service.js` (`from` = `EMAIL_FROM`, default `noreply@<domain>`).
- **Soft-fail:** sends are best-effort — a send failure never blocks the underlying action (charge, approval, etc.).
- **Config dependency:** emails only actually dispatch when `RESEND_API_KEY` is set and `EMAIL_FROM` is on a **Resend-verified domain**. Confirm both are set in the prod secrets before relying on delivery (in dev with no key, sends are skipped and reported as "not sent").

### Emails that already exist
| Function | Trigger | Recipient |
|---|---|---|
| `sendOrderReceipt` | guest shop checkout success (`POST /payments/checkout`) — **wired** | shopper |
| `sendWelcome` / verification | account creation | new user |
| `sendMagicLink`, `sendPasswordReset` | auth flows | user |
| `sendPortalInvitation` | admin invites a doctor | doctor |
| `sendAdminApprovalRequest` | doctor registers | admin |
| `sendDoctorApproved` / `sendDoctorRejected` | admin decision | doctor |

## Gap → what to add now (purchase/payment success)

The **shop** purchase receipt exists. The missing "purchase success" email is the
**doctor invoice-payment receipt** — today a doctor pays invoices and gets no
emailed confirmation.

### 1. Doctor invoice-payment receipt (primary)
- **Add:** `sendPaymentReceipt({ to, amount, invoices: [{ number, amount }], transactionId, date, last4? })` in `email.service.js` (mirror `sendOrderReceipt`'s styled HTML).
- **Wire:** inside `recordPaymentAndAllocations()` in `payment.routes.js`, after the ledger write succeeds — so **all** payment paths get it (saved-card `charge-saved`, hosted `hosted-complete`). Soft-fail like the others.
- **Content:** amount charged, the invoice numbers paid + per-invoice split, transaction id, date, masked card if available. Subject e.g. "Payment received — Diamond Orthotic Lab".
- **Recipient:** the doctor's account email.

### 2. Rx case submission confirmation (secondary, nice-to-have)
- **Add:** `sendCaseSubmitted({ to, caseNumber, patient, devices })`.
- **Wire:** after a successful `POST /rx/cases` / the new `/rx/form-submissions`.
- **Content:** case number, patient, device(s) ordered, "we've received your case."

## Phasing
1. **Now:** doctor payment receipt (#1). Confirm `RESEND_API_KEY` + verified `EMAIL_FROM` in prod.
2. **Next:** Rx case-submission confirmation (#2).
3. **Later:** order status / shipped notifications (would need a Seazona status feed), monthly statement reminders.

## Open questions
- Confirm the `EMAIL_FROM` sending domain is verified in Resend (DKIM/SPF) so receipts don't land in spam.
- Should receipts CC the lab (`ADMIN_NOTIFICATION_EMAIL`) for a paper trail? (Easy to add.)
