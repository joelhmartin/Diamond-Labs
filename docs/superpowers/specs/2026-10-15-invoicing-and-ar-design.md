# Piece 3: Invoicing & AR (design)

_2026-10-15 · roadmap: `2026-10-05-own-the-lab-roadmap.md` · builds on piece 1
(catalog & pricing) and piece 2 (lab orders)_

## Goal

Our backend becomes the system of record for **what each client owes**:
invoices generated from lab orders, invoice PDFs, monthly statements, balances
and aging. Seazona's invoice role ends on this branch: no invoice reads from
Seazona for display or payment, and no payment writes to Seazona.

## What exists today (survey 2026-10-15)

- **No local invoices.** Every invoice screen and money path reads Seazona
  live: `invoice.routes.js` (admin + doctor lists, detail, offline payment),
  `verifyAllocations` in `payment-recording.service.js`, and the AutoPay
  sweep (`autopay-runner.service.js`).
- **`invoice_payments`** is the only invoice table. It is keyed by
  `(seazona_client_id, seazona_invoice_id)`, stores `applied_amount` as
  `numeric(12,2)` dollars, and records refunds as negative rows. Paid =
  `sum(applied_amount)` per invoice.
- **Seazona writes:** `seazona.createPayment` in `recordPaymentAndAllocations`
  (`payment-recording.service.js:91`) and in the refund route
  (`payment.routes.js:1113`).
- **AutoPay** runs dry only (`AUTOPAY_LIVE_RUN=false`) because the
  "cap at the real Seazona balance" guard was never buildable — staff payments
  entered in Seazona are invisible to us.
- **Pricing** (`lib/pricing.js`, `lib/money.js`) is integer cents and pure,
  but `pricing.service.priceShopCart` rejects rx-channel variants. Lab orders
  and their lines carry no prices.
- **PDF:** piece 2's `ticket-model.js` (pure) / `ticket-pdf.js` (pdfkit) split.
- **Email:** `deliver()` has no attachment support.
- No statement, aging, credit, invoice detail page or invoice PDF exists.
- `payment.routes.js` is 1,414 lines — over the 1,000-line cap.

## Model

