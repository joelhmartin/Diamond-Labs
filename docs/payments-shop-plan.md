# Payments & Shop — Implementation Plan

_Owner: Diamond Labs · drafted 2026-06-10 · status: ready to implement_

This is the working plan for finishing the payment + shop surfaces. It captures the
current state, the locked decisions, the hard API constraints we verified live, and a
phased task list. Treat the **Verified constraints** section as ground truth.

---

## Locked decisions
1. **Cards on file → Accept Hosted (SAQ A).** Card data never touches our DOM. Use the
   hosted iframe's `addPaymentProfile` to save a card during payment (the "save this card"
   checkbox) and an add-only / zero-dollar hosted token for standalone "Add Card".
2. **Guest shop orders → pushed to Seazona** via `POST v1/orders/` (`createOrder`), in
   addition to a local order record.
3. **Server-side price authority → synced Seazona products.** A local `products` mirror
   (system of record = Seazona) is the price source at checkout. This kills the
   client-trusted-amount vulnerability AND provides the SKU mapping `createOrder` needs.

## Verified constraints (probed live 2026-06-10 — do not re-litigate)
- `POST v1/payments/` is account-level only; the *Invoices & Payments* report matches a
  payment to invoices by parsing `Invoices <num>, <num>` from the **referenceNumber** field
  (NOT notes; by invoice **number**). Already wired in `buildInvoiceReference`.
- `v1/payments/` = POST-only (no list). `v1/payments/:id` = GET-only (no delete).
- **`v1/products/` is GET-only (`405 Allow=GET`).** ⇒ Seazona has **no product-create API**.
  True bidirectional product sync is impossible via API. Design = **Seazona is the system of
  record; we mirror one-way (Seazona → us) and map SKUs.** A product created only in our
  backend can NOT be pushed to Seazona and therefore can NOT be ordered through `createOrder`
  (which requires a Seazona product id). Admins who want a shop item orderable must create it
  in Seazona first; our sync then picks it up. (Surface this in the admin UI.)
  Product shape: `{ id, code, name, taxable, price }` — 391 products today.
- `v1/orders/` = POST. `createOrder` body: `{ clientId, patientName, due,
  items:[{id:<seazonaProductId>, arch:1|2|null}], notes, userId }` → `{ orderId }`. The
  `userId` must be a Seazona **lab-staff** user id (`v1/users/`, 17 available, shape
  `{id, firstName, lastName, email}`). Pick a service/lab account and store it in env.
- Seazona has **no sandbox** — every `createPayment`/`createOrder` writes live. Gate real
  writes on `AUTHORIZE_NET_ENV === "production"` (matches existing payment code) and verify
  with controlled small tests, as we did for payments on the Matt Rago test account (1324).

---

## Current state (summary)

**Doctor invoice payments** — the Accept Hosted new-card path is fully wired and secure
(ownership check, captured-amount reconciliation, idempotency on `transId`, correct
`Invoices <num>` recording + local `invoice_payments` ledger). Single-invoice already works.
- ✅ DONE this session: ownership guard added to `/payments/charge` + `/payments/charge-saved`
  (previously only the hosted path enforced it).
- ❌ No paid-state: `invoice_payments` is write-only, `GET /invoices` doesn't merge it,
  `PaymentModal.balanceOf` uses gross total (can over-pay).

**Card on file** — backend CIM complete for add/list/delete/charge (no update). Frontend
missing: "Add Card" button is a toast stub; no save-card checkbox. Tokenization mismatch:
`POST /saved-cards` wants an Accept.js nonce but the doctor app only has the hosted iframe.

**Shop / guest checkout** — cart + browsing production-ready. Checkout is a card-charge
happy path with serious holes: client-trusted amount (price tampering), no idempotency,
nothing recorded (no Seazona order, no local order table), no confirmation email (the UI
falsely says one was sent), `$0` path hits a non-existent `/orders/free` and fakes success.

---

## Phase 0 — Security debugging (small, do first)
- [x] Add `verifyInvoiceOwnership` to `/payments/charge` and `/payments/charge-saved`.
- [ ] Guest checkout: remove the fake `$0`/success path and the false "email sent" copy in
  `Checkout.jsx` (replace with honest states once Phase 3 lands).

