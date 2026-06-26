# Payment Portal — Capability Audit & Roadmap

_2026-06-25. Goal: a fully-functional B2B ordering / invoice-payment / card-on-file
portal on Authorize.net + Seazona. This reviews the standard capabilities such a
system has, what Authorize.net supports, what we have today, and a prioritized
build plan._

Legend — **Status:** ✅ have · 🟡 partial · ❌ missing. **Auth.net:** does the
gateway support it.

## 1. Charging / accepting payment
| Capability | Auth.net | Status | Notes |
|---|---|---|---|
| One-time card charge (auth+capture) | ✅ | ✅ | guest checkout + hosted invoice pay |
| Charge a saved card (CIM) | ✅ | ✅ | `chargeCustomerProfile` |
| Pay multiple invoices in one charge | — | ✅ | allocations |
| Partial / split payments | — | ✅ | per-invoice amounts |
| Hosted/iframe entry (SAQ-A) | ✅ | ✅ | Accept Hosted |
| Idempotent charges | — | ✅ | `withIdempotency` |
| Surcharge / convenience fee | ✅ | ❌ | B2B labs sometimes pass card fees; needs disclosure rules |
| Auth-only then capture later | ✅ | ❌ | not needed for invoice pay (auth+capture is right) |

## 2. Refunds / voids  ← **shipped (P0 + partial)**
| Capability | Auth.net | Status |
|---|---|---|
| Void (unsettled, same-day) | ✅ `voidTransaction` | ✅ |
| Refund (settled) | ✅ `refundTransaction` | ✅ |
| Partial refund | ✅ | ✅ (by invoice slice, settled charges; one reversal per charge) |
| Ledger reversal (invoice un-pays) | — | ✅ (negative `invoice_payments` rows) |
| Seazona credit/reversal | 🟡 (write-only API) | ✅ best-effort (alertable log on failure) |
| Refund receipt email | — | ✅ (`sendRefundReceipt`) |

## 3. Card on file (CIM)
| Capability | Auth.net | Status | Notes |
|---|---|---|---|
| Add / store card (profile) | ✅ | ✅ | hosted add-card |
| List saved cards (masked) | ✅ | ✅ | |
| Update expiry / billing | ✅ | ✅ | |
| Delete card | ✅ | ✅ | |
| **Multiple cards** per doctor | ✅ | ✅ | list/add/edit/delete each; pay modal picks among them |
| **Default card** selection | ✅ | ✅ | `users.defaultPaymentProfileId`; pre-selected in the pay modal |
| Card nickname / label | — | ❌ | P2 nicety |

## 4. Payment history / receipts
| Capability | Status | Notes |
|---|---|---|
| Emailed receipt (purchase + invoice payment) | ✅ | shop + doctor payment receipts (Mailgun) |
| Refund receipt | ❌ | building with refunds |
| **In-portal payment history** (doctor sees their payments) | ✅ | `/doctor/payments` — charges + refunds netted per transaction |
| Admin view of a doctor's payments / a payment's detail | ✅ | `/admin/payments` — searchable list, refund from a row |
| Downloadable/printable receipt (PDF) | ❌ | P2 |

## 5. Reconciliation / reporting / disputes
| Capability | Auth.net | Status | Notes |
|---|---|---|---|
| Record payment back to Seazona | — | ✅ | account-level payment + "Invoices N" reference |
| Reflect Seazona-direct payments | 🟡 | ✅ | admin "offline payment" entry |
| **Settlement webhooks** (txn settled/failed) | ✅ webhooks | ⏸️ deferred | low value — portal paid/balance comes from the local ledger; an authorized charge effectively always settles |
| **Dispute / chargeback alerts** | ✅ webhooks | ⏸️ deferred | B2B repeat doctors → chargebacks rare; Auth.net portal can email dispute alerts with no code. Revisit if disputes become a real concern |
| Daily settlement / batch report | ✅ (Transaction Details API) | ❌ | P2 — reconciliation export |

## 6. Security / compliance
| Capability | Status | Notes |
|---|---|---|
| PCI SAQ-A (card never on our server) | ✅ | hosted/tokenized |
| AVS + CVV | ✅ | `cardCodeRequired`, billing address |
| Idempotency / no double-charge | ✅ | |
| Transaction bound to doctor+session | ✅ | refId binding |
| 3-D Secure / SCA | n/a-ish | US B2B isn't under PSD2; Auth.net supports CardholderAuth if ever needed |
| Advanced Fraud Detection (AFDS) filters | 🟡 | available in the Auth.net dashboard — configure velocity/AVS filters |
| **Audit log of payment actions** (who refunded what) | ✅ | `audit_log` rows on charge/refund/void/offline/card changes; admin sees per-transaction history on `/admin/payments` |

## 7. Recurring / statements (lab-specific)
| Capability | Auth.net | Status | Notes |
|---|---|---|---|
| **Autopay monthly statement** | ✅ ARB / scheduled CIM charge | ❌ | P2 — some doctors bill per-statement (grandfathered/Olmos centers); could auto-charge a saved card on a cycle |
| Recurring subscription billing | ✅ ARB | ❌ | not currently a need |

---

## Prioritized roadmap
- **P0 (now):** Refunds & voids — admin action, void-or-refund, ledger reversal, Seazona credit (best-effort), refund receipt.
- **P1 (next, "fully functional" core):**
  1. ✅ _Done._ In-portal **payment history** (doctor, `/doctor/payments`) + **admin payment view** (`/admin/payments`, refund from a row).
  2. ✅ _Done._ **Default card** (`users.defaultPaymentProfileId`, pre-selected in the pay modal) + **multiple cards** verified end-to-end (list/add/edit/delete/select).
  3. ✅ _Done._ **Partial refunds** by invoice slice (settled charges; one reversal per charge — incremental top-ups are a future enhancement).
  4. ⏸️ _Deferred (2026-06-25)._ **Webhooks**: settlement confirmation + dispute/chargeback alerts. Skipped by decision — B2B repeat doctors make chargebacks rare, portal paid/balance comes from the local ledger, and Auth.net's portal can email dispute alerts with no code. Revisit only if disputes become a real concern (would need an Auth.net webhook subscription + Signature Key).
  5. ✅ _Done._ **Payment-action audit log** — `audit_log` rows for charge/refund/void/offline/card changes; per-transaction history on `/admin/payments`.
- **P2 (later):** surcharge/convenience fee, autopay statements (ARB), settlement/reconciliation export, printable PDF receipts, card nicknames.

## Notes / decisions to confirm
- **Refund → Seazona:** Seazona's payment API is write-only; a refund will reverse the **portal ledger** automatically and **attempt** a negative/credit payment to Seazona, falling back to an alertable log for manual entry if Seazona rejects credits (same safe pattern as the payment write).
- **Who can refund:** admin-only (doctors cannot self-refund).
- **Surcharging** has legal/disclosure rules by state — confirm the lab actually wants to pass card fees before building #P2.