- **`invoices`**
  - Keys: `id`, `invoiceNumber` (unique int; continues Seazona's numbering
    from `INVOICE_NUMBER_START`, allocated like lab order numbers under an
    advisory lock), `kind` (`order` | `shop` | `legacy`), `clientUserId`
    (null only for guest shop invoices), `labOrderId` (unique when set),
    `legacySeazonaInvoiceId` (unique, nullable — piece 5's import key).
  - State: `status` (`draft` | `issued` | `void`), `version` (optimistic
    concurrency, as on lab orders), `issuedAt`, `dueDate` (`date`),
    `voidedAt`, `voidReason`.
  - Money (integer cents): `subtotalCents`, `taxCents`, `shippingCents`,
    `totalCents`. Totals are recomputed from lines by one pure function on
    every draft change, never edited directly.
  - `notes` (staff-only, encrypted at rest like `labNotes`).
- **`invoice_lines`** — `invoiceId`, `position`, `variantId` (nullable for
  free-form lines like shipping or a rush fee), `code`, `description`, `qty`,
  `unitCents`, `lineCents`, `taxable`, `priceSource`
  (`client` | `base` | `manual` | `remake` | `unpriced`), `labOrderLineId`.
- **Paid and balance are derived, never stored:** `paidCents` = sum of the
  invoice's ledger rows; `balanceCents = totalCents − paidCents`. "Paid" is
  `balanceCents ≤ 0` on an issued invoice. One function computes it
  (`invoice-balance` in the ledger service); every screen and money path
  calls it.

### Ledger changes (`invoice_payments`)

- Gains `invoice_id` (local invoice). `seazona_invoice_id` and
  `seazona_client_id` become nullable and are kept as legacy columns until
  piece 5's import fills `invoice_id` for history.
- `applied_amount numeric(12,2)` becomes **`applied_cents integer`**
  (migrated in place, `round(applied_amount*100)`). One column, so nothing has
  to agree with anything.
- New `source` values: `admin_check`, `admin_cash`, `admin_ach`,
  `admin_other` (manual payments) and `credit` (a staff credit/write-off,
  allocated like a payment, with a required reason). A credit carries a
  synthetic `transaction_id` of `credit:<id>` and is never sent to a card
  processor.
- Allocation shape everywhere: `[{ invoiceId, amountCents }]` with local ids.

## Lifecycle

- **Draft at release.** When piece 2 creates a lab order (Rx release, remake,
  shop checkout) the same transaction creates its invoice:
  - Rx order: one invoice line per non-note lab order line, priced by
    `priceLabOrderLines` (client price, else base). A variant with no price
    gets `unitCents 0`, `priceSource "unpriced"`.
  - Remake: lines copied at `unitCents 0`, `priceSource "remake"` — remakes
    are free unless staff edit the draft.
  - Shop order: `kind "shop"`, lines and totals copied from `order_items`,
    issued immediately, and fully paid by one ledger row
    (`source "shop_card"`, the checkout's transaction id). Guests get
    `clientUserId null`; it never reaches a statement.
- **Editing a draft** (admin): change qty or unit price (an override needs a
  reason and sets `priceSource "manual"`), add a free-form line (shipping,
  rush fee, adjustment), remove a line, edit notes. Every change carries
  `expectedVersion`; a mismatch returns 409, as on lab orders.
- **Issue on ship.** When the lab order moves to `shipped`, the same
  transaction issues the draft (`issuedAt` now, `dueDate` =
  ship date + `INVOICE_TERMS_DAYS`, default 30) — **unless** a line is still
  `unpriced`, in which case the invoice stays draft and appears in
  Admin › Invoices "Needs a price". Billing never blocks the bench: the ship
  always succeeds. Staff can also issue a priced draft by hand.
- **Cancel voids.** A cancelled lab order voids its draft.
- **Issued invoices are immutable.** Corrections are a **credit** (ledger row,
  reduces balance, needs a reason) or a **void** (allowed only while net paid
  is 0; needs a reason). A voided invoice keeps its number.

## Payments

- All card paths (doctor saved card, Accept Hosted, admin charge-saved,
  AutoPay) keep Authorize.net and the idempotency/locking they have today;
  only the invoice source changes. `verifyAllocations` reads local invoices
  under row locks (`SELECT … FOR UPDATE`) instead of `seazona.getInvoice`,
  checking ownership, status `issued` and remaining balance.
- **Seazona payment writes are removed** (`createPayment` in recording and
  refunds), along with `writeToSeazona`, `seazonaPaymentId` handling, the
  `Invoices <num>` reference token and the `SEAZONA_CLIENT_NOT_LINKED` guard.
  `seazona.createPayment` itself stays in `seazona.service.js` until piece 5
  deletes the service.
- **Manual payments** (admin): "Record payment" on a client — method
  (check / cash / ACH / other), reference, amount, date. Allocated
  oldest-first by default (`allocateOldestFirst`, reused) or to chosen
  invoices. Overpayment is refused (no unapplied credit balance in this
  piece).
- **AutoPay** reads local open invoices. The out-of-band TODO goes away
  because every payment now lands in the ledger. `AUTOPAY_LIVE_RUN` stays as
  configured — turning it on is a cutover decision, not this piece's.

## Statements & AR

- **Statement** for a client and a month: opening balance, every invoice
  issued, payment, credit and void in the month (dated), closing balance, and
  aging of the closing balance — Current, 1–30, 31–60, 61–90, 90+ days past
  due. A pure `buildStatementModel(client, activity, period)` decides it all;
  dates use the lab timezone.
- **Admin › Accounts receivable:** one row per client with a balance:
  balance, aging buckets, oldest due date; totals row; filter past-due only;
  each row links to the client's invoices and a statement download.
- **Doctor:** Invoices page shows our invoices (number, lab order, patient
  initials, issued, due, total, balance, status) with a detail view and PDF
  download, plus "Download statement" for a chosen month.

## PDFs

`buildInvoiceModel(invoice, lines, client, order)` and
`buildStatementModel(...)` are pure, and render through one shared
`services/pdf/` layout layer extracted from `ticket-pdf.js` (document setup,
WinAnsi cleaning, header block, table, footer). The ticket moves onto it too,
so the project has one PDF primitive. Invoices show the patient name (the
doctor needs it to match the bill); delivery follows the ticket's rules —
generated on demand, never stored, `no-store`, audit-logged, no patient name
in the filename.

## Email

"Email invoice" and "Email statement" (admin buttons, never automatic in this
piece) send a short notice — amount, due date, a portal link — with **no PDF
and no patient data**, so nothing PHI-bearing travels by email and `deliver()`
needs no attachment support. Doctors download the PDF in the portal.

## Code shape

- `lib/money.js` moves to `packages/shared/src/money.js` so the web formats
  cents the same way; the API re-exports.
- The lab order number allocator's pure core generalises to
  `nextSequenceNumber(maxExisting, start)` used by both lab orders and
  invoices.
- `services/billing/`: `invoices.service.js` (create/edit/issue/void,
  called from `lab-orders.service.js` inside its transactions),
  `invoice-rules.js` (pure: totals, transitions, edit planning),
  `statements.service.js`, `invoice-model.js`, `statement-model.js`.
- `pricing.service` gains `priceLabOrderLines(lines, clientUserId)` reusing
  `lib/pricing.js` without the shop-channel filter.
- `payment.routes.js` is split along its seams before it is edited:
  checkout, doctor invoice payments (saved card + hosted), refunds, history.
- `invoice.routes.js` is rewritten against the local tables.
- Web: `InvoicesPage` and `PaymentModal` switch to cents and local ids;
  `AdminInvoicesPage` becomes the local invoice list (filters: status,
  needs-price, client, number); new invoice detail page (admin edit/issue/
  void/credit; doctor read-only); new AR page; `DoctorPaymentDrawer` uses a
  per-client invoices endpoint instead of filtering the whole list.

## Errors and safety

- Money is integer cents end to end except at the Authorize.net boundary
  (`fromCents` once, in the wrapper call).
- Illegal transitions (edit an issued invoice, void with payments) → 422 with
  the reason; stale version → 409.
- Every draft/issue/void/credit/manual payment writes an audit entry.
- Billing is admin-only; the `lab` role sees no money.
- A failure creating the invoice inside a release/checkout transaction must
  not lose the lab order: the release fails as a whole (staff retry), while
  shop checkout keeps piece 2's rule — the lab order + shop invoice
  transaction runs after the paid order commits and logs
  `[LAB][SHOP_ORDER_FAILED]` on failure.

## Testing

Vitest pure tests for invoice totals (tax on taxable subtotal once, remake
zeroing, unpriced detection), the draft/issue/void rules, edit planning,
balance derivation (payments, refunds, credits), oldest-first allocation in
cents, aging buckets at boundaries (due today, 30, 31, 90, 91 days), statement
opening/closing arithmetic across a month boundary in the lab timezone, and
the invoice/statement models; PDF rendering smoke-tested to a non-empty
buffer. Route tests follow the existing source-inspection pattern, plus a
guard test that nothing outside `seazona.service.js` and the piece 5 import
references `createPayment`/`getInvoice`.

## Out of scope

- Importing Seazona's ~16k invoices and opening balances (piece 5; the
  `legacy` kind and `legacySeazonaInvoiceId` exist so it can).
- Shipping charges from carrier labels (piece 4 adds a shipping line).
- Unapplied credit / prepayment balances, finance charges, per-client terms,
  a tax engine, automatic monthly statement emails, PDF email attachments.