## Phase 1 — Invoice payments + dashboard paid-state
- [ ] **Read API:** in `invoice.routes.js`, aggregate `invoice_payments` by `seazonaInvoiceId`
  for the user, add `paidAmount`, `balance = total - paidAmount`, `paid` to `normalizeInvoice`.
  (Optionally a `GET /payments/history` for a payments tab.)
- [ ] **Frontend:** `InvoicesPage` Paid/Balance column; suppress select/"Pay" on paid;
  `PaymentModal.balanceOf` uses `inv.balance` (supports partials/over-pay protection).
- [ ] Label it **"Paid via portal"** — our ledger only knows portal payments, not payments
  keyed directly into Seazona. (Optional later: reconcile against Seazona's HTML export.)

## Phase 2 — Card on file (Accept Hosted, SAQ A)
- [ ] `authorizenet.service.js`: extend `getHostedPaymentPageToken` to optionally include
  `customerProfileId` + `hostedPaymentCustomerOptions.addPaymentProfile: true`; add a
  `getHostedAddCardToken` (zero-dollar/add-only) and `updateCustomerPaymentProfile`.
- [ ] On hosted-complete with save-card, persist the new `customerPaymentProfileId`
  (lazily create the CIM profile if the user has none — plumbing already exists).
- [ ] **Frontend:** real "Add Card" flow on `SavedCardsPage` (hosted iframe, not the toast
  stub); "Save this card for later" checkbox in `PaymentModal` new-card path; keep
  list/delete; add edit (update expiry/billing). Cards rendered masked (already do).
- [ ] Keep relying on `customerProfileId` scoping for saved-card ownership (gateway-enforced);
  add an explicit membership check if charging by bare `paymentProfileId` expands.

## Phase 3 — Shop: product sync + secure guest checkout + orders + email
**3a. Product sync (foundation)**
- [ ] New `products` table (mirror): `seazonaProductId (id)`, `code`, `name`, `taxable`,
  `price`, + shop-presentation fields (image, description, `purchasable`, category). Seed
  from `v1/products/`. Sync job (manual trigger + scheduled) pulls Seazona → local; Seazona
  fields (price/name/taxable) are authoritative on each sync.
- [ ] Map the 54 shop SKUs (`catalog.js`) to `seazonaProductId`. Admin Products UI shows the
  Seazona link; clearly mark that **new products must be created in Seazona** to be orderable.
**3b. Secure checkout**
- [ ] Server **recomputes** the order total from the `products` table (never trust client
  `amount`); compute tax/shipping server-side; reject on mismatch.
- [ ] Idempotency on `/payments/checkout` (dedupe by gateway txn / client idempotency key).
- [ ] Pass `billTo`/`shipTo` to Authorize.net (`chargeWithNonce` signature extension) for AVS.
**3c. Orders + records + email**
- [ ] New `orders` + `order_items` tables (snapshot prices, shipping JSON, txn id, status,
  authoritative unique order number — replace `DOL-<last8 ts>`).
- [ ] After a verified charge: write local order → `createOrder` to Seazona (mapped product
  ids + configured lab-staff `userId`) → store returned `orderId`.
- [ ] Confirmation/receipt email (new Resend template). Wire `register`'s verification email
  (`sendWelcome` is currently dead code) if account-creation-at-checkout is added.
- [ ] Optional "create an account" at checkout (`user` role) — passwordless/verify-email.

## Cross-cutting / open risks
- **`createOrder` correctness is unproven** — do a controlled live test (one mapped SKU, real
  client/lab `userId`) like we did for payments before trusting it in the checkout path.
- **Lab-staff `userId`** for orders: choose one and put it in env (`SEAZONA_ORDER_USER_ID`).
- **Tax/shipping**: currently flat 8% / $12 client-side placeholders — must move server-side.
- **Account at checkout**: confirm desired UX (optional checkbox vs always-prompt).
- **us→Seazona product creation is not possible** — confirm the admin "create product" UX
  reflects this (local-only vs require-Seazona-first).
