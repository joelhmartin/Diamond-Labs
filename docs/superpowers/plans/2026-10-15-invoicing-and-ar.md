# Invoicing & AR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make our database the system of record for what each client owes: invoices generated from lab orders, invoice PDFs, monthly statements, balances and aging. Seazona's invoice role ends on this branch: no invoice reads from Seazona for display or payment, and no payment writes to Seazona.

**Architecture:**
- Two new tables, `invoices` and `invoice_lines`. The `invoice_payments` ledger points at local invoices (`invoice_id`) and stores money as `applied_cents integer`. Paid and balance are derived from the ledger by one function (`deriveBalance`), never stored.
- Pure rules live in `apps/api/src/services/billing/`: `invoice-rules.js` (totals, draft → issued → void, edit planning, balance), `aging.js`, `invoice-model.js`, `statement-model.js`. Services run those plans in transactions, with an optimistic `version` check like lab orders.
- `lab-orders.service.js` calls the invoice service inside its own transactions: release and remake create a draft, the shop lab order creates an issued and paid shop invoice, ship issues the draft (in a savepoint, so billing never blocks the bench), cancel voids the draft.
- Every money path (doctor saved card, Accept Hosted, admin charge, AutoPay, manual payments, credits) verifies allocations against local invoices under the existing per-invoice locks, writes the local ledger, and writes nothing to Seazona.
- One PDF layout layer (`services/pdf/`) is extracted from the work ticket. The ticket, the invoice and the statement all render through it.
- Money is integer cents end to end. `lib/money.js` moves to `packages/shared/src/money.js` so the web formats and parses cents with the same code.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM 0.36 / drizzle-kit 0.30.6 (Postgres 15), Zod 3 (`@my-app/shared`), Vitest (+ `node:assert/strict`), pdfkit 0.20.2, React + Vite + React Router, axios (`apps/web/src/config/api.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-invoicing-and-ar-design.md` (roadmap: `docs/superpowers/specs/2026-10-05-own-the-lab-roadmap.md`; builds on piece 2's plan `docs/superpowers/plans/2026-10-07-lab-orders-and-production.md`)

**Estimated size:** about 146 changed files against `feat/own-the-lab`, counting the spec and this plan. That is too close to CodeRabbit's 150-file cap for one PR. Task 14 therefore opens two stacked PRs along the natural seam:
- **A: API**, Tasks 1–11 plus the docs, about 118 files;
- **B: web**, Tasks 12–13, about 28 files.
Both are comfortably under the cap. Don't add unplanned files.

## Spec corrections

Each item is a load-bearing claim in the spec that is wrong or incomplete against the real code. The plan builds the corrected version.

1. **Row locks can't serialize the card paths.** The spec has `verifyAllocations` read invoices under `SELECT … FOR UPDATE`. A row lock lasts only as long as its transaction. The card charge happens between the cap check and the ledger write (`payment.routes.js` charge-saved, hosted-complete; `autopay-runner.service.js`), outside any DB transaction, and a transaction can't safely be held open across an Authorize.net call. The serializer today is `withInvoiceLocks` (`lib/payment-helpers.js:66`, Redis `SET NX` per invoice id). **The plan keeps `withInvoiceLocks` around every writer of an invoice's balance:** card charges, AutoPay, manual payments, credits and voids. `FOR UPDATE` is used only inside the DB-only transactions (edit, issue, void, credit, ship/cancel hooks).
2. **`invoice_payments.user_id` is `NOT NULL`** (`db/schema/invoice-payments.js:19`). A guest's shop invoice is paid by a `shop_card` row with no portal user. The plan makes `user_id` nullable (it is attribution, not ownership).
3. **`shippingCents` can't be derived from the spec's line model.** Nothing marks a line as shipping. The plan adds `invoice_lines.kind` (`item | shipping | fee | adjustment`). Totals use the same formula as the shop (`lib/pricing.js` `priceLines`): tax once, on the taxable non-shipping lines; shipping is the sum of shipping lines. Only an `adjustment` line may be negative.
4. **Manual-payment date and reference, the credit reason and the price-override reason have nowhere to live.** The plan adds `invoice_payments.paid_on` (date), `invoice_payments.reference` (varchar 100), `invoice_payments.note` (encrypted text: the credit reason) and `invoice_lines.price_note` (encrypted text: why a price was overridden). All four are classified in the staging scrub.
5. **`applied_amount → applied_cents` can't be migrated "in place" by drizzle-kit.** A generated rename/retype can't multiply by 100. The plan does it in three migrations:
   - `0028` adds `applied_cents` (nullable) and relaxes `applied_amount`'s `NOT NULL`.
   - `0029` is a `drizzle-kit generate --custom` backfill: `round(applied_amount * 100)`. Precedent: `0017_rx_case_status_backfill.sql`.
   - `0030` (Task 8) sets `applied_cents NOT NULL` and drops `applied_amount`, once no code reads it.
   drizzle's migrator runs all pending migrations in one transaction, so production sees one atomic change.
6. **Invoice ownership moves from the practice to the doctor user.** Today the ledger and the caps are keyed by `seazonaClientId`, because several portal logins can share one practice (`invoice-ledger.service.js` header). Local invoices belong to `clientUserId`, the doctor whose case it is: the same owner lab orders and My cases use. A second login of the same practice will no longer see the first login's invoices. There is no local "practice" entity to key on, so the plan follows the spec. The PR body flags it as a product decision for the user.
7. **The shop invoice copies the checkout quote, not `order_items`.** `createShopLabOrder` runs with the in-memory quote that `order_items` was written from (same values). Lines and totals are copied, never recomputed, so the invoice always equals the charge. A test proves `computeTotals` agrees with `priceLines` for shop-shaped lines.
8. **The display/strict ledger split goes away.** Soft-fail balance reads existed because invoices came from Seazona and the ledger from our DB. Now both live in the same database. A ledger error fails the request (500) instead of rendering every invoice as unpaid.
9. **"The ship always succeeds" needs a savepoint.** The spec keeps the bench unblocked only for unpriced lines. A DB error while issuing would still roll back the ship, because it runs in the same transaction. The plan issues and voids inside `tx.transaction(...)` (a savepoint). A failure logs `[BILLING][ISSUE_FAILED]` / `[BILLING][VOID_FAILED]`, and the move still commits.
10. **Lab orders released before this branch have no invoice.** Staging already has some. On ship, the plan drafts the missing invoice first, then issues it, so no shipped Rx job escapes billing.
11. **A backdated manual payment would break statement arithmetic.** If `paidOn` falls before an allocated invoice's issue date, the statement shows a payment against an invoice that didn't exist yet. The plan refuses a `paidOn` in the future or before any allocated invoice's issue date.
12. **Doctors never see drafts.** The spec lists what doctors see but not that drafts are hidden. A draft is not a bill. The doctor list, detail, PDF and statement exclude `draft`.
13. **`GET /admin/clients/:id` (a live Seazona client read in `invoice.routes.js:124`) has no web caller.** It is dropped in the rewrite.
14. **Boundary helper.** The spec names `fromCents`. The codebase already has `toDecimalString(cents)`, which yields the decimal string Authorize.net's `String(amount)` expects. The plan uses it at the gateway boundary and adds no new helper.
15. **Task order: AutoPay before manual payments.** Manual payments reuse `allocateOldestFirst`. It is converted to cents once, with AutoPay (Task 7), so there is never a dollars copy and a cents copy side by side.

## Global Constraints

- All work happens in the worktree `/Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-3` on branch `feat/own-the-lab-3-invoicing`. Never `cd` to the main checkout; other agents work there.
- Push only with `git push origin feat/own-the-lab-3-invoicing`, never a bare `git push` (`push.default=matching` would push local `main`).
- **No Seazona API calls.** No reads, no writes, from code, tests, scripts or a dev server. Seazona's host rate limit blocks the whole integration, production included. Never call Seazona except through `seazona.service.js`. `seazona.createPayment` and the invoice reads stay in `seazona.service.js` for piece 5, unused. `services/seazona-access.test.js` and `routes/__tests__/seazona-order-retired.test.js` must keep passing, and Task 8 adds `routes/__tests__/seazona-invoice-retired.test.js`.
- **Never run a real charge.** `AUTHORIZE_NET_ENV` is production. Payment changes are verified by tests and source checks only. `AUTOPAY_LIVE_RUN` stays as configured.
- **Never use browser or Chrome tools** (no `mcp__claude-in-chrome__*`, no `mcp__MCP_DOCKER__browser_*`). The UI is verified by `pnpm --filter @my-app/web build` and pure-helper tests.
- **No native `alert()` / `confirm()` / `prompt()`** in the web app. Destructive or irreversible actions use the inline two-click `ConfirmButton` (Task 13). Reasons are typed into inline forms.
- **No DB foreign keys** (repo convention). Ids are cuid2 via `createId()` from `apps/api/src/lib/id.js`, `varchar(128)`.
- **Money is integer cents** via `packages/shared/src/money.js` (re-exported by `apps/api/src/lib/money.js` and `apps/web/src/lib/money.js`). Dollars appear only at a boundary:
  - a Postgres `numeric` column (`toCents` / `toDecimalString`);
  - the Authorize.net wire (`toDecimalString` going out, `toCents` coming back);
  - a staff-typed amount (`parseMoneyInput`).
  AutoPay's existing `numeric` columns (`autopay_enrollments.amount`, `autopay_attempts.amount_*`) stay dollars and are converted at the read/write.
- **Migrations come only from `cd apps/api && pnpm db:generate`** (and `pnpm drizzle-kit generate --custom` for the one data backfill). Expect `0028_*`, `0029_invoice_payments_applied_cents.sql`, `0030_*`. Never hand-number a migration or edit a generated one. The custom file is written by hand by design.
- **Staging scrub.** Every new column is classified in `apps/api/src/db/scrub/plan.js` and `COLUMNS.md` (`plan.test.js` fails otherwise). Staff free text (`invoices.notes`, `invoices.void_reason`, `invoice_lines.price_note`, `invoice_payments.note`) is encrypted at rest (`lib/crypto.js`) and scrubbed as `phi`.
- **Source files stay under 1,000 lines** (excluding blanks and comments). `payment.routes.js` (1,414) is split first (Task 1), before anything edits it.
- **One implementation per job.** Reuse rather than copy:
  - `withInvoiceLocks` / `withIdempotency`;
  - `allocateOldestFirst`, `unitPriceFor`, `pctOfCents`;
  - `isoDateIn` / `LAB_TIMEZONE` / `formatUsDate` / `formatLabDate` (`@my-app/shared`);
  - `initialsFor`, `decryptRxPhi` / `caseSummary`;
  - `auditService`, `validate` / `validateQuery`, `handlerSource`.
  Generalise rather than copy: the order-number allocator becomes `allocateSequenceNumber`, and the ticket's PDF plumbing becomes `services/pdf/`.
- **Tests:** Vitest. New files import `{ test } from "vitest"` and `assert from "node:assert/strict"`. Existing `describe/it/expect` files keep their style. There is no DB harness:
  - rules live in pure helpers and are tested there;
  - services are tested against the recording fake in `apps/api/src/test/fake-tx.js` (Task 5);
  - route wiring is pinned by source inspection (`routes/__tests__/_source.js` `handlerSource`).
- **PHI:**
  - Invoices carry the patient name only on the invoice detail and PDF, decrypted on read, never stored on invoice tables.
  - PDFs are generated on demand, never stored, sent `Cache-Control: no-store`, audit-logged, with no patient name in the filename.
  - Emails carry no PDF and no patient data.
  - Audit metadata is ids, numbers, amounts and field names only, never free text.
- **Billing is admin-only.** The `lab` role sees no money. Admin billing routes use `requireAdmin`; doctor routes use `requireApprovedDoctor` and scope to `request.user.id`.
- **Verification bar for every task:**
  - `pnpm test` at the repo root passes.
  - `pnpm --filter @my-app/web build` succeeds.
  - After any schema task, `cd apps/api && pnpm db:generate` prints "No schema changes".
- **Commits:** messages end with `Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>`. Replace `<implementer model>` with the name of the model that actually did the work. Subagents run on Sonnet at minimum, never Haiku.

## Sequencing

- **Base branch and PRs.** Piece 2 (#53) is merged into `feat/own-the-lab`, and this branch starts from it. Piece 3 ships as two stacked PRs (see Estimated size):
  - PR A: `feat/own-the-lab-3a-billing-api`, cut at Task 11's commit, based on `feat/own-the-lab`.
  - PR B: this branch, based on PR A.
  Merge B into A first, then A into `feat/own-the-lab`, so staging never runs the new API with the old pay screens.
- **Invoice-number seed.** `INVOICE_NUMBER_START` defaults to `500000`, a dev placeholder. Piece 5 must set it to Seazona's last invoice number + 1 **before any invoice is created in production**, because piece 5 imports legacy invoices under their own numbers. Allocation is `max(existing + 1, start)`. Put this in the PR body.
- **AutoPay stays dark.** `AUTOPAY_LIVE_RUN` is untouched. The Seazona "out-of-band" TODO goes away because every payment now lands in our ledger. Turning AutoPay on is a cutover decision.
- **Mid-branch states.** The branch is never deployed between tasks. From Task 6 until Task 8, the old Seazona invoice routes still exist beside the new payment paths. Tests pass at every task, and the app is coherent again from Task 8.

## Review Focus

These are the five input classes most likely to bite a real user, each pinned to a test in the task that owns it:

1. **A card payment and a staff action hit the same invoice at once** (a doctor paying while staff void, credit or record a check). They are serialized by `withInvoiceLocks`. A void is refused once any payment has landed. Pinned by the `planVoid` "has payments" test in **Task 4**, the void/credit/manual-payment lock source test in **Task 9**, and the in-lock `verifyAllocations` cap test in **Task 6**.
2. **Shipping a job whose invoice can't be issued** (an unpriced line, or a DB hiccup while issuing). The move to `shipped` must still commit, and the invoice stays draft under "Needs a price". Pinned by the `planIssue` unpriced test in **Task 4**, and the `billingFollowUp` savepoint test plus the `issueForShippedLabOrder` unpriced test in **Task 5**.
3. **A doctor opens an invoice that is a draft, or is someone else's.** The answer is 404. The doctor view never carries staff notes, price notes, the void reason, ledger references or transaction ids. Pinned by the `doctorInvoiceView` allow-list test in **Task 8** and the doctor-route source test in **Task 8**.
4. **Dates at the edges of the lab's day and month.** A payment at 11:30 pm Chicago on Oct 31 belongs to October's statement. A backdated manual payment can't predate its invoice. Pinned by the statement-model timezone test in **Task 10** and the `planManualPayment` date tests in **Task 9**.
5. **Seazona-era ledger rows** (`invoice_id` null, `seazona_invoice_id` set). They must still show in payment history and refund correctly after deploy. Pinned by the legacy-row `summarizePayments` test and the refund reversal-key test in **Task 6**.

---

## File Structure

**Shared (`packages/shared/src`)**
- New:
  - `money.js` (+ `money.test.js`, moved from the API): the one money implementation, plus `parseMoneyInput`.
  - `billing/billing.js` (+ test): invoice vocabulary, aging buckets, `invoiceStatusLabel`, manual payment methods.
  - `billing/allocation.js` (+ test, moved from the API's `lib/autopay-allocation.js`): `allocateOldestFirst`, `sortOldestFirst`, `resolveChargeCents`.
  - `schemas/billing.schema.js` (+ test): Zod bodies and queries for the billing routes.
- Modified: `index.js`, `schemas/payment.schema.js` (allocations in cents).

**API (`apps/api/src`)**
- New:
  - `lib/sequence.js` (+ test), `services/sequence.service.js` (+ test), `lib/refund-plan.js` (+ test), `lib/crypto.field-sealer.test.js`.
  - `db/schema/invoices.js` (+ `invoices.test.js`).
  - `services/billing/` holds the billing code:
    - `invoice-rules.js` (+ test), `aging.js` (+ test), `invoice-errors.js`, `invoice-crypto.js`;
    - `invoices.service.js` (+ test), `invoice-queries.js`, `invoice-views.js` (+ test);
    - `ledger.service.js` (+ test), `invoice-actions.service.js` (+ test);
    - `invoice-model.js` (+ test), `statement-model.js` (+ test), `billing-pdf.js` (+ test), `statements.service.js` (+ test).
  - `services/pdf/pdf-text.js`, `services/pdf/pdf-layout.js` (+ test).
  - `test/fake-tx.js`.
  - Payment routes split out of `payment.routes.js`:
    - `routes/payment-replies.js`, `routes/checkout.routes.js`, `routes/saved-cards.routes.js`;
    - `routes/invoice-payment.routes.js`, `routes/refund.routes.js`.
  - Billing routes: `routes/admin-invoice.routes.js`, `routes/receivables.routes.js`; `routes/pdf-reply.js` (`sendPdf`, shared with the work ticket).
  - Route tests:
    - `routes/__tests__/payment-routes-split.test.js`, `routes/__tests__/billing-routes.test.js`;
    - `routes/__tests__/seazona-invoice-retired.test.js`.
  - `config/env.billing.test.js`, `services/audit.service.test.js`, `services/email-billing.test.js`.
- Modified:
  - `lib/money.js` (re-export), `lib/crypto.js` (`fieldSealer`), `lib/pricing.js` (+ test), `lib/payment-summary.js` (+ test).
  - `config/env.js`, `db/schema/invoice-payments.js`, `db/schema/index.js`.
  - `db/scrub/plan.js`, `plan.test.js`, `COLUMNS.md`.
  - `services/audit.service.js`, `services/pricing.service.js`, `services/payment-recording.service.js` (+ test).
  - `services/autopay-runner.service.js`, `services/email.service.js`, `services/email-staging.test.js`.
  - `services/lab/lab-order-rules.js` (+ test), `services/lab/lab-orders.service.js` (+ test), `services/lab/ticket-model.js` (+ test), `services/lab/ticket-pdf.js`.
  - `services/auth.service.js` (one comment).
  - `routes/payment.routes.js`, `routes/admin-payment.routes.js`, `routes/invoice.routes.js`, `routes/lab.routes.js`, `index.js`.
  - Route tests: `routes/__tests__/{charge-error-reply,checkout-lines,rx-release,payment.schema,lab-routes}.test.js`.
  - `jobs/definitions/autopay.job.test.js`.
- Generated: `db/migrations/0028_*.sql`, `0029_invoice_payments_applied_cents.sql`, `0030_*.sql` + snapshots + `_journal.json`.
- Deleted:
  - `lib/money.test.js` and `lib/autopay-allocation.js` (+ test) (moved to shared), `services/invoice-ledger.service.js` and its two tests;
  - `routes/__tests__/admin-invoices.routes.test.js`, `routes/__tests__/admin-offline-payment.routes.test.js`.

**Web (`apps/web/src`)**
- New:
  - `lib/requests.js` (+ test), moved out of `lib/lab-board.js`. `lib/invoices.js` (+ test).
  - `components/ui/ConfirmButton.jsx`.
  - `components/billing/InvoiceView.jsx`, `components/billing/StatementDownload.jsx`.
  - `pages/doctor/InvoiceDetailPage.jsx`.
  - `pages/app/AdminInvoiceDetailPage.jsx`, `pages/app/AdminReceivablesPage.jsx`.
  - `components/admin/RecordPaymentModal.jsx`.
- Modified:
  - `lib/money.js`, `lib/lab-board.js` (+ test), `hooks/useInvoiceAllocation.js`.
  - `pages/lab/LabOrderDetailPage.jsx`, `pages/lab/LabBoardPage.jsx`, `pages/app/AdminOrdersPage.jsx`, `pages/app/AdminDepartmentsPage.jsx` (request helpers' new home).
  - `components/doctor/PaymentModal.jsx`, `pages/doctor/InvoicesPage.jsx`, `pages/doctor/PaymentsPage.jsx`.
  - `pages/app/AdminInvoicesPage.jsx` (rewritten), `pages/app/AdminPaymentsPage.jsx`, `components/admin/RefundPaymentModal.jsx`, `components/admin/DoctorPaymentDrawer.jsx`.
  - `pages/app/AdminCatalogPage.jsx` (+ test), `pages/app/AdminClientPricingPage.jsx`.
  - `App.jsx`, `config/routes.js`, `components/layout/Sidebar.jsx`.

## Task order

| # | Task |
|---|---|
| 1 | Worktree setup; split `payment.routes.js` along its seams (pure move) |
| 2 | Shared money; sequence allocator generalised |
| 3 | Billing tables, ledger columns, migrations 0028–0029, scrub, env, audit-in-transaction |
| 4 | Pure billing rules: vocabulary, schemas, invoice rules, aging, errors |
| 5 | Lab-line pricing, invoices service, lab-order hooks (release, remake, shop, ship, cancel) |
| 6 | Ledger service; recording and `verifyAllocations` on local invoices; card and refund paths in cents; Seazona payment writes removed |
| 7 | AutoPay on local invoices; `allocateOldestFirst` in cents |
| 8 | Invoice reads (doctor + admin), old ledger and Seazona invoice routes removed, migration 0030, Seazona invoice guard |
| 9 | Admin invoice actions: edit, issue, void, credit, manual payments |
| 10 | PDF layout layer; invoice and statement models; invoice PDFs |
| 11 | Accounts receivable, statements, email notices |
| 12 | Web: shared plumbing and the doctor side |
| 13 | Web: the admin side |
| 14 | Whole-piece verification and PR |

---

### Task 1: Worktree setup; split `payment.routes.js` along its seams (pure move)

`payment.routes.js` is 1,414 lines, over the 1,000-line cap, and later tasks edit three of its seams. Split it first, verbatim, so later diffs are reviewable. No behaviour changes in this task.

**Files:**
- Create: `apps/api/src/routes/payment-replies.js`, `apps/api/src/routes/checkout.routes.js`, `apps/api/src/routes/saved-cards.routes.js`, `apps/api/src/routes/invoice-payment.routes.js`, `apps/api/src/routes/refund.routes.js`, `apps/api/src/routes/__tests__/payment-routes-split.test.js`
- Modify: `apps/api/src/routes/payment.routes.js` (keeps history, admin payments, audit, test hosted), `apps/api/src/routes/admin-payment.routes.js:20-24`, `apps/api/src/index.js:26,223`, `apps/api/src/routes/__tests__/charge-error-reply.test.js:7`, `apps/api/src/routes/__tests__/checkout-lines.test.js:3`, `apps/api/src/routes/__tests__/rx-release.test.js:10`

**Interfaces:**
- Produces:
  - `routes/payment-replies.js` exports `CHARGE_RATE_LIMIT`, `chargeErrorReply(reply, err)`, `sendInvoiceLockedError(reply)`, `sendAllocationError(reply, v)`.
  - `routes/checkout.routes.js` exports `checkoutLinesFromQuote(quote)` and default `checkoutRoutes`.
  - `routes/saved-cards.routes.js` default `savedCardRoutes`.
  - `routes/invoice-payment.routes.js` default `invoicePaymentRoutes`.
  - `routes/refund.routes.js` default `refundRoutes`.
  - `routes/payment.routes.js` default `paymentRoutes`, now history, admin payments, audit and test hosted only.

- [ ] **Step 1: Give the worktree its own database and env**

The worktree has no `.env`. Piece 3's migrations must not land in piece 2's database.

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-3
git branch --show-current            # must print feat/own-the-lab-3-invoicing
cp ../own-the-lab-2/.env .env
git check-ignore .env                # must print .env — never commit it
createdb diamond_labs_own_the_lab_3
pg_dump diamond_labs_own_the_lab_2 | psql -q diamond_labs_own_the_lab_3
sed -i '' 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://bif@localhost:5432/diamond_labs_own_the_lab_3#' .env
ln -s ../../.env apps/api/.env
git check-ignore apps/api/.env       # must print apps/api/.env
pnpm install
grep '^DATABASE_URL' .env | sed -E 's#//[^@]*@#//***@#'   # expect diamond_labs_own_the_lab_3
(cd apps/api && pnpm db:migrate)     # nothing new to apply (0027 is already there)
pnpm test                            # green baseline before any change
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/routes/__tests__/payment-routes-split.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
// Lines that count toward the 1,000-line cap: not blank, not a comment.
const codeLines = (src) =>
  src.split("\n").filter((l) => {
    const t = l.trim();
    return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).length;

const FILES = {
  "../checkout.routes.js": ['fastify.post("/payments/checkout",'],
  "../saved-cards.routes.js": [
    'fastify.get("/payments/saved-cards",', 'fastify.put("/payments/saved-cards/:profileId/default",',
    'fastify.post("/payments/saved-cards/hosted-token",', 'fastify.put("/payments/saved-cards/:profileId",',
    'fastify.delete("/payments/saved-cards/:profileId",',
  ],
  "../invoice-payment.routes.js": [
    'fastify.post("/payments/charge-saved",', 'fastify.post("/payments/hosted-token",', 'fastify.post("/payments/hosted-complete",',
  ],
  "../refund.routes.js": ['fastify.post("/admin/payments/refund",'],
  "../payment.routes.js": [
    'fastify.get("/payments/history",', 'fastify.get("/admin/payments",', 'fastify.get("/admin/payments/audit",',
    'fastify.post("/payments/test/hosted-token",', 'fastify.post("/payments/test/hosted-complete",',
  ],
};

test("every payment route lives in exactly one module, along its seam", () => {
  const all = Object.values(FILES).flat();
  for (const [file, markers] of Object.entries(FILES)) {
    const src = read(file);
    for (const m of markers) assert.ok(src.includes(m), `${m} missing from ${file}`);
    for (const other of all.filter((m) => !markers.includes(m))) assert.ok(!src.includes(other), `${other} also in ${file}`);
  }
});

test("each payment module stays under the 1,000-line cap", () => {
  for (const file of [...Object.keys(FILES), "../payment-replies.js"]) {
    assert.ok(codeLines(read(file)) < 1000, `${file} is over the cap`);
  }
});

test("the server registers every payment module", () => {
  const index = read("../../index.js");
  for (const name of ["checkoutRoutes", "savedCardRoutes", "invoicePaymentRoutes", "refundRoutes", "paymentRoutes"]) {
    assert.match(index, new RegExp(`await fastify\\.register\\(${name},\\s*\\{ prefix: "/api/v1" \\}\\)`), name);
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/payment-routes-split.test.js`
Expected: FAIL with `ENOENT … checkout.routes.js`.

- [ ] **Step 4: Split the file with a checked script**

Save this outside the repo (for example in your scratchpad) as `split-payment-routes.mjs`, then run it from the worktree root with `node <path>/split-payment-routes.mjs`. It checks every boundary line first, so if the file has drifted it fails loudly instead of splitting in the wrong place.

```js
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "apps/api/src/routes/payment.routes.js";
const src = readFileSync(PATH, "utf8").split("\n");
const line = (n) => src[n - 1];
const expectAt = (n, text) => {
  if (!line(n).startsWith(text)) throw new Error(`line ${n}: expected "${text}", got "${line(n)}"`);
};
const range = (a, b) => src.slice(a - 1, b).join("\n");

expectAt(49, "// Per-route strict rate limit");
expectAt(52, "const CHARGE_RATE_LIMIT");
expectAt(54, "// Hosted-payment binding record TTL");
expectAt(56, "const HOSTED_BINDING_TTL");
expectAt(58, "/**");
expectAt(70, "export function chargeErrorReply");
expectAt(82, "}");
expectAt(84, "/** Best-effort split");
expectAt(116, "}");
expectAt(118, "/**");
expectAt(137, "}");
expectAt(139, "/**");
expectAt(248, "}");
expectAt(250, "export default async function paymentRoutes(fastify) {");
expectAt(251, "  // ───");
expectAt(426, "  });");
expectAt(428, "  // List saved cards");
expectAt(600, "  });");
expectAt(602, "  // Charge a saved card");
expectAt(883, "  });");
expectAt(885, "  // ───");
expectAt(1234, "  });");
expectAt(1236, "  // ───");
expectAt(1413, "  });");
expectAt(1414, "}");

const write = (file, parts) => writeFileSync(`apps/api/src/routes/${file}`, `${parts.join("\n\n")}\n`);

write("payment-replies.js", [
  `import { ERROR_CODES } from "@my-app/shared";
import { extractDeclineMessage } from "../lib/payment-helpers.js";

/**
 * Replies shared by every charge-producing route module (checkout, invoice
 * payments, admin charge-on-behalf). Split out of payment.routes.js.
 */`,
  range(49, 52).replace("const CHARGE_RATE_LIMIT", "export const CHARGE_RATE_LIMIT"),
  range(58, 82),
  range(118, 137),
]);

write("checkout.routes.js", [
  `import { optionalAuthenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validate.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { sendOrderReceipt } from "../services/email.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { orders, orderItems } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { createShopLabOrder } from "../services/lab/lab-orders.service.js";
import { ERROR_CODES, checkoutSchema } from "@my-app/shared";
import { withIdempotency, ChargeInProgressError, safeParse, idemResultKey } from "../lib/payment-helpers.js";
import { toDecimalString } from "../lib/money.js";
import { priceShopCart, pricingClientFor } from "../services/pricing.service.js";
import { PricingError, assertQuotedTotal } from "../lib/pricing.js";
import { pricingErrorReply } from "./catalog.routes.js";
import { CHARGE_RATE_LIMIT, chargeErrorReply } from "./payment-replies.js";`,
  range(84, 116),
  range(139, 248),
  `export default async function checkoutRoutes(fastify) {\n${range(251, 426)}\n}`,
]);

write("saved-cards.routes.js", [
  `import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile } from "../services/card.service.js";
import { isCardUsedByAutopay, CARD_IN_USE_BY_AUTOPAY_MESSAGE } from "../services/autopay.service.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";`,
  `export default async function savedCardRoutes(fastify) {\n${range(428, 600)}\n}`,
]);

write("invoice-payment.routes.js", [
  `import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile } from "../services/card.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { invoicePayments } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { ERROR_CODES, chargeSavedSchema, hostedTokenSchema, hostedCompleteSchema } from "@my-app/shared";
import {
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
  safeParse,
} from "../lib/payment-helpers.js";
import { verifyAllocations, recordPaymentAndAllocations } from "../services/payment-recording.service.js";
import { CHARGE_RATE_LIMIT, chargeErrorReply, sendInvoiceLockedError, sendAllocationError } from "./payment-replies.js";`,
  range(54, 56),
  `export default async function invoicePaymentRoutes(fastify) {\n${range(602, 883)}\n}`,
]);

write("refund.routes.js", [
  `import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import * as seazonaService from "../services/seazona.service.js";
import { sendRefundReceipt } from "../services/email.service.js";
import { voidOrRefund } from "../lib/void-refund.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, invoicePayments } from "../db/schema/index.js";
import { eq, and, gt } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { ERROR_CODES, refundSchema } from "@my-app/shared";
import { withIdempotency, ChargeInProgressError, extractDeclineMessage } from "../lib/payment-helpers.js";
import { round2 } from "../lib/money.js";`,
  `export default async function refundRoutes(fastify) {\n${range(885, 1234)}\n}`,
]);

write("payment.routes.js", [
  `import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { listPaymentsForUser, listAllPayments } from "../services/invoice-ledger.service.js";
import { db } from "../config/database.js";
import { users, auditLog } from "../db/schema/index.js";
import { eq, and, inArray, like, desc } from "drizzle-orm";
import { env } from "../config/env.js";
import { testModeError } from "../config/app-env.js";
import { ERROR_CODES } from "@my-app/shared";

// Checkout, saved cards, invoice payments and refunds live in their own route
// modules (checkout.routes.js, saved-cards.routes.js, invoice-payment.routes.js,
// refund.routes.js); shared replies in payment-replies.js. This module keeps
// payment history, the admin payment views and the admin-only test endpoints.`,
  `export default async function paymentRoutes(fastify) {\n${range(1236, 1413)}\n}`,
]);

console.log("split done");
```

- [ ] **Step 5: Point the callers at the new modules**

`apps/api/src/routes/admin-payment.routes.js`. Replace the import block at lines 20–24:

```js
import {
  sendAllocationError,
  sendInvoiceLockedError,
  chargeErrorReply,
} from "./payment-replies.js";
```

`apps/api/src/index.js`. After `import paymentRoutes from "./routes/payment.routes.js";` add:

```js
import checkoutRoutes from "./routes/checkout.routes.js";
import savedCardRoutes from "./routes/saved-cards.routes.js";
import invoicePaymentRoutes from "./routes/invoice-payment.routes.js";
import refundRoutes from "./routes/refund.routes.js";
```

and after `await fastify.register(paymentRoutes, { prefix: "/api/v1" });` add:

```js
await fastify.register(checkoutRoutes, { prefix: "/api/v1" });
await fastify.register(savedCardRoutes, { prefix: "/api/v1" });
await fastify.register(invoicePaymentRoutes, { prefix: "/api/v1" });
await fastify.register(refundRoutes, { prefix: "/api/v1" });
```

Tests that read the old file:
- `routes/__tests__/charge-error-reply.test.js` line 7 becomes `const { chargeErrorReply } = await import("../payment-replies.js");`.
- `routes/__tests__/checkout-lines.test.js` line 3 becomes `import { checkoutLinesFromQuote } from "../checkout.routes.js";`.
- `routes/__tests__/rx-release.test.js` line 10 becomes `const payment = read("../checkout.routes.js");`.

`config/app-env.test.js` still reads `payment.routes.js` for the test endpoints, which stay there.

- [ ] **Step 6: Run the whole suite and the build**

```bash
cd apps/api && pnpm vitest run src/routes/__tests__/payment-routes-split.test.js   # PASS
cd ../.. && pnpm test && pnpm --filter @my-app/web build
git diff --stat   # payment.routes.js shrinks by ~1,230 lines; five new files add ~1,280
```

Expected: every test passes. The behaviour is unchanged: all route bodies are byte-identical moves (check with `git diff -M --color-moved=zebra`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes apps/api/src/index.js
git commit -m "refactor(payments): split payment.routes.js along its seams (pure move)

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 2: Shared money; sequence allocator generalised

**Files:**
- Create: `packages/shared/src/money.js`, `apps/api/src/lib/sequence.js`, `apps/api/src/lib/sequence.test.js`, `apps/api/src/services/sequence.service.js`, `apps/api/src/services/sequence.service.test.js`
- Move: `apps/api/src/lib/money.test.js` → `packages/shared/src/money.test.js` (`git mv`)
- Modify:
  - `apps/api/src/lib/money.js` (becomes a re-export), `packages/shared/src/index.js`;
  - `apps/web/src/lib/money.js`, `apps/web/src/pages/app/AdminCatalogPage.jsx:15-21,122`, `apps/web/src/pages/app/AdminCatalogPage.test.jsx`, `apps/web/src/pages/app/AdminClientPricingPage.jsx:7,77`;
  - `apps/api/src/services/lab/lab-order-rules.js:25-32`, `apps/api/src/services/lab/lab-order-rules.test.js:4,11-17`;
  - `apps/api/src/services/lab/lab-orders.service.js:15,19-21,50-54`, `apps/api/src/services/lab/lab-orders.service.test.js` (the advisory-lock source test).

**Interfaces:**
- Produces (from `@my-app/shared`):
  - `round2`, `toCents`, `assertCents`, `toDecimalString`, `sumCents`, `mulCents`, `pctOfCents`: unchanged behaviour.
  - `formatCents(cents) → string`: `"—"` for null/undefined; throws on non-integers.
  - `parseMoneyInput(str, { allowNegative = false }?) → cents | null | undefined`: null when empty, undefined when not a money amount.
- Produces (API):
  - `lib/sequence.js` `nextSequenceNumber(maxExisting, start) → number`.
  - `services/sequence.service.js` `allocateSequenceNumber(tx, { lockId, table, column, start }) → Promise<number>`.
  - `lab-orders.service.js` `LAB_ORDER_NUMBER_LOCK = 7300421`; `allocateOrderNumber(tx)` is unchanged for callers.
- Removed: `nextLabOrderNumber` (lab-order-rules.js), web `parsePriceInput` (AdminCatalogPage.jsx).

- [ ] **Step 1: Move the money test and extend it (failing)**

```bash
git mv apps/api/src/lib/money.test.js packages/shared/src/money.test.js
```

In `packages/shared/src/money.test.js`, change the import to:

```js
import {
  round2, toCents, toDecimalString, formatCents, sumCents, mulCents, pctOfCents, parseMoneyInput,
} from "./money.js";
```

and append:

```js
test("formatCents shows a dash for no amount and refuses dollars", () => {
  assert.equal(formatCents(null), "—");
  assert.equal(formatCents(undefined), "—");
  assert.equal(formatCents(-1250), "-$12.50");
  assert.throws(() => formatCents(12.5), TypeError);
});

test("parseMoneyInput: staff type dollars, the code gets cents", () => {
  assert.equal(parseMoneyInput("199"), 19900);
  assert.equal(parseMoneyInput("$1,234.5"), 123450);
  assert.equal(parseMoneyInput("0"), 0);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("   "), null);
  assert.equal(parseMoneyInput("abc"), undefined);
  assert.equal(parseMoneyInput("1.999"), undefined);
  assert.equal(parseMoneyInput("-3"), undefined, "negative only when asked for");
  assert.equal(parseMoneyInput("-3", { allowNegative: true }), -300);
  assert.equal(parseMoneyInput("-$12.05", { allowNegative: true }), -1205);
});
```

`apps/api/src/lib/sequence.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { nextSequenceNumber } from "./sequence.js";

test("a sequence continues from its start and never reuses a number", () => {
  assert.equal(nextSequenceNumber(null, 100000), 100000);
  assert.equal(nextSequenceNumber(100244, 100000), 100245);
  assert.equal(nextSequenceNumber(12, 100000), 100000, "raising the start later jumps ahead");
  assert.throws(() => nextSequenceNumber(null, 0), RangeError);
  assert.throws(() => nextSequenceNumber(null, 1.5), RangeError);
});
```

`apps/api/src/services/sequence.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { allocateSequenceNumber } from "./sequence.service.js";

function fakeTx(max) {
  const ops = [];
  return {
    ops,
    execute: async (q) => { ops.push({ op: "execute", q }); },
    select: () => ({ from: async () => { ops.push({ op: "select" }); return [{ max }]; } }),
  };
}

test("takes the sequence's own advisory lock before reading the max", async () => {
  const tx = fakeTx(500041);
  const n = await allocateSequenceNumber(tx, { lockId: 7300422, table: {}, column: {}, start: 500000 });
  assert.equal(n, 500042);
  assert.deepEqual(tx.ops.map((o) => o.op), ["execute", "select"]);
  const lockSql = tx.ops[0].q.queryChunks.flatMap((c) => c.value ?? []).join("");
  assert.match(lockSql, /pg_advisory_xact_lock\(7300422\)/);
});

test("an empty table starts at the configured number", async () => {
  assert.equal(await allocateSequenceNumber(fakeTx(null), { lockId: 1, table: {}, column: {}, start: 500000 }), 500000);
});

test("refuses a non-integer lock id (it is interpolated into SQL)", async () => {
  await assert.rejects(allocateSequenceNumber(fakeTx(null), { lockId: "1; drop", table: {}, column: {}, start: 1 }), RangeError);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @my-app/shared exec vitest run src/money.test.js && cd apps/api && pnpm vitest run src/lib/sequence.test.js src/services/sequence.service.test.js`
Expected: FAIL. `./money.js`, `./sequence.js` and `./sequence.service.js` don't exist.

- [ ] **Step 3: Implement shared money**

`packages/shared/src/money.js`:

```js
/**
 * Money: integer cents end to end. The one implementation, shared by the API
 * (apps/api/src/lib/money.js re-exports it) and the web (apps/web/src/lib/money.js).
 * Dollars appear only at a boundary: a Postgres numeric column (toCents /
 * toDecimalString), the Authorize.net wire (toDecimalString out, toCents in), or
 * an amount a person typed (parseMoneyInput).
 */

/** Legacy dollar-float rounding. Only AutoPay's numeric(12,2) columns still need it. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const AMOUNT = /^-?\d+(\.\d+)?$/;

/** Dollars (number, or a decimal string such as a Postgres numeric) → cents, half-up. */
export function toCents(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!AMOUNT.test(s)) throw new TypeError(`Not a money amount: ${value}`);
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const digits = (frac + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

export function assertCents(c, label = "amount") {
  if (!Number.isSafeInteger(c)) throw new TypeError(`${label} must be integer cents, got ${c}`);
  return c;
}

/** Cents → "123.45": the string a numeric(12,2) column and the Authorize.net wire expect. */
export function toDecimalString(cents) {
  assertCents(cents);
  const a = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.56"; "—" when there is no amount. Throws on anything that isn't integer cents. */
export function formatCents(cents) {
  if (cents == null) return "—";
  return USD.format(assertCents(cents) / 100);
}

export function sumCents(list) {
  return list.reduce((s, c) => s + assertCents(c), 0);
}

export function mulCents(cents, qty) {
  assertCents(cents);
  if (!Number.isSafeInteger(qty)) throw new TypeError(`qty must be an integer, got ${qty}`);
  return cents * qty;
}

/** A percentage given in basis points (800 = 8%), rounded half-up to the cent. */
export function pctOfCents(cents, rateBps) {
  assertCents(cents);
  assertCents(rateBps, "rateBps");
  const raw = cents * rateBps;
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(raw) + 5000) / 10000);
}

const TYPED = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/**
 * What a person typed ("$1,234.5") → cents. null when empty; undefined when it
 * isn't a money amount (more than two decimals, letters, or a minus sign
 * without `allowNegative`).
 */
export function parseMoneyInput(str, { allowNegative = false } = {}) {
  const s = String(str ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  const m = TYPED.exec(s);
  if (!m || (m[1] && !allowNegative)) return undefined;
  const cents = Number(m[2]) * 100 + Number(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] ? -cents : cents;
}
```

`packages/shared/src/index.js`. Append:

```js
// Money (integer cents)
export * from "./money.js";
```

`apps/api/src/lib/money.js` (whole file):

```js
// The one money implementation lives in @my-app/shared (packages/shared/src/money.js).
export {
  round2, toCents, assertCents, toDecimalString, formatCents, sumCents, mulCents, pctOfCents, parseMoneyInput,
} from "@my-app/shared";
```

`apps/web/src/lib/money.js` (whole file):

```js
// The one money implementation lives in @my-app/shared (packages/shared/src/money.js).
export { formatCents, parseMoneyInput } from "@my-app/shared";
```

In `apps/web/src/pages/app/AdminCatalogPage.jsx`:
- delete `export function parsePriceInput(str) { … }` (lines 15–21);
- add `parseMoneyInput` to its `../../lib/money.js` import: `import { formatCents, parseMoneyInput } from "../../lib/money.js";`;
- change line 122 to `const basePriceCents = parseMoneyInput(draft.price);`.

In `AdminCatalogPage.test.jsx`, drop `parsePriceInput` from the import and delete the `"admins type dollars; the API gets cents"` test, which now lives in the shared money test.

In `AdminClientPricingPage.jsx`:
- replace `import { parsePriceInput } from "./AdminCatalogPage.jsx";` with nothing;
- change its money import to `import { formatCents, parseMoneyInput } from "../../lib/money.js";`;
- change line 77 to `const priceCents = parseMoneyInput(pick.price);`.

- [ ] **Step 4: Implement the sequence allocator and move lab orders onto it**

`apps/api/src/lib/sequence.js`:

```js
/**
 * The next number in a business sequence (lab order numbers, invoice numbers):
 * continues from `start`, never reuses one, and raising `start` later jumps
 * ahead. Callers read the current max under a transaction-scoped advisory lock
 * (services/sequence.service.js allocateSequenceNumber).
 */
export function nextSequenceNumber(maxExisting, start) {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new RangeError(`A sequence start must be a positive integer, got ${start}`);
  }
  if (maxExisting == null) return start;
  return Math.max(Number(maxExisting) + 1, start);
}
```

`apps/api/src/services/sequence.service.js`:

```js
import { sql } from "drizzle-orm";
import { nextSequenceNumber } from "../lib/sequence.js";

/**
 * Allocate the next number of a sequence inside the caller's transaction. The
 * advisory lock is held until that transaction ends, so two concurrent writers
 * can never read the same max. Each sequence has its own lock id (lab orders
 * 7300421, invoices 7300422).
 */
export async function allocateSequenceNumber(tx, { lockId, table, column, start }) {
  if (!Number.isSafeInteger(lockId)) throw new RangeError(`lockId must be an integer, got ${lockId}`);
  await tx.execute(sql.raw(`select pg_advisory_xact_lock(${lockId})`));
  const [row] = await tx.select({ max: sql`max(${column})` }).from(table);
  return nextSequenceNumber(row?.max == null ? null : Number(row.max), start);
}
```

`apps/api/src/services/lab/lab-order-rules.js`: delete `nextLabOrderNumber` (lines 25–32 with its doc comment).

`apps/api/src/services/lab/lab-order-rules.test.js`:
- remove `nextLabOrderNumber` from the import on line 4;
- delete the test `"order numbers continue from the start and never reuse one"` (lines 11–17), which `lib/sequence.test.js` now covers.

`apps/api/src/services/lab/lab-orders.service.js`:
- remove `nextLabOrderNumber` from the `./lab-order-rules.js` import;
- add `import { allocateSequenceNumber } from "../sequence.service.js";`;
- delete the `ORDER_NUMBER_LOCK` constant and its comment (lines 19–21);
- replace `allocateOrderNumber`:

```js
// Serialises order-number allocation (services/sequence.service.js).
export const LAB_ORDER_NUMBER_LOCK = 7300421;

export function allocateOrderNumber(tx) {
  return allocateSequenceNumber(tx, {
    lockId: LAB_ORDER_NUMBER_LOCK, table: labOrders, column: labOrders.orderNumber, start: env.LAB_ORDER_NUMBER_START,
  });
}
```

`apps/api/src/services/lab/lab-orders.service.test.js`: replace the body of the test `"order numbers are allocated under a transaction-scoped advisory lock"` with:

```js
  assert.match(source, /allocateSequenceNumber\(tx, \{\s*lockId: LAB_ORDER_NUMBER_LOCK/);
  assert.equal(mod.LAB_ORDER_NUMBER_LOCK, 7300421);
```

- [ ] **Step 5: Run the suites and the build**

```bash
pnpm test
pnpm --filter @my-app/web build
grep -rn "parsePriceInput\|nextLabOrderNumber" apps packages --include='*.js' --include='*.jsx' | grep -v node_modules   # no output
```

Expected: everything passes. `allocateOrderNumber takes the advisory lock before reading the max` still passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api/src/lib apps/api/src/services apps/web/src
git commit -m "refactor(money): one cents implementation in shared; sequence allocator for order and invoice numbers

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 3: Billing tables, ledger columns, migrations 0028–0029, scrub, env, audit-in-transaction

**Files:**
- Create: `apps/api/src/db/schema/invoices.js`, `apps/api/src/db/schema/invoices.test.js`, `apps/api/src/config/env.billing.test.js`, `apps/api/src/services/audit.service.test.js`
- Modify: `apps/api/src/db/schema/invoice-payments.js`, `apps/api/src/db/schema/index.js`, `apps/api/src/db/scrub/plan.js`, `apps/api/src/db/scrub/plan.test.js`, `apps/api/src/db/scrub/COLUMNS.md`, `apps/api/src/config/env.js:67-71`, `apps/api/src/services/audit.service.js:5-16`
- Generated: `apps/api/src/db/migrations/0028_*.sql`, `0029_invoice_payments_applied_cents.sql` (custom, hand-written body), `meta/0028_snapshot.json`, `meta/0029_snapshot.json`, `meta/_journal.json`

**Interfaces:**
- Produces (Drizzle tables from `db/schema/index.js`):
  - `invoices`: `id, invoiceNumber, kind, clientUserId, labOrderId, legacySeazonaInvoiceId, status, version, issuedAt, dueDate ("YYYY-MM-DD"), voidedAt, voidReason, subtotalCents, taxCents, shippingCents, totalCents, notes, createdAt, updatedAt`.
  - `invoiceLines`: `id, invoiceId, position, kind, variantId, code, description, qty, unitCents, lineCents, taxable, priceSource, priceNote, labOrderLineId, createdAt`.
  - `invoicePayments` gains `invoiceId, appliedCents, paidOn ("YYYY-MM-DD"), reference, note`. `userId` and `seazonaInvoiceId` become nullable. `appliedAmount` stays nullable until Task 8 drops it.
- `env.INVOICE_NUMBER_START` (default 500000) and `env.INVOICE_TERMS_DAYS` (default 30).
- `auditService.log(entry, database = db)`: pass a transaction so the audit row commits or rolls back with the change.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/db/schema/invoices.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invoices, invoiceLines, invoicePayments } from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migration = (prefix) => {
  const f = readdirSync(migrationsDir).find((n) => n.startsWith(prefix) && n.endsWith(".sql"));
  assert.ok(f, `no ${prefix}* migration`);
  return readFileSync(join(migrationsDir, f), "utf8");
};

test("invoices carry identity, lifecycle and totals in cents", () => {
  has(invoices, [
    "id", "invoiceNumber", "kind", "clientUserId", "labOrderId", "legacySeazonaInvoiceId", "status", "version",
    "issuedAt", "dueDate", "voidedAt", "voidReason", "subtotalCents", "taxCents", "shippingCents", "totalCents",
    "notes", "createdAt", "updatedAt",
  ]);
  assert.equal(invoices.invoiceNumber.notNull, true);
  assert.equal(invoices.clientUserId.notNull, false, "a guest's shop invoice has no client");
  assert.equal(invoices.version.notNull, true);
  for (const c of ["subtotalCents", "taxCents", "shippingCents", "totalCents"]) assert.equal(invoices[c].columnType, "PgInteger", c);
});

test("invoice lines are typed, in cents, and remember where their price came from", () => {
  has(invoiceLines, [
    "id", "invoiceId", "position", "kind", "variantId", "code", "description", "qty", "unitCents", "lineCents",
    "taxable", "priceSource", "priceNote", "labOrderLineId", "createdAt",
  ]);
  assert.equal(invoiceLines.kind.default, "item");
});

test("the ledger points at local invoices, in cents, with the manual-payment fields", () => {
  has(invoicePayments, ["invoiceId", "appliedCents", "paidOn", "reference", "note"]);
  assert.equal(invoicePayments.userId.notNull, false, "a guest's shop payment has no portal user");
  assert.equal(invoicePayments.seazonaInvoiceId.notNull, false, "legacy column, kept for Seazona-era rows");
});

test("0028: invoice numbers are unique; one invoice per lab order and per legacy Seazona invoice", () => {
  const sql = migration("0028_");
  assert.match(sql, /CREATE TABLE "invoices"/);
  assert.match(sql, /CREATE TABLE "invoice_lines"/);
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_invoice_number_idx"/);
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_lab_order_idx"/);
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_legacy_seazona_idx"/);
  assert.match(sql, /ALTER TABLE "invoice_payments" ADD COLUMN "applied_cents" integer;/);
  assert.match(sql, /ALTER TABLE "invoice_payments" ALTER COLUMN "user_id" DROP NOT NULL;/);
  assert.match(sql, /ALTER TABLE "invoice_payments" ALTER COLUMN "applied_amount" DROP NOT NULL;/);
});

test("0029 converts every existing ledger amount to cents, half away from zero", () => {
  const sql = migration("0029_");
  assert.match(sql, /UPDATE "invoice_payments" SET "applied_cents" = round\("applied_amount" \* 100\)::integer WHERE "applied_cents" IS NULL;/);
});
```

`apps/api/src/config/env.billing.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

test("invoice numbering has a placeholder start that piece 5 replaces before cutover", () => {
  assert.equal(env.INVOICE_NUMBER_START, 500000);
});

test("net terms default to 30 days", () => {
  assert.equal(env.INVOICE_TERMS_DAYS, 30);
});
```

`apps/api/src/services/audit.service.test.js`:

```js
import { test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

vi.mock("../config/database.js", () => ({
  db: { insert: () => { throw new Error("the global db must not be used when a transaction is passed"); } },
}));

const { log } = await import("./audit.service.js");

test("log writes through the transaction it is given, so the row commits or rolls back with the change", async () => {
  const rows = [];
  const tx = { insert: () => ({ values: async (v) => { rows.push(v); } }) };
  await log({ userId: "u1", action: "invoice.issued", targetType: "invoice", targetId: "inv1", metadata: { invoiceNumber: 500001 } }, tx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "invoice.issued");
  assert.deepEqual(rows[0].metadata, { invoiceNumber: 500001 });
});
```

In `apps/api/src/db/scrub/plan.test.js`, add to `MUST_SCRUB`:

```js
  invoices: ["notes", "void_reason"],
  invoice_lines: ["description", "price_note"],
  invoice_payments: ["reference", "note"],
```

and append:

```js
test("invoice line descriptions are re-derived from the catalog by code; shipping stays Shipping", () => {
  const sql = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "invoice_lines").sql;
  assert.ok(sql.includes(`"description" = CASE WHEN "invoice_lines"."kind" = 'shipping' THEN 'Shipping' ELSE LEFT(COALESCE(`), sql);
  assert.ok(sql.includes(`v."code" = "invoice_lines"."code"`), sql);
  assert.match(sql, /"price_note" = NULL/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/db/schema/invoices.test.js src/config/env.billing.test.js src/services/audit.service.test.js src/db/scrub/plan.test.js`
Expected: FAIL. `invoices` is undefined, the env keys are missing, `log` ignores its second argument, and the scrub tables are missing.

- [ ] **Step 3: Implement the schema, env and audit change**

`apps/api/src/db/schema/invoices.js`:

```js
import { pgTable, varchar, text, integer, boolean, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Invoices (own-the-lab piece 3): what each client owes. One per lab order
// (kind "order"), one per paid shop order (kind "shop") and, from piece 5's
// import, one per historical Seazona invoice (kind "legacy").
//
// Money is integer cents. Totals are recomputed from the lines by
// services/billing/invoice-rules.js computeTotals on every draft change and
// never edited directly. Paid and balance are DERIVED from invoice_payments
// (services/billing/ledger.service.js + invoice-rules deriveBalance), never stored.
//
// notes, voidReason and invoice_lines.priceNote are staff free text that can
// name a patient: encrypted at rest (services/billing/invoice-crypto.js).
//
// No DB foreign keys (repo convention).

export const invoices = pgTable("invoices", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Continues the legacy numbering from INVOICE_NUMBER_START (allocated under
  // an advisory lock, services/sequence.service.js).
  invoiceNumber: integer("invoice_number").notNull(),
  // order | shop | legacy
  kind: varchar("kind", { length: 10 }).notNull(),
  // The doctor billed. Null only for a guest's shop invoice (never on a statement).
  clientUserId: varchar("client_user_id", { length: 128 }),
  labOrderId: varchar("lab_order_id", { length: 128 }),
  // Piece 5's import key.
  legacySeazonaInvoiceId: varchar("legacy_seazona_invoice_id", { length: 128 }),
  // draft | issued | void
  status: varchar("status", { length: 10 }).notNull().default("draft"),
  // Optimistic concurrency, as on lab orders: every change increments it.
  version: integer("version").notNull().default(1),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  dueDate: date("due_date", { mode: "string" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  shippingCents: integer("shipping_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  // Staff-only, encrypted.
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invoices_invoice_number_idx").on(t.invoiceNumber),
  // Postgres unique indexes ignore NULLs: one invoice per lab order / legacy invoice when set.
  uniqueIndex("invoices_lab_order_idx").on(t.labOrderId),
  uniqueIndex("invoices_legacy_seazona_idx").on(t.legacySeazonaInvoiceId),
  index("invoices_client_idx").on(t.clientUserId),
  index("invoices_status_idx").on(t.status),
]);

export const invoiceLines = pgTable("invoice_lines", {
  id: varchar("id", { length: 128 }).primaryKey(),
  invoiceId: varchar("invoice_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  // item | shipping | fee | adjustment. Shipping lines make up shippingCents;
  // only an adjustment may be negative.
  kind: varchar("kind", { length: 12 }).notNull().default("item"),
  variantId: varchar("variant_id", { length: 128 }),
  code: varchar("code", { length: 60 }),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitCents: integer("unit_cents").notNull(),
  lineCents: integer("line_cents").notNull(),
  taxable: boolean("taxable").notNull().default(false),
  // client | base | manual | remake | unpriced
  priceSource: varchar("price_source", { length: 10 }).notNull(),
  // Why staff overrode the price. Encrypted.
  priceNote: text("price_note"),
  labOrderLineId: varchar("lab_order_line_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId)]);
```

`apps/api/src/db/schema/invoice-payments.js` (whole file):

```js
import { pgTable, varchar, timestamp, numeric, integer, date, text, index } from "drizzle-orm/pg-core";

/**
 * The invoice ledger: how money was applied to invoices. One row per invoice a
 * payment was split across. Paid = SUM(applied_cents) per invoice; balance is
 * derived (services/billing/invoice-rules.js deriveBalance), never stored.
 *
 * Sign: payments and credits are POSITIVE (they reduce the balance); refund and
 * void reversals are NEGATIVE rows carrying `refundsTransactionId` = the
 * ORIGINAL charge's transaction id (the double-refund guard and the
 * reconciliation link). The row's own `transactionId` is the gateway's id, an
 * `OFFLINE-<id>` sentinel for a manual payment, `credit:<rowId>` for a staff
 * credit, or the checkout's id for a shop order.
 *
 * Seazona-era rows (before own-the-lab piece 3) carry `seazonaClientId` /
 * `seazonaInvoiceId` and no `invoiceId`; piece 5's import fills `invoiceId`.
 */
export const invoicePayments = pgTable("invoice_payments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Who paid (attribution, not ownership). Null for a guest's shop payment.
  userId: varchar("user_id", { length: 128 }),
  // The local invoice (own-the-lab piece 3).
  invoiceId: varchar("invoice_id", { length: 128 }),
  // Legacy (Seazona) keys, kept for history.
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaInvoiceId: varchar("seazona_invoice_id", { length: 128 }),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  // TEMPORARY: the dollar amount. Converted into applied_cents by migration
  // 0029 and dropped in own-the-lab piece 3 Task 8. New code never reads it.
  appliedAmount: numeric("applied_amount", { precision: 12, scale: 2 }),
  // Integer cents (NOT NULL from Task 8 / migration 0030).
  appliedCents: integer("applied_cents"),
  transactionId: varchar("transaction_id", { length: 100 }).notNull(),
  seazonaPaymentId: varchar("seazona_payment_id", { length: 128 }),
  // Set only on refund/void reversal rows → the ORIGINAL charge's transaction id.
  refundsTransactionId: varchar("refunds_transaction_id", { length: 100 }),
  // doctor_card | doctor_hosted | admin_card | autopay | refund | shop_card |
  // admin_check | admin_cash | admin_ach | admin_other | credit
  // (admin_offline on Seazona-era rows; null on rows older than the column).
  source: varchar("source", { length: 32 }),
  // The day a manual payment was received (staff-entered). Null → the row's lab-local created date.
  paidOn: date("paid_on", { mode: "string" }),
  // Check number / ACH trace a manual payment carries.
  reference: varchar("reference", { length: 100 }),
  // A credit's reason. Staff free text: encrypted.
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invoice_payments_user_id_idx").on(table.userId),
  index("invoice_payments_invoice_id_idx").on(table.invoiceId),
  index("invoice_payments_seazona_invoice_id_idx").on(table.seazonaInvoiceId),
  index("invoice_payments_transaction_id_idx").on(table.transactionId),
  index("invoice_payments_refunds_transaction_id_idx").on(table.refundsTransactionId),
]);
```

`apps/api/src/db/schema/index.js`. Append:

```js
export { invoices, invoiceLines } from "./invoices.js";
```

`apps/api/src/config/env.js`. After the `LAB_ORDER_NUMBER_START` line add:

```js
  // ── Invoices ──
  // Invoice numbers continue the legacy system's numbering. Piece 5 sets this
  // to Seazona's last invoice number + 1 BEFORE any invoice is created in
  // production (legacy invoices are imported under their own numbers);
  // allocation is max(existing + 1, start).
  INVOICE_NUMBER_START: z.coerce.number().int().positive().default(500000),
  // Net terms: an invoice issued on ship is due this many days later.
  INVOICE_TERMS_DAYS: z.coerce.number().int().min(0).max(365).default(30),
```

`apps/api/src/services/audit.service.js`. Replace `log`:

```js
/**
 * Write one audit row. Pass a transaction as `database` when the action is
 * itself transactional (invoice draft/issue/void/credit), so the audit row
 * commits or rolls back with it.
 */
export async function log({ userId, accountId, action, targetType, targetId, metadata, ipAddress }, database = db) {
  await database.insert(auditLog).values({
    id: createId(),
    userId: userId || null,
    accountId: accountId || null,
    action,
    targetType: targetType || null,
    targetId: targetId || null,
    metadata: metadata || {},
    ipAddress: ipAddress || null,
  });
}
```

`logSafe(entry)` keeps calling `log(entry)` (the global db).

- [ ] **Step 4: Classify the new columns for the staging scrub**

`apps/api/src/db/scrub/plan.js`. Replace the `invoice_payments` entry:

```js
  invoice_payments: {
    mode: "update",
    columns: {
      id: K, user_id: K, invoice_id: K, seazona_client_id: K, seazona_invoice_id: K, invoice_number: K,
      applied_amount: K, applied_cents: K, transaction_id: K, seazona_payment_id: K, refunds_transaction_id: K,
      source: K, paid_on: K,
      reference: pii("NULL"), // staff-typed check number / trace — free text
      note: phi("NULL"), // a credit's reason: staff free text, encrypted at rest
      created_at: K,
    },
  },
```

and add, after `lab_order_events`:

```js
  // Invoices (own-the-lab piece 3). Staff free text (notes, void reasons, price
  // notes) is encrypted at rest in prod and can name a patient: replaced, never decrypted.
  invoices: {
    mode: "update",
    columns: {
      id: K, invoice_number: K, kind: K, client_user_id: K, lab_order_id: K, legacy_seazona_invoice_id: K,
      status: K, version: K, issued_at: K, due_date: K, voided_at: K,
      void_reason: phi("NULL"),
      subtotal_cents: K, tax_cents: K, shipping_cents: K, total_cents: K,
      notes: phi("NULL"),
      created_at: K, updated_at: K,
    },
  },
  invoice_lines: {
    mode: "update",
    columns: {
      id: K, invoice_id: K, position: K, kind: K, variant_id: K, code: K,
      // Free-form lines are staff-typed: re-derived from the catalog by code (same
      // rule as lab_order_lines.name); a shipping line stays "Shipping".
      description: phi(`CASE WHEN "invoice_lines"."kind" = 'shipping' THEN 'Shipping' ELSE LEFT(COALESCE(${catalogNameFor('"invoice_lines"."code"')}, 'Line'), 255) END`),
      qty: K, unit_cents: K, line_cents: K, taxable: K, price_source: K,
      price_note: phi("NULL"), // why a price was overridden: staff free text, encrypted
      lab_order_line_id: K, created_at: K,
    },
  },
```

`apps/api/src/db/scrub/COLUMNS.md`. Add to "Rewritten columns":

```markdown
| invoices.notes, invoices.void_reason | phi | NULL (staff free text, encrypted at rest; can name a patient) |
| invoice_lines.description | phi | `Shipping` for shipping lines; otherwise the catalog name for `code` (`product_variants.code` first, then `products.code`), else `Line`. Free-form lines are staff-typed |
| invoice_lines.price_note | phi | NULL (why a price was overridden: staff free text, encrypted) |
| invoice_payments.reference | pii | NULL (staff-typed check number / ACH trace) |
| invoice_payments.note | phi | NULL (a credit's reason: staff free text, encrypted) |
```

In "Kept (judgement calls)", replace the `invoice_payments, autopay_attempts …` bullet with:

```markdown
- invoices and invoice_lines apart from the columns above (numbers, status, dates, cents, codes, quantities, price sources); invoice_payments money columns, ids, sources and `paid_on`; autopay_attempts (allocations are invoice id/number/amount), orders money columns and transaction ids, order_items, catalog and product tables, memberships, app_theme.
```

- [ ] **Step 5: Generate migration 0028, then the custom backfill 0029**

```bash
cd apps/api
pnpm db:generate
```

Expected: a new `src/db/migrations/0028_<name>.sql` with:
- `CREATE TABLE "invoices"` and `CREATE TABLE "invoice_lines"`;
- `ALTER TABLE "invoice_payments" ADD COLUMN` for `invoice_id`, `applied_cents`, `paid_on`, `reference`, `note`;
- `ALTER COLUMN … DROP NOT NULL` for `user_id`, `seazona_invoice_id` and `applied_amount`;
- the five invoice indexes and `invoice_payments_invoice_id_idx`.

Do not edit it. drizzle-kit asks nothing (every change is additive).

```bash
pnpm db:generate --custom --name=invoice_payments_applied_cents
```

Expected: an empty `src/db/migrations/0029_invoice_payments_applied_cents.sql`. This one is written by hand. Its whole content:

```sql
UPDATE "invoice_payments" SET "applied_cents" = round("applied_amount" * 100)::integer WHERE "applied_cents" IS NULL;
```

(`round(numeric)` rounds half away from zero; refunds are negative rows, so `-12.345` → `-1235`.)

- [ ] **Step 6: Apply locally and run the suite**

```bash
pnpm db:migrate
psql diamond_labs_own_the_lab_3 -c "select count(*) filter (where applied_cents is null) as unconverted from invoice_payments"   # 0
pnpm db:generate   # "No schema changes"
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

Expected: both migrations apply in one transaction and every test passes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db apps/api/src/config apps/api/src/services/audit.service.js apps/api/src/services/audit.service.test.js
git commit -m "feat(billing): invoice tables, cents ledger columns, migrations 0028-0029, scrub classification

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 4: Pure billing rules: vocabulary, schemas, invoice rules, aging, errors

**Files:**
- Create: `packages/shared/src/billing/billing.js`, `packages/shared/src/billing/billing.test.js`, `packages/shared/src/schemas/billing.schema.js`, `packages/shared/src/schemas/billing.schema.test.js`, `apps/api/src/services/billing/invoice-rules.js`, `apps/api/src/services/billing/invoice-rules.test.js`, `apps/api/src/services/billing/aging.js`, `apps/api/src/services/billing/aging.test.js`, `apps/api/src/services/billing/invoice-errors.js`
- Modify: `packages/shared/src/index.js`

**Interfaces:**
- Produces (from `@my-app/shared`):
  - constants: `INVOICE_STATUSES`, `INVOICE_KINDS`, `INVOICE_LINE_KINDS`, `PRICE_SOURCES`, `MANUAL_PAYMENT_METHODS`, `MANUAL_PAYMENT_LABELS`, `CREDIT_SOURCE` ("credit"), `SHOP_PAYMENT_SOURCE` ("shop_card"), `AGING_BUCKETS` (`[{ key, label }]`), `LINE_KIND_LABELS`, `PRICE_SOURCE_LABELS`;
  - `manualPaymentSource(method) → "admin_<method>"`;
  - `invoiceStatusLabel({ status, balanceCents, dueDate }, todayIso) → "Draft" | "Void" | "Paid" | "Past due" | "Open"`;
  - schemas: `invoiceListQuerySchema`, `invoiceEditSchema`, `invoiceIssueSchema`, `invoiceVoidSchema`, `invoiceCreditSchema`, `manualPaymentSchema`, `statementQuerySchema`, `receivablesQuerySchema`, `clientInvoicesQuerySchema`.
- Produces (API `services/billing/invoice-rules.js`):
  - `InvoiceError(code, message)`, with codes `NOT_FOUND | STALE | LOCKED | INVALID | INVALID_TRANSITION | REASON_REQUIRED | OVERPAY`;
  - `addDaysIso(iso, days)`, `lineCentsOf(line)`;
  - `computeTotals(lines, { taxRateBps }) → { subtotalCents, taxCents, shippingCents, totalCents }`;
  - `hasUnpriced(lines)`, `asRemakeLines(pricedLines)`;
  - `planDraftInvoice({ invoiceId, invoiceNumber, labOrder, pricedLines, now, taxRateBps }) → { invoice, lines }`;
  - `planShopInvoice({ invoiceId, invoiceNumber, labOrderId, clientUserId, quote, now, todayIso }) → { invoice, lines }`;
  - `assertFreshInvoice(invoice, expectedVersion)`;
  - `planLineEdit(invoice, lines, edit, { now, taxRateBps }) → { op: { insert? | update?: { id, values } | delete? }, patch, audit }`;
  - `planIssue(invoice, lines, { now, termsDays, issueDateIso }) → { patch }`;
  - `planVoid(invoice, { paidCents, reason, now }) → { patch }`;
  - `deriveBalance(invoice, paidCents) → { paidCents, balanceCents, paid }`: **the** balance rule.
- Produces (API `services/billing/aging.js`):
  - `AGING_KEYS`;
  - `daysPastDue(dueDate, asOfIso)`, `agingKeyFor(dueDate, asOfIso)`;
  - `ageBalances(items, asOfIso) → { buckets, totalCents, oldestDueDate }`;
  - `buildReceivables(openInvoices, clientsById, asOfIso, { pastDueOnly }) → { rows, totals, asOf }`.
- Produces (API `services/billing/invoice-errors.js`): `invoiceErrorReply(err) → { status, body } | null`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/billing/billing.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { invoiceStatusLabel, manualPaymentSource, MANUAL_PAYMENT_METHODS, AGING_BUCKETS } from "./billing.js";

test("an invoice reads as Draft, Void, Paid, Past due or Open", () => {
  const today = "2026-10-15";
  assert.equal(invoiceStatusLabel({ status: "draft", balanceCents: 500 }, today), "Draft");
  assert.equal(invoiceStatusLabel({ status: "void", balanceCents: 0 }, today), "Void");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 0, dueDate: "2026-09-01" }, today), "Paid");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: -100, dueDate: "2026-09-01" }, today), "Paid");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 100, dueDate: "2026-10-14" }, today), "Past due");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 100, dueDate: "2026-10-15" }, today), "Open", "due today is not past due");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 100, dueDate: null }, today), "Open");
});

test("manual payment methods map to ledger sources", () => {
  assert.deepEqual(MANUAL_PAYMENT_METHODS.map(manualPaymentSource), ["admin_check", "admin_cash", "admin_ach", "admin_other"]);
});

test("the five aging buckets, in print order", () => {
  assert.deepEqual(AGING_BUCKETS.map((b) => b.label), ["Current", "1–30", "31–60", "61–90", "90+"]);
});
```

`packages/shared/src/schemas/billing.schema.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  invoiceEditSchema, invoiceVoidSchema, invoiceCreditSchema, manualPaymentSchema, statementQuerySchema, invoiceListQuerySchema,
} from "./billing.schema.js";

const ok = (schema, v) => schema.safeParse(v).success;

test("edits are one of update / add / remove / notes, always with the version seen", () => {
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "update", lineId: "l1", unitCents: 9000, reason: "discount" } }));
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "add", kind: "shipping", description: "Shipping", qty: 1, unitCents: 1500 } }));
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "remove", lineId: "l1" } }));
  assert.ok(ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "notes", notes: null } }));
  assert.ok(!ok(invoiceEditSchema, { edit: { op: "remove", lineId: "l1" } }), "expectedVersion is required");
  assert.ok(!ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "add", kind: "gift", description: "x", qty: 1, unitCents: 1 } }));
  assert.ok(!ok(invoiceEditSchema, { expectedVersion: 2, edit: { op: "add", kind: "fee", description: "x", qty: 1, unitCents: 1.5 } }), "cents are integers");
});

test("void and credit need a reason; a credit is a positive cents amount", () => {
  assert.ok(!ok(invoiceVoidSchema, { expectedVersion: 1, reason: "   " }));
  assert.ok(ok(invoiceVoidSchema, { expectedVersion: 1, reason: "Billed the wrong client" }));
  assert.ok(!ok(invoiceCreditSchema, { amountCents: 0, reason: "x" }));
  assert.ok(ok(invoiceCreditSchema, { amountCents: 2500, reason: "Shade mismatch goodwill" }));
});

test("a manual payment's chosen allocations must add up to the payment", () => {
  const base = { method: "check", reference: "1042", amountCents: 30000, paidOn: "2026-10-14" };
  assert.ok(ok(manualPaymentSchema, base), "oldest-first when no allocations are given");
  assert.ok(ok(manualPaymentSchema, { ...base, allocations: [{ invoiceId: "a", amountCents: 10000 }, { invoiceId: "b", amountCents: 20000 }] }));
  assert.ok(!ok(manualPaymentSchema, { ...base, allocations: [{ invoiceId: "a", amountCents: 10000 }] }));
  assert.ok(!ok(manualPaymentSchema, { ...base, method: "bitcoin" }));
  assert.ok(!ok(manualPaymentSchema, { ...base, paidOn: "10/14/2026" }));
});

test("statements are asked for by month; list filters coerce", () => {
  assert.ok(ok(statementQuerySchema, { month: "2026-10" }));
  assert.ok(!ok(statementQuerySchema, { month: "2026-13" }));
  assert.ok(!ok(statementQuerySchema, {}));
  const q = invoiceListQuerySchema.parse({ needsPrice: "true", number: "500123" });
  assert.equal(q.needsPrice, true);
  assert.equal(q.number, 500123);
});
```

`apps/api/src/services/billing/invoice-rules.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { priceLines } from "../../lib/pricing.js";
import {
  InvoiceError, addDaysIso, computeTotals, hasUnpriced, asRemakeLines, planDraftInvoice, planShopInvoice,
  assertFreshInvoice, planLineEdit, planIssue, planVoid, deriveBalance,
} from "./invoice-rules.js";
import { invoiceErrorReply } from "./invoice-errors.js";

const now = new Date("2026-10-15T15:00:00Z");
const TAX = { taxRateBps: 800 };
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;
const line = (over = {}) => ({
  id: "l1", position: 0, kind: "item", description: "DDSO Nylon", qty: 1, unitCents: 10000, lineCents: 10000,
  taxable: false, priceSource: "client", ...over,
});
const draft = (over = {}) => ({ id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, totalCents: 10000, ...over });

test("tax is charged once, on the taxable non-shipping lines", () => {
  const t = computeTotals([
    line({ unitCents: 1250, qty: 2, taxable: true }),
    line({ unitCents: 1000, taxable: false }),
    line({ kind: "shipping", unitCents: 1200, taxable: true }),
  ], TAX);
  assert.deepEqual(t, { subtotalCents: 3500, taxCents: 200, shippingCents: 1200, totalCents: 4900 });
});

test("computeTotals agrees with the shop's priceLines for the same lines", () => {
  const variants = new Map([
    ["a", { id: "a", name: "Mute", active: true, basePriceCents: 2199, taxable: true }],
    ["b", { id: "b", name: "Case", active: true, basePriceCents: 500, taxable: false }],
  ]);
  const quote = priceLines({
    lines: [{ variantId: "a", qty: 3 }, { variantId: "b", qty: 1 }],
    variants, config: { taxRateBps: 800, shippingFlatCents: 1200, maxQty: 999 },
  });
  const { lines } = planShopInvoice({ invoiceId: "inv", invoiceNumber: 1, labOrderId: "lo", clientUserId: null, quote, now, todayIso: "2026-10-15" });
  const { subtotalCents, taxCents, shippingCents, totalCents } = quote;
  assert.deepEqual(computeTotals(lines, TAX), { subtotalCents, taxCents, shippingCents, totalCents });
});

test("a shop invoice is issued, due the day it was paid, and copies the charged totals", () => {
  const quote = {
    lines: [{ variantId: "a", code: "61", name: "Mute", qty: 1, unitCents: 2199, lineCents: 2199, taxable: true, priceSource: "base" }],
    subtotalCents: 2199, taxCents: 176, shippingCents: 1200, totalCents: 3575,
  };
  const { invoice, lines } = planShopInvoice({ invoiceId: "inv", invoiceNumber: 500002, labOrderId: "lo1", clientUserId: null, quote, now, todayIso: "2026-10-15" });
  assert.equal(invoice.kind, "shop");
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.issuedAt, now);
  assert.equal(invoice.dueDate, "2026-10-15");
  assert.equal(invoice.totalCents, 3575);
  assert.equal(invoice.clientUserId, null);
  assert.deepEqual(lines.map((l) => [l.kind, l.description, l.lineCents, l.priceSource]), [
    ["item", "Mute", 2199, "base"], ["shipping", "Shipping", 1200, "base"],
  ]);
});

test("a lab order's draft prices each line and keeps unpriced ones visible", () => {
  const { invoice, lines } = planDraftInvoice({
    invoiceId: "inv", invoiceNumber: 500003, labOrder: { id: "lo1", clientUserId: "doc1" }, now, taxRateBps: 800,
    pricedLines: [
      { labOrderLineId: "lol1", variantId: "v1", code: "2608", description: "DDSO Nylon", qty: 1, unitCents: 40500, taxable: false, priceSource: "client" },
      { labOrderLineId: "lol2", variantId: null, code: "9999", description: "Unknown code", qty: 1, unitCents: 0, taxable: false, priceSource: "unpriced" },
    ],
  });
  assert.deepEqual([invoice.status, invoice.kind, invoice.labOrderId, invoice.clientUserId, invoice.version], ["draft", "order", "lo1", "doc1", 1]);
  assert.equal(invoice.totalCents, 40500);
  assert.equal(hasUnpriced(lines), true);
  assert.deepEqual(lines.map((l) => [l.position, l.labOrderLineId, l.lineCents]), [[0, "lol1", 40500], [1, "lol2", 0]]);
});

test("a remake's lines are free unless staff edit them", () => {
  const out = asRemakeLines([{ description: "DDSO", qty: 1, unitCents: 40500, priceSource: "client" }]);
  assert.deepEqual(out.map((l) => [l.unitCents, l.priceSource]), [[0, "remake"]]);
});

test("addDaysIso crosses months and leap days, and refuses junk", () => {
  assert.equal(addDaysIso("2026-10-15", 30), "2026-11-14");
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysIso("2026-01-01", -1), "2025-12-31");
  assert.throws(() => addDaysIso("10/15/2026", 1), RangeError);
});

test("a stale version is refused", () => {
  assert.throws(() => assertFreshInvoice(draft(), 1), isCode("STALE"));
  assert.throws(() => assertFreshInvoice(draft(), undefined), isCode("STALE"));
  assert.doesNotThrow(() => assertFreshInvoice(draft(), 2));
});

test("editing: a price override needs a reason, marks the line manual, and keeps the reason out of audit", () => {
  const lines = [line()];
  assert.throws(() => planLineEdit(draft(), lines, { op: "update", lineId: "l1", unitCents: 9000 }, { now, ...TAX }), isCode("REASON_REQUIRED"));
  const plan = planLineEdit(draft(), lines, { op: "update", lineId: "l1", unitCents: 9000, reason: " courtesy discount " }, { now, ...TAX });
  assert.deepEqual(plan.op.update, { id: "l1", values: { unitCents: 9000, priceSource: "manual", priceNote: "courtesy discount", lineCents: 9000 } });
  assert.equal(plan.patch.totalCents, 9000);
  assert.equal(plan.patch.version, 3);
  assert.deepEqual(plan.audit, { op: "update", lineId: "l1", unitCents: 9000, priceOverride: true });
});

test("editing: a quantity change keeps the price source", () => {
  const plan = planLineEdit(draft(), [line()], { op: "update", lineId: "l1", qty: 3 }, { now, ...TAX });
  assert.deepEqual(plan.op.update, { id: "l1", values: { qty: 3, lineCents: 30000 } });
  assert.equal(plan.patch.subtotalCents, 30000);
});

test("editing: free-form lines; only an adjustment may be negative; shipping is never taxed", () => {
  const lines = [line()];
  const ship = planLineEdit(draft(), lines, { op: "add", kind: "shipping", description: "  Shipping ", qty: 1, unitCents: 1500, taxable: true }, { now, ...TAX });
  const ins = ship.op.insert;
  assert.deepEqual([ins.kind, ins.description, ins.position, ins.taxable, ins.priceSource, ins.lineCents], ["shipping", "Shipping", 1, false, "manual", 1500]);
  assert.equal(ship.patch.shippingCents, 1500);
  assert.equal(ship.patch.totalCents, 11500);
  assert.throws(() => planLineEdit(draft(), lines, { op: "add", kind: "fee", description: "Rush", qty: 1, unitCents: -100 }, { now, ...TAX }), isCode("INVALID"));
  assert.throws(() => planLineEdit(draft(), lines, { op: "add", kind: "fee", description: "  ", qty: 1, unitCents: 100 }, { now, ...TAX }), isCode("INVALID"));
  const adj = planLineEdit(draft(), lines, { op: "add", kind: "adjustment", description: "Goodwill", qty: 1, unitCents: -2500 }, { now, ...TAX });
  assert.equal(adj.patch.totalCents, 7500);
});

test("editing: remove, notes, and refusals", () => {
  const lines = [line(), line({ id: "l2", position: 1, unitCents: 500 })];
  const rm = planLineEdit(draft(), lines, { op: "remove", lineId: "l2" }, { now, ...TAX });
  assert.deepEqual(rm.op, { delete: "l2" });
  assert.equal(rm.patch.totalCents, 10000);
  const notes = planLineEdit(draft(), lines, { op: "notes", notes: "  call before shipping " }, { now, ...TAX });
  assert.equal(notes.patch.notes, "call before shipping");
  assert.equal(planLineEdit(draft(), lines, { op: "notes", notes: "   " }, { now, ...TAX }).patch.notes, null);
  assert.throws(() => planLineEdit(draft(), lines, { op: "remove", lineId: "nope" }, { now, ...TAX }), isCode("NOT_FOUND"));
  assert.throws(() => planLineEdit(draft(), lines, { op: "update", lineId: "l1", qty: 1 }, { now, ...TAX }), isCode("INVALID"), "a no-op is refused");
  assert.throws(() => planLineEdit(draft(), lines, { op: "update", lineId: "l1", qty: 1000 }, { now, ...TAX }), isCode("INVALID"));
});

test("an issued or void invoice can't be edited", () => {
  for (const status of ["issued", "void"]) {
    assert.throws(() => planLineEdit(draft({ status }), [line()], { op: "notes", notes: "x" }, { now, ...TAX }), isCode("INVALID_TRANSITION"));
  }
});

test("issue: due = issue date + terms; an unpriced line or a negative total holds it at draft", () => {
  const plan = planIssue(draft(), [line()], { now, termsDays: 30, issueDateIso: "2026-10-15" });
  assert.deepEqual(plan.patch, { status: "issued", issuedAt: now, dueDate: "2026-11-14", version: 3, updatedAt: now });
  assert.throws(
    () => planIssue(draft(), [line({ priceSource: "unpriced", description: "Mystery splint" })], { now, termsDays: 30, issueDateIso: "2026-10-15" }),
    (e) => isCode("INVALID")(e) && /Mystery splint/.test(e.message),
  );
  assert.throws(() => planIssue(draft({ totalCents: -1 }), [line()], { now, termsDays: 30, issueDateIso: "2026-10-15" }), isCode("INVALID"));
  assert.throws(() => planIssue(draft({ status: "issued" }), [line()], { now, termsDays: 30, issueDateIso: "2026-10-15" }), isCode("INVALID_TRANSITION"));
});

test("void: needs a reason; an issued invoice only while net paid is zero", () => {
  assert.throws(() => planVoid(draft(), { paidCents: 0, reason: "  ", now }), isCode("REASON_REQUIRED"));
  assert.equal(planVoid(draft(), { paidCents: 0, reason: "Lab order cancelled", now }).patch.status, "void");
  assert.throws(() => planVoid(draft({ status: "issued" }), { paidCents: 2500, reason: "Wrong client", now }), isCode("INVALID_TRANSITION"));
  const v = planVoid(draft({ status: "issued" }), { paidCents: 0, reason: " Wrong client ", now });
  assert.deepEqual(v.patch, { status: "void", voidedAt: now, voidReason: "Wrong client", version: 3, updatedAt: now });
  assert.throws(() => planVoid(draft({ status: "void" }), { paidCents: 0, reason: "again", now }), isCode("INVALID_TRANSITION"));
});

test("balance = total − (payments + credits − refunds); a void owes nothing; a draft is never paid", () => {
  const issued = { status: "issued", totalCents: 10000 };
  assert.deepEqual(deriveBalance(issued, 0), { paidCents: 0, balanceCents: 10000, paid: false });
  assert.deepEqual(deriveBalance(issued, 6000 + 1500 - 2000), { paidCents: 5500, balanceCents: 4500, paid: false });
  assert.deepEqual(deriveBalance(issued, 10000), { paidCents: 10000, balanceCents: 0, paid: true });
  assert.equal(deriveBalance({ status: "draft", totalCents: 10000 }, 0).paid, false);
  assert.deepEqual(deriveBalance({ status: "void", totalCents: 10000 }, 0), { paidCents: 0, balanceCents: 0, paid: false });
  assert.throws(() => deriveBalance(issued, 12.5), TypeError);
});

test("invoice errors map to the status a screen can act on", () => {
  assert.equal(invoiceErrorReply(new InvoiceError("STALE", "This invoice changed — reload.")).status, 409);
  assert.equal(invoiceErrorReply(new InvoiceError("NOT_FOUND", "x")).status, 404);
  assert.equal(invoiceErrorReply(new InvoiceError("INVALID_TRANSITION", "x")).status, 422);
  assert.equal(invoiceErrorReply(new InvoiceError("OVERPAY", "x")).body.error.code, "OVERPAY");
  assert.equal(invoiceErrorReply(new InvoiceError("LOCKED", "x")).status, 409, "a payment in progress: retry shortly");
  assert.equal(invoiceErrorReply(new Error("boom")), null);
});
```

`apps/api/src/services/billing/aging.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { agingKeyFor, daysPastDue, ageBalances, buildReceivables } from "./aging.js";
import { addDaysIso } from "./invoice-rules.js";

const asOf = "2026-10-15";
const dueDaysAgo = (n) => addDaysIso(asOf, -n);

test("aging buckets at their boundaries: due today, 30, 31, 90, 91 days", () => {
  assert.equal(agingKeyFor(dueDaysAgo(-5), asOf), "current", "not yet due");
  assert.equal(agingKeyFor(dueDaysAgo(0), asOf), "current", "due today");
  assert.equal(agingKeyFor(dueDaysAgo(1), asOf), "d1_30");
  assert.equal(agingKeyFor(dueDaysAgo(30), asOf), "d1_30");
  assert.equal(agingKeyFor(dueDaysAgo(31), asOf), "d31_60");
  assert.equal(agingKeyFor(dueDaysAgo(60), asOf), "d31_60");
  assert.equal(agingKeyFor(dueDaysAgo(61), asOf), "d61_90");
  assert.equal(agingKeyFor(dueDaysAgo(90), asOf), "d61_90");
  assert.equal(agingKeyFor(dueDaysAgo(91), asOf), "d90_plus");
  assert.equal(agingKeyFor(null, asOf), "current", "no due date is never past due");
});

test("days past due count calendar days across a DST change", () => {
  assert.equal(daysPastDue("2026-11-01", "2026-11-02"), 1);
  assert.equal(daysPastDue("2026-03-07", "2026-03-09"), 2);
});

test("ageBalances buckets each open balance and finds the oldest due date", () => {
  const out = ageBalances([
    { dueDate: dueDaysAgo(0), balanceCents: 1000 },
    { dueDate: dueDaysAgo(45), balanceCents: 2500 },
    { dueDate: dueDaysAgo(120), balanceCents: 400 },
    { dueDate: dueDaysAgo(200), balanceCents: 0 },
  ], asOf);
  assert.deepEqual(out.buckets, { current: 1000, d1_30: 0, d31_60: 2500, d61_90: 0, d90_plus: 400 });
  assert.equal(out.totalCents, 3900);
  assert.equal(out.oldestDueDate, dueDaysAgo(120), "a zero balance is not the oldest open item");
});

test("receivables: one row per client with a balance, past-due filter, totals, worst first", () => {
  const open = [
    { clientUserId: "a", dueDate: dueDaysAgo(0), balanceCents: 5000 },
    { clientUserId: "b", dueDate: dueDaysAgo(40), balanceCents: 1000 },
    { clientUserId: "b", dueDate: dueDaysAgo(2), balanceCents: 500 },
    { clientUserId: "c", dueDate: dueDaysAgo(10), balanceCents: 0 },
    { clientUserId: null, dueDate: dueDaysAgo(99), balanceCents: 999 },
  ];
  const clients = new Map([["a", { name: "Dr A", practice: "A Dental" }], ["b", { name: "Dr B", practice: null }]]);
  const all = buildReceivables(open, clients, asOf);
  assert.deepEqual(all.rows.map((r) => [r.clientUserId, r.balanceCents, r.pastDueCents]), [["b", 1500, 1500], ["a", 5000, 0]]);
  assert.equal(all.rows[0].oldestDueDate, dueDaysAgo(40));
  assert.deepEqual(all.totals.buckets, { current: 5000, d1_30: 500, d31_60: 1000, d61_90: 0, d90_plus: 0 });
  assert.equal(all.totals.balanceCents, 6500);
  const pastDue = buildReceivables(open, clients, asOf, { pastDueOnly: true });
  assert.deepEqual(pastDue.rows.map((r) => r.clientUserId), ["b"]);
  assert.equal(pastDue.totals.balanceCents, 1500, "totals follow the filter");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @my-app/shared exec vitest run src/billing src/schemas/billing.schema.test.js && cd apps/api && pnpm vitest run src/services/billing`
Expected: FAIL. None of the modules exist.

- [ ] **Step 3: Implement the shared vocabulary and schemas**

`packages/shared/src/billing/billing.js`:

```js
/**
 * Billing vocabulary shared by the API and the web: invoice states and kinds,
 * line kinds, price sources, manual payment methods, aging buckets and the
 * one status label a person sees. Rules (totals, transitions, balances) live
 * in apps/api/src/services/billing/invoice-rules.js.
 */
export const INVOICE_STATUSES = ["draft", "issued", "void"];
export const INVOICE_KINDS = ["order", "shop", "legacy"];
export const INVOICE_LINE_KINDS = ["item", "shipping", "fee", "adjustment"];
export const PRICE_SOURCES = ["client", "base", "manual", "remake", "unpriced"];

export const LINE_KIND_LABELS = { item: "Item", shipping: "Shipping", fee: "Fee", adjustment: "Adjustment" };
export const PRICE_SOURCE_LABELS = {
  client: "Client price", base: "Base price", manual: "Manual", remake: "Remake (no charge)", unpriced: "Needs a price",
};

export const MANUAL_PAYMENT_METHODS = ["check", "cash", "ach", "other"];
export const MANUAL_PAYMENT_LABELS = { check: "Check", cash: "Cash", ach: "ACH", other: "Other" };
/** A manual payment's ledger source: admin_check | admin_cash | admin_ach | admin_other. */
export const manualPaymentSource = (method) => `admin_${method}`;

/** A staff credit / write-off: allocated like a payment, never sent to a card processor. */
export const CREDIT_SOURCE = "credit";
/** The ledger row that pays a shop invoice at checkout. */
export const SHOP_PAYMENT_SOURCE = "shop_card";

export const AGING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
];

/**
 * What a person sees for an invoice. Due dates are "YYYY-MM-DD", so string
 * order is date order; due today is not yet past due.
 */
export function invoiceStatusLabel({ status, balanceCents, dueDate }, todayIso) {
  if (status === "draft") return "Draft";
  if (status === "void") return "Void";
  if (balanceCents <= 0) return "Paid";
  if (dueDate && dueDate < todayIso) return "Past due";
  return "Open";
}
```

`packages/shared/src/schemas/billing.schema.js`:

```js
import { z } from "zod";
import { INVOICE_STATUSES, INVOICE_LINE_KINDS, MANUAL_PAYMENT_METHODS } from "../billing/billing.js";

const id = z.string().min(1).max(128);
const version = z.number().int().positive();
const cents = z.number().int().min(-10_000_000).max(10_000_000);
const positiveCents = z.number().int().positive().max(10_000_000);
const reason = z.string().trim().min(1, "Say why.").max(500);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");

export const invoiceListQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  needsPrice: flag,
  clientUserId: id.optional(),
  number: z.coerce.number().int().positive().optional(),
});

// The rules (reason required for a price change, negatives only on an
// adjustment, nothing-to-change) live in invoice-rules.js planLineEdit.
export const invoiceEditSchema = z.object({
  expectedVersion: version,
  edit: z.discriminatedUnion("op", [
    z.object({
      op: z.literal("update"), lineId: id,
      qty: z.number().int().min(1).max(999).optional(),
      unitCents: cents.optional(),
      reason: z.string().trim().max(500).optional(),
    }),
    z.object({
      op: z.literal("add"), kind: z.enum(INVOICE_LINE_KINDS),
      description: z.string().trim().min(1).max(200),
      qty: z.number().int().min(1).max(999),
      unitCents: cents,
      taxable: z.boolean().default(false),
    }),
    z.object({ op: z.literal("remove"), lineId: id }),
    z.object({ op: z.literal("notes"), notes: z.string().max(5000).nullable() }),
  ]),
});

export const invoiceIssueSchema = z.object({ expectedVersion: version });
export const invoiceVoidSchema = z.object({ expectedVersion: version, reason });
export const invoiceCreditSchema = z.object({ amountCents: positiveCents, reason });

export const manualPaymentSchema = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional(),
  amountCents: positiveCents,
  paidOn: isoDate,
  // Omit to apply oldest-first.
  allocations: z.array(z.object({ invoiceId: id, amountCents: positiveCents })).min(1).max(200).optional(),
}).refine(
  (p) => !p.allocations || p.allocations.reduce((s, a) => s + a.amountCents, 0) === p.amountCents,
  { message: "Allocations must add up to the payment.", path: ["allocations"] },
);

export const statementQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.") });
export const receivablesQuerySchema = z.object({ pastDueOnly: flag });
export const clientInvoicesQuerySchema = z.object({ open: flag });
```

`packages/shared/src/index.js`. Append:

```js
// Billing
export * from "./billing/billing.js";
export * from "./schemas/billing.schema.js";
```

- [ ] **Step 4: Implement the invoice rules, aging and error mapping**

`apps/api/src/services/billing/invoice-rules.js`:

```js
import { INVOICE_LINE_KINDS } from "@my-app/shared";
import { assertCents, formatCents, mulCents, pctOfCents, sumCents } from "../../lib/money.js";

/**
 * Pure invoice rules: totals, the draft → issued → void lifecycle, draft edit
 * planning and the balance rule. No DB and no clock (callers pass ids and
 * `now`), so every rule is unit-tested here and invoices.service.js only runs
 * the plans inside transactions.
 */

export class InvoiceError extends Error {
  /**
   * @param {"NOT_FOUND"|"STALE"|"LOCKED"|"INVALID"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"OVERPAY"} code
   * @param {string} message  safe to show staff
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "InvoiceError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const MAX_QTY = 999;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" plus n calendar days (date arithmetic in UTC, so no DST drift). */
export function addDaysIso(iso, days) {
  const m = ISO.exec(iso ?? "");
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

export const lineCentsOf = (l) => mulCents(l.unitCents, l.qty);

/**
 * Totals from lines: the one formula, the same one lib/pricing.js priceLines
 * uses for the shop. Tax once, on the taxable non-shipping lines; shipping is
 * the shipping lines; total = subtotal + tax + shipping.
 */
export function computeTotals(lines, { taxRateBps }) {
  const priced = lines.map((l) => ({ kind: l.kind ?? "item", taxable: Boolean(l.taxable), cents: lineCentsOf(l) }));
  const goods = priced.filter((l) => l.kind !== "shipping");
  const subtotalCents = sumCents(goods.map((l) => l.cents));
  const shippingCents = sumCents(priced.filter((l) => l.kind === "shipping").map((l) => l.cents));
  const taxCents = pctOfCents(sumCents(goods.filter((l) => l.taxable).map((l) => l.cents)), taxRateBps);
  return { subtotalCents, taxCents, shippingCents, totalCents: subtotalCents + taxCents + shippingCents };
}

export const hasUnpriced = (lines) => lines.some((l) => l.priceSource === "unpriced");

/** Remakes are free unless staff edit the draft: same lines, zero price. */
export const asRemakeLines = (pricedLines) => pricedLines.map((l) => ({ ...l, unitCents: 0, priceSource: "remake" }));

function newInvoice({ invoiceId, invoiceNumber, kind, clientUserId, labOrderId, now }) {
  return {
    id: invoiceId, invoiceNumber, kind, clientUserId: clientUserId ?? null, labOrderId: labOrderId ?? null,
    legacySeazonaInvoiceId: null, status: "draft", version: 1, issuedAt: null, dueDate: null, voidedAt: null, voidReason: null,
    subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0, notes: null, createdAt: now, updatedAt: now,
  };
}

function lineRow(invoiceId, position, l) {
  return {
    invoiceId, position, kind: l.kind ?? "item", variantId: l.variantId ?? null, code: l.code ?? null,
    description: l.description, qty: l.qty, unitCents: l.unitCents, lineCents: lineCentsOf(l),
    taxable: (l.kind ?? "item") === "shipping" ? false : Boolean(l.taxable),
    priceSource: l.priceSource, priceNote: null, labOrderLineId: l.labOrderLineId ?? null,
  };
}

/** A lab order → its draft invoice, one line per priced lab order line. */
export function planDraftInvoice({ invoiceId, invoiceNumber, labOrder, pricedLines, now, taxRateBps }) {
  const lines = pricedLines.map((l, i) => lineRow(invoiceId, i, l));
  const invoice = {
    ...newInvoice({ invoiceId, invoiceNumber, kind: "order", clientUserId: labOrder.clientUserId, labOrderId: labOrder.id, now }),
    ...computeTotals(lines, { taxRateBps }),
  };
  return { invoice, lines };
}

/**
 * A paid shop order → its invoice: issued, and due the day it was paid. Lines
 * and totals are COPIED from the checkout quote the card was charged for,
 * never recomputed, so the invoice always equals the charge.
 */
export function planShopInvoice({ invoiceId, invoiceNumber, labOrderId, clientUserId, quote, now, todayIso }) {
  const items = quote.lines.map((l) => ({
    kind: "item", variantId: l.variantId ?? null, code: l.code ?? null, description: l.name,
    qty: l.qty, unitCents: l.unitCents, taxable: l.taxable, priceSource: l.priceSource,
  }));
  if (quote.shippingCents > 0) {
    items.push({ kind: "shipping", description: "Shipping", qty: 1, unitCents: quote.shippingCents, taxable: false, priceSource: "base" });
  }
  const invoice = {
    ...newInvoice({ invoiceId, invoiceNumber, kind: "shop", clientUserId, labOrderId, now }),
    status: "issued", issuedAt: now, dueDate: todayIso,
    subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, shippingCents: quote.shippingCents, totalCents: quote.totalCents,
  };
  return { invoice, lines: items.map((l, i) => lineRow(invoiceId, i, l)) };
}

/** The editor must have seen the version it is changing (optimistic concurrency, as on lab orders). */
export function assertFreshInvoice(invoice, expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion !== invoice.version) {
    throw new InvoiceError("STALE", "This invoice changed — reload.");
  }
}

function assertDraft(invoice) {
  if (invoice.status === "draft") return;
  const why = invoice.status === "issued"
    ? "issued invoices can't change; use a credit, or void it."
    : "it can't change.";
  throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} is ${invoice.status} — ${why}`);
}

const trimmed = (s) => (typeof s === "string" ? s.trim() : "");
const bump = (invoice, now) => ({ version: invoice.version + 1, updatedAt: now });

function checkQty(qty) {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new InvoiceError("INVALID", `Quantity must be a whole number from 1 to ${MAX_QTY}.`);
}

function checkSign(kind, unitCents) {
  assertCents(unitCents, "unitCents");
  if (unitCents < 0 && kind !== "adjustment") throw new InvoiceError("INVALID", "Only an adjustment line can be negative.");
}

/**
 * One draft edit → the line operation, the invoice patch (totals recomputed
 * from the resulting lines, version bumped) and audit metadata. Totals are
 * never set directly. A price override needs a reason; the reason is kept on
 * the line (encrypted) and never copied into audit metadata.
 */
export function planLineEdit(invoice, lines, edit, { now, taxRateBps }) {
  assertDraft(invoice);
  if (edit.op === "notes") {
    return { op: {}, patch: { notes: trimmed(edit.notes) || null, ...bump(invoice, now) }, audit: { op: "notes" } };
  }

  let op;
  let after;
  let audit;
  if (edit.op === "add") {
    if (!INVOICE_LINE_KINDS.includes(edit.kind)) throw new InvoiceError("INVALID", `Unknown line kind: ${edit.kind}`);
    const description = trimmed(edit.description);
    if (!description) throw new InvoiceError("INVALID", "A line needs a description.");
    checkQty(edit.qty);
    checkSign(edit.kind, edit.unitCents);
    const position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
    const line = lineRow(invoice.id, position, {
      kind: edit.kind, description, qty: edit.qty, unitCents: edit.unitCents, taxable: edit.taxable, priceSource: "manual",
    });
    op = { insert: line };
    after = [...lines, line];
    audit = { op: "add", kind: edit.kind, qty: edit.qty, unitCents: edit.unitCents };
  } else {
    const line = lines.find((l) => l.id === edit.lineId);
    if (!line) throw new InvoiceError("NOT_FOUND", "That line isn't on this invoice.");
    if (edit.op === "remove") {
      op = { delete: line.id };
      after = lines.filter((l) => l !== line);
      audit = { op: "remove", lineId: line.id };
    } else if (edit.op === "update") {
      const values = {};
      if (edit.qty !== undefined && edit.qty !== line.qty) {
        checkQty(edit.qty);
        values.qty = edit.qty;
      }
      if (edit.unitCents !== undefined && edit.unitCents !== line.unitCents) {
        checkSign(line.kind, edit.unitCents);
        const reason = trimmed(edit.reason);
        if (!reason) throw new InvoiceError("REASON_REQUIRED", "Say why the price is being changed.");
        Object.assign(values, { unitCents: edit.unitCents, priceSource: "manual", priceNote: reason });
      }
      if (Object.keys(values).length === 0) throw new InvoiceError("INVALID", "Nothing to change.");
      const updated = { ...line, ...values };
      values.lineCents = lineCentsOf(updated);
      updated.lineCents = values.lineCents;
      op = { update: { id: line.id, values } };
      after = lines.map((l) => (l === line ? updated : l));
      audit = {
        op: "update", lineId: line.id,
        ...(values.qty !== undefined ? { qty: values.qty } : {}),
        ...(values.unitCents !== undefined ? { unitCents: values.unitCents, priceOverride: true } : {}),
      };
    } else {
      throw new InvoiceError("INVALID", `Unknown edit: ${edit.op}`);
    }
  }
  return { op, patch: { ...computeTotals(after, { taxRateBps }), ...bump(invoice, now) }, audit };
}

/** Issue a draft: due = the lab-local issue date + net terms. An unpriced line holds it. */
export function planIssue(invoice, lines, { now, termsDays, issueDateIso }) {
  assertDraft(invoice);
  const unpriced = lines.find((l) => l.priceSource === "unpriced");
  if (unpriced) throw new InvoiceError("INVALID", `“${unpriced.description}” still needs a price.`);
  if (invoice.totalCents < 0) throw new InvoiceError("INVALID", "An invoice can't be issued for less than $0.00.");
  return { patch: { status: "issued", issuedAt: now, dueDate: addDaysIso(issueDateIso, termsDays), ...bump(invoice, now) } };
}

/**
 * Void with a reason. A draft can always be voided (its lab order was
 * cancelled). An issued invoice only while its net paid is zero: once money
 * has been applied, the correction is a refund or a credit. A void keeps its number.
 */
export function planVoid(invoice, { paidCents, reason, now }) {
  if (invoice.status === "void") throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} is already void.`);
  const why = trimmed(reason);
  if (!why) throw new InvoiceError("REASON_REQUIRED", "Say why this invoice is being voided.");
  if (invoice.status === "issued" && paidCents !== 0) {
    throw new InvoiceError(
      "INVALID_TRANSITION",
      `Invoice #${invoice.invoiceNumber} has ${formatCents(paidCents)} applied. Refund or credit it instead of voiding.`,
    );
  }
  return { patch: { status: "void", voidedAt: now, voidReason: why, ...bump(invoice, now) } };
}

/**
 * THE balance rule. paidCents = the sum of the invoice's ledger rows (payments
 * and credits positive, refunds negative). A void owes nothing; "paid" means an
 * issued invoice with nothing left to pay.
 */
export function deriveBalance(invoice, paidCents = 0) {
  assertCents(paidCents, "paidCents");
  if (invoice.status === "void") return { paidCents, balanceCents: 0, paid: false };
  const balanceCents = invoice.totalCents - paidCents;
  return { paidCents, balanceCents, paid: invoice.status === "issued" && balanceCents <= 0 };
}
```

`apps/api/src/services/billing/invoice-errors.js`:

```js
import { InvoiceError } from "./invoice-rules.js";

const STATUS = { NOT_FOUND: 404, STALE: 409, LOCKED: 409, INVALID: 422, INVALID_TRANSITION: 422, REASON_REQUIRED: 422, OVERPAY: 422 };

/** InvoiceError → HTTP reply ({ status, body }); anything else is not ours to swallow (null). */
export function invoiceErrorReply(err) {
  if (!(err instanceof InvoiceError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}
```

`apps/api/src/services/billing/aging.js`:

```js
import { AGING_BUCKETS } from "@my-app/shared";

/**
 * Aging: how far past due each open balance is, in the five buckets the
 * statement and the AR page print. Pure; dates are lab-local "YYYY-MM-DD".
 */
export const AGING_KEYS = AGING_BUCKETS.map((b) => b.key);

const DAY_MS = 86_400_000;
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** Calendar days from the due date to asOf (0 = due today; negative = not yet due). */
export function daysPastDue(dueDate, asOfIso) {
  if (!dueDate) return 0;
  return Math.round(dayNumber(asOfIso) - dayNumber(dueDate));
}

export function agingKeyFor(dueDate, asOfIso) {
  const d = daysPastDue(dueDate, asOfIso);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

const emptyBuckets = () => Object.fromEntries(AGING_KEYS.map((k) => [k, 0]));

/** @param {Array<{ dueDate: string|null, balanceCents: number }>} items */
export function ageBalances(items, asOfIso) {
  const buckets = emptyBuckets();
  let totalCents = 0;
  let oldestDueDate = null;
  for (const it of items) {
    if (!it.balanceCents) continue;
    buckets[agingKeyFor(it.dueDate, asOfIso)] += it.balanceCents;
    totalCents += it.balanceCents;
    if (it.balanceCents > 0 && it.dueDate && (!oldestDueDate || it.dueDate < oldestDueDate)) oldestDueDate = it.dueDate;
  }
  return { buckets, totalCents, oldestDueDate };
}

/**
 * Admin › Accounts receivable: one row per client with a balance (worst past
 * due first), plus a totals row that follows the filter. Guest invoices
 * (no client) never appear.
 *
 * @param {Array<{ clientUserId: string|null, dueDate: string|null, balanceCents: number }>} openInvoices
 * @param {Map<string, { name?: string, practice?: string, accountNumber?: string }>} clientsById
 */
export function buildReceivables(openInvoices, clientsById, asOfIso, { pastDueOnly = false } = {}) {
  const byClient = new Map();
  for (const inv of openInvoices) {
    if (!inv.clientUserId) continue;
    if (!byClient.has(inv.clientUserId)) byClient.set(inv.clientUserId, []);
    byClient.get(inv.clientUserId).push(inv);
  }
  const rows = [];
  for (const [clientUserId, items] of byClient) {
    const aged = ageBalances(items, asOfIso);
    if (aged.totalCents <= 0) continue;
    const pastDueCents = aged.totalCents - aged.buckets.current;
    if (pastDueOnly && pastDueCents <= 0) continue;
    const c = clientsById.get(clientUserId) ?? {};
    rows.push({
      clientUserId, name: c.name ?? null, practice: c.practice ?? null, accountNumber: c.accountNumber ?? null,
      balanceCents: aged.totalCents, pastDueCents, buckets: aged.buckets, oldestDueDate: aged.oldestDueDate,
      openInvoices: items.filter((i) => i.balanceCents > 0).length,
    });
  }
  rows.sort((a, b) => b.pastDueCents - a.pastDueCents || b.balanceCents - a.balanceCents
    || String(a.practice ?? a.name ?? "").localeCompare(String(b.practice ?? b.name ?? "")));
  const totals = { balanceCents: 0, pastDueCents: 0, buckets: emptyBuckets() };
  for (const r of rows) {
    totals.balanceCents += r.balanceCents;
    totals.pastDueCents += r.pastDueCents;
    for (const k of AGING_KEYS) totals.buckets[k] += r.buckets[k];
  }
  return { rows, totals, asOf: asOfIso };
}
```

- [ ] **Step 5: Run the tests and the suite**

```bash
pnpm --filter @my-app/shared exec vitest run src/billing src/schemas/billing.schema.test.js   # PASS
(cd apps/api && pnpm vitest run src/services/billing)                                          # PASS
pnpm test && pnpm --filter @my-app/web build
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src apps/api/src/services/billing
git commit -m "feat(billing): pure invoice rules, aging and shared billing vocabulary

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 5: Lab-line pricing, invoices service, lab-order hooks (release, remake, shop, ship, cancel)

**Files:**
- Create: `apps/api/src/test/fake-tx.js`, `apps/api/src/lib/crypto.field-sealer.test.js`, `apps/api/src/services/billing/invoice-crypto.js`, `apps/api/src/services/billing/invoices.service.js`, `apps/api/src/services/billing/invoices.service.test.js`
- Modify: `apps/api/src/lib/crypto.js`, `apps/api/src/lib/pricing.js`, `apps/api/src/lib/pricing.test.js`, `apps/api/src/services/pricing.service.js`, `apps/api/src/services/lab/lab-orders.service.js`, `apps/api/src/services/lab/lab-orders.service.test.js`, `apps/api/src/routes/checkout.routes.js` (`recordGuestOrder`), `apps/api/src/routes/__tests__/rx-release.test.js`

**Interfaces:**
- Consumes:
  - Task 2: `allocateSequenceNumber`.
  - Task 3: `invoices`, `invoiceLines`, `invoicePayments`, `auditService.log(entry, tx)`, `env.INVOICE_NUMBER_START`, `env.INVOICE_TERMS_DAYS`.
  - Task 4: `planDraftInvoice`, `planShopInvoice`, `asRemakeLines`, `hasUnpriced`, `planIssue`, `planVoid`.
- Produces:
  - `lib/crypto.js` `fieldSealer(fields) → { seal(values), open(row) }`.
  - `services/billing/invoice-crypto.js`: `sealInvoice`, `openInvoice`, `sealLine`, `openLine`, `sealLedgerRow`, `openLedgerRow`.
  - `lib/pricing.js` `priceLabLines({ lines, variants, clientPrices }) → [{ labOrderLineId, variantId, code, description, qty, unitCents, taxable, priceSource }]`. Note-only lines are dropped; a line with no variant or price gets `unitCents 0, priceSource "unpriced"`.
  - `pricing.service.js`: `loadVariantsById(ids, database)`, `loadClientPrices(clientUserId, ids, database)` (new optional `database`), `priceLabOrderLines(lines, clientUserId, database)`.
  - `services/billing/invoices.service.js`:
    - `INVOICE_NUMBER_LOCK = 7300422`, `allocateInvoiceNumber(tx)`;
    - `auditInvoice(tx, action, invoice, byUserId, metadata)`, `loadLines(tx, invoiceId)`;
    - `createDraftForLabOrder(tx, { labOrder, lines, byUserId }) → { id, invoiceNumber }`;
    - `createShopInvoice(tx, { labOrderId, clientUserId, quote, transactionId }) → { id, invoiceNumber }`;
    - `issueForShippedLabOrder(tx, { labOrderId, shippedAt, byUserId }) → { issued, reason?, dueDate? }`;
    - `voidForCancelledLabOrder(tx, { labOrderId, byUserId }) → { voided }`.
  - `lab-orders.service.js`:
    - `createShopLabOrder(tx, { orderId, clientUserId, quote, transactionId })` (was `quoteLines`);
    - `billingFollowUp(to, byUserId) → ((tx, order) => Promise<void>) | undefined`;
    - `releaseRxCase` also returns `invoice`.
  - `test/fake-tx.js`: `fakeTx({ selects, updates }) → tx` with `.log`; `fakeDb(tx)`.

- [ ] **Step 1: Extract the recording fake so service tests share one**

`apps/api/src/test/fake-tx.js`:

```js
/**
 * A recording fake of drizzle's transaction surface for service tests (the
 * repo has no DB harness). Every awaited select/update chain pops the next
 * queued result (an array; [] when the queue runs dry); inserts record their
 * values; `transaction(fn)` runs fn against the same fake, as a savepoint
 * would in production. `log` is the ordered list of operations.
 */
export function fakeTx({ selects = [], updates = [] } = {}) {
  const log = [];
  const chain = (queue, record) => {
    const b = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve(queue ? queue.shift() ?? [] : undefined).then(res, rej);
        return (...args) => { if (record) record(prop, args); return b; };
      },
    });
    return b;
  };
  const tx = {
    log,
    execute: async (q) => { log.push({ op: "execute", q }); return q; },
    select: () => { log.push({ op: "select" }); return chain(selects); },
    selectDistinct: () => { log.push({ op: "select" }); return chain(selects); },
    update: () => {
      const entry = { op: "update" };
      log.push(entry);
      return chain(updates, (m, a) => { if (m === "set") { entry.values = a[0]; log.push({ op: "set", values: a[0] }); } });
    },
    insert: () => {
      const entry = { op: "insert" };
      log.push(entry);
      return chain(null, (m, a) => { if (m === "values") entry.values = a[0]; });
    },
    delete: () => { log.push({ op: "delete" }); return chain(null); },
    transaction: (fn) => fn(tx),
  };
  return tx;
}

export const fakeDb = (tx) => ({ transaction: (fn) => fn(tx) });
```

In `apps/api/src/services/lab/lab-orders.service.test.js`:
- delete the local `fakeTx` function and the local `fakeDb` const (the block under `// ── Behaviour, against a recording fake …`);
- add `const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");` after the other imports.

Every existing test keeps working: the shared fake logs the same `update`, `set`, `insert` and `execute` entries.

- [ ] **Step 2: Write the failing tests**

`apps/api/src/lib/crypto.field-sealer.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { fieldSealer, decryptField } = await import("./crypto.js");

test("fieldSealer encrypts only its fields, skips null and absent ones, and opens them back", () => {
  const { seal, open } = fieldSealer(["notes", "reason"]);
  const sealed = seal({ id: "x", notes: "Jane Doe's case", reason: null, total: 5 });
  assert.notEqual(sealed.notes, "Jane Doe's case");
  assert.equal(decryptField(sealed.notes), "Jane Doe's case");
  assert.equal(sealed.reason, null);
  assert.equal(sealed.total, 5);
  assert.ok(!("other" in seal({ id: "x" })));
  assert.deepEqual(open(sealed), { id: "x", notes: "Jane Doe's case", reason: null, total: 5 });
});
```

Append to `apps/api/src/lib/pricing.test.js`:

```js
import { priceLabLines } from "./pricing.js";

test("lab lines: client price, else base; unknown or unpriced variants are flagged, never refused", () => {
  const variants = new Map([
    ["v1", { id: "v1", basePriceCents: 45000, taxable: false, active: true }],
    ["v2", { id: "v2", basePriceCents: null, taxable: true, active: true }],
    ["v3", { id: "v3", basePriceCents: 1200, taxable: true, active: false }],
  ]);
  const out = priceLabLines({
    lines: [
      { id: "a", variantId: "v1", code: "2608", name: "DDSO Nylon", qty: 1, noteOnly: false },
      { id: "b", variantId: "v2", code: "2700", name: "No price yet", qty: 2, noteOnly: false },
      { id: "c", variantId: null, code: "9999", name: "Unknown code", qty: 1, noteOnly: false },
      { id: "d", variantId: "v3", code: "61", name: "Retired item", qty: 1, noteOnly: false },
      { id: "e", variantId: null, code: null, name: "Bite in CR", qty: 1, noteOnly: true },
    ],
    variants,
    clientPrices: new Map([["v1", 40500]]),
  });
  assert.deepEqual(out.map((l) => [l.labOrderLineId, l.unitCents, l.priceSource, l.qty, l.taxable]), [
    ["a", 40500, "client", 1, false],
    ["b", 0, "unpriced", 2, true],
    ["c", 0, "unpriced", 1, false],
    ["d", 1200, "base", 1, true],
  ]);
  assert.equal(out[0].description, "DDSO Nylon");
});
```

(If `pricing.test.js` already imports from `./pricing.js` at the top, add `priceLabLines` to that import instead of a second import line.)

`apps/api/src/services/billing/invoices.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { fakeTx } = await import("../../test/fake-tx.js");
const mod = await import("./invoices.service.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(fileURLToPath(new URL("./invoices.service.js", import.meta.url)), "utf8");
const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);

const labLines = [
  { id: "lol1", variantId: "v1", code: "2608", name: "DDSO Nylon", qty: 1, noteOnly: false },
  { id: "lol2", variantId: null, code: "9999", name: "Mystery", qty: 1, noteOnly: false },
  { id: "lol3", variantId: null, code: null, name: "Bite in CR", qty: 1, noteOnly: true },
];

test("a released lab order gets a draft invoice priced from the client's prices", async () => {
  const tx = fakeTx({ selects: [
    [{ id: "v1", basePriceCents: 45000, taxable: false }], // variants
    [{ variantId: "v1", priceCents: 40500 }], // client prices
    [{ max: 500010 }], // invoice number
  ] });
  const out = await mod.createDraftForLabOrder(tx, { labOrder: { id: "lo1", clientUserId: "doc1", isRemake: false }, lines: labLines, byUserId: "staff1" });
  assert.equal(out.invoiceNumber, 500011);
  const [invoice, lines, audit] = inserts(tx);
  assert.deepEqual([invoice.status, invoice.kind, invoice.clientUserId, invoice.labOrderId, invoice.totalCents], ["draft", "order", "doc1", "lo1", 40500]);
  assert.deepEqual(lines.map((l) => [l.labOrderLineId, l.unitCents, l.priceSource]), [["lol1", 40500, "client"], ["lol2", 0, "unpriced"]]);
  assert.equal(audit.action, "invoice.drafted");
  assert.deepEqual(audit.metadata, { invoiceNumber: 500011, labOrderId: "lo1", unpriced: true });
  const ops = tx.log.map((l) => l.op);
  assert.ok(ops.indexOf("execute") < ops.lastIndexOf("select"), "number allocated under the advisory lock");
});

test("a remake's draft copies the lines at no charge", async () => {
  const tx = fakeTx({ selects: [[{ id: "v1", basePriceCents: 45000, taxable: false }], [], [{ max: null }]] });
  await mod.createDraftForLabOrder(tx, { labOrder: { id: "lo2", clientUserId: "doc1", isRemake: true }, lines: labLines.slice(0, 1) });
  const [invoice, lines] = inserts(tx);
  assert.equal(invoice.totalCents, 0);
  assert.equal(invoice.invoiceNumber, 500000);
  assert.deepEqual(lines.map((l) => [l.unitCents, l.priceSource]), [[0, "remake"]]);
});

test("a paid shop order gets an issued invoice, paid in full by one shop_card ledger row", async () => {
  const tx = fakeTx({ selects: [[{ max: null }]] });
  const quote = {
    lines: [{ variantId: "v1", code: "61", name: "Mute", qty: 2, unitCents: 2199, lineCents: 4398, taxable: true, priceSource: "base" }],
    subtotalCents: 4398, taxCents: 352, shippingCents: 1200, totalCents: 5950,
  };
  await mod.createShopInvoice(tx, { labOrderId: "lo9", clientUserId: null, quote, transactionId: "60123" });
  const [invoice, lines, ledger, audit] = inserts(tx);
  assert.deepEqual([invoice.kind, invoice.status, invoice.totalCents, invoice.clientUserId], ["shop", "issued", 5950, null]);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    [ledger.userId, ledger.invoiceId, ledger.appliedCents, ledger.source, ledger.transactionId],
    [null, invoice.id, 5950, "shop_card", "60123"],
  );
  assert.equal(audit.action, "invoice.issued");
});

const draftRow = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 1, totalCents: 40500, notes: null, voidReason: null };

test("shipping issues a priced draft, due on the lab-local ship date plus terms", async () => {
  const tx = fakeTx({ selects: [[draftRow], [{ id: "l1", description: "DDSO", priceSource: "client", priceNote: null }]] });
  // 03:00 UTC on Oct 16 is still Oct 15 in Chicago.
  const out = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date("2026-10-16T03:00:00Z"), byUserId: "tech1" });
  assert.deepEqual(out, { issued: true, dueDate: "2026-11-14" });
  const set = tx.log.find((l) => l.op === "set").values;
  assert.deepEqual([set.status, set.dueDate, set.version], ["issued", "2026-11-14", 2]);
  assert.equal(inserts(tx).at(-1).action, "invoice.issued");
});

test("an unpriced line holds the invoice at draft; the ship is not affected", async () => {
  const tx = fakeTx({ selects: [[draftRow], [{ id: "l1", description: "Mystery", priceSource: "unpriced", priceNote: null }]] });
  const out = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date(), byUserId: "tech1" });
  assert.deepEqual(out, { issued: false, reason: "unpriced" });
  assert.equal(tx.log.filter((l) => l.op === "set").length, 0);
  assert.equal(inserts(tx).at(-1).action, "invoice.issue_held");
});

test("an already-issued invoice is left alone on ship", async () => {
  const tx = fakeTx({ selects: [[{ ...draftRow, status: "issued" }]] });
  assert.deepEqual(await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date() }), { issued: false, reason: "issued" });
});

test("a lab order released before invoicing existed is drafted on ship, then issued", async () => {
  const tx = fakeTx({ selects: [
    [], // no invoice yet
    [{ id: "lo1", source: "rx_case", clientUserId: "doc1", isRemake: false }],
    [labLines[0]],
    [{ id: "v1", basePriceCents: 45000, taxable: false }],
    [],
    [{ max: null }],
    [draftRow],
    [{ id: "l1", description: "DDSO", priceSource: "base", priceNote: null }],
  ] });
  const out = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date("2026-10-15T15:00:00Z") });
  assert.equal(out.issued, true);
  assert.equal(inserts(tx)[0].status, "draft");
});

test("cancelling voids a draft with a sealed reason; an issued invoice is not touched", async () => {
  const tx = fakeTx({ selects: [[draftRow]] });
  assert.deepEqual(await mod.voidForCancelledLabOrder(tx, { labOrderId: "lo1", byUserId: "tech1" }), { voided: true });
  const set = tx.log.find((l) => l.op === "set").values;
  assert.equal(set.status, "void");
  assert.equal(decryptField(set.voidReason), "Lab order cancelled");
  const issued = fakeTx({ selects: [[{ ...draftRow, status: "issued" }]] });
  assert.deepEqual(await mod.voidForCancelledLabOrder(issued, { labOrderId: "lo1" }), { voided: false });
});

test("everything runs on the caller's transaction and locks the invoice row; nothing talks to Seazona", () => {
  assert.doesNotMatch(source, /\bdb\./, "use the transaction passed in");
  assert.match(source, /\.for\("update"\)/);
  assert.doesNotMatch(source, /seazona/i);
  assert.equal(mod.INVOICE_NUMBER_LOCK, 7300422);
});
```

In `apps/api/src/services/lab/lab-orders.service.test.js`, delete the test `"createShopLabOrder: the order number is allocated under the lock and every event note is sealed"` (it uses the old `quoteLines` signature; the first test below replaces it) and append:

```js
test("createShopLabOrder: the job and its paid shop invoice are written in one transaction", async () => {
  const tx = fakeTx({ selects: [[{ max: null }], [{ max: null }]] });
  const quote = {
    lines: [{ variantId: "v1", code: "61", name: "Kit", qty: 1, unitCents: 500, lineCents: 500, taxable: false, priceSource: "base" }],
    subtotalCents: 500, taxCents: 0, shippingCents: 1200, totalCents: 1700,
  };
  await mod.createShopLabOrder(tx, { orderId: "o1", clientUserId: null, quote, transactionId: "t1" });
  const ins = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  assert.equal(ins.length, 7, "lab order, lines, events, invoice, invoice lines, ledger row, audit");
  for (const e of [].concat(ins[2])) assert.ok(e.note == null || decryptField(e.note) !== e.note, "event notes sealed");
  assert.equal(ins[5].source, "shop_card");
  assert.equal(ins[5].appliedCents, 1700);
});

test("mutate runs the plan's follow-up inside the transaction, with the updated order", async () => {
  const seen = [];
  const tx = fakeTx({ selects: [[baseRow]], updates: [[{ ...baseRow, version: 4, status: "shipped" }]] });
  const plan = () => ({
    patch: { status: "shipped", version: 4 },
    event: { labOrderId: "lo-1", type: "status", note: null, at: new Date() },
    after: async (t, order) => { seen.push([t === tx, order.status, order.version]); },
  });
  await mod.mutate("lo-1", 3, plan, fakeDb(tx));
  assert.deepEqual(seen, [[true, "shipped", 4]]);
});

test("billing follows the bench and never blocks it: ship issues, cancel voids, failures are logged", async () => {
  assert.equal(mod.billingFollowUp("in_production", "u1"), undefined);
  const errors = [];
  const original = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    const failing = { transaction: async () => { throw new Error("db down") } };
    await mod.billingFollowUp("shipped", "u1")(failing, { id: "lo-1", shippedAt: new Date() });
    await mod.billingFollowUp("cancelled", "u1")(failing, { id: "lo-1" });
  } finally {
    console.error = original;
  }
  assert.match(errors[0], /^\[BILLING\]\[ISSUE_FAILED\] labOrder=lo-1/);
  assert.match(errors[1], /^\[BILLING\]\[VOID_FAILED\] labOrder=lo-1/);
});

test("release and remake draft an invoice inside their transaction, after the job's lines exist", () => {
  const release = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(release.indexOf("insertPlan(") < release.indexOf("createDraftForLabOrder(tx,"), "release");
  const remake = source.slice(source.indexOf("export function remakeOrder"), source.indexOf("export function listAssignableStaff"));
  assert.ok(remake.indexOf("insertPlan(") < remake.indexOf("createDraftForLabOrder(tx,"), "remake");
  const shop = source.slice(source.indexOf("export async function createShopLabOrder"), source.indexOf("function boardWhere"));
  assert.match(shop, /createShopInvoice\(tx, \{ labOrderId: plan\.labOrder\.id, clientUserId, quote, transactionId \}\)/);
  assert.match(source, /tx\.transaction\(\(sp\) => step\(sp, order\)\)/, "billing runs in a savepoint");
});
```

In `apps/api/src/routes/__tests__/rx-release.test.js`, in the test `"checkout creates the lab order AFTER the paid-order transaction…"`, replace the `createShopLabOrder` regex with:

```js
  assert.match(after, /await db\.transaction\(\(tx\) =>\s*createShopLabOrder\(tx, \{ orderId, clientUserId: pricedForUserId, quote, transactionId: result\.transactionId \}\)/);
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/lib/crypto.field-sealer.test.js src/lib/pricing.test.js src/services/billing/invoices.service.test.js src/services/lab/lab-orders.service.test.js src/routes/__tests__/rx-release.test.js`
Expected: FAIL. `fieldSealer`, `priceLabLines` and `invoices.service.js` don't exist; `createShopLabOrder` makes no invoice; `billingFollowUp` is undefined.

- [ ] **Step 4: Implement the crypto helper, lab-line pricing and the invoices service**

`apps/api/src/lib/crypto.js`. Append:

```js
/**
 * Encrypt/decrypt a fixed set of free-text fields on a row: staff notes that
 * can name a patient (lab order hold reasons and notes, invoice notes, void
 * and price-override reasons, credit reasons). `seal` skips null and absent
 * fields; `open` decrypts the ones present and keeps null as null.
 */
export function fieldSealer(fields) {
  return {
    seal(values) {
      const out = { ...values };
      for (const f of fields) if (f in out && out[f] != null) out[f] = encryptField(out[f]);
      return out;
    },
    open(row) {
      const out = { ...row };
      for (const f of fields) if (f in out) out[f] = row[f] == null ? null : decryptField(row[f]);
      return out;
    },
  };
}
```

`apps/api/src/services/lab/lab-orders.service.js`. Replace `sealOrder` / `openOrder` with the shared helper:
- change the crypto import to `import { encryptField, decryptField, fieldSealer } from "../../lib/crypto.js";`;
- replace the two functions with:

```js
const orderSecrets = fieldSealer(SECRET_ORDER_FIELDS);
const sealOrder = orderSecrets.seal;
const openOrder = orderSecrets.open;
```

`sealEvent` / `openEvent` are unchanged.

`apps/api/src/services/billing/invoice-crypto.js`:

```js
import { fieldSealer } from "../../lib/crypto.js";

// Staff free text on billing rows can name a patient: encrypted at rest, like
// lab notes (B4). Decrypted rows are never logged.
const invoiceSecrets = fieldSealer(["notes", "voidReason"]);
const lineSecrets = fieldSealer(["priceNote"]);
const ledgerSecrets = fieldSealer(["note"]);

export const sealInvoice = invoiceSecrets.seal;
export const openInvoice = invoiceSecrets.open;
export const sealLine = lineSecrets.seal;
export const openLine = lineSecrets.open;
export const sealLedgerRow = ledgerSecrets.seal;
export const openLedgerRow = ledgerSecrets.open;
```

`apps/api/src/lib/pricing.js`. Append:

```js
/**
 * Lab order lines → invoice lines. Unlike priceLines (the shop), nothing is
 * refused: the job is already on the bench. A line with no variant, or a
 * variant with no price, becomes unitCents 0 / priceSource "unpriced", which
 * holds its invoice at draft for staff. Inactive and rx-channel variants price
 * normally. Note-only lines (build instructions) are not billed.
 */
export function priceLabLines({ lines, variants, clientPrices = new Map() }) {
  return lines.filter((l) => !l.noteOnly).map((l) => {
    const variant = l.variantId ? variants.get(l.variantId) : null;
    const price = variant ? unitPriceFor(variant, clientPrices.get(l.variantId)) : null;
    return {
      labOrderLineId: l.id ?? null,
      variantId: l.variantId ?? null,
      code: l.code ?? null,
      description: l.name,
      qty: Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 1,
      unitCents: price ? price.cents : 0,
      priceSource: price ? price.source : "unpriced",
      taxable: Boolean(variant?.taxable),
    };
  });
}
```

`apps/api/src/services/pricing.service.js`:
- change the `../lib/pricing.js` import to `import { priceLines, priceLabLines } from "../lib/pricing.js";`;
- replace `loadClientPrices`;
- add `loadVariantsById` and `priceLabOrderLines`:

```js
/** Variants by id in any channel and any active state: lab work is priced whatever its catalog status is now. */
export async function loadVariantsById(variantIds, database = db) {
  if (variantIds.length === 0) return new Map();
  const rows = await database.select().from(productVariants).where(inArray(productVariants.id, variantIds));
  return new Map(rows.map((v) => [v.id, v]));
}

export async function loadClientPrices(clientUserId, variantIds, database = db) {
  if (!clientUserId || variantIds.length === 0) return new Map();
  const rows = await database
    .select({ variantId: clientPrices.variantId, priceCents: clientPrices.priceCents })
    .from(clientPrices)
    .where(and(eq(clientPrices.clientUserId, clientUserId), inArray(clientPrices.variantId, variantIds)));
  return new Map(rows.map((r) => [r.variantId, r.priceCents]));
}

/** A lab order's lines priced for its client (inside the caller's transaction when one is passed). */
export async function priceLabOrderLines(lines, clientUserId, database = db) {
  const ids = [...new Set(lines.filter((l) => !l.noteOnly && l.variantId).map((l) => l.variantId))];
  const variants = await loadVariantsById(ids, database);
  const prices = await loadClientPrices(clientUserId, ids, database);
  return priceLabLines({ lines, variants, clientPrices: prices });
}
```

(Sequential on purpose: two queries on one transaction connection run one after the other anyway.)

`apps/api/src/services/billing/invoices.service.js`:

```js
import { asc, eq } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, SHOP_PAYMENT_SOURCE } from "@my-app/shared";
import { env } from "../../config/env.js";
import { PRICING } from "../../config/pricing.js";
import { invoices, invoiceLines, invoicePayments, labOrders, labOrderLines } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { allocateSequenceNumber } from "../sequence.service.js";
import { priceLabOrderLines } from "../pricing.service.js";
import * as auditService from "../audit.service.js";
import { sealInvoice, openInvoice, sealLine, openLine } from "./invoice-crypto.js";
import { planDraftInvoice, planShopInvoice, asRemakeLines, hasUnpriced, planIssue, planVoid } from "./invoice-rules.js";

/**
 * Invoice writes. Every function here runs inside the CALLER's transaction:
 * lab-orders.service.js creates, issues and voids invoices in the same
 * transaction as the job change that causes them, so a job and its bill
 * can't disagree. Rules live in invoice-rules.js; this file only loads, plans
 * and writes. Audit rows are written through the same transaction.
 */

// Serialises invoice-number allocation (services/sequence.service.js).
export const INVOICE_NUMBER_LOCK = 7300422;

export function allocateInvoiceNumber(tx) {
  return allocateSequenceNumber(tx, {
    lockId: INVOICE_NUMBER_LOCK, table: invoices, column: invoices.invoiceNumber, start: env.INVOICE_NUMBER_START,
  });
}

async function insertInvoice(tx, { invoice, lines }) {
  await tx.insert(invoices).values(sealInvoice(invoice));
  if (lines.length) await tx.insert(invoiceLines).values(lines.map((l) => sealLine({ ...l, id: createId() })));
}

/** An audit row in the caller's transaction: ids, numbers and amounts only — never free text. */
export function auditInvoice(tx, action, invoice, byUserId, metadata = {}) {
  return auditService.log({
    userId: byUserId ?? null, action, targetType: "invoice", targetId: invoice.id,
    metadata: { invoiceNumber: invoice.invoiceNumber, ...metadata },
  }, tx);
}

export async function loadLines(tx, invoiceId) {
  const rows = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position));
  return rows.map(openLine);
}

/**
 * A new lab order (Rx release or remake) → its draft invoice. `lines` are the
 * lab order's inserted lines (with ids). A remake is priced at zero.
 */
export async function createDraftForLabOrder(tx, { labOrder, lines, byUserId = null }) {
  const priced = await priceLabOrderLines(lines, labOrder.clientUserId, tx);
  const plan = planDraftInvoice({
    invoiceId: createId(),
    invoiceNumber: await allocateInvoiceNumber(tx),
    labOrder,
    pricedLines: labOrder.isRemake ? asRemakeLines(priced) : priced,
    now: new Date(),
    taxRateBps: PRICING.taxRateBps,
  });
  await insertInvoice(tx, plan);
  await auditInvoice(tx, "invoice.drafted", plan.invoice, byUserId, { labOrderId: labOrder.id, unpriced: hasUnpriced(plan.lines) });
  return { id: plan.invoice.id, invoiceNumber: plan.invoice.invoiceNumber };
}

/**
 * A paid shop order's invoice: issued, and paid in full by one ledger row
 * carrying the checkout's transaction id. A guest's invoice has no client and
 * never reaches a statement.
 */
export async function createShopInvoice(tx, { labOrderId, clientUserId = null, quote, transactionId }) {
  const now = new Date();
  const plan = planShopInvoice({
    invoiceId: createId(), invoiceNumber: await allocateInvoiceNumber(tx),
    labOrderId, clientUserId, quote, now, todayIso: isoDateIn(LAB_TIMEZONE, now),
  });
  await insertInvoice(tx, plan);
  await tx.insert(invoicePayments).values({
    id: createId(),
    userId: clientUserId ?? null,
    invoiceId: plan.invoice.id,
    invoiceNumber: String(plan.invoice.invoiceNumber),
    appliedCents: plan.invoice.totalCents,
    transactionId: String(transactionId),
    source: SHOP_PAYMENT_SOURCE,
  });
  await auditInvoice(tx, "invoice.issued", plan.invoice, null, { kind: "shop", totalCents: plan.invoice.totalCents });
  return { id: plan.invoice.id, invoiceNumber: plan.invoice.invoiceNumber };
}

async function invoiceForLabOrder(tx, labOrderId) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.labOrderId, labOrderId)).for("update");
  return row ? openInvoice(row) : null;
}

/**
 * A lab order moved to shipped → issue its draft, due on the lab-local ship
 * date plus INVOICE_TERMS_DAYS. An unpriced line holds it at draft (it shows
 * under Admin › Invoices "Needs a price"). A lab order released before
 * invoicing existed is drafted first, so no shipped Rx job escapes billing.
 * Callers run this in a savepoint (lab-orders.service billingFollowUp): the
 * ship itself must commit whatever happens here.
 */
export async function issueForShippedLabOrder(tx, { labOrderId, shippedAt, byUserId = null }) {
  let invoice = await invoiceForLabOrder(tx, labOrderId);
  if (!invoice) {
    const [labOrder] = await tx.select().from(labOrders).where(eq(labOrders.id, labOrderId));
    // A shop order's invoice is written at checkout; a missing one is a
    // [LAB][SHOP_ORDER_FAILED] backfill case, not something to invent here.
    if (!labOrder || labOrder.source === "shop_order") return { issued: false, reason: "no_invoice" };
    const lines = await tx.select().from(labOrderLines).where(eq(labOrderLines.labOrderId, labOrderId)).orderBy(asc(labOrderLines.position));
    await createDraftForLabOrder(tx, { labOrder, lines, byUserId });
    invoice = await invoiceForLabOrder(tx, labOrderId);
  }
  if (invoice.status !== "draft") return { issued: false, reason: invoice.status };
  const lines = await loadLines(tx, invoice.id);
  if (hasUnpriced(lines)) {
    await auditInvoice(tx, "invoice.issue_held", invoice, byUserId, { reason: "unpriced" });
    return { issued: false, reason: "unpriced" };
  }
  const now = new Date();
  const { patch } = planIssue(invoice, lines, {
    now, termsDays: env.INVOICE_TERMS_DAYS, issueDateIso: isoDateIn(LAB_TIMEZONE, shippedAt ?? now),
  });
  await tx.update(invoices).set(patch).where(eq(invoices.id, invoice.id));
  await auditInvoice(tx, "invoice.issued", invoice, byUserId, { via: "ship", totalCents: invoice.totalCents, dueDate: patch.dueDate });
  return { issued: true, dueDate: patch.dueDate };
}

/** A lab order was cancelled → void its draft. An issued invoice is never touched here. */
export async function voidForCancelledLabOrder(tx, { labOrderId, byUserId = null }) {
  const invoice = await invoiceForLabOrder(tx, labOrderId);
  if (!invoice || invoice.status !== "draft") return { voided: false };
  const { patch } = planVoid(invoice, { paidCents: 0, reason: "Lab order cancelled", now: new Date() });
  await tx.update(invoices).set(sealInvoice(patch)).where(eq(invoices.id, invoice.id));
  await auditInvoice(tx, "invoice.voided", invoice, byUserId, { via: "cancel" });
  return { voided: true };
}
```

- [ ] **Step 5: Hook the invoice service into lab orders and checkout**

`apps/api/src/services/lab/lab-orders.service.js`. Add the import:

```js
import {
  createDraftForLabOrder, createShopInvoice, issueForShippedLabOrder, voidForCancelledLabOrder,
} from "../billing/invoices.service.js";
```

`insertPlan` returns the inserted lines (their ids are the invoice lines' `labOrderLineId`):

```js
async function insertPlan(tx, { labOrder, lines, events }) {
  await tx.insert(labOrders).values(sealOrder(labOrder));
  const inserted = lines.map((l) => ({ ...l, id: createId() }));
  if (inserted.length) await tx.insert(labOrderLines).values(inserted);
  if (events.length) await tx.insert(labOrderEvents).values(events.map((e, i) => sealEvent({ ...e, at: new Date(new Date(e.at).getTime() + i) })));
  return inserted;
}
```

In `releaseRxCase`, replace the last two lines:

```js
  const orderLines = await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
  // The bill is drafted with the job: a failure here fails the release as a whole (staff retry).
  const invoice = await createDraftForLabOrder(tx, { labOrder: plan.labOrder, lines: orderLines, byUserId });
  return { labOrder: { id: plan.labOrder.id, orderNumber }, unknownCodes: plan.unknownCodes, invoice };
```

Replace `createShopLabOrder`:

```js
/**
 * The lab order and the paid shop invoice for a just-paid shop order. Runs in
 * its own transaction right after the paid order commits (never inside it), so
 * a failure can't roll back a charged order; checkout logs
 * [LAB][SHOP_ORDER_FAILED] for backfill.
 */
export async function createShopLabOrder(tx, { orderId, clientUserId = null, quote, transactionId }) {
  const orderNumber = await allocateOrderNumber(tx);
  const plan = planShopLabOrder({ orderId, clientUserId, quoteLines: quote.lines, orderNumber, labOrderId: createId(), now: new Date() });
  await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
  await createShopInvoice(tx, { labOrderId: plan.labOrder.id, clientUserId, quote, transactionId });
  return { id: plan.labOrder.id, orderNumber };
}
```

In `mutate`, after `await tx.insert(labOrderEvents).values(sealEvent(planned.event));`, add:

```js
    const opened = openOrder(updated);
    if (planned.after) await planned.after(tx, opened);
    return { order: opened, changed: true };
```

and delete the old `return { order: openOrder(updated), changed: true };`.

Replace `changeStatus`:

```js
/**
 * Billing follows the bench and never blocks it. Shipping issues the order's
 * invoice and cancelling voids its draft, each in a SAVEPOINT. A billing
 * failure is logged for staff ([BILLING][ISSUE_FAILED] / [BILLING][VOID_FAILED],
 * ids only) and the move itself still commits.
 */
export function billingFollowUp(to, byUserId) {
  const steps = {
    shipped: { tag: "ISSUE_FAILED", step: (tx, order) => issueForShippedLabOrder(tx, { labOrderId: order.id, shippedAt: order.shippedAt, byUserId }) },
    cancelled: { tag: "VOID_FAILED", step: (tx, order) => voidForCancelledLabOrder(tx, { labOrderId: order.id, byUserId }) },
  };
  const s = steps[to];
  if (!s) return undefined;
  const { tag, step } = s;
  return async (tx, order) => {
    try {
      await tx.transaction((sp) => step(sp, order));
    } catch (err) {
      console.error(`[BILLING][${tag}] labOrder=${order.id}: ${String(err?.message || err).slice(0, 300)}`);
    }
  };
}

export function changeStatus(id, { to, reason, expectedVersion, byUserId = null }) {
  return mutate(id, expectedVersion, (order) => ({
    ...planStatusChange(order, to, { reason, byUserId, now: new Date() }),
    after: billingFollowUp(to, byUserId),
  }));
}
```

In `remakeOrder`, replace `await insertPlan(tx, plan);` with:

```js
    const lines = await insertPlan(tx, plan);
    await createDraftForLabOrder(tx, { labOrder: plan.labOrder, lines, byUserId });
```

`apps/api/src/routes/checkout.routes.js`. In `recordGuestOrder`, replace the `createShopLabOrder` call:

```js
    await db.transaction((tx) =>
      createShopLabOrder(tx, { orderId, clientUserId: pricedForUserId, quote, transactionId: result.transactionId })
    );
```

and update the comment above it to say "The job for the bench and its paid shop invoice."

- [ ] **Step 6: Run the tests and the suite**

```bash
cd apps/api && pnpm vitest run src/lib src/services/billing src/services/lab src/routes/__tests__/rx-release.test.js   # PASS
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(billing): draft on release/remake, paid shop invoice at checkout, issue on ship, void on cancel

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 6: Ledger service; recording and `verifyAllocations` on local invoices; card and refund paths in cents; Seazona payment writes removed

**Files:**
- Create: `apps/api/src/services/billing/ledger.service.js`, `apps/api/src/services/billing/ledger.service.test.js`, `apps/api/src/lib/refund-plan.js`, `apps/api/src/lib/refund-plan.test.js`
- Modify (rewrite): `apps/api/src/services/payment-recording.service.js`, `apps/api/src/services/payment-recording.service.test.js`, `apps/api/src/lib/payment-summary.js`, `apps/api/src/lib/payment-summary.test.js`, `apps/api/src/routes/invoice-payment.routes.js`, `apps/api/src/routes/refund.routes.js`
- Modify:
  - `apps/api/src/routes/admin-payment.routes.js` (the `charge-saved` handler), `apps/api/src/routes/payment.routes.js` (ledger import, search filter);
  - `apps/api/src/services/email.service.js:432-540`, `apps/api/src/services/email-staging.test.js:41`;
  - `packages/shared/src/schemas/payment.schema.js`, `apps/api/src/routes/__tests__/payment.schema.test.js` (everything above `describe("checkoutSchema"`).

**Interfaces:**
- Consumes:
  - Task 4: `deriveBalance`, `SHOP_PAYMENT_SOURCE`, `CREDIT_SOURCE`.
  - Task 5: `openLedgerRow`.
- Produces:
  - `services/billing/ledger.service.js`:
    - `paidCentsByInvoice(invoiceIds, database) → Map<id, cents>`;
    - `withBalances(invoiceRows, database) → rows + { paidCents, balanceCents, paid }`;
    - `openInvoicesForClient(clientUserId, database) → [{ id, invoiceNumber, balanceCents, dueDate, issuedOn }]` (issued, balance > 0, oldest due first);
    - `ledgerRowsForInvoice(invoiceId, database)`;
    - `listPaymentsForUser(userId)`, `listAllPayments({ userId })` (shop checkouts excluded).
    Every read throws on a DB error.
  - `lib/payment-summary.js`:
    - `summarizePayments(rows) → [{ transactionId, userId, source, grossCents, refundedCents, netCents, status, refundable, offline, credit, createdAt, refundTransactionId, invoices: [{ invoiceId, invoiceNumber, amountCents }] }]`;
    - `ledgerInvoiceKey(row)`, `CREDIT_PREFIX = "credit:"`, `OFFLINE_PREFIX`, `REFUND_PENDING_PREFIX`.
  - `lib/refund-plan.js`: `invoiceKeysOf(row)`, `planRefund(originalRows, allocations?) → { totalCents | null, rows } | { error }`.
  - `services/payment-recording.service.js`:
    - `recordPaymentAndAllocations({ user, amountCents, transactionId, allocations: [{ invoiceId, invoiceNumber, amountCents }], source, wasCharged, auditAction, actorUserId, paidOn, reference }) → { ledgerWriteFailed }` (never throws);
    - `verifyAllocations(allocations, user, { enforceCap, database }) → null | { kind: "forbidden" | "validation", message }`.
  - `@my-app/shared`:
    - `allocationSchema` is `{ invoiceId, amountCents }`;
    - `chargeSavedSchema` is `{ paymentProfileId, amountCents, allocations }`;
    - `hostedTokenSchema` and `hostedCompleteSchema` carry cents allocations;
    - `refundAllocationSchema` is `{ invoiceId, amountCents }`.
  - Wire changes:
    - `POST /payments/charge-saved` and `POST /admin/users/:userId/payments/charge-saved` take `{ paymentProfileId, amountCents, allocations }`.
    - `POST /payments/hosted-token` returns `amountCents`.
    - `POST /payments/hosted-complete` returns `amountCents`.
    - `POST /admin/payments/refund` takes `allocations: [{ invoiceId, amountCents }]` and returns `amountCents`.
  - `email.service.js`: `sendPaymentReceipt({ to, amountCents, invoices: [{ number, amountCents }], transactionId, date, wasCharged })`, `sendRefundReceipt({ to, amountCents, invoices, transactionId, date })`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/billing/ledger.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { fakeTx } = await import("../../test/fake-tx.js");
const ledger = await import("./ledger.service.js");
const source = readFileSync(fileURLToPath(new URL("./ledger.service.js", import.meta.url)), "utf8");

test("paid per invoice is the SUM of its rows; numbers come back from bigint strings", async () => {
  const db = fakeTx({ selects: [[{ invoiceId: "a", paid: "5500" }, { invoiceId: "b", paid: "-100" }]] });
  const paid = await ledger.paidCentsByInvoice(["a", "b", "a"], db);
  assert.equal(paid.get("a"), 5500);
  assert.equal(paid.get("b"), -100);
  assert.equal((await ledger.paidCentsByInvoice([], fakeTx())).size, 0, "no ids, no query");
});

test("withBalances attaches the one balance rule", async () => {
  const db = fakeTx({ selects: [[{ invoiceId: "a", paid: "2500" }]] });
  const [a, b] = await ledger.withBalances([
    { id: "a", status: "issued", totalCents: 10000 },
    { id: "b", status: "void", totalCents: 5000 },
  ], db);
  assert.deepEqual([a.paidCents, a.balanceCents, a.paid], [2500, 7500, false]);
  assert.deepEqual([b.paidCents, b.balanceCents], [0, 0]);
});

test("a client's open invoices: issued, still owing, oldest due first, with the lab-local issue date", async () => {
  const db = fakeTx({ selects: [
    [
      { id: "late", invoiceNumber: 500002, status: "issued", totalCents: 5000, dueDate: "2026-11-30", issuedAt: new Date("2026-10-31T04:30:00Z") },
      { id: "early", invoiceNumber: 500001, status: "issued", totalCents: 8000, dueDate: "2026-10-30", issuedAt: new Date("2026-09-30T15:00:00Z") },
      { id: "paid", invoiceNumber: 500003, status: "issued", totalCents: 1000, dueDate: "2026-10-01", issuedAt: new Date("2026-09-01T15:00:00Z") },
    ],
    [{ invoiceId: "paid", paid: "1000" }, { invoiceId: "early", paid: "3000" }],
  ] });
  const open = await ledger.openInvoicesForClient("doc1", db);
  assert.deepEqual(open.map((i) => [i.id, i.balanceCents]), [["early", 5000], ["late", 5000]]);
  assert.equal(open[1].issuedOn, "2026-10-30", "04:30 UTC on Oct 31 is still Oct 30 in Chicago");
  await assert.rejects(ledger.openInvoicesForClient(null, db), /clientUserId is required/);
});

test("shop checkouts stay out of payment history (and so out of the refund screen)", () => {
  assert.match(source, /notInArray\(invoicePayments\.source, \[SHOP_PAYMENT_SOURCE\]\)/);
  assert.doesNotMatch(source, /catch \(/, "ledger reads fail closed — no soft-fail fallbacks");
});
```

`apps/api/src/lib/refund-plan.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { planRefund } from "./refund-plan.js";

const row = (over) => ({
  userId: "doc1", invoiceId: "inv1", seazonaClientId: null, seazonaInvoiceId: null, invoiceNumber: "500001", appliedCents: 6000, ...over,
});

test("a full refund negates every original row and keeps its invoice keys", () => {
  const plan = planRefund([row(), row({ invoiceId: "inv2", invoiceNumber: "500002", appliedCents: 4000 })]);
  assert.equal(plan.totalCents, null, "full: the gateway reverses the whole charge");
  assert.deepEqual(plan.rows.map((r) => [r.invoiceId, r.appliedCents]), [["inv1", -6000], ["inv2", -4000]]);
});

test("a partial refund reverses named slices, each capped at what it was charged", () => {
  const rows = [row(), row({ invoiceId: "inv2", invoiceNumber: "500002", appliedCents: 4000 })];
  const plan = planRefund(rows, [{ invoiceId: "inv2", amountCents: 1500 }]);
  assert.equal(plan.totalCents, 1500);
  assert.deepEqual(plan.rows.map((r) => [r.invoiceId, r.invoiceNumber, r.appliedCents]), [["inv2", "500002", -1500]]);
  assert.match(planRefund(rows, [{ invoiceId: "inv2", amountCents: 4001 }]).error, /exceeds the \$40\.00 charged/);
  assert.match(planRefund(rows, [{ invoiceId: "nope", amountCents: 1 }]).error, /not part of this charge/);
  assert.match(planRefund(rows, [{ invoiceId: "inv1", amountCents: 1 }, { invoiceId: "inv1", amountCents: 1 }]).error, /more than once/);
});

test("a Seazona-era charge (no local invoice id) refunds by its Seazona invoice id", () => {
  const legacy = row({ invoiceId: null, seazonaClientId: "c1", seazonaInvoiceId: "sz-9", invoiceNumber: "41201", appliedCents: 2500 });
  const plan = planRefund([legacy], [{ invoiceId: "sz-9", amountCents: 2500 }]);
  assert.deepEqual(plan.rows[0], {
    invoiceId: null, seazonaClientId: "c1", seazonaInvoiceId: "sz-9", invoiceNumber: "41201", userId: "doc1", appliedCents: -2500,
  });
});
```

`apps/api/src/lib/payment-summary.test.js` (whole file):

```js
import { describe, it, expect } from "vitest";
import { summarizePayments } from "./payment-summary.js";

function row(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    userId: "u1",
    invoiceId: over.invoiceId ?? "inv-1",
    seazonaInvoiceId: null,
    invoiceNumber: over.invoiceNumber ?? "500001",
    appliedCents: over.appliedCents ?? 10000,
    transactionId: over.transactionId ?? "TXN1",
    refundsTransactionId: over.refundsTransactionId ?? null,
    createdAt: over.createdAt || new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

describe("summarizePayments", () => {
  it("returns empty for no rows", () => {
    expect(summarizePayments([])).toEqual([]);
    expect(summarizePayments(undefined)).toEqual([]);
  });

  it("summarizes a multi-invoice charge as one paid payment, in cents", () => {
    const [p] = summarizePayments([
      row({ invoiceId: "a", invoiceNumber: "500001", appliedCents: 6000 }),
      row({ invoiceId: "b", invoiceNumber: "500002", appliedCents: 4000 }),
    ]);
    expect([p.grossCents, p.refundedCents, p.netCents, p.status, p.refundable]).toEqual([10000, 0, 10000, "paid", true]);
    expect(p.invoices).toEqual([
      { invoiceId: "a", invoiceNumber: "500001", amountCents: 6000 },
      { invoiceId: "b", invoiceNumber: "500002", amountCents: 4000 },
    ]);
  });

  it("marks a fully reversed charge refunded and a partly reversed one partially_refunded", () => {
    const [full] = summarizePayments([row(), row({ transactionId: "REF1", refundsTransactionId: "TXN1", appliedCents: -10000 })]);
    expect([full.refundedCents, full.netCents, full.status, full.refundable, full.refundTransactionId]).toEqual([10000, 0, "refunded", false, "REF1"]);
    const [part] = summarizePayments([row(), row({ transactionId: "REF1", refundsTransactionId: "TXN1", appliedCents: -4000 })]);
    expect([part.netCents, part.status]).toEqual([6000, "partially_refunded"]);
  });

  it("treats a write-ahead guard row as refund_pending, not refundable", () => {
    const [p] = summarizePayments([row(), row({ transactionId: "REFUND-PENDING-TXN1", refundsTransactionId: "TXN1", appliedCents: 0 })]);
    expect([p.grossCents, p.status, p.refundable]).toEqual([10000, "refund_pending", false]);
  });

  it("never offers a refund for a manual payment or a credit — no gateway transaction behind either", () => {
    const [manual] = summarizePayments([row({ transactionId: "OFFLINE-abc", source: "admin_check" })]);
    expect([manual.offline, manual.credit, manual.refundable]).toEqual([true, false, false]);
    const [credit] = summarizePayments([row({ transactionId: "credit:xyz", source: "credit", appliedCents: 2500 })]);
    expect([credit.credit, credit.refundable, credit.grossCents]).toEqual([true, false, 2500]);
  });

  it("keys a Seazona-era row by its Seazona invoice id", () => {
    const [p] = summarizePayments([row({ invoiceId: null, seazonaInvoiceId: "sz-9", invoiceNumber: "41201", appliedCents: 2500, source: null })]);
    expect(p.invoices).toEqual([{ invoiceId: "sz-9", invoiceNumber: "41201", amountCents: 2500 }]);
    expect(p.source).toBeNull();
  });

  it("carries source through and sorts newest first", () => {
    const out = summarizePayments([
      row({ transactionId: "OLD", source: "autopay", createdAt: new Date("2026-06-01T00:00:00Z") }),
      row({ transactionId: "NEW", source: "doctor_card", createdAt: new Date("2026-06-10T00:00:00Z") }),
    ]);
    expect(out.map((p) => [p.transactionId, p.source])).toEqual([["NEW", "doctor_card"], ["OLD", "autopay"]]);
  });
});
```

`apps/api/src/services/payment-recording.service.test.js` (whole file):

```js
import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const inserted = [];
let insertFails = false;
let invoiceRows = [];
vi.mock("../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { if (insertFails) throw new Error("db down"); inserted.push(...v); } }),
    select: () => ({ from: () => ({ where: async () => invoiceRows }) }),
  },
}));
let paid = new Map();
vi.mock("./billing/ledger.service.js", () => ({ paidCentsByInvoice: async () => paid }));
const receipts = [];
vi.mock("./email.service.js", () => ({ sendPaymentReceipt: async (args) => { receipts.push(args); return true; } }));
const audits = [];
vi.mock("./audit.service.js", () => ({ logSafe: (e) => { audits.push(e); }, log: async () => {} }));

const { recordPaymentAndAllocations, verifyAllocations } = await import("./payment-recording.service.js");
const source = readFileSync(fileURLToPath(new URL("./payment-recording.service.js", import.meta.url)), "utf8");

beforeEach(() => {
  inserted.length = 0; receipts.length = 0; audits.length = 0;
  insertFails = false; invoiceRows = []; paid = new Map();
});

const doctor = { id: "doc1", email: "d@x.com" };
const allocations = () => [
  { invoiceId: "inv1", invoiceNumber: "500001", amountCents: 30000 },
  { invoiceId: "inv2", invoiceNumber: "500002", amountCents: 12550 },
];

test("one ledger row per allocated invoice, in cents, against the local invoice", async () => {
  const out = await recordPaymentAndAllocations({ user: doctor, amountCents: 42550, transactionId: "tx1", allocations: allocations(), source: "doctor_card" });
  assert.deepEqual(out, { ledgerWriteFailed: false });
  assert.deepEqual(inserted.map((r) => [r.userId, r.invoiceId, r.invoiceNumber, r.appliedCents, r.transactionId, r.source]), [
    ["doc1", "inv1", "500001", 30000, "tx1", "doctor_card"],
    ["doc1", "inv2", "500002", 12550, "tx1", "doctor_card"],
  ]);
  assert.equal(receipts[0].amountCents, 42550);
  assert.deepEqual(receipts[0].invoices, [{ number: "500001", amountCents: 30000 }, { number: "500002", amountCents: 12550 }]);
});

test("manual payments carry their received date and reference", async () => {
  await recordPaymentAndAllocations({
    user: doctor, amountCents: 30000, transactionId: "OFFLINE-x", allocations: allocations().slice(0, 1),
    source: "admin_check", wasCharged: false, paidOn: "2026-10-14", reference: "1042",
  });
  assert.deepEqual([inserted[0].paidOn, inserted[0].reference], ["2026-10-14", "1042"]);
  assert.equal(receipts[0].wasCharged, false);
});

test("nothing is written to Seazona — our ledger is the system of record", () => {
  assert.doesNotMatch(source, /seazona/i);
});

test("a ledger failure after a charge is reported, never thrown; the charged doctor still gets a receipt", async () => {
  insertFails = true;
  const out = await recordPaymentAndAllocations({ user: doctor, amountCents: 42550, transactionId: "tx1", allocations: allocations(), source: "doctor_card" });
  assert.deepEqual(out, { ledgerWriteFailed: true });
  assert.equal(receipts.length, 1);
  assert.equal(audits[0].metadata.ledgerWriteFailed, true);
});

test("a manual record that failed to save sends no receipt (nothing was recorded)", async () => {
  insertFails = true;
  await recordPaymentAndAllocations({ user: doctor, amountCents: 30000, transactionId: "OFFLINE-x", allocations: allocations().slice(0, 1), source: "admin_cash", wasCharged: false });
  assert.equal(receipts.length, 0);
});

test("audit carries amounts, the source and invoice numbers only", async () => {
  await recordPaymentAndAllocations({ user: doctor, amountCents: 42550, transactionId: "tx1", allocations: allocations(), source: "autopay", actorUserId: "admin1", auditAction: "payment.manual_recorded" });
  assert.deepEqual(audits[0], {
    userId: "admin1", action: "payment.manual_recorded", targetType: "transaction", targetId: "tx1",
    metadata: { amountCents: 42550, source: "autopay", invoices: ["500001", "500002"], ledgerWriteFailed: false },
  });
});

const inv = (over = {}) => ({ id: "inv1", invoiceNumber: 500001, clientUserId: "doc1", status: "issued", totalCents: 30000, ...over });

test("verifyAllocations: someone else's invoice and a missing one read the same (403)", async () => {
  invoiceRows = [inv({ clientUserId: "doc2" })];
  const other = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor);
  invoiceRows = [];
  const missing = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor);
  assert.equal(other.kind, "forbidden");
  assert.deepEqual(other, missing);
});

test("verifyAllocations: drafts and voids can't be paid; an invoice may appear once", async () => {
  invoiceRows = [inv({ status: "draft" })];
  assert.match((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor)).message, /hasn't been issued/);
  invoiceRows = [inv({ status: "void" })];
  assert.match((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor)).message, /is void/);
  const dup = await verifyAllocations([{ invoiceId: "inv1", amountCents: 1 }, { invoiceId: "inv1", amountCents: 1 }], doctor);
  assert.equal(dup.kind, "validation");
});

test("verifyAllocations: the cap is what's left after payments, credits and refunds", async () => {
  invoiceRows = [inv()];
  paid = new Map([["inv1", 20000]]);
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 10000 }], doctor, { enforceCap: true }), null);
  const over = await verifyAllocations([{ invoiceId: "inv1", amountCents: 10001 }], doctor, { enforceCap: true });
  assert.equal(over.kind, "validation");
  assert.match(over.message, /exceeds its balance of \$100\.00/);
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 30000 }], doctor), null, "no cap without enforceCap (ownership pass)");
});

test("verifyAllocations fills in the invoice number from our invoice", async () => {
  invoiceRows = [inv()];
  const a = [{ invoiceId: "inv1", amountCents: 100 }];
  await verifyAllocations(a, doctor);
  assert.equal(a[0].invoiceNumber, "500001");
});
```

In `apps/api/src/routes/__tests__/payment.schema.test.js`, replace everything above `describe("checkoutSchema", () => {` with:

```js
import { describe, it, expect } from "vitest";
import {
  allocationSchema,
  chargeSavedSchema,
  hostedTokenSchema,
  hostedCompleteSchema,
  checkoutSchema,
  refundSchema,
} from "@my-app/shared";

describe("allocationSchema", () => {
  it("is a local invoice id and integer cents", () => {
    expect(allocationSchema.safeParse({ invoiceId: "inv1", amountCents: 1250 }).success).toBe(true);
    expect(allocationSchema.safeParse({ invoiceId: "inv1", amountCents: 12.5 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "", amountCents: 5 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amountCents: 0 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amountCents: 10_000_001 }).success).toBe(false);
  });
});

describe("chargeSavedSchema", () => {
  const ok = { paymentProfileId: "pp_1", amountCents: 3000, allocations: [{ invoiceId: "a", amountCents: 1000 }, { invoiceId: "b", amountCents: 2000 }] };
  it("accepts allocations that sum exactly to the charge", () => {
    expect(chargeSavedSchema.safeParse(ok).success).toBe(true);
    expect(chargeSavedSchema.safeParse({ ...ok, amountCents: 2999 }).success).toBe(false);
  });
  it("refuses the same invoice twice", () => {
    expect(chargeSavedSchema.safeParse({ ...ok, allocations: [{ invoiceId: "a", amountCents: 1500 }, { invoiceId: "a", amountCents: 1500 }] }).success).toBe(false);
  });
  it("requires a paymentProfileId and at least one allocation", () => {
    expect(chargeSavedSchema.safeParse({ amountCents: 10, allocations: [{ invoiceId: "a", amountCents: 10 }] }).success).toBe(false);
    expect(chargeSavedSchema.safeParse({ paymentProfileId: "p", amountCents: 10, allocations: [] }).success).toBe(false);
  });
});

describe("hostedTokenSchema / hostedCompleteSchema", () => {
  it("carry cents allocations; extra token fields pass through", () => {
    const r = hostedTokenSchema.safeParse({ allocations: [{ invoiceId: "a", amountCents: 500 }], saveCard: true, iframeCommunicatorUrl: "https://x/IFrameCommunicator.html" });
    expect(r.success).toBe(true);
    expect(r.data.saveCard).toBe(true);
    expect(hostedTokenSchema.safeParse({ allocations: [] }).success).toBe(false);
    expect(hostedCompleteSchema.safeParse({ transId: "t1", refId: "Habc", allocations: [{ invoiceId: "a", amountCents: 500 }] }).success).toBe(true);
    expect(hostedCompleteSchema.safeParse({ transId: "t1", allocations: [{ invoiceId: "a", amountCents: 500 }] }).success).toBe(false);
  });
});

describe("refundSchema", () => {
  it("full reversal with a transaction id alone; partial with cents slices", () => {
    expect(refundSchema.safeParse({ transactionId: "1234567890" }).success).toBe(true);
    expect(refundSchema.safeParse({ transactionId: "" }).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ invoiceId: "a", amountCents: 4000 }] }).success).toBe(true);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [] }).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ invoiceId: "a", amountCents: 10.5 }] }).success).toBe(false);
  });
});

```

`apps/api/src/services/email-staging.test.js` line 41: change `amount: 10` to `amountCents: 1000`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/billing/ledger.service.test.js src/lib/refund-plan.test.js src/lib/payment-summary.test.js src/services/payment-recording.service.test.js src/routes/__tests__/payment.schema.test.js`
Expected: FAIL. The ledger and refund-plan modules don't exist; the summary and schemas are still in dollars; recording still calls Seazona.

- [ ] **Step 3: Implement the ledger, summary and refund plan**

`apps/api/src/services/billing/ledger.service.js`:

```js
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, SHOP_PAYMENT_SOURCE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { invoices, invoicePayments } from "../../db/schema/index.js";
import { summarizePayments } from "../../lib/payment-summary.js";
import { deriveBalance } from "./invoice-rules.js";
import { openLedgerRow } from "./invoice-crypto.js";

/**
 * The invoice ledger's read side. Paid is the SUM of an invoice's
 * invoice_payments rows (payments and credits positive, refunds negative);
 * the balance comes from deriveBalance (invoice-rules.js), the one rule every
 * screen and money path uses. Every read THROWS on a DB error: invoices and
 * the ledger share one database, so there is no partial answer worth showing,
 * and a money path must fail closed.
 */

/** @returns {Promise<Map<string, number>>} invoiceId → paid cents */
export async function paidCentsByInvoice(invoiceIds, database = db) {
  const ids = [...new Set(invoiceIds.map(String))];
  if (ids.length === 0) return new Map();
  const rows = await database
    .select({ invoiceId: invoicePayments.invoiceId, paid: sql`coalesce(sum(${invoicePayments.appliedCents}), 0)` })
    .from(invoicePayments)
    .where(inArray(invoicePayments.invoiceId, ids))
    .groupBy(invoicePayments.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, Number(r.paid)]));
}

/** Invoice rows with { paidCents, balanceCents, paid } attached. */
export async function withBalances(invoiceRows, database = db) {
  const paid = await paidCentsByInvoice(invoiceRows.map((i) => i.id), database);
  return invoiceRows.map((inv) => ({ ...inv, ...deriveBalance(inv, paid.get(inv.id) ?? 0) }));
}

const LAST_DAY = "9999-12-31";

/**
 * What a payment can be applied to: the client's issued invoices that still
 * owe, oldest due first (undated last), each with its lab-local issue date.
 */
export async function openInvoicesForClient(clientUserId, database = db) {
  if (!clientUserId) throw new Error("invoice ledger: clientUserId is required");
  const rows = await database
    .select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status,
      totalCents: invoices.totalCents, dueDate: invoices.dueDate, issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(and(eq(invoices.clientUserId, clientUserId), eq(invoices.status, "issued")));
  const balanced = await withBalances(rows, database);
  return balanced
    .filter((i) => i.balanceCents > 0)
    .map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, balanceCents: i.balanceCents, dueDate: i.dueDate ?? null,
      issuedOn: isoDateIn(LAB_TIMEZONE, new Date(i.issuedAt)),
    }))
    .sort((a, b) => (a.dueDate ?? LAST_DAY).localeCompare(b.dueDate ?? LAST_DAY) || a.invoiceNumber - b.invoiceNumber);
}

/** An invoice's ledger rows, oldest first, with credit reasons decrypted. */
export async function ledgerRowsForInvoice(invoiceId, database = db) {
  const rows = await database
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId))
    .orderBy(asc(invoicePayments.createdAt));
  return rows.map(openLedgerRow);
}

// A shop checkout pays an order, not a bill someone chose to pay: it stays out
// of payment history (and so out of the refund screen).
const NOT_SHOP = or(isNull(invoicePayments.source), notInArray(invoicePayments.source, [SHOP_PAYMENT_SOURCE]));

/** A doctor's own transaction-level payment history. */
export async function listPaymentsForUser(userId, database = db) {
  const rows = await database.select().from(invoicePayments).where(and(eq(invoicePayments.userId, userId), NOT_SHOP));
  return summarizePayments(rows);
}

/** Every doctor's payment history (admin), optionally for one user. */
export async function listAllPayments({ userId } = {}, database = db) {
  const where = userId ? and(eq(invoicePayments.userId, userId), NOT_SHOP) : NOT_SHOP;
  return summarizePayments(await database.select().from(invoicePayments).where(where));
}
```

`apps/api/src/lib/payment-summary.js` (whole file):

```js
/**
 * Pure payment-ledger aggregation (no DB, no env, no I/O), so the fiddly
 * grouping and status logic is unit-tested in isolation. The ledger service
 * (services/billing/ledger.service.js) fetches rows and delegates here.
 * Money is integer cents.
 */

export const REFUND_PENDING_PREFIX = "REFUND-PENDING-";
// A manual payment (staff record a check, cash, ACH) has no Authorize.net
// transaction behind it: its transactionId is an `OFFLINE-<id>` sentinel.
export const OFFLINE_PREFIX = "OFFLINE-";
// A staff credit / write-off: `credit:<rowId>`. Never sent to a card processor.
export const CREDIT_PREFIX = "credit:";

/** The invoice a ledger row applies to: the local invoice, or (Seazona-era rows) the Seazona invoice id. */
export const ledgerInvoiceKey = (r) => r.invoiceId ?? r.seazonaInvoiceId ?? null;

/**
 * Collapse invoice_payments rows into one summary per ORIGINAL transaction.
 * Charge rows have no refundsTransactionId; reversal rows carry
 * refundsTransactionId = the charge's id and a NEGATIVE appliedCents. The
 * refund write-ahead guard is a reversal with 0 cents and a REFUND-PENDING id.
 * @returns {Array<object>} newest first
 */
export function summarizePayments(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const isReversal = r.refundsTransactionId != null;
    const chargeTxn = isReversal ? r.refundsTransactionId : r.transactionId;
    if (!groups.has(chargeTxn)) groups.set(chargeTxn, { chargeTxn, charge: [], reversals: [] });
    const g = groups.get(chargeTxn);
    (isReversal ? g.reversals : g.charge).push(r);
  }

  const summaries = [];
  for (const { chargeTxn, charge, reversals } of groups.values()) {
    const grossCents = charge.reduce((s, r) => s + r.appliedCents, 0);
    const refundedCents = -reversals.reduce((s, r) => s + r.appliedCents, 0);
    const netCents = grossCents - refundedCents;
    const realReversals = reversals.filter((r) => !String(r.transactionId).startsWith(REFUND_PENDING_PREFIX));
    const hasPendingGuard = reversals.some((r) => String(r.transactionId).startsWith(REFUND_PENDING_PREFIX));

    let status;
    if (hasPendingGuard && !realReversals.length) status = "refund_pending";
    else if (realReversals.length && netCents <= 0) status = "refunded";
    else if (realReversals.length) status = "partially_refunded";
    else status = "paid";

    const offline = String(chargeTxn).startsWith(OFFLINE_PREFIX);
    const credit = String(chargeTxn).startsWith(CREDIT_PREFIX);
    // Refundable only with a real gateway transaction, no reversal or guard row
    // yet (the refund route's double-refund guard), and money to give back.
    const refundable = !offline && !credit && reversals.length === 0 && grossCents > 0;

    const sourceRows = charge.length ? charge : reversals;
    const createdAt = sourceRows.reduce((min, r) => (r.createdAt && (!min || r.createdAt < min) ? r.createdAt : min), null);

    summaries.push({
      transactionId: chargeTxn,
      userId: sourceRows[0]?.userId || null,
      // doctor_card | doctor_hosted | admin_card | autopay | admin_check |
      // admin_cash | admin_ach | admin_other | credit (admin_offline on
      // Seazona-era rows; null before the column existed).
      source: sourceRows[0]?.source || null,
      grossCents,
      refundedCents,
      netCents,
      status,
      refundable,
      offline,
      credit,
      createdAt,
      refundTransactionId: realReversals[0]?.transactionId || null,
      invoices: charge.map((r) => ({ invoiceId: ledgerInvoiceKey(r), invoiceNumber: r.invoiceNumber || null, amountCents: r.appliedCents })),
    });
  }

  summaries.sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));
  return summaries;
}
```

`apps/api/src/lib/refund-plan.js`:

```js
import { formatCents } from "./money.js";
import { ledgerInvoiceKey } from "./payment-summary.js";

/** The invoice keys a reversal row copies from the row it reverses (local id, and Seazona ids on Seazona-era rows). */
export const invoiceKeysOf = (r) => ({
  invoiceId: r.invoiceId ?? null,
  seazonaClientId: r.seazonaClientId ?? null,
  seazonaInvoiceId: r.seazonaInvoiceId ?? null,
  invoiceNumber: r.invoiceNumber ?? null,
});

/**
 * Plan the ledger side of a refund. No `allocations` → FULL: negate every
 * original row (the gateway reverses the whole charge; totalCents null).
 * With `allocations` ([{ invoiceId, amountCents }], invoiceId = the row's
 * ledgerInvoiceKey) → PARTIAL: one negative row per named slice, each capped at
 * what that invoice was charged. Returns { totalCents, rows } or { error }.
 */
export function planRefund(originalRows, allocations) {
  if (!allocations) {
    return { totalCents: null, rows: originalRows.map((r) => ({ ...invoiceKeysOf(r), userId: r.userId ?? null, appliedCents: -r.appliedCents })) };
  }
  const charged = new Map();
  for (const r of originalRows) {
    const key = String(ledgerInvoiceKey(r));
    const c = charged.get(key);
    charged.set(key, { row: c?.row ?? r, cents: (c?.cents ?? 0) + r.appliedCents });
  }
  const seen = new Set();
  const rows = [];
  for (const a of allocations) {
    const key = String(a.invoiceId);
    const c = charged.get(key);
    if (!c) return { error: `Invoice ${key} is not part of this charge.` };
    if (seen.has(key)) return { error: `Invoice ${key} appears more than once.` };
    seen.add(key);
    if (a.amountCents > c.cents) {
      return { error: `Refund for invoice ${c.row.invoiceNumber || key} exceeds the ${formatCents(c.cents)} charged to it.` };
    }
    rows.push({ ...invoiceKeysOf(c.row), userId: c.row.userId ?? null, appliedCents: -a.amountCents });
  }
  return { totalCents: rows.reduce((s, r) => s - r.appliedCents, 0), rows };
}
```

- [ ] **Step 4: Rewrite recording and verification against local invoices**

`apps/api/src/services/payment-recording.service.js` (whole file):

```js
import { inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { invoices, invoicePayments } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { formatCents } from "../lib/money.js";
import { sendPaymentReceipt } from "./email.service.js";
import * as auditService from "./audit.service.js";
import { paidCentsByInvoice } from "./billing/ledger.service.js";
import { deriveBalance } from "./billing/invoice-rules.js";

/**
 * After money moved (a captured card charge) or was received (a manual
 * payment staff record): write one invoice_payments row per allocated
 * invoice, send the receipt, and audit. Our ledger is the system of record;
 * nothing is written to the legacy lab system (own-the-lab piece 3).
 *
 * Allocations: [{ invoiceId, invoiceNumber, amountCents }] against local
 * invoices. `source`: doctor_card | doctor_hosted | admin_card | autopay |
 * admin_check | admin_cash | admin_ach | admin_other. `paidOn` / `reference`
 * are set by manual payments only. `wasCharged` false = no card was charged
 * (receipt copy says "recorded").
 *
 * Returns { ledgerWriteFailed }. NEVER throws: after a card charge the money is
 * captured, so a ledger failure is logged loudly ([PAYMENT][LEDGER_WRITE_FAILED],
 * ids and amounts only) rather than 500ing a request a retry would re-charge.
 */
export async function recordPaymentAndAllocations({
  user,
  amountCents,
  transactionId,
  allocations,
  source = null,
  wasCharged = true,
  auditAction = "payment.charge",
  actorUserId = null,
  paidOn = null,
  reference = null,
}) {
  let ledgerWriteFailed = false;
  try {
    await db.insert(invoicePayments).values(
      allocations.map((a) => ({
        id: createId(),
        userId: user.id,
        invoiceId: String(a.invoiceId),
        invoiceNumber: a.invoiceNumber != null ? String(a.invoiceNumber) : null,
        appliedCents: a.amountCents,
        transactionId,
        source,
        paidOn,
        reference,
      }))
    );
  } catch (ledgerErr) {
    ledgerWriteFailed = true;
    console.error(
      `[PAYMENT][LEDGER_WRITE_FAILED] payment ${transactionId} was ${wasCharged ? "charged" : "received"} but the invoice ledger insert failed — manual reconcile required ` +
        JSON.stringify({
          transactionId,
          userId: user.id,
          amountCents,
          invoices: allocations.map((a) => ({ invoiceId: a.invoiceId, amountCents: a.amountCents })),
          error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
        })
    );
  }

  // Receipt (soft-fail). A manual record that failed to save recorded nothing,
  // so it gets no receipt; a captured card charge always does.
  if (user.email && !(ledgerWriteFailed && !wasCharged)) {
    try {
      await sendPaymentReceipt({
        to: user.email,
        amountCents,
        invoices: allocations.map((a) => ({ number: a.invoiceNumber || a.invoiceId, amountCents: a.amountCents })),
        transactionId,
        date: new Date(),
        wasCharged,
      });
    } catch {
      /* deliver() never throws; belt-and-suspenders */
    }
  }

  await auditService.logSafe({
    userId: actorUserId || user.id,
    action: auditAction,
    targetType: "transaction",
    targetId: transactionId,
    metadata: {
      amountCents,
      source,
      invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
      ledgerWriteFailed,
    },
  });

  return { ledgerWriteFailed };
}

/**
 * Check a payment's allocations against our invoices: each one exists, belongs
 * to the payer (`clientUserId === user.id`), is issued, appears once, and (with
 * `enforceCap`) is not paid past its balance after payments, credits and
 * refunds. Backfills `invoiceNumber`. Returns null when all good, else
 * { kind: "forbidden" | "validation", message } (→ 403 / 422).
 *
 * Concurrency: every caller holds withInvoiceLocks (lib/payment-helpers.js)
 * across verify-with-cap → charge → record. A DB row lock can't do that job:
 * the card charge happens between the check and the write, outside any
 * transaction.
 */
export async function verifyAllocations(allocations, user, { enforceCap = false, database = db } = {}) {
  const ids = allocations.map((a) => String(a.invoiceId));
  if (new Set(ids).size !== ids.length) {
    return { kind: "validation", message: "Each invoice can appear only once in a payment." };
  }
  const rows = ids.length
    ? await database
        .select({
          id: invoices.id, invoiceNumber: invoices.invoiceNumber, clientUserId: invoices.clientUserId,
          status: invoices.status, totalCents: invoices.totalCents,
        })
        .from(invoices)
        .where(inArray(invoices.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paid = enforceCap ? await paidCentsByInvoice(ids, database) : null;
  for (const a of allocations) {
    const inv = byId.get(String(a.invoiceId));
    // Not found and not yours read the same, so invoice ids can't be probed.
    if (!inv || inv.clientUserId !== user.id) {
      return { kind: "forbidden", message: `Invoice ${a.invoiceNumber || a.invoiceId} is not on this account.` };
    }
    a.invoiceNumber = String(inv.invoiceNumber);
    if (inv.status !== "issued") {
      return {
        kind: "validation",
        message: `Invoice #${inv.invoiceNumber} ${inv.status === "void" ? "is void" : "hasn't been issued yet"} and can't be paid.`,
      };
    }
    if (enforceCap) {
      const { balanceCents } = deriveBalance(inv, paid.get(inv.id) ?? 0);
      if (a.amountCents > balanceCents) {
        return {
          kind: "validation",
          message: `${formatCents(a.amountCents)} for invoice #${inv.invoiceNumber} exceeds its balance of ${formatCents(Math.max(0, balanceCents))}.`,
        };
      }
    }
  }
  return null;
}
```

- [ ] **Step 5: Allocations in cents on the wire**

`packages/shared/src/schemas/payment.schema.js`. Replace everything from the `hasAtMost2Decimals` helper through `hostedCompleteSchema` with:

```js
// At-most-2-decimal-places guard that doesn't trip on float drift (the
// checkout's dollar `amount` is the only dollar field left on the wire).
const hasAtMost2Decimals = (n) => Number(n.toFixed(2)) === n;

/** Integer cents, positive, capped at $100,000. */
const amountCents = z.number().int().positive().max(10_000_000);

/** One slice of a payment applied to one of OUR invoices (own-the-lab piece 3). */
export const allocationSchema = z.object({
  invoiceId: z.string().min(1).max(128),
  amountCents,
});

const sumOf = (allocations) => allocations.reduce((s, a) => s + a.amountCents, 0);
const eachInvoiceOnce = (allocations) => new Set(allocations.map((a) => a.invoiceId)).size === allocations.length;
const allocations = z.array(allocationSchema).min(1)
  .refine(eachInvoiceOnce, { message: "Each invoice can appear only once." });

/** POST /payments/charge-saved (and the admin charge-on-behalf) — a saved card across invoices. */
export const chargeSavedSchema = z
  .object({ paymentProfileId: z.string().min(1), amountCents, allocations })
  .refine((d) => sumOf(d.allocations) === d.amountCents, {
    message: "Allocations must add up to the charge.",
    path: ["allocations"],
  });

/**
 * POST /payments/hosted-token — the hosted page's amount is the allocation sum,
 * computed server-side. Extra fields (iframeCommunicatorUrl, saveCard) pass through.
 */
export const hostedTokenSchema = z.object({ allocations }).passthrough();

/**
 * POST /admin/payments/refund. Omit `allocations` for a FULL reversal; give
 * slices for a PARTIAL refund (settled charges only). `invoiceId` is the ledger
 * row's invoice key (our invoice id, or the Seazona id on a Seazona-era row).
 */
export const refundAllocationSchema = z.object({ invoiceId: z.string().min(1).max(128), amountCents });

export const refundSchema = z.object({
  transactionId: z.string().min(1),
  allocations: z.array(refundAllocationSchema).min(1).optional(),
});

/** POST /payments/hosted-complete — finalize a hosted charge (bound to its token). */
export const hostedCompleteSchema = z.object({
  transId: z.string().min(1),
  refId: z.string().min(1),
  allocations,
});
```

(The old dollar `amount` constant is deleted; `checkoutSchema` below keeps using `hasAtMost2Decimals`.)

`apps/api/src/routes/invoice-payment.routes.js` (whole file):

```js
import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile } from "../services/card.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { invoicePayments } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { formatCents, toCents, toDecimalString } from "../lib/money.js";
import { ERROR_CODES, chargeSavedSchema, hostedTokenSchema, hostedCompleteSchema } from "@my-app/shared";
import {
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
  safeParse,
} from "../lib/payment-helpers.js";
import { verifyAllocations, recordPaymentAndAllocations } from "../services/payment-recording.service.js";
import { CHARGE_RATE_LIMIT, chargeErrorReply, sendInvoiceLockedError, sendAllocationError } from "./payment-replies.js";

// Hosted-payment binding record TTL (C2): a doctor has ~30 min to complete a
// hosted charge before the issued token's server-side binding expires.
const HOSTED_BINDING_TTL = 30 * 60;

const sumCentsOf = (allocations) => allocations.reduce((s, a) => s + a.amountCents, 0);

/**
 * A doctor pays their invoices: with a saved card (charge-saved), or a new card
 * on Authorize.net's hosted page (hosted-token → hosted-complete, SAQ A).
 * Allocations are [{ invoiceId, amountCents }] against OUR invoices. Every
 * request first proves the invoices are the caller's (verifyAllocations); the
 * balance cap is re-checked inside the per-invoice locks, right before money
 * moves or is recorded. Dollars appear only on the Authorize.net wire
 * (toDecimalString out, toCents back).
 */
export default async function invoicePaymentRoutes(fastify) {
  // Requires an Idempotency-Key header (H1/L5): the frontend mints one per submit.
  fastify.post("/payments/charge-saved", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(chargeSavedSchema)],
  }, async (request, reply) => {
    const { paymentProfileId, amountCents, allocations } = request.body;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;

    const idempotencyKey = request.headers["idempotency-key"] || null;
    if (!idempotencyKey) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
    }
    if (!customerProfileId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No saved-card profile on file for this account." } });
    }
    // Ownership (no cap) runs OUTSIDE the idempotency replay path: every request,
    // a replay included, must first prove the invoices are the caller's, so a
    // guessed key can't replay another doctor's result.
    const own = await verifyAllocations(allocations, request.user);
    if (own) return sendAllocationError(reply, own);

    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `charge-saved:${request.user.id}:${idempotencyKey}`,
        async () =>
          // D1: two different keys hitting one invoice must not both pass the cap.
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              const capErr = await verifyAllocations(allocations, request.user, { enforceCap: true });
              if (capErr) throw Object.assign(new Error("allocation_error"), { allocationError: capErr });
              const result = await authorizenetService.chargeCustomerProfile({
                customerProfileId,
                paymentProfileId,
                amount: toDecimalString(amountCents),
                invoiceNumber: allocations[0].invoiceNumber,
              });
              const { ledgerWriteFailed } = await recordPaymentAndAllocations({
                user: request.user,
                amountCents,
                transactionId: result.transactionId,
                allocations,
                source: "doctor_card",
              });
              return { ...result, amountCents, ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}) };
            },
            { log: fastify.log }
          ),
        { log: fastify.log }
      );
    } catch (err) {
      if (err?.allocationError) return sendAllocationError(reply, err.allocationError);
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      if (err instanceof ChargeInProgressError) return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      fastify.log.warn({ userId: request.user.id, err: String(err?.message || err) }, "charge-saved failed");
      return chargeErrorReply(reply, err);
    }
    return { data: outcome.result };
  });

  // A new card on Authorize.net's hosted page. The amount is the allocation
  // sum, baked into the token server-side; the mode follows AUTHORIZE_NET_ENV.
  fastify.post("/payments/hosted-token", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(hostedTokenSchema)],
  }, async (request, reply) => {
    const { allocations, iframeCommunicatorUrl, saveCard } = request.body || {};
    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }
    const v = await verifyAllocations(allocations, request.user);
    if (v) return sendAllocationError(reply, v);
    const amountCents = sumCentsOf(allocations);

    // Save-card: create the CIM profile lazily so the gateway has a customer
    // to attach the new card to.
    const customerProfileId = saveCard ? await ensureCustomerProfile(request.user) : undefined;

    // C2: bind the transaction to THIS doctor and THIS token. hosted-complete
    // records only a transaction whose order.invoiceNumber matches a binding
    // owned by the caller, and records the allocations bound here.
    const refId = `H${createId().slice(0, 14)}`;
    await redis.set(
      `rxpay:hosted:${refId}`,
      JSON.stringify({ userId: request.user.id, allocations, amountCents }),
      "EX",
      HOSTED_BINDING_TTL
    );

    const result = await authorizenetService.getHostedPaymentPageToken({
      amount: toDecimalString(amountCents),
      // order.invoiceNumber round-trips through getTransactionDetails; the refId does not reliably.
      invoiceNumber: refId,
      description: `Diamond Labs — invoice(s): ${allocations.map((a) => a.invoiceNumber).join(", ")}`.slice(0, 255),
      refId,
      iframeCommunicatorUrl,
      customerProfileId,
      allowSaveCard: Boolean(saveCard),
    });
    if (!result?.token) {
      await redis.del(`rxpay:hosted:${refId}`).catch(() => {});
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not get a payment form token." } });
    }
    return { data: { token: result.token, formUrl: result.formUrl, refId, amountCents } };
  });

  // Finalize a hosted payment: verify what Authorize.net captured, then record
  // the ledger. Idempotent on transId. A saved card lives at the gateway under
  // the doctor's CIM profile; nothing to store here.
  fastify.post("/payments/hosted-complete", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(hostedCompleteSchema)],
  }, async (request, reply) => {
    const { transId, refId, allocations } = request.body;

    const existing = await db.select().from(invoicePayments).where(eq(invoicePayments.transactionId, String(transId)));
    if (existing.length) return { data: { transId, alreadyRecorded: true, rows: existing.length } };

    // C2 (a): the binding must exist and be the caller's.
    const binding = safeParse(await redis.get(`rxpay:hosted:${refId}`));
    if (!binding || String(binding.userId) !== String(request.user.id)) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Payment session not found or does not belong to your account." } });
    }
    // Record what the token was issued for, never caller-supplied allocations.
    const boundAllocations = Array.isArray(binding.allocations) && binding.allocations.length ? binding.allocations : allocations;

    const details = await authorizenetService.getTransactionDetails(transId);
    if (!details) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });

    // C2 (b): the captured transaction carries our binding token.
    if (String(details.orderInvoiceNumber) !== String(refId) && String(details.refId) !== String(refId)) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Transaction does not match the issued payment session." } });
    }
    // C2 (c): only an approved, captured or settled transaction is recordable.
    const SETTLED_OR_PENDING = new Set(["capturedPendingSettlement", "settledSuccessfully"]);
    if (String(details.responseCode) !== "1" || !SETTLED_OR_PENDING.has(String(details.transactionStatus))) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Transaction is not in a recordable state (status: ${details.transactionStatus || "unknown"}).` },
      });
    }
    // C2 (d): captured amount = the bound allocation sum, to the cent.
    const capturedCents = toCents(details.amount);
    const boundCents = sumCentsOf(boundAllocations);
    if (capturedCents !== boundCents) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Allocation total (${formatCents(boundCents)}) does not match the captured amount (${formatCents(capturedCents)}).` },
      });
    }

    // D1: lock the bound invoices across cap check → ledger write.
    let recorded;
    try {
      recorded = await withInvoiceLocks(
        redis,
        boundAllocations.map((a) => a.invoiceId),
        async () => {
          const v = await verifyAllocations(boundAllocations, request.user, { enforceCap: true });
          if (v) return { allocationError: v };
          return {
            result: await recordPaymentAndAllocations({
              user: request.user,
              amountCents: capturedCents,
              transactionId: String(transId),
              allocations: boundAllocations,
              source: "doctor_hosted",
            }),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      throw err;
    }
    if (recorded.allocationError) return sendAllocationError(reply, recorded.allocationError);

    // One-time use.
    await redis.del(`rxpay:hosted:${refId}`).catch(() => {});
    return {
      data: {
        transId,
        amountCents: capturedCents,
        status: details.status,
        recorded: true,
        ...(recorded.result.ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
      },
    };
  });
}
```

`apps/api/src/routes/admin-payment.routes.js`. In `POST /admin/users/:userId/payments/charge-saved`, make these changes:
- Add `import { toDecimalString } from "../lib/money.js";` to the imports.
- Replace `const { paymentProfileId, amount, allocations } = request.body;` with `const { paymentProfileId, amountCents, allocations } = request.body;`.
- Delete the `if (!doctor.seazonaClientId) { … SEAZONA_CLIENT_NOT_LINKED … }` block.
- Inside the lock, replace the charge and record calls and the return with:

```js
              const result = await authorizenetService.chargeCustomerProfile({
                customerProfileId,
                paymentProfileId,
                amount: toDecimalString(amountCents),
                invoiceNumber: allocations[0].invoiceNumber,
              });
              const { ledgerWriteFailed } = await recordPaymentAndAllocations({
                user: doctor,
                amountCents,
                transactionId: result.transactionId,
                allocations,
                source: "admin_card",
              });
              return { ...result, amountCents, ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}) };
```

- Replace the audit metadata with:

```js
        metadata: {
          amountCents,
          transactionId: outcome.result.transactionId,
          invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
        },
```

- In `loadDoctor`'s doc comment, "verifyAllocations" still applies. Keep `seazonaClientId` / `seazonaAccountNumber` in its select (AutoPay oversight lists show the account number).

`apps/api/src/routes/payment.routes.js`:
- change the ledger import to `import { listPaymentsForUser, listAllPayments } from "../services/billing/ledger.service.js";`;
- in `GET /admin/payments`'s `q` filter, delete the line `(p.seazonaClientId || "").toLowerCase().includes(needle) ||`.

`apps/api/src/services/email.service.js`. Make the two invoice receipts take cents:
- add `import { formatCents } from "../lib/money.js";` to the imports;
- change the signatures:
  - `export async function sendPaymentReceipt({ to, amountCents, invoices = [], transactionId, date, wasCharged = true }) {`
  - `export async function sendRefundReceipt({ to, amountCents, invoices = [], transactionId, date }) {`
- in the bodies of those two functions only, swap the money calls (the order receipt above them keeps `money()`):

```bash
cd apps/api
start=$(grep -n "^export async function sendPaymentReceipt" src/services/email.service.js | cut -d: -f1)
sed -i '' "${start},\$ s/money(i\.amount)/formatCents(i.amountCents)/; ${start},\$ s/money(amount)/formatCents(amountCents)/" src/services/email.service.js
grep -n "money(" src/services/email.service.js   # only the order receipt's money() calls remain
```

In the doc comment of `sendPaymentReceipt`, replace "or entered directly in Seazona" with "or ACH".

- [ ] **Step 6: Refunds in cents, with no Seazona credit**

`apps/api/src/routes/refund.routes.js` (whole file):

```js
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { sendRefundReceipt } from "../services/email.service.js";
import { voidOrRefund } from "../lib/void-refund.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, invoicePayments } from "../db/schema/index.js";
import { and, eq, gt, isNull, notInArray, or } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { toCents } from "../lib/money.js";
import { planRefund, invoiceKeysOf } from "../lib/refund-plan.js";
import { ERROR_CODES, refundSchema, SHOP_PAYMENT_SOURCE, CREDIT_SOURCE } from "@my-app/shared";
import { withIdempotency, ChargeInProgressError, extractDeclineMessage } from "../lib/payment-helpers.js";

const invoiceRef = (r) => r.invoiceNumber || r.invoiceId || r.seazonaInvoiceId;

export default async function refundRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // ADMIN REFUND / VOID: reverse a card payment recorded through the portal.
  //
  // Voids an unsettled charge or refunds a settled one at Authorize.net, then
  // reverses OUR ledger (negative invoice_payments rows), which reopens the
  // invoices' balances. Nothing is written to the legacy lab system (own-the-lab piece 3).
  // FULL (no allocations) or PARTIAL by invoice slice (settled charges only).
  // ONE reversal per charge: the double-refund guard rejects a second one.
  //
  // Concurrency: guard + gateway reversal + ledger + receipt run inside
  // withIdempotency keyed on the charge's transaction id. Nothing after the
  // gateway call may throw out of the locked fn, so a successful reversal is
  // always cached rather than followed by a lock release that permits a re-refund.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/admin/payments/refund", {
    preHandler: [authenticate, requireAdmin, validate(refundSchema)],
  }, async (request, reply) => {
    const { transactionId, allocations } = request.body;
    const txid = String(transactionId);

    // 1. The ORIGINAL charge's rows (positive only). Shop checkouts and staff
    //    credits are not portal card payments: never refunded here.
    const originalRows = await db
      .select()
      .from(invoicePayments)
      .where(and(
        eq(invoicePayments.transactionId, txid),
        gt(invoicePayments.appliedCents, 0),
        or(isNull(invoicePayments.source), notInArray(invoicePayments.source, [SHOP_PAYMENT_SOURCE, CREDIT_SOURCE])),
      ));
    if (!originalRows.length) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "No portal payment found for that transaction id." } });
    }

    // 2. The reversal plan (read-only; no money moves yet).
    const plan = planRefund(originalRows, allocations);
    if (plan.error) return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: plan.error } });

    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `refund:${txid}`,
        async () => {
          // 3a. Double-refund guard (inside the lock, so check-then-act can't race).
          const existingRefund = await db
            .select({ id: invoicePayments.id })
            .from(invoicePayments)
            .where(eq(invoicePayments.refundsTransactionId, txid));
          if (existingRefund.length) throw Object.assign(new Error("already_refunded"), { alreadyRefunded: true });

          // 3b. Read the doctor BEFORE the gateway call, while a DB error is still safe.
          const refundUser = originalRows[0].userId
            ? (await db.select().from(users).where(eq(users.id, originalRows[0].userId)))[0] || null
            : null;

          // 3c. WRITE-AHEAD guard: a durable double-refund marker before touching
          //     the gateway, rolled back only if the gateway definitely moved no money.
          const guardRowId = createId();
          await db.insert(invoicePayments).values({
            id: guardRowId,
            ...invoiceKeysOf(originalRows[0]),
            userId: originalRows[0].userId ?? null,
            appliedCents: 0,
            transactionId: `REFUND-PENDING-${txid}`,
            refundsTransactionId: txid,
          });

          // 3d. Reverse at the gateway (void if unsettled, refund if settled).
          //     Dollars only on the wire.
          let result;
          try {
            result = await voidOrRefund(txid, plan.totalCents == null ? undefined : plan.totalCents / 100);
          } catch (gwErr) {
            const definitivelyNoMoneyMoved = !!gwErr.refundErrorKind || !!gwErr.authNetResponse;
            if (definitivelyNoMoneyMoved) {
              await db.delete(invoicePayments).where(eq(invoicePayments.id, guardRowId)).catch(() => {});
              throw gwErr;
            }
            console.error(
              `[PAYMENT][REFUND_UNCERTAIN] reversal of charge ${txid} failed without a definitive gateway response — the charge MAY already be reversed; guard row ${guardRowId} kept to block a retry, manual reconcile required ` +
                JSON.stringify({ transactionId: txid, error: String(gwErr?.message || gwErr).slice(0, 300) })
            );
            throw Object.assign(gwErr, { refundUncertain: true });
          }

          // The money is back at the gateway. Nothing below may throw.
          const refundTxnId = result.transactionId || `REFUND-${txid}`;
          const refundedCents = toCents(result.amount);

          // 4. Reverse OUR ledger: rows that sum to exactly what was reversed.
          const reversalRows = plan.rows.map((r) => ({
            id: createId(), ...r, transactionId: refundTxnId, refundsTransactionId: txid, source: "refund",
          }));
          let ledgerWriteFailed = false;
          try {
            await db.insert(invoicePayments).values(reversalRows);
          } catch (ledgerErr) {
            ledgerWriteFailed = true;
            console.error(
              `[PAYMENT][REFUND_LEDGER_WRITE_FAILED] refund/void ${refundTxnId} for charge ${txid} succeeded at Authorize.net but the ledger reversal insert failed — manual reconcile required ` +
                JSON.stringify({
                  transactionId: txid, refundTransactionId: refundTxnId, action: result.action, amountCents: refundedCents,
                  invoices: reversalRows.map(invoiceRef), error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
                })
            );
            // The write-ahead guard row (3c) already blocks a re-refund.
          }

          // 5. Refund receipt (soft-fail).
          if (refundUser?.email) {
            try {
              await sendRefundReceipt({
                to: refundUser.email,
                amountCents: refundedCents,
                invoices: reversalRows.map((r) => ({ number: invoiceRef(r), amountCents: -r.appliedCents })),
                transactionId: txid,
                date: new Date(),
              });
            } catch {
              /* deliver() never throws */
            }
          }

          // 6. Audit (ids and amounts only), inside the idempotent block so a replay doesn't double-record.
          const invoicesRef = reversalRows.map(invoiceRef);
          console.log("[PAYMENT][REFUND] " + JSON.stringify({ admin: request.user.id, transactionId: txid, action: result.action, amountCents: refundedCents, invoices: invoicesRef }));
          await auditService.logSafe({
            userId: request.user.id,
            action: "payment.refund",
            targetType: "transaction",
            targetId: txid,
            metadata: {
              kind: result.action,
              partial: plan.totalCents != null,
              amountCents: refundedCents,
              refundTransactionId: refundTxnId,
              invoices: invoicesRef,
              ledgerWriteFailed,
            },
            ipAddress: request.ip,
          });

          return {
            action: result.action,
            refundTransactionId: refundTxnId,
            amountCents: refundedCents,
            ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err?.alreadyRefunded) return reply.code(409).send({ error: ERROR_CODES.ALREADY_REFUNDED });
      if (err instanceof ChargeInProgressError) return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      if (err?.refundErrorKind === "not_found") return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: err.message } });
      if (err?.refundErrorKind === "validation") return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      // Outcome unknown: tell the admin NOT to retry (the guard row stays).
      if (err?.refundUncertain) return reply.code(ERROR_CODES.REFUND_UNCERTAIN.status).send({ error: ERROR_CODES.REFUND_UNCERTAIN });
      fastify.log.warn({ transactionId: txid, err: String(err?.message || err) }, "refund gateway call failed");
      // A refund/void gateway error is not a card decline.
      if (err?.authNetResponse) {
        const message = extractDeclineMessage(err.authNetResponse) || ERROR_CODES.REFUND_FAILED.message;
        return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: { ...ERROR_CODES.REFUND_FAILED, message } });
      }
      return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: ERROR_CODES.REFUND_FAILED });
    }

    return { data: outcome.result };
  });
}
```

- [ ] **Step 7: Run the tests and the suite**

```bash
cd apps/api && pnpm vitest run src/services/billing src/lib src/services/payment-recording.service.test.js src/routes/__tests__   # PASS
grep -n "seazonaService\|createPayment\|SEAZONA_CLIENT_NOT_LINKED" src/routes/invoice-payment.routes.js src/routes/refund.routes.js src/routes/admin-payment.routes.js src/services/payment-recording.service.js   # no output
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

Expected: everything passes.
- `admin-offline-payment.routes.test.js` and `admin-invoices.routes.test.js` still pass: they mock the old modules and are deleted in Task 8.
- `autopay.job.test.js` still passes: it mocks recording; Task 7 rewrites the runner.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src packages/shared/src
git commit -m "feat(billing): payments verify and record against local invoices in cents; no Seazona payment writes

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 7: AutoPay on local invoices; `allocateOldestFirst` in cents, shared

The allocator moves to `packages/shared` so the pay screens (Tasks 12–13) preview exactly the split the server records. Money arithmetic must not have two places to diverge.

**Files:**
- Create: `packages/shared/src/billing/allocation.js`
- Move: `apps/api/src/lib/autopay-allocation.test.js` → `packages/shared/src/billing/allocation.test.js` (`git mv`, then rewritten)
- Delete: `apps/api/src/lib/autopay-allocation.js`
- Modify (rewrite): `apps/api/src/services/autopay-runner.service.js`
- Modify: `apps/api/src/jobs/definitions/autopay.job.test.js`, `packages/shared/src/index.js`

**Interfaces:**
- Consumes (Task 6): `openInvoicesForClient(clientUserId) → [{ id, invoiceNumber, balanceCents, dueDate, issuedOn }]`; `verifyAllocations`, `recordPaymentAndAllocations` (cents).
- Produces (from `@my-app/shared`):
  - `resolveChargeCents({ enrolledCents, totalBalanceCents }) → cents` (replaces `resolveChargeAmount`);
  - `sortOldestFirst(invoices) → invoices` (due date ascending, undated last, then invoice number);
  - `allocateOldestFirst(invoices: [{ id, invoiceNumber, balanceCents, dueDate }], chargeCents) → { allocations: [{ invoiceId, invoiceNumber, amountCents }], totalAllocatedCents }`.
  - Task 9's manual payments and Tasks 12–13's pay screens reuse `allocateOldestFirst`.
  - `autopay_attempts.allocations` jsonb now stores the cents shape. `amount_attempted` / `amount_charged` stay `numeric` dollars, written with `toDecimalString`. The job summary's `totalAmount` stays dollars (AdminJobsPage renders it).

- [ ] **Step 1: Write the failing tests**

```bash
git mv apps/api/src/lib/autopay-allocation.test.js packages/shared/src/billing/allocation.test.js
```

`packages/shared/src/billing/allocation.test.js` (whole file):

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { allocateOldestFirst, resolveChargeCents, sortOldestFirst } from "./allocation.js";

const inv = (id, balanceCents, dueDate, invoiceNumber = `IN-${id}`) => ({ id, balanceCents, dueDate, invoiceNumber });

test("the enrolled amount, or the whole balance when that is less; never negative", () => {
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: 120000 }), 50000);
  // The payoff rule: the floor governs ENROLLMENT, not the final payment.
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: 18000 }), 18000);
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: 0 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: -1200 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: -5000, totalBalanceCents: 10000 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: NaN, totalBalanceCents: 10000 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: 100.5, totalBalanceCents: 10000 }), 0, "dollars are refused");
});

test("fills the oldest invoice first, then spills into the next", () => {
  const { allocations, totalAllocatedCents } = allocateOldestFirst(
    [inv("b", 30000, "2026-03-01"), inv("a", 20000, "2026-01-01"), inv("c", 40000, "2026-05-01")],
    60000,
  );
  assert.deepEqual(allocations, [
    { invoiceId: "a", invoiceNumber: "IN-a", amountCents: 20000 },
    { invoiceId: "b", invoiceNumber: "IN-b", amountCents: 30000 },
    { invoiceId: "c", invoiceNumber: "IN-c", amountCents: 10000 },
  ]);
  assert.equal(totalAllocatedCents, 60000);
});

test("stops at the total balance, omits invoices that get nothing, skips zero and negative balances", () => {
  assert.equal(allocateOldestFirst([inv("a", 5000, "2026-01-01"), inv("b", 2500, "2026-02-01")], 50000).totalAllocatedCents, 7500);
  assert.deepEqual(allocateOldestFirst([inv("a", 20000, "2026-01-01"), inv("b", 30000, "2026-02-01")], 20000).allocations.map((x) => x.invoiceId), ["a"]);
  assert.deepEqual(
    allocateOldestFirst([inv("a", 0, "2026-01-01"), inv("b", -500, "2026-02-01"), inv("c", 10000, "2026-03-01")], 10000).allocations.map((x) => x.invoiceId),
    ["c"],
  );
});

test("a zero, NaN or dollar charge allocates nothing", () => {
  for (const charge of [0, NaN, 100.5]) {
    assert.deepEqual(allocateOldestFirst([inv("a", 10000, "2026-01-01")], charge), { allocations: [], totalAllocatedCents: 0 });
  }
});

test("sortOldestFirst is the order the pay screens list invoices in", () => {
  const sorted = sortOldestFirst([inv("c", 1, undefined), inv("b", 1, "2026-03-01"), inv("a", 1, "2026-01-01")]);
  assert.deepEqual(sorted.map((i) => i.id), ["a", "b", "c"]);
});

test("ties on due date fall back to invoice number, compared as numbers", () => {
  const { allocations } = allocateOldestFirst(
    [{ id: "x", invoiceNumber: 100000, balanceCents: 100, dueDate: "2026-01-01" }, { id: "y", invoiceNumber: 99999, balanceCents: 100, dueDate: "2026-01-01" }],
    100,
  );
  assert.equal(allocations[0].invoiceNumber, "99999");
});

// An undated invoice must not outrank one that is demonstrably older (a live dry
// run once paid two undated invoices ahead of an overdue 2024 one).
test("an invoice with no due date sorts after every dated one, deterministically among themselves", () => {
  assert.deepEqual(allocateOldestFirst([inv("b", 10000, undefined), inv("a", 10000, "2026-02-01")], 20000).allocations.map((x) => x.invoiceId), ["a", "b"]);
  const { allocations } = allocateOldestFirst([inv("u1", 48000, undefined), inv("u2", 1650, undefined), inv("old", 1500, "2024-10-25")], 10000);
  assert.deepEqual([allocations[0].invoiceId, allocations[0].amountCents], ["old", 1500]);
  assert.deepEqual(
    allocateOldestFirst([inv("b", 5000, undefined, "IN-2"), inv("a", 5000, undefined, "IN-1")], 10000).allocations.map((x) => x.invoiceNumber),
    ["IN-1", "IN-2"],
  );
});
```

`apps/api/src/jobs/definitions/autopay.job.test.js`. Edit it as follows:

1. Delete the Seazona mock (the `seazonaGetAllInvoicesResult` const and its `vi.mock("../../services/seazona.service.js", …)`) and the old ledger mock (`ledgerGetClientPaidMapStrict` and its `vi.mock("../../services/invoice-ledger.service.js", …)`). Add in their place:

```js
// The sweep reads each due doctor's open invoices from OUR ledger
// (own-the-lab piece 3) — controllable per test, incl. a read failure.
const ledgerOpenInvoicesForClient = vi.fn(async () => []);
vi.mock("../../services/billing/ledger.service.js", () => ({
  openInvoicesForClient: (...args) => ledgerOpenInvoicesForClient(...args),
}));
```

2. Replace the `invoices` and `rawSeazonaInvoices` fixtures with:

```js
const invoices = [
  { id: "i1", invoiceNumber: 1001, balanceCents: 30000, dueDate: "2026-01-01" },
  { id: "i2", invoiceNumber: 1002, balanceCents: 40000, dueDate: "2026-02-01" },
];
```

3. In `beforeEach`, replace the four `seazonaGetAllInvoicesResult` / `ledgerGetClientPaidMapStrict` lines with:

```js
  ledgerOpenInvoicesForClient.mockClear();
  ledgerOpenInvoicesForClient.mockImplementation(async () => invoices);
```

4. In `"charges the enrolled amount and allocates oldest-first"`, replace its three `expect` lines about the charge and allocations with:

```js
    expect(charged[0]).toMatchObject({ customerProfileId: "cp1", paymentProfileId: "pp1", amount: "500.00" });
    expect(recorded[0].amountCents).toBe(50000);
    expect(recorded[0].allocations).toEqual([
      { invoiceId: "i1", invoiceNumber: "1001", amountCents: 30000 },
      { invoiceId: "i2", invoiceNumber: "1002", amountCents: 20000 },
    ]);
```

5. In `"charges only the balance when it is under the enrolled amount"`, use `invoices: [{ id: "i1", invoiceNumber: 1001, balanceCents: 18000, dueDate: "2026-01-01" }]` and `expect(charged[0].amount).toBe("180.00");`.

6. Rename `"labels a 'forbidden' cap-check result as an unreachable/unavailable blip, not a flat 'not found'"` to `"records a 'forbidden' cap-check result as could-not-verify, never as a decline"` and change its reason assertion to `expect(attempt.failureReason).toMatch(/could not verify/i);`.

7. In `"records a failed attempt and charges nothing when the local ledger read fails"`, replace the mock line with `ledgerOpenInvoicesForClient.mockRejectedValueOnce(new Error("connection reset"));`.

8. Replace `"skips the Seazona archive fetch entirely when nothing is due"` with:

```js
  it("reads no invoices at all when nothing is due", async () => {
    dueRows = [];
    const summary = await runAutopaySweep({ dryRun: false, now, runId: "r1" });
    expect(summary.considered).toBe(0);
    expect(ledgerOpenInvoicesForClient).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });
```

9. Delete `"records a skipped attempt, leaves status untouched, and charges nothing when Seazona is unreachable"` (there is no upstream to be unreachable).

10. Rename `"charges a due enrollment end-to-end when Seazona and the ledger are healthy"` to `"charges a due enrollment end-to-end"`.

11. Replace `"fetches the Seazona invoice archive only once even with multiple due enrollments"` with:

```js
  it("reads each due doctor's own open invoices from the ledger", async () => {
    const doctor2 = { ...doctor, id: "u2" };
    const enrollment2 = { ...enrollment, id: "e2", userId: "u2" };
    dueRows = [{ enrollment, doctor }, { enrollment: enrollment2, doctor: doctor2 }];
    await runAutopaySweep({ dryRun: false, now, runId: "r1" });
    expect(ledgerOpenInvoicesForClient.mock.calls.map((c) => c[0])).toEqual(["u1", "u2"]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @my-app/shared exec vitest run src/billing/allocation.test.js && cd apps/api && pnpm vitest run src/jobs/definitions/autopay.job.test.js`
Expected: FAIL. `allocation.js` doesn't exist; the runner still fetches from Seazona.

- [ ] **Step 3: Implement allocation in cents, in shared**

```bash
git rm apps/api/src/lib/autopay-allocation.js
```

`packages/shared/src/billing/allocation.js`:

```js
/**
 * Splitting money across a client's open invoices, in integer cents. One
 * implementation for AutoPay, staff-recorded manual payments (API) and the
 * pay screens' preview (web), so what a person sees is what gets recorded.
 */

/**
 * How much an AutoPay cycle charges. The payoff rule: AUTOPAY_MIN_AMOUNT
 * governs what a doctor may ENROLL at, not what the final payment may be. If
 * the balance is less than the enrolled amount, charge the balance and close
 * the account out. A money function clamps its own inputs: anything that isn't
 * positive integer cents charges nothing.
 */
export function resolveChargeCents({ enrolledCents, totalBalanceCents }) {
  if (!Number.isSafeInteger(totalBalanceCents) || totalBalanceCents <= 0) return 0;
  if (!Number.isSafeInteger(enrolledCents) || enrolledCents <= 0) return 0;
  return Math.min(enrolledCents, totalBalanceCents);
}

const byNumberOrId = (a, b) => {
  const na = a.invoiceNumber ?? a.id;
  const nb = b.invoiceNumber ?? b.id;
  if (typeof na === "number" && typeof nb === "number") return na - nb;
  const sa = String(na);
  const sb = String(nb);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

/**
 * Oldest due first. A missing due date sorts LAST: "no date recorded" is not
 * "most overdue" (a live dry run once paid two undated invoices ahead of a
 * genuinely overdue 2024 one, which got only the remainder). Ties fall back
 * to the invoice number.
 */
export function sortOldestFirst(invoices) {
  return [...(invoices || [])].sort((a, b) => {
    const da = a.dueDate ? String(a.dueDate) : null;
    const db = b.dueDate ? String(b.dueDate) : null;
    if (da === null && db !== null) return 1;
    if (db === null && da !== null) return -1;
    if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
    return byNumberOrId(a, b);
  });
}

/**
 * Spread `chargeCents` across open invoices, oldest due first
 * (sortOldestFirst), spilling into the next once one is filled.
 *
 * @param {Array<{ id: string, invoiceNumber?: number|string, balanceCents: number, dueDate?: string|null }>} invoices
 * @returns {{ allocations: Array<{ invoiceId: string, invoiceNumber: string|null, amountCents: number }>, totalAllocatedCents: number }}
 */
export function allocateOldestFirst(invoices, chargeCents) {
  if (!Number.isSafeInteger(chargeCents) || chargeCents <= 0) return { allocations: [], totalAllocatedCents: 0 };
  const ordered = sortOldestFirst((invoices || []).filter((i) => Number.isSafeInteger(i.balanceCents) && i.balanceCents > 0));

  let remaining = chargeCents;
  const allocations = [];
  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const amountCents = Math.min(invoice.balanceCents, remaining);
    allocations.push({
      invoiceId: String(invoice.id),
      invoiceNumber: invoice.invoiceNumber != null ? String(invoice.invoiceNumber) : null,
      amountCents,
    });
    remaining -= amountCents;
  }
  return { allocations, totalAllocatedCents: chargeCents - remaining };
}
```

`packages/shared/src/index.js`. Add under `// Billing`:

```js
export * from "./billing/allocation.js";
```

- [ ] **Step 4: Rewrite the runner against our ledger**

`apps/api/src/services/autopay-runner.service.js` (whole file):

```js
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { autopayEnrollments, autopayAttempts, users } from "../db/schema/index.js";
import { eq, and, or } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { toCents, toDecimalString } from "../lib/money.js";
import * as authorizenetService from "./authorizenet.service.js";
import { openInvoicesForClient } from "./billing/ledger.service.js";
import { verifyAllocations, recordPaymentAndAllocations } from "./payment-recording.service.js";
import { allocateOldestFirst, resolveChargeCents } from "@my-app/shared";
import { isDueOn, isRetryDay, cycleKeyFor, labDateFor } from "../lib/autopay-schedule.js";
import {
  withInvoiceLocks,
  withIdempotency,
  isGatewayOutcomePending,
  ChargeInProgressError,
  InvoiceLockedError,
} from "../lib/payment-helpers.js";
import * as emailService from "./email.service.js";

/**
 * The AutoPay sweep. Balances come from OUR invoices and ledger
 * (own-the-lab piece 3), so every payment, including the checks staff
 * record, is visible before a card is charged. That retires the old
 * "cap at the legacy system's balance" go-live precondition. AUTOPAY_LIVE_RUN
 * still gates real charges: turning it on is a cutover decision.
 *
 * Money is integer cents; the enrollment amount and the attempt amounts are
 * numeric(12,2) dollar columns, converted at the read (toCents) and the
 * write (toDecimalString).
 */

/**
 * Thrown (inside the per-invoice lock, before the gateway call) when a
 * SUCCESSFUL real charge already exists for this user and cycle. The redis
 * idempotency key is a 24h cache scoped to the enrollment id, which doesn't
 * survive a charge-day change or a re-enroll; this fresh DB read keyed on the
 * doctor is the durable layer. Recorded as `skipped`, never as a decline.
 */
class AlreadyChargedThisCycleError extends Error {
  constructor() {
    super("A successful AutoPay charge already exists for this user this cycle.");
    this.name = "AlreadyChargedThisCycleError";
  }
}

/**
 * Thrown (inside the lock, before the gateway call) when the in-lock
 * re-verification fails: another payment may have landed on these invoices
 * since the sweep read them. Recorded as `failed`, never counted against
 * consecutiveFailures (no card was touched).
 */
class AllocationCapExceededError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/** Every attempt row for this user in this cycle (filtered in JS by the two call sites). */
async function attemptsThisCycle(userId, cycleKey) {
  return db
    .select({ status: autopayAttempts.status, dryRun: autopayAttempts.dryRun })
    .from(autopayAttempts)
    .where(and(eq(autopayAttempts.userId, userId), eq(autopayAttempts.cycleKey, cycleKey)));
}

/**
 * The shape every attempt row shares. `cycleKey` defaults to the current
 * calendar cycle; a retry that rolled into next month passes its BASE cycle
 * (isRetryDay), or the durable per-cycle guard would break.
 */
function attemptBase({ enrollment, doctor, runId, now, dryRun, cycleKey }) {
  return {
    id: createId(),
    enrollmentId: enrollment.id,
    userId: doctor.id,
    jobRunId: runId || null,
    cycleKey: cycleKey || cycleKeyFor(now, env.AUTOPAY_TIMEZONE),
    scheduledFor: labDateFor(now, env.AUTOPAY_TIMEZONE),
    dryRun: Boolean(dryRun),
  };
}

/** Guarded attempt insert: processEnrollment promises never to throw, even if the record of an outcome fails. */
async function writeAttempt(row, log) {
  try {
    await db.insert(autopayAttempts).values(row);
  } catch (err) {
    log?.error?.({ err, attempt: row }, "[AutoPay] failed to write autopay_attempts row — the outcome above happened but was not durably recorded");
  }
  return row;
}

/** Guarded enrollment update, same contract as writeAttempt. */
async function updateEnrollment(id, patch, log) {
  try {
    await db.update(autopayEnrollments).set(patch).where(eq(autopayEnrollments.id, id));
  } catch (err) {
    log?.error?.({ err, enrollmentId: id, patch }, "[AutoPay] failed to update autopay_enrollments row");
  }
}

/**
 * A doctor's open invoices from our ledger. A read failure must NOT become
 * "nothing owed" (which would complete the enrollment) or "nothing paid"
 * (which would overcharge): it is its own outcome. kind: "ok" | "ledger_error".
 */
async function resolveOpenInvoices(doctor) {
  try {
    return { kind: "ok", invoices: await openInvoicesForClient(doctor.id) };
  } catch (err) {
    return { kind: "ledger_error", error: err };
  }
}

/**
 * Run one enrollment for one cycle. Returns the attempt row it wrote. Never
 * throws: one doctor's failure must not abort the sweep.
 * @param {Array<{ id, invoiceNumber, balanceCents, dueDate }>} invoices
 */
export async function processEnrollment({ enrollment, doctor, invoices, dryRun, now, runId, log, cycleKey }) {
  const base = attemptBase({ enrollment, doctor, runId, now, dryRun, cycleKey });

  try {
    const totalBalanceCents = (invoices || []).reduce((s, i) => s + i.balanceCents, 0);
    const chargeCents = resolveChargeCents({ enrolledCents: toCents(enrollment.amount), totalBalanceCents });

    if (chargeCents <= 0) {
      // Nothing owed: stop charging. `completed` is recoverable (see below). A
      // dry run only records what it would do; it never moves the lifecycle.
      if (!dryRun) await updateEnrollment(enrollment.id, { status: "completed", lastRunAt: now, updatedAt: now }, log);
      return writeAttempt({ ...base, status: "skipped", failureReason: "no outstanding balance" }, log);
    }

    // A completed enrollment that owes again resumes automatically.
    if (enrollment.status === "completed" && !dryRun) {
      await updateEnrollment(enrollment.id, { status: "active", updatedAt: now }, log);
    }

    const { allocations, totalAllocatedCents } = allocateOldestFirst(invoices, chargeCents);
    const amountAttempted = toDecimalString(totalAllocatedCents);

    if (dryRun) {
      return writeAttempt({ ...base, status: "would_charge", amountAttempted, allocations }, log);
    }

    try {
      // Same nesting as the doctor's charge-saved route: the idempotency key
      // serializes retries of THIS enrollment+cycle; the invoice locks
      // serialize against any other payment on the same invoices.
      // Known crash window (lib/payment-helpers.js): the result cache is written
      // after the charge and the record; a process death in between can let a
      // retry 2 minutes to 1 hour later charge again. Accepted, documented risk.
      const idem = await withIdempotency(
        redis,
        `autopay:${enrollment.id}:${base.cycleKey}`,
        () =>
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              // I3: re-verify the cap INSIDE the lock, as every human payment path does.
              const capErr = await verifyAllocations(allocations, doctor, { enforceCap: true });
              if (capErr) throw new AllocationCapExceededError(capErr.message, capErr.kind);

              // C2: the durable per-cycle guard, fresh, right before the gateway.
              const cycleAttempts = await attemptsThisCycle(doctor.id, base.cycleKey);
              if (cycleAttempts.some((a) => a.status === "succeeded" && a.dryRun === false)) {
                throw new AlreadyChargedThisCycleError();
              }

              const charge = await authorizenetService.chargeCustomerProfile({
                customerProfileId: doctor.authorizeNetCustomerProfileId,
                paymentProfileId: enrollment.paymentProfileId,
                amount: amountAttempted,
                invoiceNumber: allocations[0]?.invoiceNumber,
              });
              await recordPaymentAndAllocations({
                user: doctor,
                amountCents: totalAllocatedCents,
                transactionId: charge.transactionId,
                allocations,
                source: "autopay",
              });
              return charge;
            },
            { log }
          ),
        { log }
      );

      // On replay, fn never ran: neither the gateway nor the ledger was touched again.
      const transactionId = idem.result?.transactionId ?? null;
      await updateEnrollment(enrollment.id, { lastRunAt: now, lastChargedAt: now, consecutiveFailures: 0, updatedAt: now }, log);
      return writeAttempt(
        { ...base, status: "succeeded", amountAttempted, amountCharged: amountAttempted, transactionId, allocations },
        log
      );
    } catch (err) {
      if (err instanceof AlreadyChargedThisCycleError) {
        return writeAttempt({ ...base, status: "skipped", failureReason: "already charged this cycle" }, log);
      }

      // The in-lock check failed: an internal race, not the card. No failure
      // count, no decline email.
      if (err instanceof AllocationCapExceededError) {
        await updateEnrollment(enrollment.id, { lastRunAt: now, updatedAt: now }, log);
        const failureReason = err.kind === "forbidden"
          ? `could not verify allocation before charging: ${String(err.message).slice(0, 400)}`
          : String(err.message).slice(0, 500);
        return writeAttempt({ ...base, status: "failed", amountAttempted, allocations, failureReason }, log);
      }

      // A fraud hold that could not be released may still be captured: never
      // retry it. Recorded `skipped` (retries fire only on `failed`), the
      // enrollment paused until a human reconciles it; the lock helpers keep
      // their locks for the pending window.
      if (isGatewayOutcomePending(err)) {
        await updateEnrollment(enrollment.id, { lastRunAt: now, status: "paused", pausedReason: "gateway_outcome_pending", updatedAt: now }, log);
        log?.error?.(
          { enrollmentId: enrollment.id, userId: doctor.id, transactionId: err.transactionId || null },
          "[AutoPay][GATEWAY_OUTCOME_PENDING] charge held for review and could not be released — enrollment paused, not retried"
        );
        return writeAttempt(
          {
            ...base, status: "skipped", amountAttempted,
            transactionId: err.transactionId ? String(err.transactionId) : null, allocations,
            failureReason: "charge held for fraud review and could not be released — outcome pending at the gateway; not retried, enrollment paused until reconciled",
          },
          log
        );
      }

      // Another payment holds this enrollment's key or one of the invoices:
      // nothing reached the card. `failed` so the retry day can try again,
      // but no failure count and no decline email.
      if (err instanceof ChargeInProgressError || err instanceof InvoiceLockedError) {
        await updateEnrollment(enrollment.id, { lastRunAt: now, updatedAt: now }, log);
        return writeAttempt(
          { ...base, status: "failed", amountAttempted, allocations, failureReason: `not charged — another charge is in progress for these invoices: ${String(err.message).slice(0, 400)}` },
          log
        );
      }

      const failures = Number(enrollment.consecutiveFailures || 0) + 1;
      const shouldPause = failures >= Number(env.AUTOPAY_MAX_FAILURES);
      await updateEnrollment(
        enrollment.id,
        { lastRunAt: now, consecutiveFailures: failures, ...(shouldPause ? { status: "paused", pausedReason: "consecutive_failures" } : {}), updatedAt: now },
        log
      );
      // Notify, soft-fail (the email takes dollars).
      await Promise.resolve()
        .then(() => emailService.sendAutopayFailure({
          email: doctor.email, name: doctor.name, amount: totalAllocatedCents / 100, reason: err?.message || "Card declined", paused: shouldPause,
        }))
        .catch(() => {});
      return writeAttempt(
        { ...base, status: "failed", amountAttempted, allocations, failureReason: String(err?.message || err).slice(0, 500) },
        log
      );
    }
  } catch (err) {
    // Final safety net: a genuine bug still returns an attempt-shaped object.
    log?.error?.({ err, enrollmentId: enrollment?.id }, "[AutoPay] processEnrollment hit an unexpected error");
    return writeAttempt({ ...base, status: "failed", failureReason: `unexpected error: ${String(err?.message || err).slice(0, 450)}` }, log);
  }
}

/** Sweep every enrollment due today. */
export async function runAutopaySweep({ dryRun = true, now = new Date(), log, runId } = {}) {
  const rows = await db
    .select({
      enrollment: autopayEnrollments,
      doctor: {
        id: users.id,
        email: users.email,
        name: users.name,
        authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
      },
    })
    .from(autopayEnrollments)
    .innerJoin(users, eq(users.id, autopayEnrollments.userId))
    .where(
      and(
        eq(autopayEnrollments.enabled, true),
        // `completed` is recoverable: a paid-off doctor may owe again.
        or(eq(autopayEnrollments.status, "active"), eq(autopayEnrollments.status, "completed"))
      )
    );

  const currentCycleKey = cycleKeyFor(now, env.AUTOPAY_TIMEZONE);

  // I4: due on the charge day, or on a decline retry day (charge day + 2 / + 5)
  // when this cycle already has a real failed attempt. Each due row carries its
  // BASE cycle (a retry can roll into next month).
  const due = [];
  for (const row of rows) {
    const { enrollment } = row;
    if (isDueOn(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE)) {
      due.push({ ...row, cycleKey: currentCycleKey });
      continue;
    }
    const retry = isRetryDay(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE);
    if (retry) {
      const cycleAttempts = await attemptsThisCycle(enrollment.userId, retry.cycleKey);
      if (cycleAttempts.some((a) => a.status === "failed" && a.dryRun === false)) due.push({ ...row, cycleKey: retry.cycleKey });
    }
  }

  const summary = { considered: due.length, charged: 0, skipped: 0, failed: 0, wouldCharge: 0, totalAmount: 0 };
  let totalCents = 0;

  for (const { enrollment, doctor, cycleKey: baseCycleKey } of due) {
    try {
      const resolved = await resolveOpenInvoices(doctor);
      if (resolved.kind === "ledger_error") {
        await writeAttempt(
          { ...attemptBase({ enrollment, doctor, runId, now, dryRun, cycleKey: baseCycleKey }), status: "failed", failureReason: "could not determine balance — ledger read failed" },
          log
        );
        summary.failed++;
        continue;
      }
      const attempt = await processEnrollment({
        enrollment, doctor, invoices: resolved.invoices, dryRun, now, runId, log, cycleKey: baseCycleKey,
      });
      if (attempt.status === "succeeded") {
        summary.charged++;
        totalCents += toCents(attempt.amountCharged);
      } else if (attempt.status === "would_charge") {
        summary.wouldCharge++;
        totalCents += toCents(attempt.amountAttempted);
      } else if (attempt.status === "failed") {
        summary.failed++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      // processEnrollment doesn't throw, but one doctor must never abort the sweep.
      summary.failed++;
      log?.error?.({ err, enrollmentId: enrollment.id }, "autopay enrollment threw outside processEnrollment");
    }
  }

  // Job summaries stay in dollars (AdminJobsPage renders totalAmount as money).
  summary.totalAmount = totalCents / 100;
  return summary;
}
```

- [ ] **Step 5: Run the tests and the suite**

```bash
pnpm --filter @my-app/shared exec vitest run src/billing/allocation.test.js                 # PASS
cd apps/api && pnpm vitest run src/jobs/definitions/autopay.job.test.js                      # PASS
grep -n "seazona\|round2\|Seazona" src/services/autopay-runner.service.js   # no output
grep -rn "autopay-allocation" src   # no output
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

- [ ] **Step 6: Commit**

```bash
git add -A packages/shared/src apps/api/src/lib apps/api/src/services/autopay-runner.service.js apps/api/src/jobs
git commit -m "feat(autopay): sweep local invoices in cents; out-of-band precondition retired; allocator shared

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 8: Invoice reads (doctor + admin); old ledger and Seazona invoice routes removed; migration 0030; Seazona invoice guard

**Files:**
- Create:
  - `apps/api/src/services/billing/invoice-queries.js`, `apps/api/src/services/billing/invoice-views.js`, `apps/api/src/services/billing/invoice-views.test.js`;
  - `apps/api/src/routes/admin-invoice.routes.js`;
  - `apps/api/src/routes/__tests__/billing-routes.test.js`, `apps/api/src/routes/__tests__/seazona-invoice-retired.test.js`.
- Modify (rewrite): `apps/api/src/routes/invoice.routes.js`
- Modify:
  - `apps/api/src/index.js`, `apps/api/src/db/schema/invoice-payments.js`, `apps/api/src/db/schema/invoices.test.js`;
  - `apps/api/src/db/scrub/plan.js`, `apps/api/src/db/scrub/COLUMNS.md`;
  - `apps/api/src/services/auth.service.js:459-460` (comment only).
- Delete:
  - `apps/api/src/services/invoice-ledger.service.js`, `apps/api/src/services/invoice-ledger.service.test.js`, `apps/api/src/services/invoice-ledger.test.js`;
  - `apps/api/src/routes/__tests__/admin-invoices.routes.test.js`, `apps/api/src/routes/__tests__/admin-offline-payment.routes.test.js`.
- Generated: `apps/api/src/db/migrations/0030_*.sql` + snapshot + journal.

**Interfaces:**
- Consumes:
  - Task 5: `openInvoice`, `openLine`.
  - Task 6: `withBalances`, `ledgerRowsForInvoice`.
  - Shared: `initialsFor` (lab-order-rules), `decryptRxPhi`, `caseSummary`.
- Produces:
  - `services/billing/invoice-queries.js`:
    - `INVOICE_LIST_LIMIT = 500`;
    - `listInvoices({ status, needsPrice, clientUserId, number }) → { invoices: [{ id, invoiceNumber, kind, status, clientUserId, clientName, practice, labOrderId, labOrderNumber, issuedAt, dueDate, totalCents, paidCents, balanceCents, needsPrice }], truncated }`;
    - `listClientInvoices(clientUserId, { includeDrafts, openOnly }) → [{ id, invoiceNumber, kind, status, labOrderNumber, caseNumber, patientInitials, issuedAt, dueDate, totalCents, paidCents, balanceCents }]`;
    - `getInvoiceDetail(id, { withActivity }) → { invoice (opened, with balance), lines (opened), payments (opened ledger rows), labOrder: { id, orderNumber, source, status, isRemake, caseNumber, patientName, shopOrderNumber } | null, client: { id, name, email, accountNumber, practice, address1, address2, city, state, zip } | null, activity? }`.
  - `services/billing/invoice-views.js`:
    - `ledgerEntryKind(row) → "payment" | "credit" | "refund"`;
    - `doctorInvoiceRow(row)`, `doctorInvoiceView(detail)`, `adminInvoiceView(detail)`.
  - Routes:
    - `GET /api/v1/invoices` and `GET /api/v1/invoices/:id` (doctor);
    - `GET /api/v1/admin/invoices`, `GET /api/v1/admin/invoices/:id`, `GET /api/v1/admin/clients/:userId/invoices?open=true|false` (admin).
    - `routes/admin-invoice.routes.js` exports `ADMIN`.
  - `invoice_payments.applied_cents` is `NOT NULL`; `applied_amount` is gone.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/billing/invoice-views.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { doctorInvoiceView, doctorInvoiceRow, adminInvoiceView, ledgerEntryKind } from "./invoice-views.js";

const detail = {
  invoice: {
    id: "inv1", invoiceNumber: 500001, kind: "order", status: "issued", clientUserId: "doc1", labOrderId: "lo1",
    issuedAt: new Date("2026-10-15T15:00:00Z"), dueDate: "2026-11-14", subtotalCents: 40500, taxCents: 0, shippingCents: 1500,
    totalCents: 42000, paidCents: 10000, balanceCents: 32000, paid: false, version: 3,
    notes: "Dr asked us to call Jane Doe's mother", voidReason: null,
  },
  lines: [{ id: "l1", kind: "item", code: "2608", description: "DDSO Nylon", qty: 1, unitCents: 40500, lineCents: 40500, priceSource: "manual", priceNote: "goodwill for Jane Doe", taxable: false }],
  payments: [
    { id: "p1", appliedCents: 12000, source: "doctor_card", transactionId: "601", paidOn: null, createdAt: new Date("2026-10-16T15:00:00Z"), reference: null, note: null },
    { id: "p2", appliedCents: 0, source: null, transactionId: "REFUND-PENDING-601", paidOn: null, createdAt: new Date(), reference: null, note: null },
    { id: "p3", appliedCents: -4000, source: "refund", transactionId: "602", refundsTransactionId: "601", paidOn: null, createdAt: new Date("2026-10-17T15:00:00Z") },
    { id: "p4", appliedCents: 2000, source: "credit", transactionId: "credit:p4", paidOn: "2026-10-18", createdAt: new Date(), reference: null, note: "shade mismatch" },
  ],
  labOrder: { id: "lo1", orderNumber: 100245, caseNumber: "RX-ABC", patientName: "Jane Doe", status: "shipped" },
  client: { id: "doc1", name: "Dr Lee", practice: "Lee Dental" },
};

test("a doctor sees the bill, its lines and dated payments — never staff notes, price notes, sources or references", () => {
  const v = doctorInvoiceView(detail);
  assert.deepEqual(Object.keys(v).sort(), [
    "balanceCents", "caseNumber", "dueDate", "id", "invoiceNumber", "issuedAt", "kind", "labOrderNumber", "lines", "paidCents",
    "patientName", "payments", "shippingCents", "status", "subtotalCents", "taxCents", "totalCents",
  ]);
  assert.deepEqual(Object.keys(v.lines[0]).sort(), ["code", "description", "id", "kind", "lineCents", "qty", "unitCents"]);
  assert.deepEqual(v.payments.map((p) => [p.kind, p.amountCents]), [["payment", 12000], ["refund", -4000], ["credit", 2000]]);
  assert.deepEqual(Object.keys(v.payments[0]).sort(), ["amountCents", "date", "kind"]);
  const text = JSON.stringify(v);
  for (const secret of ["call Jane Doe's mother", "goodwill", "shade mismatch", "601", "doctor_card", "manual"]) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
  assert.equal(v.patientName, "Jane Doe", "the doctor needs the patient to match the bill");
});

test("a doctor's list row is an allow-list too", () => {
  const row = doctorInvoiceRow({ ...detail.invoice, labOrderNumber: 100245, patientInitials: "JD", caseNumber: "RX-ABC" });
  assert.deepEqual(Object.keys(row).sort(), [
    "balanceCents", "dueDate", "id", "invoiceNumber", "issuedAt", "kind", "labOrderNumber", "paidCents", "patientInitials", "status", "totalCents",
  ]);
});

test("staff see everything, with the ledger shaped and the refund guard row hidden", () => {
  const v = adminInvoiceView({ ...detail, activity: [{ action: "invoice.issued" }] });
  assert.equal(v.invoice.notes, "Dr asked us to call Jane Doe's mother");
  assert.equal(v.lines[0].priceNote, "goodwill for Jane Doe");
  assert.deepEqual(v.payments.map((p) => [p.kind, p.source, p.amountCents]), [
    ["payment", "doctor_card", 12000], ["refund", "refund", -4000], ["credit", "credit", 2000],
  ]);
  assert.equal(v.payments[2].note, "shade mismatch");
  assert.equal(v.activity.length, 1);
});

test("ledger entry kinds", () => {
  assert.equal(ledgerEntryKind({ source: "credit", appliedCents: 100 }), "credit");
  assert.equal(ledgerEntryKind({ source: "refund", appliedCents: -100 }), "refund");
  assert.equal(ledgerEntryKind({ source: "admin_check", appliedCents: 100 }), "payment");
});
```

`apps/api/src/routes/__tests__/billing-routes.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const doctor = read("../invoice.routes.js");
const admin = read("../admin-invoice.routes.js");
const index = read("../../index.js");
const markersOf = (src) => [...src.matchAll(/\n  fastify\.(get|post|patch|put|delete)\("([^"]+)",/g)].map((m) => `fastify.${m[1]}("${m[2]}",`);

test("doctor invoice routes are approved-doctor only, scoped to the caller, and never show a draft", () => {
  assert.match(doctor, /const DOCTOR = \[authenticate, requireApprovedDoctor\]/);
  for (const m of markersOf(doctor)) assert.match(handlerSource(doctor, m), /preHandler: (DOCTOR|\[\.\.\.DOCTOR)/, m);
  assert.match(handlerSource(doctor, 'fastify.get("/invoices",'), /listClientInvoices\(request\.user\.id\)/);
  const detail = handlerSource(doctor, 'fastify.get("/invoices/:id",');
  assert.match(detail, /detail\.invoice\.clientUserId !== request\.user\.id/);
  assert.match(detail, /detail\.invoice\.status === "draft"/);
  assert.match(detail, /doctorInvoiceView\(detail\)/);
  assert.match(detail, /"invoice\.read"/);
  assert.doesNotMatch(doctor, /seazona/i);
});

test("every admin billing route is admin-only: the lab role sees no money", () => {
  assert.match(admin, /export const ADMIN = \[authenticate, requireAdmin\]/);
  const markers = markersOf(admin);
  assert.ok(markers.length >= 3, "route discovery looks broken");
  for (const m of markers) assert.match(handlerSource(admin, m), /preHandler: (ADMIN|\[\.\.\.ADMIN)/, m);
  assert.match(handlerSource(admin, 'fastify.get("/admin/invoices",'), /validateQuery\(invoiceListQuerySchema\)/);
  assert.match(handlerSource(admin, 'fastify.get("/admin/invoices/:id",'), /adminInvoiceView\(detail\)/);
});

test("the server registers the billing routes", () => {
  assert.match(index, /await fastify\.register\(adminInvoiceRoutes, \{ prefix: "\/api\/v1" \}\)/);
  assert.match(index, /await fastify\.register\(invoiceRoutes, \{ prefix: "\/api\/v1" \}\)/);
});
```

`apps/api/src/routes/__tests__/seazona-invoice-retired.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// own-the-lab piece 3 ended Seazona's invoice role: no invoice reads from
// Seazona for display or payment, and no payment writes to Seazona. The reads
// and createPayment stay in seazona.service.js for piece 5's history import;
// when that import lands, add its file to ALLOWED by name. Scans code AND
// comments, so a stale instruction can't survive either.
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = join(here, "../../../../../");
const ROOTS = ["apps/api/src", "apps/api/scripts", "scripts"].map((p) => join(repo, p));
const ALLOWED = new Set(["apps/api/src/services/seazona.service.js"]);
const SELF = fileURLToPath(import.meta.url);

const FORBIDDEN = [
  /\bcreatePayment\b/, /\bgetInvoice\b/, /\bgetInvoices\b/, /\bgetInvoicesResult\b/, /\bgetAllInvoicesResult\b/,
  /writeToSeazona/, /recordInSeazona/, /buildInvoiceReference/, /SEAZONA_CLIENT_NOT_LINKED/, /seazonaUnavailable/,
  /PAYMENT_WRITE_FAILED/, /getClientPaidMap/, /invoice-ledger\.service/,
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.(js|jsx|mjs)$/.test(name) && p !== SELF) yield p;
  }
}

test("nothing outside seazona.service.js reads invoices from or writes payments to Seazona", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const rel = relative(repo, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${rel}: ${re}`);
    }
  }
  assert.deepEqual(hits, []);
});
```

Append to `apps/api/src/db/schema/invoices.test.js`:

```js
test("0030: applied_cents is required and the dollar column is gone (after the 0029 backfill)", () => {
  const sql = migration("0030_");
  assert.match(sql, /ALTER TABLE "invoice_payments" ALTER COLUMN "applied_cents" SET NOT NULL;/);
  assert.match(sql, /ALTER TABLE "invoice_payments" DROP COLUMN (IF EXISTS )?"applied_amount";/);
  assert.equal(invoicePayments.appliedCents.notNull, true);
  assert.ok(!("appliedAmount" in invoicePayments));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/billing/invoice-views.test.js src/routes/__tests__/billing-routes.test.js src/routes/__tests__/seazona-invoice-retired.test.js src/db/schema/invoices.test.js`
Expected: FAIL.
- The views and admin routes don't exist.
- The guard lists `invoice.routes.js`, `invoice-ledger.service.js` and `auth.service.js` (a comment).
- There is no 0030 migration.

- [ ] **Step 3: Implement the views and queries**

`apps/api/src/services/billing/invoice-views.js`:

```js
/**
 * Response shapes for invoice reads. The doctor's are explicit allow-lists
 * (the doctorCaseView pattern), so a staff column added later never reaches a
 * doctor by default: staff notes, price notes and sources, the void reason,
 * ledger references, credit reasons and transaction ids stay staff-only. The
 * refund write-ahead guard row (0 cents) is bookkeeping and shown to no one.
 */

/** What a ledger row is, to a person reading the invoice. */
export function ledgerEntryKind(row) {
  if (row.source === "credit") return "credit";
  return row.appliedCents < 0 ? "refund" : "payment";
}

const visible = (payments) => payments.filter((p) => p.appliedCents !== 0);

export function doctorInvoiceRow(r) {
  return {
    id: r.id, invoiceNumber: r.invoiceNumber, kind: r.kind, status: r.status,
    labOrderNumber: r.labOrderNumber ?? null, patientInitials: r.patientInitials ?? null,
    issuedAt: r.issuedAt ?? null, dueDate: r.dueDate ?? null,
    totalCents: r.totalCents, paidCents: r.paidCents, balanceCents: r.balanceCents,
  };
}

export function doctorInvoiceView({ invoice, lines, payments, labOrder }) {
  return {
    id: invoice.id, invoiceNumber: invoice.invoiceNumber, kind: invoice.kind, status: invoice.status,
    issuedAt: invoice.issuedAt ?? null, dueDate: invoice.dueDate ?? null,
    subtotalCents: invoice.subtotalCents, taxCents: invoice.taxCents, shippingCents: invoice.shippingCents,
    totalCents: invoice.totalCents, paidCents: invoice.paidCents, balanceCents: invoice.balanceCents,
    labOrderNumber: labOrder?.orderNumber ?? null, caseNumber: labOrder?.caseNumber ?? null, patientName: labOrder?.patientName ?? null,
    lines: lines.map((l) => ({
      id: l.id, kind: l.kind, code: l.code ?? null, description: l.description, qty: l.qty, unitCents: l.unitCents, lineCents: l.lineCents,
    })),
    payments: visible(payments).map((p) => ({ date: p.paidOn ?? p.createdAt, kind: ledgerEntryKind(p), amountCents: p.appliedCents })),
  };
}

/** Staff see the whole invoice; ledger rows are shaped for the detail page. */
export function adminInvoiceView({ invoice, lines, payments, labOrder, client, activity }) {
  return {
    invoice,
    lines,
    payments: visible(payments).map((p) => ({
      id: p.id, date: p.paidOn ?? p.createdAt, kind: ledgerEntryKind(p), source: p.source ?? null,
      amountCents: p.appliedCents, transactionId: p.transactionId, refundsTransactionId: p.refundsTransactionId ?? null,
      reference: p.reference ?? null, note: p.note ?? null,
    })),
    labOrder,
    client,
    activity: activity ?? [],
  };
}
```

`apps/api/src/services/billing/invoice-queries.js`:

```js
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { caseSummary } from "@my-app/shared";
import { db } from "../../config/database.js";
import { invoices, invoiceLines, labOrders, rxCases, orders, users, doctorProfiles, auditLog } from "../../db/schema/index.js";
import { decryptRxPhi } from "../rx/phi-crypto.js";
import { initialsFor } from "../lab/lab-order-rules.js";
import { withBalances, ledgerRowsForInvoice } from "./ledger.service.js";
import { openInvoice, openLine } from "./invoice-crypto.js";

/**
 * Invoice reads for the doctor and admin screens. Balances always come from
 * withBalances (ledger + deriveBalance). The patient's name is decrypted for
 * the detail view and PDF only; lists carry initials. Callers must never log
 * a detail result (it carries PHI).
 */

export const INVOICE_LIST_LIMIT = 500;

const client = alias(users, "client");
const actor = alias(users, "actor");

function patientInitials(row) {
  if (!row.patientFirst && !row.patientLast) return null;
  try {
    return initialsFor(caseSummary(decryptRxPhi({ patientFirst: row.patientFirst, patientLast: row.patientLast })).patientName);
  } catch {
    return null; // an undecryptable name shows as "—", it never fails the list
  }
}

/** Admin › Invoices: newest first, filtered on the server (the list is capped). */
export async function listInvoices(filters = {}, database = db) {
  const conds = [];
  if (filters.status) conds.push(eq(invoices.status, filters.status));
  if (filters.clientUserId) conds.push(eq(invoices.clientUserId, filters.clientUserId));
  if (filters.number) conds.push(eq(invoices.invoiceNumber, filters.number));
  if (filters.needsPrice) {
    conds.push(eq(invoices.status, "draft"));
    conds.push(sql`exists (select 1 from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id} and ${invoiceLines.priceSource} = 'unpriced')`);
  }
  const rows = await database
    .select({ invoice: invoices, clientName: client.name, practice: doctorProfiles.companyName, labOrderNumber: labOrders.orderNumber })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.invoiceNumber))
    .limit(INVOICE_LIST_LIMIT);
  const ids = rows.map((r) => r.invoice.id);
  const unpriced = new Set(
    ids.length
      ? (await database
          .selectDistinct({ id: invoiceLines.invoiceId })
          .from(invoiceLines)
          .where(and(inArray(invoiceLines.invoiceId, ids), eq(invoiceLines.priceSource, "unpriced")))).map((r) => r.id)
      : []
  );
  const balanced = await withBalances(rows.map((r) => r.invoice), database);
  return {
    invoices: balanced.map((inv, i) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, kind: inv.kind, status: inv.status,
      clientUserId: inv.clientUserId, clientName: rows[i].clientName ?? null, practice: rows[i].practice ?? null,
      labOrderId: inv.labOrderId, labOrderNumber: rows[i].labOrderNumber ?? null,
      issuedAt: inv.issuedAt, dueDate: inv.dueDate, totalCents: inv.totalCents, paidCents: inv.paidCents, balanceCents: inv.balanceCents,
      needsPrice: unpriced.has(inv.id),
    })),
    truncated: rows.length >= INVOICE_LIST_LIMIT,
  };
}

/**
 * One client's invoices, newest first. Doctors get issued and void ones
 * (includeDrafts false); `openOnly` is what a payment can be applied to.
 */
export async function listClientInvoices(clientUserId, { includeDrafts = false, openOnly = false } = {}, database = db) {
  const conds = [eq(invoices.clientUserId, clientUserId)];
  if (openOnly) conds.push(eq(invoices.status, "issued"));
  else if (!includeDrafts) conds.push(ne(invoices.status, "draft"));
  const rows = await database
    .select({
      invoice: invoices, labOrderNumber: labOrders.orderNumber, caseNumber: rxCases.caseNumber,
      patientFirst: rxCases.patientFirst, patientLast: rxCases.patientLast,
    })
    .from(invoices)
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .leftJoin(rxCases, and(eq(labOrders.source, "rx_case"), eq(rxCases.id, labOrders.sourceId)))
    .where(and(...conds))
    .orderBy(desc(invoices.invoiceNumber));
  const balanced = await withBalances(rows.map((r) => r.invoice), database);
  const out = balanced.map((inv, i) => ({
    id: inv.id, invoiceNumber: inv.invoiceNumber, kind: inv.kind, status: inv.status,
    labOrderNumber: rows[i].labOrderNumber ?? null, caseNumber: rows[i].caseNumber ?? null,
    patientInitials: patientInitials(rows[i]),
    issuedAt: inv.issuedAt, dueDate: inv.dueDate,
    totalCents: inv.totalCents, paidCents: inv.paidCents, balanceCents: inv.balanceCents,
  }));
  return openOnly ? out.filter((i) => i.balanceCents > 0) : out;
}

async function labOrderBlock(labOrderId, database) {
  const [lo] = await database
    .select({
      id: labOrders.id, orderNumber: labOrders.orderNumber, source: labOrders.source, sourceId: labOrders.sourceId,
      status: labOrders.status, isRemake: labOrders.isRemake,
    })
    .from(labOrders)
    .where(eq(labOrders.id, labOrderId));
  if (!lo) return null;
  const { sourceId, ...rest } = lo;
  if (lo.source === "rx_case") {
    const [c] = await database
      .select({ caseNumber: rxCases.caseNumber, patientFirst: rxCases.patientFirst, patientLast: rxCases.patientLast })
      .from(rxCases)
      .where(eq(rxCases.id, sourceId));
    return { ...rest, caseNumber: c?.caseNumber ?? null, patientName: c ? caseSummary(decryptRxPhi(c)).patientName : null, shopOrderNumber: null };
  }
  const [o] = await database.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, sourceId));
  return { ...rest, caseNumber: null, patientName: null, shopOrderNumber: o?.orderNumber ?? null };
}

async function invoiceActivity(invoiceId, database) {
  const rows = await database
    .select({ id: auditLog.id, action: auditLog.action, metadata: auditLog.metadata, createdAt: auditLog.createdAt, actorName: actor.name })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.userId))
    .where(and(eq(auditLog.targetType, "invoice"), eq(auditLog.targetId, invoiceId), ne(auditLog.action, "invoice.read")))
    .orderBy(asc(auditLog.createdAt));
  return rows.map((r) => ({ ...r, actorName: r.actorName ?? null, metadata: r.metadata ?? {} }));
}

/**
 * Everything the detail page and the invoice PDF need, decrypted. Throws on
 * a decrypt failure; routes turn that into a generic 500 and never echo it.
 */
export async function getInvoiceDetail(id, { withActivity = false } = {}, database = db) {
  const [row] = await database
    .select({
      invoice: invoices, clientName: client.name, clientEmail: client.email,
      accountNumber: client.seazonaAccountNumber, profile: doctorProfiles,
    })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .where(eq(invoices.id, id));
  if (!row) return null;
  const [invoice] = await withBalances([openInvoice(row.invoice)], database);
  const lines = (await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position))).map(openLine);
  const payments = await ledgerRowsForInvoice(id, database);
  const labOrder = invoice.labOrderId ? await labOrderBlock(invoice.labOrderId, database) : null;
  const p = row.profile;
  const clientBlock = invoice.clientUserId
    ? {
        id: invoice.clientUserId, name: row.clientName ?? null, email: row.clientEmail ?? null, accountNumber: row.accountNumber ?? null,
        practice: p?.companyName ?? null, address1: p?.address1 ?? null, address2: p?.address2 ?? null,
        city: p?.city ?? null, state: p?.state ?? null, zip: p?.zip ?? null,
      }
    : null;
  return {
    invoice, lines, payments, labOrder, client: clientBlock,
    ...(withActivity ? { activity: await invoiceActivity(id, database) } : {}),
  };
}
```

- [ ] **Step 4: Rewrite the doctor routes and add the admin reads**

`apps/api/src/routes/invoice.routes.js` (whole file):

```js
import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { ERROR_CODES } from "@my-app/shared";
import * as auditService from "../services/audit.service.js";
import { listClientInvoices, getInvoiceDetail } from "../services/billing/invoice-queries.js";
import { doctorInvoiceRow, doctorInvoiceView } from "../services/billing/invoice-views.js";

/**
 * A doctor's own invoices, from our tables (own-the-lab piece 3). Scoped to
 * request.user.id; a draft is not a bill and is never shown; every response
 * is built from an allow-list (invoice-views.js).
 */
export const DOCTOR = [authenticate, requireApprovedDoctor];

export default async function invoiceRoutes(fastify) {
  fastify.get("/invoices", { preHandler: DOCTOR }, async (request) => ({
    data: (await listClientInvoices(request.user.id)).map(doctorInvoiceRow),
  }));

  fastify.get("/invoices/:id", { preHandler: DOCTOR }, async (request, reply) => {
    let detail;
    try {
      detail = await getInvoiceDetail(request.params.id);
    } catch (err) {
      // Never echo the error: decrypt failures can carry PHI context.
      request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice detail failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to load invoice." } });
    }
    if (!detail || detail.invoice.clientUserId !== request.user.id || detail.invoice.status === "draft") {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }
    // The invoice carries the patient's name: every read is audited (ids only).
    auditService.logSafe({ userId: request.user.id, action: "invoice.read", targetType: "invoice", targetId: detail.invoice.id, ipAddress: request.ip });
    return { data: doctorInvoiceView(detail) };
  });
}
```

`apps/api/src/routes/admin-invoice.routes.js`:

```js
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, invoiceListQuerySchema, clientInvoicesQuerySchema } from "@my-app/shared";
import * as auditService from "../services/audit.service.js";
import { listInvoices, getInvoiceDetail, listClientInvoices } from "../services/billing/invoice-queries.js";
import { adminInvoiceView } from "../services/billing/invoice-views.js";

/** Billing is admin-only: the lab role sees no money. */
export const ADMIN = [authenticate, requireAdmin];

export default async function adminInvoiceRoutes(fastify) {
  // Admin › Invoices (filters: status, needs-price, client, number).
  fastify.get("/admin/invoices", { preHandler: [...ADMIN, validateQuery(invoiceListQuerySchema)] }, async (request) => ({
    data: await listInvoices(request.query),
  }));

  fastify.get("/admin/invoices/:id", { preHandler: ADMIN }, async (request, reply) => {
    let detail;
    try {
      detail = await getInvoiceDetail(request.params.id, { withActivity: true });
    } catch (err) {
      request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice detail failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to load invoice." } });
    }
    if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    auditService.logSafe({ userId: request.user.id, action: "invoice.read", targetType: "invoice", targetId: detail.invoice.id, ipAddress: request.ip });
    return { data: adminInvoiceView(detail) };
  });

  // One client's invoices: the drawer, Record payment and the AR row link.
  fastify.get("/admin/clients/:userId/invoices", { preHandler: [...ADMIN, validateQuery(clientInvoicesQuerySchema)] }, async (request) => ({
    data: await listClientInvoices(request.params.userId, { includeDrafts: !request.query.open, openOnly: request.query.open }),
  }));
}
```

`apps/api/src/index.js`. After `import invoiceRoutes from "./routes/invoice.routes.js";` add `import adminInvoiceRoutes from "./routes/admin-invoice.routes.js";`, and after `await fastify.register(invoiceRoutes, { prefix: "/api/v1" });` add:

```js
await fastify.register(adminInvoiceRoutes, { prefix: "/api/v1" });
```

`apps/api/src/services/auth.service.js` lines 459–460. Replace the comment with:

```js
  // Billing no longer depends on this link (own-the-lab piece 3: invoices are
  // ours); it matters for piece 5's import of the client's Seazona history.
```

- [ ] **Step 5: Drop the dollar column (migration 0030) and delete the Seazona-era code**

```bash
cd apps/api
git rm src/services/invoice-ledger.service.js src/services/invoice-ledger.service.test.js src/services/invoice-ledger.test.js \
  src/routes/__tests__/admin-invoices.routes.test.js src/routes/__tests__/admin-offline-payment.routes.test.js
grep -rn "invoice-ledger.service\|appliedAmount\|applied_amount" src --include='*.js' | grep -v "db/migrations"
# Expected remaining hits: only db/schema/invoice-payments.js, scrub/plan.js and the schema test.
```

`apps/api/src/db/schema/invoice-payments.js`:
- delete the `appliedAmount` column and its comment;
- change `appliedCents` to `appliedCents: integer("applied_cents").notNull(),` with the comment `// Integer cents (sign rule in the header).`;
- remove `numeric` from the import.

`apps/api/src/db/scrub/plan.js`, `invoice_payments`: delete `applied_amount: K,`.

`apps/api/src/db/scrub/COLUMNS.md`: nothing lists `applied_amount`, so no change.

```bash
pnpm db:generate
```

Expected: `src/db/migrations/0030_<name>.sql` with `ALTER TABLE "invoice_payments" ALTER COLUMN "applied_cents" SET NOT NULL;` and the `DROP COLUMN` of `applied_amount`. drizzle-kit asks nothing: a column is only removed. Do not edit it.

- [ ] **Step 6: Apply locally and run the suite**

```bash
pnpm db:migrate
psql diamond_labs_own_the_lab_3 -c '\d invoice_payments' | grep applied   # applied_cents | integer | not null
pnpm db:generate   # "No schema changes"
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

Expected: everything passes, including `seazona-invoice-retired.test.js`, `seazona-access.test.js` and `seazona-order-retired.test.js`.

- [ ] **Step 7: Commit**

```bash
git add -A apps/api/src
git commit -m "feat(billing): invoice reads from our tables; Seazona invoice routes and dollar ledger column retired

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 9: Admin invoice actions: edit, issue, void, credit, manual payments

**Files:**
- Create: `apps/api/src/services/billing/invoice-actions.service.js`, `apps/api/src/services/billing/invoice-actions.service.test.js`
- Modify: `apps/api/src/services/billing/invoice-rules.js`, `apps/api/src/services/billing/invoice-rules.test.js`, `apps/api/src/routes/admin-invoice.routes.js`, `apps/api/src/routes/__tests__/billing-routes.test.js`

**Interfaces:**
- Consumes:
  - Task 4: `planLineEdit`, `planIssue`, `planVoid`, `deriveBalance`, `invoiceErrorReply`, `manualPaymentSource`, `CREDIT_SOURCE`.
  - Task 5: `auditInvoice`, `loadLines`, `sealLedgerRow`.
  - Task 6: `paidCentsByInvoice`, `openInvoicesForClient`, `verifyAllocations`, `recordPaymentAndAllocations`.
  - Task 7: `allocateOldestFirst` (cents, from `@my-app/shared`).
- Produces (`invoice-rules.js`):
  - `planCredit(invoice, { amountCents, reason, balanceCents }) → { reason }`;
  - `planManualPayment({ openInvoices, amountCents, allocations?, paidOn, todayIso }) → [{ invoiceId, invoiceNumber, amountCents }]`.
- Produces (`invoice-actions.service.js`):
  - `editDraft(id, { edit, expectedVersion, byUserId })`;
  - `issueInvoice(id, { expectedVersion, byUserId })`;
  - `voidInvoice(id, { reason, expectedVersion, byUserId })`;
  - `recordCredit(id, { amountCents, reason, byUserId }) → { id, balanceCents }`;
  - `recordManualPayment({ clientUserId, method, reference, amountCents, paidOn, allocations, byUserId }) → { transactionId, allocations }`.
  Each takes an optional `database` last argument for tests.
- Produces (routes, all `ADMIN`):
  - `PATCH /admin/invoices/:id/lines` (`invoiceEditSchema`) → `{ id, version, totalCents }`;
  - `POST /admin/invoices/:id/issue` (`invoiceIssueSchema`) → `{ id, status, version, dueDate }`;
  - `POST /admin/invoices/:id/void` (`invoiceVoidSchema`) → `{ id, status, version }`;
  - `POST /admin/invoices/:id/credit` (`invoiceCreditSchema`) → 201 `{ id, balanceCents }`;
  - `POST /admin/clients/:userId/payments` (`manualPaymentSchema`) → 201 `{ transactionId, allocations }`.
  - Errors: `InvoiceError` → 404 / 409 / 422 via `invoiceErrorReply`. A held invoice lock maps to 409 `LOCKED`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/billing/invoice-rules.test.js` (and add `planCredit, planManualPayment` to its import from `./invoice-rules.js`):

```js
test("credit: an issued invoice, a reason, and no more than is owed", () => {
  const issued = draft({ status: "issued" });
  assert.deepEqual(planCredit(issued, { amountCents: 2500, reason: " shade mismatch ", balanceCents: 10000 }), { reason: "shade mismatch" });
  assert.throws(() => planCredit(issued, { amountCents: 2500, reason: " ", balanceCents: 10000 }), isCode("REASON_REQUIRED"));
  assert.throws(() => planCredit(issued, { amountCents: 10001, reason: "x", balanceCents: 10000 }), isCode("OVERPAY"));
  assert.throws(() => planCredit(draft(), { amountCents: 100, reason: "x", balanceCents: 10000 }), isCode("INVALID_TRANSITION"));
  assert.throws(() => planCredit(issued, { amountCents: 0, reason: "x", balanceCents: 10000 }), isCode("INVALID"));
});

const open = [
  { id: "a", invoiceNumber: 500001, balanceCents: 20000, dueDate: "2026-09-30", issuedOn: "2026-08-31" },
  { id: "b", invoiceNumber: 500002, balanceCents: 30000, dueDate: "2026-10-30", issuedOn: "2026-09-30" },
];

test("manual payment: oldest-first by default; overpaying the open balance is refused", () => {
  assert.deepEqual(planManualPayment({ openInvoices: open, amountCents: 25000, paidOn: "2026-10-14", todayIso: "2026-10-15" }), [
    { invoiceId: "a", invoiceNumber: "500001", amountCents: 20000 },
    { invoiceId: "b", invoiceNumber: "500002", amountCents: 5000 },
  ]);
  assert.throws(() => planManualPayment({ openInvoices: open, amountCents: 50001, paidOn: "2026-10-14", todayIso: "2026-10-15" }), isCode("OVERPAY"));
});

test("manual payment: chosen invoices must be open, once each, within balance, adding up", () => {
  const chosen = planManualPayment({ openInvoices: open, amountCents: 30000, allocations: [{ invoiceId: "b", amountCents: 30000 }], paidOn: "2026-10-14", todayIso: "2026-10-15" });
  assert.deepEqual(chosen, [{ invoiceId: "b", invoiceNumber: "500002", amountCents: 30000 }]);
  const pay = (allocations, amountCents) => () => planManualPayment({ openInvoices: open, amountCents, allocations, paidOn: "2026-10-14", todayIso: "2026-10-15" });
  assert.throws(pay([{ invoiceId: "zzz", amountCents: 100 }], 100), isCode("INVALID"));
  assert.throws(pay([{ invoiceId: "a", amountCents: 20001 }], 20001), isCode("OVERPAY"));
  assert.throws(pay([{ invoiceId: "a", amountCents: 100 }, { invoiceId: "a", amountCents: 100 }], 200), isCode("INVALID"));
  assert.throws(pay([{ invoiceId: "a", amountCents: 100 }], 200), isCode("INVALID"));
});

test("manual payment: the received date can't be in the future or before the invoice was issued", () => {
  const pay = (paidOn, allocations) => () => planManualPayment({ openInvoices: open, amountCents: 1000, allocations, paidOn, todayIso: "2026-10-15" });
  assert.throws(pay("2026-10-16"), (e) => isCode("INVALID")(e) && /future/.test(e.message));
  assert.throws(pay("2026-09-29", [{ invoiceId: "b", amountCents: 1000 }]), (e) => isCode("INVALID")(e) && /#500002/.test(e.message));
  assert.doesNotThrow(pay("2026-09-30", [{ invoiceId: "b", amountCents: 1000 }]), "the issue day itself is fine");
  assert.throws(pay("10/14/2026"), isCode("INVALID"));
});
```

`apps/api/src/services/billing/invoice-actions.service.test.js`:

```js
import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// The per-invoice locks go through config/redis.js; an in-memory store stands in.
const lockStore = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) { if (nx && lockStore.has(key)) return null; lockStore.set(key, val); return "OK"; },
    async del(key) { lockStore.delete(key); return 1; },
    async get(key) { return lockStore.get(key) ?? null; },
  },
}));
const recorded = [];
let verifyResult = null;
vi.mock("../payment-recording.service.js", () => ({
  verifyAllocations: async () => verifyResult,
  recordPaymentAndAllocations: async (args) => { recorded.push(args); return { ledgerWriteFailed: false }; },
}));

const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");
const actions = await import("./invoice-actions.service.js");
const { InvoiceError } = await import("./invoice-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(fileURLToPath(new URL("./invoice-actions.service.js", import.meta.url)), "utf8");
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;

beforeEach(() => { lockStore.clear(); recorded.length = 0; verifyResult = null; });

const draftRow = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, totalCents: 10000, notes: null, voidReason: null, clientUserId: "doc1" };
const lineRow = { id: "l1", position: 0, kind: "item", description: "DDSO", qty: 1, unitCents: 10000, lineCents: 10000, taxable: false, priceSource: "client", priceNote: null };

test("editDraft: a stale version is refused before any write", async () => {
  const tx = fakeTx({ selects: [[draftRow]] });
  await assert.rejects(actions.editDraft("inv1", { edit: { op: "notes", notes: "x" }, expectedVersion: 1, byUserId: "a1" }, fakeDb(tx)), isCode("STALE"));
  assert.equal(tx.log.filter((l) => ["update", "insert", "delete"].includes(l.op)).length, 0);
});

test("editDraft: a price override seals its reason, recomputes totals and audits without the reason", async () => {
  const tx = fakeTx({ selects: [[draftRow], [lineRow]], updates: [undefined, [{ ...draftRow, version: 3, totalCents: 9000 }]] });
  const out = await actions.editDraft("inv1", {
    edit: { op: "update", lineId: "l1", unitCents: 9000, reason: "courtesy for Jane Doe" }, expectedVersion: 2, byUserId: "a1",
  }, fakeDb(tx));
  assert.equal(out.version, 3);
  const sets = tx.log.filter((l) => l.op === "set").map((l) => l.values);
  assert.equal(decryptField(sets[0].priceNote), "courtesy for Jane Doe");
  assert.equal(sets[1].totalCents, 9000);
  const audit = tx.log.filter((l) => l.op === "insert").at(-1).values;
  assert.equal(audit.action, "invoice.edited");
  assert.ok(!JSON.stringify(audit.metadata).includes("Jane"));
});

test("issueInvoice: an unpriced draft can't be issued by hand either", async () => {
  const tx = fakeTx({ selects: [[draftRow], [{ ...lineRow, priceSource: "unpriced" }]] });
  await assert.rejects(actions.issueInvoice("inv1", { expectedVersion: 2, byUserId: "a1" }, fakeDb(tx)), isCode("INVALID"));
});

test("voidInvoice: refused once money is applied; runs under the invoice's payment lock", async () => {
  const issued = { ...draftRow, status: "issued" };
  const tx = fakeTx({ selects: [[issued], [{ invoiceId: "inv1", paid: "2500" }]] });
  await assert.rejects(actions.voidInvoice("inv1", { reason: "wrong client", expectedVersion: 2, byUserId: "a1" }, fakeDb(tx)), isCode("INVALID_TRANSITION"));
  assert.equal(tx.log.filter((l) => l.op === "set").length, 0);
  lockStore.set("chargeguard:inv:inv1", "1"); // a doctor's card payment is mid-flight
  await assert.rejects(actions.voidInvoice("inv1", { reason: "x", expectedVersion: 2, byUserId: "a1" }, fakeDb(fakeTx())), isCode("LOCKED"));
});

test("recordCredit: a ledger row with a sealed reason, a credit: id and no card", async () => {
  const issued = { ...draftRow, status: "issued" };
  const tx = fakeTx({ selects: [[issued], [{ invoiceId: "inv1", paid: "4000" }]] });
  const out = await actions.recordCredit("inv1", { amountCents: 2500, reason: "shade mismatch", byUserId: "a1" }, fakeDb(tx));
  assert.equal(out.balanceCents, 3500);
  const [row, audit] = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  assert.deepEqual([row.source, row.appliedCents, row.userId, row.invoiceId], ["credit", 2500, "doc1", "inv1"]);
  assert.equal(row.transactionId, `credit:${row.id}`);
  assert.equal(decryptField(row.note), "shade mismatch");
  assert.deepEqual(audit.metadata, { invoiceNumber: 500001, amountCents: 2500 });
  await assert.rejects(
    actions.recordCredit("inv1", { amountCents: 6001, reason: "x", byUserId: "a1" }, fakeDb(fakeTx({ selects: [[issued], [{ invoiceId: "inv1", paid: "4000" }]] }))),
    isCode("OVERPAY"),
  );
});

test("recordManualPayment: oldest-first, re-verified under the lock, recorded as received (not charged)", async () => {
  const db = fakeTx({ selects: [
    [{ id: "doc1", email: "d@x.com", name: "Dr", role: "doctor" }],
    [{ id: "a", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: "2026-09-30", issuedAt: new Date("2026-08-31T15:00:00Z") }],
    [],
  ] });
  const out = await actions.recordManualPayment({
    clientUserId: "doc1", method: "check", reference: " 1042 ", amountCents: 15000, paidOn: "2026-09-15", byUserId: "a1",
  }, db);
  assert.match(out.transactionId, /^OFFLINE-/);
  assert.deepEqual(recorded[0].allocations, [{ invoiceId: "a", invoiceNumber: "500001", amountCents: 15000 }]);
  assert.deepEqual(
    [recorded[0].source, recorded[0].wasCharged, recorded[0].paidOn, recorded[0].reference, recorded[0].actorUserId, recorded[0].auditAction],
    ["admin_check", false, "2026-09-15", "1042", "a1", "payment.manual_recorded"],
  );
});

test("recordManualPayment: a race lost under the lock is refused, nothing recorded; non-doctors are not clients", async () => {
  verifyResult = { kind: "validation", message: "exceeds its balance" };
  const db = fakeTx({ selects: [
    [{ id: "doc1", email: "d@x.com", role: "doctor" }],
    [{ id: "a", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: null, issuedAt: new Date("2026-08-31T15:00:00Z") }],
    [],
  ] });
  await assert.rejects(actions.recordManualPayment({ clientUserId: "doc1", method: "cash", amountCents: 100, paidOn: "2026-09-15", byUserId: "a1" }, db), isCode("OVERPAY"));
  assert.equal(recorded.length, 0);
  await assert.rejects(
    actions.recordManualPayment({ clientUserId: "x", method: "cash", amountCents: 100, paidOn: "2026-09-15" }, fakeTx({ selects: [[{ id: "x", role: "admin" }]] })),
    isCode("NOT_FOUND"),
  );
});

test("every balance-changing action holds the same per-invoice lock card payments take", () => {
  const bodyOf = (marker) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, marker);
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };
  for (const fn of ["export function voidInvoice", "export function recordCredit", "export async function recordManualPayment"]) {
    assert.match(bodyOf(fn), /underInvoiceLocks\(/, fn);
  }
  assert.match(source, /\.for\("update"\)/);
});
```

(`fakeTx` with `updates: [undefined, [...]]`: the line update pops `undefined` → `[]`, and the invoice update's `.returning()` pops the updated row.)

Append to `apps/api/src/routes/__tests__/billing-routes.test.js`:

```js
test("staff actions validate their bodies and map invoice errors to replies", () => {
  const cases = [
    ['fastify.patch("/admin/invoices/:id/lines",', /validate\(invoiceEditSchema\)/, /editDraft\(/],
    ['fastify.post("/admin/invoices/:id/issue",', /validate\(invoiceIssueSchema\)/, /issueInvoice\(/],
    ['fastify.post("/admin/invoices/:id/void",', /validate\(invoiceVoidSchema\)/, /voidInvoice\(/],
    ['fastify.post("/admin/invoices/:id/credit",', /validate\(invoiceCreditSchema\)/, /recordCredit\(/],
    ['fastify.post("/admin/clients/:userId/payments",', /validate\(manualPaymentSchema\)/, /recordManualPayment\(/],
  ];
  for (const [marker, schema, call] of cases) {
    const body = handlerSource(admin, marker);
    assert.match(body, schema, marker);
    assert.match(body, call, marker);
    assert.match(body, /byUserId: request\.user\.id/, marker);
  }
  assert.match(admin, /invoiceErrorReply\(err\)/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/billing src/routes/__tests__/billing-routes.test.js`
Expected: FAIL. `planCredit`, `planManualPayment` and `invoice-actions.service.js` don't exist; the routes don't either.

- [ ] **Step 3: Add the credit and manual-payment rules**

`apps/api/src/services/billing/invoice-rules.js`. Change its shared import to `import { INVOICE_LINE_KINDS, allocateOldestFirst } from "@my-app/shared";`, and append:

```js
/** A credit (write-off) on an issued invoice: a reason, and no more than is owed. */
export function planCredit(invoice, { amountCents, reason, balanceCents }) {
  if (invoice.status !== "issued") {
    throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} is ${invoice.status} — only an issued invoice can be credited.`);
  }
  const why = trimmed(reason);
  if (!why) throw new InvoiceError("REASON_REQUIRED", "Say why this credit is being given.");
  assertCents(amountCents, "amountCents");
  if (amountCents <= 0) throw new InvoiceError("INVALID", "A credit must be more than $0.00.");
  if (amountCents > balanceCents) {
    throw new InvoiceError("OVERPAY", `A credit of ${formatCents(amountCents)} is more than the ${formatCents(Math.max(0, balanceCents))} owed.`);
  }
  return { reason: why };
}

/**
 * A manual payment (check, cash, ACH, other) → its allocations. Staff-chosen
 * allocations must each be an open invoice, once, within its balance, and add
 * up to the payment; otherwise oldest-first (allocateOldestFirst, shared with
 * AutoPay and the pay screens). Overpaying is refused: there is no unapplied credit in this piece.
 * The received date may not be in the future, nor before an allocated invoice
 * was issued (the statement would show a payment against an invoice that
 * didn't exist yet).
 *
 * @param {Array<{ id, invoiceNumber, balanceCents, dueDate, issuedOn }>} openInvoices  ledger.openInvoicesForClient
 */
export function planManualPayment({ openInvoices, amountCents, allocations, paidOn, todayIso }) {
  assertCents(amountCents, "amountCents");
  if (amountCents <= 0) throw new InvoiceError("INVALID", "A payment must be more than $0.00.");
  if (!ISO.test(paidOn ?? "")) throw new InvoiceError("INVALID", "The payment date must be YYYY-MM-DD.");
  if (paidOn > todayIso) throw new InvoiceError("INVALID", "The payment date can't be in the future.");

  const byId = new Map(openInvoices.map((i) => [i.id, i]));
  let planned;
  if (allocations?.length) {
    const seen = new Set();
    planned = allocations.map((a) => {
      const inv = byId.get(a.invoiceId);
      if (!inv) throw new InvoiceError("INVALID", "That invoice isn't open on this client's account.");
      if (seen.has(a.invoiceId)) throw new InvoiceError("INVALID", `Invoice #${inv.invoiceNumber} appears more than once.`);
      seen.add(a.invoiceId);
      if (a.amountCents > inv.balanceCents) {
        throw new InvoiceError("OVERPAY", `${formatCents(a.amountCents)} is more than the ${formatCents(inv.balanceCents)} owed on invoice #${inv.invoiceNumber}.`);
      }
      return { invoiceId: inv.id, invoiceNumber: String(inv.invoiceNumber), amountCents: a.amountCents };
    });
    if (sumCents(planned.map((a) => a.amountCents)) !== amountCents) throw new InvoiceError("INVALID", "Allocations must add up to the payment.");
  } else {
    const { allocations: auto, totalAllocatedCents } = allocateOldestFirst(openInvoices, amountCents);
    if (totalAllocatedCents < amountCents) {
      throw new InvoiceError("OVERPAY", `${formatCents(amountCents)} is more than this client's open balance of ${formatCents(totalAllocatedCents)}.`);
    }
    planned = auto;
  }
  for (const a of planned) {
    const inv = byId.get(a.invoiceId);
    if (inv.issuedOn && paidOn < inv.issuedOn) {
      throw new InvoiceError("INVALID", `The payment date is before invoice #${inv.invoiceNumber} was issued (${inv.issuedOn}).`);
    }
  }
  return planned;
}
```

(`allocateOldestFirst` returns `invoiceNumber` as a string, matching the chosen-allocations branch.)

- [ ] **Step 4: Implement the actions service**

`apps/api/src/services/billing/invoice-actions.service.js`:

```js
import { and, eq } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, CREDIT_SOURCE, manualPaymentSource } from "@my-app/shared";
import { db } from "../../config/database.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { PRICING } from "../../config/pricing.js";
import { invoices, invoiceLines, invoicePayments, users } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { withInvoiceLocks, InvoiceLockedError } from "../../lib/payment-helpers.js";
import { paidCentsByInvoice, openInvoicesForClient } from "./ledger.service.js";
import { auditInvoice, loadLines } from "./invoices.service.js";
import { sealInvoice, openInvoice, sealLine, sealLedgerRow } from "./invoice-crypto.js";
import {
  InvoiceError, assertFreshInvoice, planLineEdit, planIssue, planVoid, planCredit, planManualPayment, deriveBalance,
} from "./invoice-rules.js";
import { verifyAllocations, recordPaymentAndAllocations } from "../payment-recording.service.js";

/**
 * Staff billing actions (Admin › Invoices). Each runs in its own transaction
 * with the invoice row locked (FOR UPDATE) and, where the client sent one, a
 * version check (409 "This invoice changed — reload"). Anything that changes
 * what an invoice owes (void, credit, manual payment) ALSO holds the
 * per-invoice lock every card payment takes (withInvoiceLocks), so a doctor
 * paying and staff voiding can never interleave. Every action is audited
 * (ids and amounts only; reasons live encrypted on the rows).
 */

async function lockInvoice(tx, id) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
  if (!row) throw new InvoiceError("NOT_FOUND", "Invoice not found.");
  return openInvoice(row);
}

async function commitPatch(tx, invoice, patch) {
  const [updated] = await tx
    .update(invoices)
    .set(sealInvoice(patch))
    .where(and(eq(invoices.id, invoice.id), eq(invoices.version, invoice.version)))
    .returning();
  if (!updated) throw new InvoiceError("STALE", "This invoice changed — reload.");
  return openInvoice(updated);
}

async function underInvoiceLocks(invoiceIds, fn) {
  try {
    return await withInvoiceLocks(redis, invoiceIds, fn);
  } catch (err) {
    if (err instanceof InvoiceLockedError) {
      throw new InvoiceError("LOCKED", "A payment on this invoice is in progress — try again in a moment.");
    }
    throw err;
  }
}

/** One draft edit: qty, an overridden price (with a reason), a free-form line, a removal, or notes. */
export function editDraft(id, { edit, expectedVersion, byUserId }, database = db) {
  return database.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    assertFreshInvoice(invoice, expectedVersion);
    const plan = planLineEdit(invoice, await loadLines(tx, id), edit, { now: new Date(), taxRateBps: PRICING.taxRateBps });
    if (plan.op.insert) await tx.insert(invoiceLines).values(sealLine({ ...plan.op.insert, id: createId() }));
    if (plan.op.update) await tx.update(invoiceLines).set(sealLine(plan.op.update.values)).where(eq(invoiceLines.id, plan.op.update.id));
    if (plan.op.delete) await tx.delete(invoiceLines).where(eq(invoiceLines.id, plan.op.delete));
    const updated = await commitPatch(tx, invoice, plan.patch);
    await auditInvoice(tx, "invoice.edited", invoice, byUserId, plan.audit);
    return updated;
  });
}

/** Issue a priced draft by hand (e.g. after pricing a held one): due today + terms, lab-local. */
export function issueInvoice(id, { expectedVersion, byUserId }, database = db) {
  return database.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    assertFreshInvoice(invoice, expectedVersion);
    const now = new Date();
    const { patch } = planIssue(invoice, await loadLines(tx, id), {
      now, termsDays: env.INVOICE_TERMS_DAYS, issueDateIso: isoDateIn(LAB_TIMEZONE, now),
    });
    const updated = await commitPatch(tx, invoice, patch);
    await auditInvoice(tx, "invoice.issued", invoice, byUserId, { via: "staff", totalCents: invoice.totalCents, dueDate: patch.dueDate });
    return updated;
  });
}

/** Void with a reason; an issued invoice only while nothing is applied to it. It keeps its number. */
export function voidInvoice(id, { reason, expectedVersion, byUserId }, database = db) {
  return underInvoiceLocks([id], () =>
    database.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      assertFreshInvoice(invoice, expectedVersion);
      const paidCents = (await paidCentsByInvoice([id], tx)).get(id) ?? 0;
      const { patch } = planVoid(invoice, { paidCents, reason, now: new Date() });
      const updated = await commitPatch(tx, invoice, patch);
      await auditInvoice(tx, "invoice.voided", invoice, byUserId, { via: "staff", wasStatus: invoice.status });
      return updated;
    })
  );
}

/**
 * A credit / write-off on an issued invoice: a ledger row allocated like a
 * payment (`source "credit"`, `transactionId "credit:<rowId>"`), never sent to
 * a card processor. The reason is stored encrypted on the row.
 */
export function recordCredit(id, { amountCents, reason, byUserId }, database = db) {
  return underInvoiceLocks([id], () =>
    database.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      const paidCents = (await paidCentsByInvoice([id], tx)).get(id) ?? 0;
      const { balanceCents } = deriveBalance(invoice, paidCents);
      const { reason: why } = planCredit(invoice, { amountCents, reason, balanceCents });
      const rowId = createId();
      await tx.insert(invoicePayments).values(sealLedgerRow({
        id: rowId,
        userId: invoice.clientUserId ?? null,
        invoiceId: invoice.id,
        invoiceNumber: String(invoice.invoiceNumber),
        appliedCents: amountCents,
        transactionId: `credit:${rowId}`,
        source: CREDIT_SOURCE,
        paidOn: isoDateIn(LAB_TIMEZONE, new Date()),
        note: why,
      }));
      await auditInvoice(tx, "invoice.credited", invoice, byUserId, { amountCents });
      return { id: rowId, balanceCents: balanceCents - amountCents };
    })
  );
}

/**
 * Record a check / cash / ACH / other payment staff received for a client:
 * oldest-first or to the invoices they chose, never more than is owed.
 * Re-verified inside the lock (a card payment may have landed since the read),
 * then written through recordPaymentAndAllocations like every card payment:
 * ledger rows, a "recorded, not charged" receipt, an audit entry.
 */
export async function recordManualPayment({ clientUserId, method, reference = null, amountCents, paidOn, allocations, byUserId }, database = db) {
  const [client] = await database
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, clientUserId));
  if (!client || client.role !== "doctor") throw new InvoiceError("NOT_FOUND", "Client not found.");
  const openInvoices = await openInvoicesForClient(clientUserId, database);
  const planned = planManualPayment({ openInvoices, amountCents, allocations, paidOn, todayIso: isoDateIn(LAB_TIMEZONE, new Date()) });

  return underInvoiceLocks(planned.map((a) => a.invoiceId), async () => {
    const capErr = await verifyAllocations(planned, client, { enforceCap: true, database });
    if (capErr) throw new InvoiceError(capErr.kind === "validation" ? "OVERPAY" : "INVALID", capErr.message);
    const transactionId = `OFFLINE-${createId()}`;
    const { ledgerWriteFailed } = await recordPaymentAndAllocations({
      user: client,
      amountCents,
      transactionId,
      allocations: planned,
      source: manualPaymentSource(method),
      wasCharged: false,
      auditAction: "payment.manual_recorded",
      actorUserId: byUserId,
      paidOn,
      reference: reference?.trim() || null,
    });
    // No money moved through us, so failing loudly is safe: nothing was recorded.
    if (ledgerWriteFailed) throw new Error("manual payment: ledger write failed — nothing was recorded");
    return { transactionId, allocations: planned };
  });
}
```

- [ ] **Step 5: Add the routes**

`apps/api/src/routes/admin-invoice.routes.js`:
- change the imports:

```js
import { validate, validateQuery } from "../middleware/validate.js";
import {
  ERROR_CODES, invoiceListQuerySchema, clientInvoicesQuerySchema, invoiceEditSchema, invoiceIssueSchema,
  invoiceVoidSchema, invoiceCreditSchema, manualPaymentSchema,
} from "@my-app/shared";
import * as actions from "../services/billing/invoice-actions.service.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";
```

- at the top of `adminInvoiceRoutes`, add:

```js
  async function run(reply, fn, status = 200) {
    try {
      return reply.code(status).send({ data: await fn() });
    } catch (err) {
      const r = invoiceErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }
```

- append these routes:

```js
  // Draft editing: one edit per request, always with the version the editor saw.
  fastify.patch("/admin/invoices/:id/lines", { preHandler: [...ADMIN, validate(invoiceEditSchema)] }, (request, reply) =>
    run(reply, async () => {
      const inv = await actions.editDraft(request.params.id, { ...request.body, byUserId: request.user.id });
      return { id: inv.id, version: inv.version, totalCents: inv.totalCents };
    }));

  fastify.post("/admin/invoices/:id/issue", { preHandler: [...ADMIN, validate(invoiceIssueSchema)] }, (request, reply) =>
    run(reply, async () => {
      const inv = await actions.issueInvoice(request.params.id, { ...request.body, byUserId: request.user.id });
      return { id: inv.id, status: inv.status, version: inv.version, dueDate: inv.dueDate };
    }));

  fastify.post("/admin/invoices/:id/void", { preHandler: [...ADMIN, validate(invoiceVoidSchema)] }, (request, reply) =>
    run(reply, async () => {
      const inv = await actions.voidInvoice(request.params.id, { ...request.body, byUserId: request.user.id });
      return { id: inv.id, status: inv.status, version: inv.version };
    }));

  fastify.post("/admin/invoices/:id/credit", { preHandler: [...ADMIN, validate(invoiceCreditSchema)] }, (request, reply) =>
    run(reply, () => actions.recordCredit(request.params.id, { ...request.body, byUserId: request.user.id }), 201));

  // "Record payment" on a client: check, cash, ACH or other.
  fastify.post("/admin/clients/:userId/payments", { preHandler: [...ADMIN, validate(manualPaymentSchema)] }, (request, reply) =>
    run(reply, () => actions.recordManualPayment({ clientUserId: request.params.userId, ...request.body, byUserId: request.user.id }), 201));
```

- [ ] **Step 6: Run the tests and the suite**

```bash
cd apps/api && pnpm vitest run src/services/billing src/routes/__tests__/billing-routes.test.js   # PASS
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(billing): staff edit, issue, void and credit invoices; record manual payments

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 10: PDF layout layer; invoice and statement models; invoice PDFs

**Files:**
- Create:
  - `apps/api/src/services/pdf/pdf-text.js`, `apps/api/src/services/pdf/pdf-layout.js`, `apps/api/src/services/pdf/pdf-layout.test.js`;
  - `apps/api/src/services/billing/invoice-model.js`, `apps/api/src/services/billing/invoice-model.test.js`;
  - `apps/api/src/services/billing/statement-model.js`, `apps/api/src/services/billing/statement-model.test.js`;
  - `apps/api/src/services/billing/billing-pdf.js`, `apps/api/src/services/billing/billing-pdf.test.js`;
  - `apps/api/src/routes/pdf-reply.js`.
- Modify:
  - `apps/api/src/services/lab/ticket-model.js` (text cleaning moves to `pdf-text.js`), `apps/api/src/services/lab/ticket-model.test.js:3`;
  - `apps/api/src/services/lab/ticket-pdf.js` (rewritten onto the layout layer);
  - `apps/api/src/routes/lab.routes.js` (ticket route uses `sendPdf`), `apps/api/src/routes/__tests__/lab-routes.test.js`;
  - `apps/api/src/routes/invoice.routes.js`, `apps/api/src/routes/admin-invoice.routes.js`, `apps/api/src/routes/__tests__/billing-routes.test.js`.

**Interfaces:**
- Consumes:
  - Task 4: `AGING_BUCKETS`, `invoiceStatusLabel`, `ageBalances`.
  - Task 8: `getInvoiceDetail`, `ledgerEntryKind`.
- Produces:
  - `services/pdf/pdf-text.js`: `printable(text)`, `deepPrintable(value)`.
  - `services/pdf/pdf-layout.js`:
    - `MARGIN`, `contentWidth(doc)`;
    - `renderPdf(title, draw) → Promise<Buffer>`;
    - `titleBlock(doc, { title, caption }) → y`, `banners(doc, list, y) → y`;
    - `keyValueGrid(doc, pairs, { top, columns?, labelWidth? })`;
    - `section(doc, title)`, `paragraph(doc, text)`;
    - `table(doc, { columns: [{ label, width, align? }], rows: string[][] })`;
    - `totalsBlock(doc, [{ label, value, bold? }])`, `footer(doc, text)`.
  - `routes/pdf-reply.js`: `sendPdf(reply, pdf, filename)` (inline, `application/pdf`, `no-store`).
  - `services/billing/invoice-model.js`:
    - `billToLines(client)`;
    - `buildInvoiceModel(invoice, lines, client, order, { generatedAt }) → { title, filename, invoiceNumber, status, banners, header, billTo, lines, totals, footer }`.
  - `services/billing/statement-model.js`:
    - `monthBounds("YYYY-MM") → { startIso, endIso, label }`;
    - `statementEvents({ invoices, payments }) → [{ date, kind, invoiceId, description, amountCents }]`;
    - `buildStatementModel(client, activity, period, { generatedAt }) → { title, filename, period, billTo, openingCents, closingCents, summary, lines, aging, footer }`.
    - `activity` is `{ invoices: [{ id, invoiceNumber, status, totalCents, issuedAt, voidedAt, dueDate, labOrderNumber }], payments: [{ invoiceId, invoiceNumber, appliedCents, source, paidOn, createdAt }] }`.
  - `services/billing/billing-pdf.js`: `renderInvoicePdf(model)`, `renderStatementPdf(model) → Promise<Buffer>`.
  - Routes:
    - `GET /api/v1/invoices/:id/pdf` (doctor: own, issued or void);
    - `GET /api/v1/admin/invoices/:id/pdf` (admin; a draft prints with a DRAFT banner).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/pdf/pdf-layout.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { renderPdf, table, titleBlock, keyValueGrid, totalsBlock, footer } from "./pdf-layout.js";
import { printable, deepPrintable } from "./pdf-text.js";

const pages = (buf) => Number(/\/Count (\d+)/.exec(buf.toString("latin1"))?.[1]);

test("renderPdf resolves to PDF bytes, and rejects when drawing throws", async () => {
  const buf = await renderPdf("t", (doc) => {
    const y = titleBlock(doc, { title: "Invoice #1", caption: "LAB" });
    keyValueGrid(doc, [["A", "1"], ["B", "2"], ["C", "3"]], { top: y });
    totalsBlock(doc, [{ label: "Total", value: "$1.00", bold: true }]);
    footer(doc, "footer");
  });
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
  await assert.rejects(renderPdf("t", () => { throw new Error("bad model"); }), /bad model/);
});

test("a long table flows onto further pages instead of being cut", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => [String(i), `Line ${i} with a description long enough to wrap onto a second line in its column`, "$1.00"]);
  const buf = await renderPdf("t", (doc) => table(doc, {
    columns: [{ label: "#", width: 0.1 }, { label: "Description", width: 0.7 }, { label: "Amount", width: 0.2, align: "right" }],
    rows,
  }));
  assert.ok(pages(buf) >= 2, `expected 2+ pages, got ${pages(buf)}`);
});

test("text the standard fonts can't draw becomes ?, recursively", () => {
  assert.equal(printable("Café “Bite” — 2× • ok"), "Café “Bite” — 2× • ok");
  assert.deepEqual(deepPrintable({ a: ["Tooth 😀"], n: 5, z: null }), { a: ["Tooth ?"], n: 5, z: null });
});
```

`apps/api/src/services/billing/invoice-model.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildInvoiceModel, billToLines } from "./invoice-model.js";

const generatedAt = new Date("2026-10-20T15:00:00Z");
const invoice = {
  invoiceNumber: 500001, kind: "order", status: "issued", issuedAt: new Date("2026-10-15T15:00:00Z"), dueDate: "2026-11-14",
  subtotalCents: 40500, taxCents: 0, shippingCents: 1500, totalCents: 42000, paidCents: 12000, balanceCents: 30000,
};
const lines = [
  { qty: 1, code: "2608", description: "DDSO Nylon", kind: "item", unitCents: 40500, lineCents: 40500 },
  { qty: 1, code: null, description: "Shipping", kind: "shipping", unitCents: 1500, lineCents: 1500 },
];
const client = { name: "Dr Amy Lee", practice: "Lee Dental", address1: "1 Main St", address2: null, city: "San Antonio", state: "TX", zip: "78201", accountNumber: "1324" };
const order = { orderNumber: 100245, caseNumber: "RX-ABC", patientName: "Jane Doe" };

test("an invoice prints who, what, when and how much — the patient too, but never in the filename", () => {
  const m = buildInvoiceModel(invoice, lines, client, order, { generatedAt });
  assert.equal(m.filename, "invoice-500001.pdf");
  assert.deepEqual(m.header, [
    ["Invoice", "#500001"], ["Status", "Open"], ["Issued", "10/15/2026"], ["Due", "11/14/2026"],
    ["Lab order", "#100245"], ["Case", "RX-ABC"], ["Patient", "Jane Doe"],
  ]);
  assert.deepEqual(m.billTo, ["Lee Dental", "Dr Amy Lee", "1 Main St", "San Antonio, TX 78201", "Account 1324"]);
  assert.deepEqual(m.lines, [["1", "2608", "DDSO Nylon", "$405.00", "$405.00"], ["1", "—", "Shipping", "$15.00", "$15.00"]]);
  assert.deepEqual(m.totals.map((t) => [t.label, t.value]), [
    ["Subtotal", "$405.00"], ["Shipping", "$15.00"], ["Tax", "$0.00"], ["Total", "$420.00"], ["Paid", "$120.00"], ["Balance due", "$300.00"],
  ]);
  assert.deepEqual(m.banners, []);
  assert.ok(!m.filename.includes("Jane"));
});

test("a draft and a void say so; an unpaid invoice past its due date reads Past due", () => {
  assert.deepEqual(buildInvoiceModel({ ...invoice, status: "draft", issuedAt: null, dueDate: null }, lines, client, order, { generatedAt }).banners, ["DRAFT — NOT A BILL"]);
  const v = buildInvoiceModel({ ...invoice, status: "void", balanceCents: 0 }, lines, client, order, { generatedAt });
  assert.deepEqual(v.banners, ["VOID"]);
  assert.ok(!v.totals.some((t) => t.label === "Balance due"), "a void owes nothing");
  assert.equal(buildInvoiceModel(invoice, lines, client, order, { generatedAt: new Date("2026-11-20T15:00:00Z") }).status, "Past due");
});

test("a guest's shop invoice bills the shop order", () => {
  const m = buildInvoiceModel({ ...invoice, kind: "shop" }, lines, null, { orderNumber: 100300, shopOrderNumber: "DOL-ABC123", caseNumber: null, patientName: null }, { generatedAt });
  assert.deepEqual(m.header[4], ["Shop order", "DOL-ABC123"]);
  assert.deepEqual(m.billTo, ["Walk-in / guest"]);
  assert.deepEqual(billToLines({ name: "Dr Solo", practice: "Dr Solo" }), ["Dr Solo"], "a solo practice isn't printed twice");
});

test("text the PDF fonts can't draw is replaced, not printed as garbage", () => {
  const m = buildInvoiceModel(invoice, lines, client, { ...order, patientName: "Zoë 😀" }, { generatedAt });
  assert.deepEqual(m.header[6], ["Patient", "Zoë ?"]);
});
```

`apps/api/src/services/billing/statement-model.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildStatementModel, monthBounds, statementEvents } from "./statement-model.js";

const invoices = [
  { id: "a", invoiceNumber: 500001, status: "issued", totalCents: 30000, issuedAt: new Date("2026-09-10T15:00:00Z"), dueDate: "2026-10-10", voidedAt: null, labOrderNumber: 100200 },
  { id: "b", invoiceNumber: 500002, status: "issued", totalCents: 20000, issuedAt: new Date("2026-10-05T15:00:00Z"), dueDate: "2026-11-04", voidedAt: null, labOrderNumber: 100201 },
  { id: "c", invoiceNumber: 500003, status: "void", totalCents: 5000, issuedAt: new Date("2026-09-20T15:00:00Z"), dueDate: "2026-10-20", voidedAt: new Date("2026-10-02T15:00:00Z"), labOrderNumber: null },
  // A draft that was voided carries no money.
  { id: "d", invoiceNumber: 500004, status: "void", totalCents: 7000, issuedAt: null, dueDate: null, voidedAt: new Date("2026-10-03T15:00:00Z"), labOrderNumber: null },
];
const payments = [
  { invoiceId: "a", invoiceNumber: "500001", appliedCents: 10000, source: "doctor_card", paidOn: null, createdAt: new Date("2026-09-25T15:00:00Z") },
  // 11:30 pm in Chicago on Oct 31 is 04:30 UTC on Nov 1: it belongs to October.
  { invoiceId: "a", invoiceNumber: "500001", appliedCents: 5000, source: "autopay", paidOn: null, createdAt: new Date("2026-11-01T04:30:00Z") },
  { invoiceId: "b", invoiceNumber: "500002", appliedCents: 2000, source: "credit", paidOn: "2026-10-12", createdAt: new Date("2026-10-12T15:00:00Z") },
  // A check received Oct 9, entered Oct 20: dated by when it was received.
  { invoiceId: "b", invoiceNumber: "500002", appliedCents: 8000, source: "admin_check", paidOn: "2026-10-09", createdAt: new Date("2026-10-20T15:00:00Z") },
  { invoiceId: "b", invoiceNumber: "500002", appliedCents: 0, source: null, paidOn: null, createdAt: new Date("2026-10-15T15:00:00Z") },
  { invoiceId: "a", invoiceNumber: "500001", appliedCents: -1000, source: "refund", paidOn: null, createdAt: new Date("2026-10-16T15:00:00Z") },
];
const client = { name: "Dr Amy Lee", practice: "Lee Dental", accountNumber: "1324" };
const activity = { invoices, payments };

test("monthBounds knows month lengths and refuses junk", () => {
  assert.deepEqual(monthBounds("2028-02"), { startIso: "2028-02-01", endIso: "2028-02-29", label: "February 2028" });
  assert.equal(monthBounds("2026-10").endIso, "2026-10-31");
  assert.throws(() => monthBounds("2026-13"), RangeError);
});

test("opening + the month's dated activity = closing, in the lab's timezone", () => {
  const m = buildStatementModel(client, activity, { month: "2026-10" }, { generatedAt: new Date("2026-11-15T15:00:00Z") });
  assert.equal(m.openingCents, 25000, "Sep: +300.00 +50.00 −100.00");
  assert.deepEqual(m.lines.map((l) => [l.date, l.kind, l.amountCents, l.balanceCents]), [
    ["2026-10-02", "void", -5000, 20000],
    ["2026-10-05", "invoice", 20000, 40000],
    ["2026-10-09", "payment", -8000, 32000],
    ["2026-10-12", "credit", -2000, 30000],
    ["2026-10-16", "refund", 1000, 31000],
    ["2026-10-31", "payment", -5000, 26000],
  ]);
  assert.equal(m.closingCents, 26000);
  assert.deepEqual(m.lines.map((l) => l.description), [
    "Void — invoice #500003",
    "Invoice #500002 · Order #100201",
    "Payment (Check) — invoice #500002",
    "Credit — invoice #500002",
    "Refund — invoice #500001",
    "Payment (AutoPay) — invoice #500001",
  ]);
  assert.deepEqual(m.lines[0].cells, ["10/02/2026", "Void — invoice #500003", "-$50.00", "$200.00"]);
  assert.equal(m.filename, "statement-2026-10.pdf");
});

test("the closing balance is aged per invoice as of the month's end, and the two agree", () => {
  const m = buildStatementModel(client, activity, { month: "2026-10" }, { generatedAt: new Date("2026-11-15T15:00:00Z") });
  assert.equal(m.period.asOfIso, "2026-10-31");
  assert.deepEqual(m.aging.buckets, { current: 10000, d1_30: 16000, d31_60: 0, d61_90: 0, d90_plus: 0 });
  assert.equal(m.aging.totalCents, m.closingCents);
  assert.deepEqual(m.aging.cells[1], ["1–30", "$160.00"]);
});

test("the next month opens where this one closed; the current month ages as of today", () => {
  const nov = buildStatementModel(client, activity, { month: "2026-11" }, { generatedAt: new Date("2026-11-15T15:00:00Z") });
  assert.equal(nov.openingCents, 26000);
  assert.deepEqual(nov.lines, []);
  assert.equal(nov.period.asOfIso, "2026-11-15");
});

test("drafts and the refund guard row never appear", () => {
  const kinds = statementEvents(activity).map((e) => `${e.kind}:${e.invoiceId}`);
  assert.ok(!kinds.some((k) => k.endsWith(":d")));
  assert.equal(statementEvents(activity).filter((e) => e.amountCents === 0).length, 0);
});
```

`apps/api/src/services/billing/billing-pdf.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { renderInvoicePdf, renderStatementPdf } from "./billing-pdf.js";
import { buildInvoiceModel } from "./invoice-model.js";
import { buildStatementModel } from "./statement-model.js";

const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString("latin1") === "%PDF-" && buf.length > 1000;

test("an invoice renders to a PDF", async () => {
  const model = buildInvoiceModel(
    { invoiceNumber: 500001, status: "issued", issuedAt: new Date(), dueDate: "2026-11-14", subtotalCents: 100, taxCents: 0, shippingCents: 0, totalCents: 100, paidCents: 0, balanceCents: 100 },
    [{ qty: 1, code: "1", description: "Item", kind: "item", unitCents: 100, lineCents: 100 }],
    { name: "Dr A", practice: "A Dental" },
    { orderNumber: 1, caseNumber: "RX-1", patientName: "Jane Doe" },
    { generatedAt: new Date() },
  );
  assert.ok(isPdf(await renderInvoicePdf(model)));
});

test("a statement renders to a PDF, with or without activity", async () => {
  const empty = buildStatementModel({ name: "Dr A" }, { invoices: [], payments: [] }, { month: "2026-10" }, { generatedAt: new Date("2026-11-01T15:00:00Z") });
  assert.ok(isPdf(await renderStatementPdf(empty)));
});
```

In `apps/api/src/services/lab/ticket-model.test.js` line 3, change the import to:

```js
import { buildTicketModel } from "./ticket-model.js";
import { printable } from "../pdf/pdf-text.js";
```

In `apps/api/src/routes/__tests__/lab-routes.test.js`, replace the body of `"the work ticket is staff-only, never cached, and audit-logged"` with:

```js
  const body = handlerSource(labSource, 'fastify.get("/lab/orders/:id/ticket.pdf",');
  assert.match(body, /STAFF/);
  assert.match(body, /lab_order\.ticket_printed/);
  assert.match(body, /sendPdf\(reply, pdf, `work-ticket-\$\{orderNumber\}\.pdf`\)/);
  const pdfReply = read("../pdf-reply.js");
  assert.match(pdfReply, /"Cache-Control", "no-store"/);
  assert.match(pdfReply, /application\/pdf/);
```

Append to `apps/api/src/routes/__tests__/billing-routes.test.js`:

```js
test("invoice PDFs: the doctor's own and never a draft; admins any; never cached; audited", () => {
  const mine = handlerSource(doctor, 'fastify.get("/invoices/:id/pdf",');
  assert.match(mine, /detail\.invoice\.clientUserId !== request\.user\.id/);
  assert.match(mine, /detail\.invoice\.status === "draft"/);
  assert.match(mine, /sendPdf\(reply, pdf, model\.filename\)/);
  assert.match(mine, /"invoice\.pdf_downloaded"/);
  const staff = handlerSource(admin, 'fastify.get("/admin/invoices/:id/pdf",');
  assert.match(staff, /sendPdf\(reply, pdf, model\.filename\)/);
  assert.match(staff, /"invoice\.pdf_downloaded"/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/pdf src/services/billing src/services/lab src/routes/__tests__/lab-routes.test.js src/routes/__tests__/billing-routes.test.js`
Expected: FAIL. None of the new modules exist.

- [ ] **Step 3: Extract the PDF layer and move the ticket onto it**

`apps/api/src/services/pdf/pdf-text.js`:

```js
/**
 * pdfkit's standard fonts draw WinAnsi only. Keep Latin-1 plus the common
 * typographic marks; anything else (emoji, CJK) would print as garbage, so it
 * becomes "?". Every PDF model runs its strings through deepPrintable.
 */
const UNPRINTABLE = /[^\n\x20-\x7E -ÿ–—‘’“”•…]/gu;

export function printable(text) {
  return String(text).normalize("NFC").replace(UNPRINTABLE, "?");
}

export function deepPrintable(value) {
  if (typeof value === "string") return printable(value);
  if (Array.isArray(value)) return value.map(deepPrintable);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepPrintable(v)]));
  return value;
}
```

`apps/api/src/services/lab/ticket-model.js`:
- delete the `UNPRINTABLE` comment and constant, `printable` and `deepPrintable` (lines 10–24);
- add `import { deepPrintable } from "../pdf/pdf-text.js";` after the shared import.

`apps/api/src/services/pdf/pdf-layout.js`:

```js
import PDFDocument from "pdfkit";

/**
 * The one PDF layer. Letter size, half-inch margins, the Helvetica family, and
 * the blocks every printed document is made of: a title, black banners, a
 * label/value grid, ruled sections, a table, a totals block and a footer.
 * Renderers (lab ticket, invoice, statement) only arrange these blocks; the
 * models decide what prints. Text must already be WinAnsi-safe (pdf-text.js).
 */
export const MARGIN = 36; // half an inch

export const contentWidth = (doc) => doc.page.width - MARGIN * 2;

/** Run `draw(doc, width)` on a fresh letter-size document; resolves to the PDF bytes. */
export function renderPdf(title, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, info: { Title: title } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, contentWidth(doc));
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** A large title with a small caption under it, top left; returns the y below them. */
export function titleBlock(doc, { title, caption }) {
  const width = contentWidth(doc);
  doc.font("Helvetica-Bold").fontSize(22).text(title, MARGIN, MARGIN, { width });
  doc.font("Helvetica").fontSize(9).text(caption, MARGIN, MARGIN + 26, { width });
  return MARGIN + 40;
}

/** Full-width black bars with white text (RUSH, ON HOLD, DRAFT, VOID); returns the y below them. */
export function banners(doc, list, y) {
  const width = contentWidth(doc);
  let at = y;
  for (const banner of list) {
    doc.rect(MARGIN, at, width, 20).fill("#000");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(12).text(banner, MARGIN + 8, at + 5, { width: width - 16 });
    doc.fillColor("#000");
    at += 24;
  }
  return at;
}

/** Label/value pairs, `columns` across, one line each (a long value is cut with an ellipsis). */
export function keyValueGrid(doc, pairs, { top, columns = 2, labelWidth = 72 }) {
  const colW = contentWidth(doc) / columns;
  doc.fontSize(9);
  pairs.forEach(([label, value], i) => {
    const x = MARGIN + (i % columns) * colW;
    const rowY = top + 4 + Math.floor(i / columns) * 14;
    doc.font("Helvetica-Bold").text(label, x, rowY, { width: labelWidth, lineBreak: false });
    doc.font("Helvetica").text(String(value), x + labelWidth + 2, rowY, { width: colW - labelWidth - 10, lineBreak: false, ellipsis: true });
  });
  doc.x = MARGIN;
  doc.y = top + 4 + Math.ceil(pairs.length / columns) * 14 + 6;
}

/** A ruled section heading; leaves the 9pt body font set. */
export function section(doc, title) {
  const width = contentWidth(doc);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).text(title, MARGIN, doc.y, { width });
  doc.moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + width, doc.y + 1).lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9);
}

/** Body text at the left margin, full width (flows onto further pages). */
export function paragraph(doc, text) {
  doc.text(text, MARGIN, doc.y, { width: contentWidth(doc) });
}

/**
 * A table. `columns`: [{ label, width (fraction of the content width), align }];
 * `rows`: arrays of strings. Cells wrap; a row that won't fit starts a new
 * page, which repeats the header.
 */
export function table(doc, { columns, rows }) {
  const total = contentWidth(doc);
  const widths = columns.map((c) => c.width * total);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0));
  const drawHeader = () => {
    drawRow(columns.map((c) => c.label), "Helvetica-Bold", false);
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + total, doc.y).lineWidth(0.5).stroke();
  };
  function drawRow(cells, font, repeatHeader) {
    doc.font(font).fontSize(9);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ""), { width: widths[i] - 6 }))) + 4;
    if (doc.y + h > doc.page.height - MARGIN) {
      doc.addPage();
      if (repeatHeader) {
        drawHeader();
        doc.font(font).fontSize(9);
      }
    }
    const y = doc.y;
    cells.forEach((c, i) => doc.text(String(c ?? ""), xs[i] + 3, y + 2, { width: widths[i] - 6, align: columns[i].align ?? "left" }));
    doc.x = MARGIN;
    doc.y = y + h;
  }
  drawHeader();
  for (const r of rows) drawRow(r, "Helvetica", true);
}

/** Right-aligned label / amount lines under a table. */
export function totalsBlock(doc, rows) {
  const width = contentWidth(doc);
  doc.moveDown(0.4);
  for (const { label, value, bold } of rows) {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
    doc.text(label, MARGIN + width * 0.5, y, { width: width * 0.32, align: "right" });
    doc.text(value, MARGIN + width * 0.82, y, { width: width * 0.18, align: "right" });
    doc.x = MARGIN;
  }
}

export function footer(doc, text) {
  doc.moveDown(1).font("Helvetica-Oblique").fontSize(7).fillColor("#444").text(text, MARGIN, doc.y, { width: contentWidth(doc) });
  doc.fillColor("#000");
}
```

`apps/api/src/services/lab/ticket-pdf.js` (whole file):

```js
import { code128Modules } from "../../lib/code128.js";
import { MARGIN, renderPdf, banners, keyValueGrid, section, paragraph, footer } from "../pdf/pdf-layout.js";

/**
 * Lay out a work ticket model (ticket-model.js) on the shared PDF layer.
 * Thin on purpose: every decision about WHAT prints lives in the model.
 * Header, barcode and banners are always on page 1; a long prescription
 * flows onto further pages rather than being cut.
 */

const MODULE = 1.1; // points per barcode module (~0.39 mm; scans on a laser printer)
const BAR_HEIGHT = 36;

function drawBarcode(doc, text, right, top) {
  const modules = code128Modules(text);
  const width = modules.reduce((s, w) => s + w, 0) * MODULE;
  let x = right - width;
  const left = x;
  modules.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(x, top, w * MODULE, BAR_HEIGHT).fill("#000");
    x += w * MODULE;
  });
  doc.fillColor("#000").font("Helvetica").fontSize(8).text(text, left, top + BAR_HEIGHT + 2, { width, align: "center" });
}

export function renderTicketPdf(model) {
  return renderPdf(model.title, (doc, width) => {
    doc.font("Helvetica-Bold").fontSize(22).text(`Order #${model.orderNumber}`, MARGIN, MARGIN, { width: width / 2 });
    doc.font("Helvetica").fontSize(9).text("WORK TICKET", MARGIN, MARGIN + 26);
    drawBarcode(doc, model.barcodeText, doc.page.width - MARGIN, MARGIN);

    keyValueGrid(doc, model.header, { top: banners(doc, model.banners, MARGIN + BAR_HEIGHT + 22) });

    section(doc, "Devices & lines");
    if (model.lines.length === 0) paragraph(doc, "—");
    for (const l of model.lines) paragraph(doc, `${l.qty} ×   ${l.code}   ${l.name}${l.arch ? `   (${l.arch})` : ""}`);
    if (model.instructions.length) {
      section(doc, "Instructions");
      for (const t of model.instructions) paragraph(doc, `• ${t}`);
    }
    if (model.buildNotes) { section(doc, "Build notes"); paragraph(doc, model.buildNotes); }
    if (model.comments) { section(doc, "Doctor's comments"); paragraph(doc, model.comments); }
    if (model.shipTo) { section(doc, "Ship to"); paragraph(doc, model.shipTo.join("\n")); }
    if (model.answerGroups.length) {
      section(doc, "Prescription");
      for (const g of model.answerGroups) {
        doc.font("Helvetica-Bold").fontSize(9).text(g.title, MARGIN, doc.y, { width });
        doc.font("Helvetica").fontSize(8);
        for (const [label, value] of g.items) doc.text(`${label}: ${value}`, MARGIN + 8, doc.y, { width: width - 8 });
        doc.moveDown(0.2);
      }
    }
    if (model.files.length) { section(doc, "Files"); paragraph(doc, model.files.join("\n")); }
    footer(doc, model.footer);
  });
}
```

`apps/api/src/routes/pdf-reply.js`:

```js
/**
 * Send a generated PDF. Every PDF here carries PHI or money (work tickets,
 * invoices, statements): generated on request, never stored, never cached
 * (no-store), shown inline. The filename is a number or a month, never a
 * patient's name.
 */
export function sendPdf(reply, pdf, filename) {
  return reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", `inline; filename="${filename}"`)
    .header("Cache-Control", "no-store")
    .send(pdf);
}
```

`apps/api/src/routes/lab.routes.js`:
- add `import { sendPdf } from "./pdf-reply.js";`;
- replace the ticket route's `return reply.header("Content-Type", …).send(pdf);` chain with:

```js
    return sendPdf(reply, pdf, `work-ticket-${orderNumber}.pdf`);
```

- [ ] **Step 4: Implement the invoice and statement models and renderers**

`apps/api/src/services/billing/invoice-model.js`:

```js
import { LAB_TIMEZONE, formatUsDate, formatLabDate, isoDateIn, invoiceStatusLabel } from "@my-app/shared";
import { formatCents } from "../../lib/money.js";
import { deepPrintable } from "../pdf/pdf-text.js";

const usDate = (iso) => formatUsDate(iso) || "—";
const labDate = (instant) => formatLabDate(instant) || "—";

/** Who the bill is for: practice, the doctor (when different), address, account. */
export function billToLines(client) {
  if (!client) return ["Walk-in / guest"];
  const practice = client.practice || client.name || "—";
  const cityLine = `${[client.city, client.state].filter(Boolean).join(", ")}${client.zip ? ` ${client.zip}` : ""}`.trim();
  return [
    practice,
    client.name && client.name !== practice ? client.name : null,
    client.address1 || null,
    client.address2 || null,
    cityLine || null,
    client.accountNumber ? `Account ${client.accountNumber}` : null,
  ].filter(Boolean);
}

/**
 * Everything printed on an invoice, decided here so it is testable; the
 * renderer (billing-pdf.js) only lays it out. The patient's name is printed
 * (the doctor needs it to match the bill). The PDF is generated on request,
 * never stored, and its filename never names the patient.
 *
 * @param invoice  from getInvoiceDetail (with paidCents / balanceCents)
 * @param order    getInvoiceDetail's labOrder block: { orderNumber, caseNumber, patientName, shopOrderNumber }
 */
export function buildInvoiceModel(invoice, lines, client, order, { generatedAt }) {
  const status = invoiceStatusLabel(invoice, isoDateIn(LAB_TIMEZONE, generatedAt));
  const banners = [];
  if (invoice.status === "draft") banners.push("DRAFT — NOT A BILL");
  if (invoice.status === "void") banners.push("VOID");
  const totals = [
    { label: "Subtotal", value: formatCents(invoice.subtotalCents) },
    ...(invoice.shippingCents ? [{ label: "Shipping", value: formatCents(invoice.shippingCents) }] : []),
    { label: "Tax", value: formatCents(invoice.taxCents) },
    { label: "Total", value: formatCents(invoice.totalCents), bold: true },
    ...(invoice.status === "issued"
      ? [{ label: "Paid", value: formatCents(invoice.paidCents) }, { label: "Balance due", value: formatCents(Math.max(0, invoice.balanceCents)), bold: true }]
      : []),
  ];
  return deepPrintable({
    title: `Invoice #${invoice.invoiceNumber}`,
    filename: `invoice-${invoice.invoiceNumber}.pdf`,
    invoiceNumber: String(invoice.invoiceNumber),
    status,
    banners,
    header: [
      ["Invoice", `#${invoice.invoiceNumber}`],
      ["Status", status],
      ["Issued", invoice.issuedAt ? labDate(invoice.issuedAt) : "—"],
      ["Due", usDate(invoice.dueDate)],
      order?.shopOrderNumber ? ["Shop order", order.shopOrderNumber] : ["Lab order", order?.orderNumber ? `#${order.orderNumber}` : "—"],
      ["Case", order?.caseNumber ?? "—"],
      ["Patient", order?.patientName ?? "—"],
    ],
    billTo: billToLines(client),
    lines: lines.map((l) => [String(l.qty), l.code || "—", l.description, formatCents(l.unitCents), formatCents(l.lineCents)]),
    totals,
    footer: `Generated ${labDate(generatedAt)} · Diamond Orthotic Laboratory · Pay online in the doctor portal. Contains patient information — keep confidential.`,
  });
}
```

`apps/api/src/services/billing/statement-model.js`:

```js
import { LAB_TIMEZONE, AGING_BUCKETS, MANUAL_PAYMENT_LABELS, formatUsDate, isoDateIn } from "@my-app/shared";
import { formatCents } from "../../lib/money.js";
import { deepPrintable } from "../pdf/pdf-text.js";
import { ageBalances } from "./aging.js";
import { ledgerEntryKind } from "./invoice-views.js";
import { billToLines } from "./invoice-model.js";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "YYYY-MM" → its first and last lab-local day and a label. */
export function monthBounds(month) {
  const m = MONTH.exec(month ?? "");
  if (!m) throw new RangeError(`Not a YYYY-MM month: ${month}`);
  const year = Number(m[1]);
  const mo = Number(m[2]);
  return {
    startIso: `${month}-01`,
    endIso: new Date(Date.UTC(year, mo, 0)).toISOString().slice(0, 10),
    label: `${MONTH_NAMES[mo - 1]} ${year}`,
  };
}

const labDay = (instant) => isoDateIn(LAB_TIMEZONE, new Date(instant));
const KIND_ORDER = { invoice: 0, payment: 1, credit: 2, refund: 3, void: 4 };

function paymentLabel(source) {
  const manual = /^admin_(check|cash|ach|other)$/.exec(source ?? "");
  if (manual) return `Payment (${MANUAL_PAYMENT_LABELS[manual[1]]})`;
  if (source === "autopay") return "Payment (AutoPay)";
  return "Payment";
}

/**
 * Every dated money event on a client's account, signed as it moves the
 * balance: an invoice issued (+total), a payment or credit (−applied), a refund
 * (+), a void of an issued invoice (−total). Dates are lab-local days; a
 * manual payment is dated by when it was received. Drafts, voided drafts and
 * the refund write-ahead guard row carry no money.
 */
export function statementEvents({ invoices, payments }) {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const events = [];
  for (const inv of invoices) {
    if (!inv.issuedAt) continue;
    const order = inv.labOrderNumber ? ` · Order #${inv.labOrderNumber}` : "";
    events.push({ date: labDay(inv.issuedAt), kind: "invoice", invoiceId: inv.id, description: `Invoice #${inv.invoiceNumber}${order}`, amountCents: inv.totalCents });
    if (inv.status === "void" && inv.voidedAt) {
      events.push({ date: labDay(inv.voidedAt), kind: "void", invoiceId: inv.id, description: `Void — invoice #${inv.invoiceNumber}`, amountCents: -inv.totalCents });
    }
  }
  for (const p of payments) {
    if (!p.appliedCents) continue;
    const kind = ledgerEntryKind(p);
    const number = byId.get(p.invoiceId)?.invoiceNumber ?? p.invoiceNumber;
    const label = kind === "credit" ? "Credit" : kind === "refund" ? "Refund" : paymentLabel(p.source);
    events.push({ date: p.paidOn ?? labDay(p.createdAt), kind, invoiceId: p.invoiceId, description: `${label} — invoice #${number}`, amountCents: -p.appliedCents });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.description.localeCompare(b.description));
}

/**
 * A client's statement for one month: opening balance, every dated event in
 * the month with a running balance, closing balance, and the closing balance
 * aged per invoice as of the month's end (or today, for the current month).
 * Pure; dates use the lab timezone.
 */
export function buildStatementModel(client, activity, period, { generatedAt }) {
  const { startIso, endIso, label } = monthBounds(period.month);
  const todayIso = isoDateIn(LAB_TIMEZONE, generatedAt);
  const asOfIso = todayIso < endIso ? todayIso : endIso;

  const events = statementEvents(activity);
  const openingCents = events.filter((e) => e.date < startIso).reduce((s, e) => s + e.amountCents, 0);
  let running = openingCents;
  const lines = events
    .filter((e) => e.date >= startIso && e.date <= endIso)
    .map((e) => {
      running += e.amountCents;
      return { ...e, balanceCents: running };
    });
  const closingCents = running;

  // Each invoice's balance as of the period end, aged by its due date.
  const paidBy = new Map();
  for (const p of activity.payments) {
    if ((p.paidOn ?? labDay(p.createdAt)) <= endIso) paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.appliedCents);
  }
  const items = activity.invoices
    .filter((inv) => inv.issuedAt && labDay(inv.issuedAt) <= endIso)
    .filter((inv) => !(inv.status === "void" && inv.voidedAt && labDay(inv.voidedAt) <= endIso))
    .map((inv) => ({ dueDate: inv.dueDate ?? null, balanceCents: inv.totalCents - (paidBy.get(inv.id) ?? 0) }));
  const aging = ageBalances(items, asOfIso);

  return deepPrintable({
    title: `Statement — ${label}`,
    filename: `statement-${period.month}.pdf`,
    period: { month: period.month, label, startIso, endIso, asOfIso },
    billTo: billToLines(client),
    openingCents,
    closingCents,
    summary: [["Opening balance", formatCents(openingCents)], ["Closing balance", formatCents(closingCents)]],
    lines: lines.map((l) => ({ ...l, cells: [formatUsDate(l.date), l.description, formatCents(l.amountCents), formatCents(l.balanceCents)] })),
    aging: { ...aging, cells: AGING_BUCKETS.map((b) => [b.label, formatCents(aging.buckets[b.key])]) },
    footer: `Generated ${formatUsDate(todayIso)} · Aging as of ${formatUsDate(asOfIso)} · Diamond Orthotic Laboratory · Pay online in the doctor portal.`,
  });
}
```

`apps/api/src/services/billing/billing-pdf.js`:

```js
import { renderPdf, titleBlock, banners, keyValueGrid, section, paragraph, table, totalsBlock, footer } from "../pdf/pdf-layout.js";

/** Lay out invoice and statement models (invoice-model.js, statement-model.js) on the shared PDF layer. */

const LINE_COLUMNS = [
  { label: "Qty", width: 0.07, align: "right" },
  { label: "Code", width: 0.1 },
  { label: "Description", width: 0.53 },
  { label: "Unit", width: 0.15, align: "right" },
  { label: "Amount", width: 0.15, align: "right" },
];

export function renderInvoicePdf(model) {
  return renderPdf(model.title, (doc) => {
    const y = banners(doc, model.banners, titleBlock(doc, { title: model.title, caption: "DIAMOND ORTHOTIC LABORATORY" }));
    keyValueGrid(doc, model.header, { top: y });
    section(doc, "Bill to");
    paragraph(doc, model.billTo.join("\n"));
    section(doc, "Items");
    table(doc, { columns: LINE_COLUMNS, rows: model.lines });
    totalsBlock(doc, model.totals);
    footer(doc, model.footer);
  });
}

const ACTIVITY_COLUMNS = [
  { label: "Date", width: 0.14 },
  { label: "Activity", width: 0.56 },
  { label: "Amount", width: 0.15, align: "right" },
  { label: "Balance", width: 0.15, align: "right" },
];

export function renderStatementPdf(model) {
  return renderPdf(model.title, (doc) => {
    const y = titleBlock(doc, { title: model.title, caption: "DIAMOND ORTHOTIC LABORATORY · ACCOUNT STATEMENT" });
    keyValueGrid(doc, model.summary, { top: y, labelWidth: 96 });
    section(doc, "Bill to");
    paragraph(doc, model.billTo.join("\n"));
    section(doc, "Activity");
    if (model.lines.length === 0) paragraph(doc, "No activity this month.");
    else table(doc, { columns: ACTIVITY_COLUMNS, rows: model.lines.map((l) => l.cells) });
    section(doc, "Aging of the closing balance");
    const width = 1 / model.aging.cells.length;
    table(doc, {
      columns: model.aging.cells.map(([label]) => ({ label, width, align: "right" })),
      rows: [model.aging.cells.map(([, value]) => value)],
    });
    footer(doc, model.footer);
  });
}
```

- [ ] **Step 5: Add the invoice PDF routes**

`apps/api/src/routes/invoice.routes.js`:
- add the imports:

```js
import { buildInvoiceModel } from "../services/billing/invoice-model.js";
import { renderInvoicePdf } from "../services/billing/billing-pdf.js";
import { sendPdf } from "./pdf-reply.js";
```

- append inside `invoiceRoutes`:

```js
  // The doctor's own invoice as a PDF: built on request, never stored or cached.
  fastify.get("/invoices/:id/pdf", { preHandler: DOCTOR }, async (request, reply) => {
    let pdf;
    let model;
    try {
      const detail = await getInvoiceDetail(request.params.id);
      if (!detail || detail.invoice.clientUserId !== request.user.id || detail.invoice.status === "draft") {
        return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
      }
      model = buildInvoiceModel(detail.invoice, detail.lines, detail.client, detail.labOrder, { generatedAt: new Date() });
      pdf = await renderInvoicePdf(model);
    } catch (err) {
      request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice pdf failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the invoice PDF." } });
    }
    auditService.logSafe({ userId: request.user.id, action: "invoice.pdf_downloaded", targetType: "invoice", targetId: request.params.id, metadata: { invoiceNumber: model.invoiceNumber }, ipAddress: request.ip });
    return sendPdf(reply, pdf, model.filename);
  });
```

`apps/api/src/routes/admin-invoice.routes.js`:
- add the same three imports (`buildInvoiceModel`, `renderInvoicePdf`, `sendPdf`);
- append:

```js
  // Any invoice, drafts included (printed with a DRAFT banner).
  fastify.get("/admin/invoices/:id/pdf", { preHandler: ADMIN }, async (request, reply) => {
    let pdf;
    let model;
    try {
      const detail = await getInvoiceDetail(request.params.id);
      if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
      model = buildInvoiceModel(detail.invoice, detail.lines, detail.client, detail.labOrder, { generatedAt: new Date() });
      pdf = await renderInvoicePdf(model);
    } catch (err) {
      request.log.error({ invoiceId: request.params.id, err: err.message }, "invoice pdf failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the invoice PDF." } });
    }
    auditService.logSafe({ userId: request.user.id, action: "invoice.pdf_downloaded", targetType: "invoice", targetId: request.params.id, metadata: { invoiceNumber: model.invoiceNumber }, ipAddress: request.ip });
    return sendPdf(reply, pdf, model.filename);
  });
```

- [ ] **Step 6: Run the tests and the suite**

```bash
cd apps/api && pnpm vitest run src/services/pdf src/services/billing src/services/lab src/routes/__tests__   # PASS
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

Expected: everything passes. The ticket tests (non-empty PDF, overflow onto page 2) pass unchanged on the shared layer.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(billing): one PDF layout layer; invoice and statement models; invoice PDFs

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 11: Accounts receivable, statements, email notices

**Files:**
- Create: `apps/api/src/services/billing/statements.service.js`, `apps/api/src/services/billing/statements.service.test.js`, `apps/api/src/routes/receivables.routes.js`, `apps/api/src/services/email-billing.test.js`
- Modify: `apps/api/src/services/email.service.js` (two notices), `apps/api/src/routes/invoice.routes.js` (doctor statement), `apps/api/src/routes/admin-invoice.routes.js` (email invoice), `apps/api/src/index.js`, `apps/api/src/routes/__tests__/billing-routes.test.js`

**Interfaces:**
- Consumes:
  - Task 4: `buildReceivables`, `deriveBalance`.
  - Task 10: `buildStatementModel`, `renderStatementPdf`, `sendPdf`.
- Produces:
  - `statements.service.js`:
    - `loadClient(clientUserId) → { id, name, email, accountNumber, practice, address1, address2, city, state, zip } | null` (doctors only);
    - `loadStatementActivity(clientUserId) → { invoices, payments }`;
    - `statementFor(clientUserId, month, { generatedAt }) → { client, model } | null`;
    - `statementPdfFor(clientUserId, month) → { model, pdf } | null`;
    - `listReceivables({ pastDueOnly }) → { rows, totals, asOf }`.
  - `email.service.js`:
    - `sendInvoiceNotice({ to, invoiceId, invoiceNumber, totalCents, balanceCents, dueDate }) → boolean`;
    - `sendStatementNotice({ to, monthLabel, closingCents }) → boolean`.
    Neither carries a PDF or patient data.
  - Routes:
    - `GET /api/v1/admin/receivables?pastDueOnly=true|false`;
    - `GET /api/v1/admin/clients/:userId/statement.pdf?month=YYYY-MM`;
    - `POST /api/v1/admin/clients/:userId/statement/email` (`{ month }`) → `{ sent }`;
    - `POST /api/v1/admin/invoices/:id/email` → `{ sent }`;
    - `GET /api/v1/invoices/statement.pdf?month=YYYY-MM` (doctor, own).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/billing/statements.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { fakeTx } = await import("../../test/fake-tx.js");
const svc = await import("./statements.service.js");
const source = readFileSync(fileURLToPath(new URL("./statements.service.js", import.meta.url)), "utf8");

test("receivables: issued invoices with what is still owed, aged and grouped by client", async () => {
  const db = fakeTx({ selects: [
    [
      { id: "i1", clientUserId: "doc1", status: "issued", totalCents: 30000, dueDate: "2000-01-01", paid: "10000" },
      { id: "i2", clientUserId: "doc1", status: "issued", totalCents: 5000, dueDate: "2000-01-01", paid: "5000" },
      { id: "i3", clientUserId: "doc2", status: "issued", totalCents: 8000, dueDate: "2999-01-01", paid: "0" },
    ],
    [{ id: "doc1", name: "Dr One", accountNumber: "1", practice: "One Dental" }, { id: "doc2", name: "Dr Two", accountNumber: "2", practice: null }],
  ] });
  const ar = await svc.listReceivables({}, db);
  assert.deepEqual(ar.rows.map((r) => [r.clientUserId, r.balanceCents, r.pastDueCents, r.openInvoices]), [["doc1", 20000, 20000, 1], ["doc2", 8000, 0, 1]]);
  assert.equal(ar.rows[0].buckets.d90_plus, 20000);
  assert.equal(ar.totals.balanceCents, 28000);
  assert.match(ar.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test("a statement is only for a doctor; drafts carry no money", async () => {
  assert.equal(await svc.statementFor("u1", "2026-10", {}, fakeTx({ selects: [[{ id: "u1", role: "admin", profile: null }]] })), null);
  assert.match(source, /ne\(invoices\.status, "draft"\)/);
  assert.match(source, /deriveBalance\(/, "receivables use the one balance rule");
});
```

`apps/api/src/services/email-billing.test.js`:

```js
import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({
  env: { APP_ENV: "production", NODE_ENV: "test", EMAIL_FROM: "noreply@example.com", APP_URL: "https://portal.example" },
}));

const email = await import("./email.service.js");
const src = readFileSync(new URL("./email.service.js", import.meta.url), "utf8");
const capture = () => { const f = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", f); return f; };
const sent = (f) => new URLSearchParams(f.mock.calls[0][1].body);

test("the invoice notice: amount, due date and a portal link — no PDF, no patient", async () => {
  const f = capture();
  const ok = await email.sendInvoiceNotice({ to: "dr@x.com", invoiceId: "inv1", invoiceNumber: 500001, totalCents: 42000, balanceCents: 30000, dueDate: "2026-11-14" });
  assert.equal(ok, true);
  const p = sent(f);
  assert.match(p.get("subject"), /Invoice #500001/);
  assert.match(p.get("html"), /\$300\.00/);
  assert.match(p.get("html"), /11\/14\/2026/);
  assert.match(p.get("html"), /https:\/\/portal\.example\/doctor\/invoices\/inv1/);
  assert.equal(p.get("attachment"), null);
  vi.unstubAllGlobals();
});

test("the statement notice: month and closing balance, linking to the portal", async () => {
  const f = capture();
  await email.sendStatementNotice({ to: "dr@x.com", monthLabel: "October 2026", closingCents: 26000 });
  const p = sent(f);
  assert.match(p.get("subject"), /October 2026/);
  assert.match(p.get("html"), /\$260\.00/);
  assert.match(p.get("html"), /https:\/\/portal\.example\/doctor\/invoices/);
  vi.unstubAllGlobals();
});

test("neither notice can carry patient data or a file", () => {
  for (const fn of ["sendInvoiceNotice", "sendStatementNotice"]) {
    const start = src.indexOf(`export async function ${fn}`);
    const body = src.slice(start, src.indexOf("\nexport ", start + 1));
    assert.doesNotMatch(body, /patient|attachment/i, fn);
  }
});
```

Append to `apps/api/src/routes/__tests__/billing-routes.test.js`:

```js
const receivables = read("../receivables.routes.js");

test("AR, client statements and notices are admin-only and audited; nothing patient-bearing is emailed", () => {
  assert.match(receivables, /import \{ ADMIN \} from "\.\/admin-invoice\.routes\.js"/);
  for (const m of markersOf(receivables)) assert.match(handlerSource(receivables, m), /preHandler: \[\.\.\.ADMIN/, m);
  assert.match(handlerSource(receivables, 'fastify.get("/admin/receivables",'), /validateQuery\(receivablesQuerySchema\)/);
  const pdf = handlerSource(receivables, 'fastify.get("/admin/clients/:userId/statement.pdf",');
  assert.match(pdf, /sendPdf\(reply, out\.pdf, out\.model\.filename\)/);
  assert.match(pdf, /"statement\.downloaded"/);
  assert.match(handlerSource(receivables, 'fastify.post("/admin/clients/:userId/statement/email",'), /"statement\.emailed"/);
  const mail = handlerSource(admin, 'fastify.post("/admin/invoices/:id/email",');
  assert.match(mail, /"invoice\.emailed"/);
  assert.doesNotMatch(mail, /patient/i);
  assert.match(index, /await fastify\.register\(receivablesRoutes, \{ prefix: "\/api\/v1" \}\)/);
});

test("a doctor downloads only their own statement", () => {
  const body = handlerSource(doctor, 'fastify.get("/invoices/statement.pdf",');
  assert.match(body, /\.\.\.DOCTOR, validateQuery\(statementQuerySchema\)/);
  assert.match(body, /statementPdfFor\(request\.user\.id, request\.query\.month\)/);
  assert.match(body, /"statement\.downloaded"/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/billing/statements.service.test.js src/services/email-billing.test.js src/routes/__tests__/billing-routes.test.js`
Expected: FAIL. The service, the notices and the routes don't exist.

- [ ] **Step 3: Implement the statements service and the notices**

`apps/api/src/services/billing/statements.service.js`:

```js
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { invoices, invoicePayments, labOrders, users, doctorProfiles } from "../../db/schema/index.js";
import { deriveBalance } from "./invoice-rules.js";
import { buildReceivables } from "./aging.js";
import { buildStatementModel } from "./statement-model.js";
import { renderStatementPdf } from "./billing-pdf.js";

/**
 * Statements and accounts receivable. A "client" is a doctor user; guest shop
 * invoices (no client) never reach a statement or the AR page.
 */

/** The doctor's bill-to block, or null when the user isn't a doctor. */
export async function loadClient(clientUserId, database = db) {
  const [row] = await database
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, accountNumber: users.seazonaAccountNumber, profile: doctorProfiles })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .where(eq(users.id, clientUserId));
  if (!row || row.role !== "doctor") return null;
  const p = row.profile;
  return {
    id: row.id, name: row.name, email: row.email, accountNumber: row.accountNumber ?? null,
    practice: p?.companyName ?? null, address1: p?.address1 ?? null, address2: p?.address2 ?? null,
    city: p?.city ?? null, state: p?.state ?? null, zip: p?.zip ?? null,
  };
}

/** Every money event on a client's account (statement-model's `activity`). Drafts carry none. */
export async function loadStatementActivity(clientUserId, database = db) {
  const invs = await database
    .select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status, totalCents: invoices.totalCents,
      issuedAt: invoices.issuedAt, voidedAt: invoices.voidedAt, dueDate: invoices.dueDate, labOrderNumber: labOrders.orderNumber,
    })
    .from(invoices)
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .where(and(eq(invoices.clientUserId, clientUserId), ne(invoices.status, "draft")));
  const ids = invs.map((i) => i.id);
  const payments = ids.length
    ? await database
        .select({
          invoiceId: invoicePayments.invoiceId, invoiceNumber: invoicePayments.invoiceNumber, appliedCents: invoicePayments.appliedCents,
          source: invoicePayments.source, paidOn: invoicePayments.paidOn, createdAt: invoicePayments.createdAt,
        })
        .from(invoicePayments)
        .where(inArray(invoicePayments.invoiceId, ids))
    : [];
  return { invoices: invs, payments };
}

/** A client's statement model for a month, or null when the user isn't a doctor. */
export async function statementFor(clientUserId, month, { generatedAt = new Date() } = {}, database = db) {
  const client = await loadClient(clientUserId, database);
  if (!client) return null;
  const model = buildStatementModel(client, await loadStatementActivity(clientUserId, database), { month }, { generatedAt });
  return { client, model };
}

/** The statement PDF (built on request, never stored), or null when the user isn't a doctor. */
export async function statementPdfFor(clientUserId, month, database = db) {
  const out = await statementFor(clientUserId, month, {}, database);
  return out ? { model: out.model, pdf: await renderStatementPdf(out.model) } : null;
}

/**
 * Admin › Accounts receivable as of the lab's today: every issued client
 * invoice with its paid total (one grouped query), the balance from the one
 * rule (deriveBalance), aged and grouped per client.
 */
export async function listReceivables({ pastDueOnly = false } = {}, database = db) {
  const rows = await database
    .select({
      id: invoices.id, clientUserId: invoices.clientUserId, status: invoices.status,
      totalCents: invoices.totalCents, dueDate: invoices.dueDate,
      paid: sql`coalesce(sum(${invoicePayments.appliedCents}), 0)`,
    })
    .from(invoices)
    .leftJoin(invoicePayments, eq(invoicePayments.invoiceId, invoices.id))
    .where(and(eq(invoices.status, "issued"), isNotNull(invoices.clientUserId)))
    .groupBy(invoices.id);
  const open = rows
    .map((r) => ({ ...r, ...deriveBalance(r, Number(r.paid)) }))
    .filter((i) => i.balanceCents > 0);
  const ids = [...new Set(open.map((i) => i.clientUserId))];
  const clients = ids.length
    ? await database
        .select({ id: users.id, name: users.name, accountNumber: users.seazonaAccountNumber, practice: doctorProfiles.companyName })
        .from(users)
        .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
        .where(inArray(users.id, ids))
    : [];
  return buildReceivables(open, new Map(clients.map((c) => [c.id, c])), isoDateIn(LAB_TIMEZONE, new Date()), { pastDueOnly });
}
```

`apps/api/src/services/email.service.js`. Add `formatUsDate` to the imports (`import { formatUsDate } from "@my-app/shared";`; `formatCents` was imported in Task 6), and append:

```js
/**
 * "You have an invoice" — sent only when staff press Email invoice (never
 * automatically). A short notice: amount, due date and a portal link. No PDF
 * and no patient data travel by email; the doctor downloads the PDF in the portal.
 */
export async function sendInvoiceNotice({ to, invoiceId, invoiceNumber, totalCents, balanceCents, dueDate }) {
  if (!to) return false;
  const url = `${env.APP_URL}/doctor/invoices/${encodeURIComponent(invoiceId)}`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2733;">
      <h1 style="font-size:20px;margin:0 0 12px;">Invoice #${esc(invoiceNumber)}</h1>
      <p style="margin:0 0 6px;">Total: <strong>${formatCents(totalCents)}</strong></p>
      <p style="margin:0 0 6px;">Balance due: <strong>${formatCents(Math.max(0, balanceCents))}</strong></p>
      <p style="margin:0 0 20px;">Due: <strong>${esc(formatUsDate(dueDate) || "on receipt")}</strong></p>
      <p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;padding:12px 24px;background:#13AEEF;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;">View and pay invoice</a></p>
      <p style="margin:0;font-size:12px;color:#8a98a6;">Sign in to the Diamond Orthotic Laboratory portal to download the PDF.</p>
    </div>`;
  return deliver({ to, subject: `Invoice #${invoiceNumber} — Diamond Orthotic Laboratory`, html });
}

/** "Your statement is ready" — staff-triggered; the closing balance and a portal link only. */
export async function sendStatementNotice({ to, monthLabel, closingCents }) {
  if (!to) return false;
  const url = `${env.APP_URL}/doctor/invoices`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2733;">
      <h1 style="font-size:20px;margin:0 0 12px;">Your ${esc(monthLabel)} statement</h1>
      <p style="margin:0 0 20px;">Balance at the end of the month: <strong>${formatCents(closingCents)}</strong></p>
      <p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;padding:12px 24px;background:#13AEEF;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;">View invoices and statements</a></p>
      <p style="margin:0;font-size:12px;color:#8a98a6;">Sign in to the Diamond Orthotic Laboratory portal to download the statement.</p>
    </div>`;
  return deliver({ to, subject: `${monthLabel} statement — Diamond Orthotic Laboratory`, html });
}
```

- [ ] **Step 4: Add the routes**

`apps/api/src/routes/receivables.routes.js`:

```js
import { validate, validateQuery } from "../middleware/validate.js";
import { ERROR_CODES, receivablesQuerySchema, statementQuerySchema } from "@my-app/shared";
import * as auditService from "../services/audit.service.js";
import { sendStatementNotice } from "../services/email.service.js";
import { listReceivables, statementFor, statementPdfFor } from "../services/billing/statements.service.js";
import { sendPdf } from "./pdf-reply.js";
import { ADMIN } from "./admin-invoice.routes.js";

/** Admin › Accounts receivable and client statements. Admin-only: the lab role sees no money. */
export default async function receivablesRoutes(fastify) {
  fastify.get("/admin/receivables", { preHandler: [...ADMIN, validateQuery(receivablesQuerySchema)] }, async (request) => ({
    data: await listReceivables(request.query),
  }));

  fastify.get("/admin/clients/:userId/statement.pdf", { preHandler: [...ADMIN, validateQuery(statementQuerySchema)] }, async (request, reply) => {
    let out;
    try {
      out = await statementPdfFor(request.params.userId, request.query.month);
    } catch (err) {
      request.log.error({ clientUserId: request.params.userId, err: err.message }, "statement pdf failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the statement." } });
    }
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    auditService.logSafe({ userId: request.user.id, action: "statement.downloaded", targetType: "user", targetId: request.params.userId, metadata: { month: request.query.month }, ipAddress: request.ip });
    return sendPdf(reply, out.pdf, out.model.filename);
  });

  // Staff-triggered, never automatic: a short notice with the closing balance and a portal link.
  fastify.post("/admin/clients/:userId/statement/email", { preHandler: [...ADMIN, validate(statementQuerySchema)] }, async (request, reply) => {
    const out = await statementFor(request.params.userId, request.body.month);
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    const sent = await sendStatementNotice({ to: out.client.email, monthLabel: out.model.period.label, closingCents: out.model.closingCents });
    auditService.logSafe({ userId: request.user.id, action: "statement.emailed", targetType: "user", targetId: request.params.userId, metadata: { month: request.body.month, closingCents: out.model.closingCents, sent }, ipAddress: request.ip });
    return { data: { sent } };
  });
}
```

`apps/api/src/routes/admin-invoice.routes.js`. Add `import { sendInvoiceNotice } from "../services/email.service.js";` and append:

```js
  // Staff-triggered notice: number, amount, due date, portal link. No PDF, no patient.
  fastify.post("/admin/invoices/:id/email", { preHandler: ADMIN }, async (request, reply) => {
    const detail = await getInvoiceDetail(request.params.id);
    if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    const { invoice, client } = detail;
    if (invoice.status !== "issued") {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Only an issued invoice can be emailed." } });
    }
    if (!client?.email) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "This client has no email address on file." } });
    }
    const sent = await sendInvoiceNotice({
      to: client.email, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      totalCents: invoice.totalCents, balanceCents: invoice.balanceCents, dueDate: invoice.dueDate,
    });
    auditService.logSafe({ userId: request.user.id, action: "invoice.emailed", targetType: "invoice", targetId: invoice.id, metadata: { invoiceNumber: invoice.invoiceNumber, sent }, ipAddress: request.ip });
    return { data: { sent } };
  });
```

`apps/api/src/routes/invoice.routes.js`:
- add `import { validateQuery } from "../middleware/validate.js";`;
- add `statementQuerySchema` to the `@my-app/shared` import;
- add `import { statementPdfFor } from "../services/billing/statements.service.js";` (the service renders the PDF);
- append the route below. Registration order doesn't matter: Fastify matches the static `/invoices/statement.pdf` ahead of `/invoices/:id`.

```js
  // The doctor's own monthly statement: no drafts, no patient names, never cached.
  fastify.get("/invoices/statement.pdf", { preHandler: [...DOCTOR, validateQuery(statementQuerySchema)] }, async (request, reply) => {
    let out;
    try {
      out = await statementPdfFor(request.user.id, request.query.month);
    } catch (err) {
      request.log.error({ err: err.message }, "statement pdf failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the statement." } });
    }
    if (!out) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    auditService.logSafe({ userId: request.user.id, action: "statement.downloaded", targetType: "user", targetId: request.user.id, metadata: { month: request.query.month }, ipAddress: request.ip });
    return sendPdf(reply, out.pdf, out.model.filename);
  });
```

`apps/api/src/index.js`. Add `import receivablesRoutes from "./routes/receivables.routes.js";` and, after the `adminInvoiceRoutes` registration:

```js
await fastify.register(receivablesRoutes, { prefix: "/api/v1" });
```

- [ ] **Step 5: Run the tests and the suite**

```bash
cd apps/api && pnpm vitest run src/services src/routes/__tests__   # PASS
cd ../.. && pnpm test && pnpm --filter @my-app/web build
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(billing): accounts receivable, monthly statements, invoice and statement notices

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 12: Web: shared plumbing and the doctor side

**Files:**
- Create:
  - `apps/web/src/lib/requests.js`, `apps/web/src/lib/__tests__/requests.test.js`;
  - `apps/web/src/lib/invoices.js`, `apps/web/src/lib/__tests__/invoices.test.js`;
  - `apps/web/src/components/billing/InvoiceView.jsx`, `apps/web/src/components/billing/StatementDownload.jsx`;
  - `apps/web/src/pages/doctor/InvoiceDetailPage.jsx`.
- Modify:
  - `apps/web/src/lib/lab-board.js`, `apps/web/src/lib/__tests__/lab-board.test.js`;
  - `apps/web/src/pages/lab/LabOrderDetailPage.jsx`, `apps/web/src/pages/lab/LabBoardPage.jsx`, `apps/web/src/pages/app/AdminOrdersPage.jsx`, `apps/web/src/pages/app/AdminDepartmentsPage.jsx` (import paths only);
  - `apps/web/src/hooks/useInvoiceAllocation.js` (rewritten), `apps/web/src/components/doctor/PaymentModal.jsx` (rewritten), `apps/web/src/pages/doctor/InvoicesPage.jsx` (rewritten);
  - `apps/web/src/pages/doctor/PaymentsPage.jsx`, `apps/web/src/config/routes.js`, `apps/web/src/App.jsx`;
  - `apps/web/src/components/admin/DoctorPaymentDrawer.jsx` (charge panel and invoice loading only: it shares the hook).

**Interfaces:**
- Consumes (API):
  - `GET /admin/clients/:userId/invoices?open=true` (drawer);
  - `GET /invoices` → `[{ id, invoiceNumber, kind, status, labOrderNumber, patientInitials, issuedAt, dueDate, totalCents, paidCents, balanceCents }]`;
  - `GET /invoices/:id` → the `doctorInvoiceView` shape;
  - `GET /invoices/:id/pdf`, `GET /invoices/statement.pdf?month=`;
  - `POST /payments/charge-saved { paymentProfileId, amountCents, allocations: [{ invoiceId, amountCents }] }`;
  - hosted-token / hosted-complete `{ allocations }`;
  - `GET /payments/history` → summaries with `grossCents`, `refundedCents`, `netCents`, `invoices: [{ invoiceId, invoiceNumber, amountCents }]`.
- Consumes (`@my-app/shared`): `allocateOldestFirst`, `sortOldestFirst`, `parseMoneyInput`, `toDecimalString`, `invoiceStatusLabel`, `isoDateIn`, `LAB_TIMEZONE`, `formatUsDate`, `formatLabDate`.
- Produces:
  - `lib/requests.js`: `errorText`, `blobErrorText`, `isStale`, `openInNewTab(getUrl)`, `openPdf(api, path, params?)` (moved out of `lib/lab-board.js`, plus `openPdf`).
  - `lib/invoices.js`: `labToday`, `STATUS_TONES`, `statusOf`, `isPayable`, `dateText`, `instantText`, `dayText`, `typedCents`, `recentMonths`, `ENTRY_LABELS`.
  - `hooks/useInvoiceAllocation(invoices: [{ id, invoiceNumber, balanceCents, dueDate }]) → { ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations, canPay }`.
  - `components/billing/InvoiceView({ invoice, order, lines, payments, actions?, linesSlot? })`.
  - `components/billing/StatementDownload({ path, compact? })`.
  - Routes: `ROUTES.DOCTOR_INVOICE_DETAIL = "/doctor/invoices/:id"`, `doctorInvoicePath(id)`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/__tests__/requests.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { isStale, errorText, blobErrorText } from "../requests.js";

test("a 409 STALE is recognised so the page can reload instead of retrying", () => {
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "STALE" } } } }), true);
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "CONFLICT" } } } }), false);
  assert.equal(errorText({ response: { data: { error: { message: "Nope." } } } }), "Nope.");
  assert.equal(errorText({}), "Something went wrong.");
});

test("a failed blob request surfaces the server's message", async () => {
  const blob = new Blob([JSON.stringify({ error: { message: "Ticket unavailable." } })]);
  assert.equal(await blobErrorText({ response: { data: blob } }), "Ticket unavailable.");
  assert.equal(await blobErrorText({ response: { data: new Blob(["not json"]) }, message: "boom" }), "boom");
  assert.equal(await blobErrorText({ message: "offline" }), "offline");
});
```

In `apps/web/src/lib/__tests__/lab-board.test.js`:
- change the import to `import { groupByStatus, quickMoves, boardParams, describeEvent } from "../lab-board.js";`;
- delete the two tests that moved into `requests.test.js` (`"a 409 STALE is recognised…"` and `"a failed blob request surfaces the server's message"`).

`apps/web/src/lib/__tests__/invoices.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { typedCents, recentMonths, isPayable, statusOf, dayText } from "../invoices.js";

test("typed amounts become cents; blank, junk and negatives are nothing", () => {
  assert.equal(typedCents("12.50"), 1250);
  assert.equal(typedCents("12."), 1200, "mid-typing a decimal point");
  assert.equal(typedCents("$1,000"), 100000);
  assert.equal(typedCents(""), 0);
  assert.equal(typedCents("abc"), 0);
  assert.equal(typedCents("-5"), 0);
  assert.equal(typedCents("1.999"), 0);
});

test("statement months run newest first and cross the year", () => {
  assert.deepEqual(recentMonths("2026-02-10", 3), [
    { value: "2026-02", label: "February 2026" },
    { value: "2026-01", label: "January 2026" },
    { value: "2025-12", label: "December 2025" },
  ]);
});

test("only an issued invoice with a balance can be paid; status words come from shared", () => {
  assert.equal(isPayable({ status: "issued", balanceCents: 1 }), true);
  assert.equal(isPayable({ status: "issued", balanceCents: 0 }), false);
  assert.equal(isPayable({ status: "void", balanceCents: 100 }), false);
  assert.equal(statusOf({ status: "issued", balanceCents: 100, dueDate: "2026-10-01" }, "2026-10-15"), "Past due");
});

test("a ledger date or a timestamp both read as the lab's calendar day", () => {
  assert.equal(dayText("2026-10-09"), "10/09/2026");
  assert.equal(dayText("2026-11-01T04:30:00.000Z"), "10/31/2026");
  assert.equal(dayText(null), "—");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @my-app/web exec vitest run src/lib/__tests__`
Expected: FAIL. `requests.js` and `invoices.js` don't exist.

- [ ] **Step 3: Move the request helpers out of the lab board**

`apps/web/src/lib/requests.js`:

```js
/**
 * Request helpers every page uses: a readable error message, the message
 * inside a failed blob (PDF) request, stale-version detection, and opening a
 * fetched URL or PDF in a new tab. (Moved out of lab-board.js: invoices,
 * statements and the work ticket all use them.)
 */

export function errorText(err) {
  return err?.response?.data?.error?.message || err?.message || "Something went wrong.";
}

/** A failed responseType "blob" request carries its JSON error as a Blob: decode it first. */
export async function blobErrorText(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text());
      if (body?.error?.message) return body.error.message;
    } catch {
      /* not JSON — use the generic message */
    }
  }
  return errorText(err);
}

export function isStale(err) {
  return err?.response?.status === 409 && err?.response?.data?.error?.code === "STALE";
}

/**
 * Open a URL that has to be fetched first (signed file link, PDF blob) in a
 * new tab. The tab opens synchronously inside the click, so popup blockers
 * allow it, then is pointed at the URL once it arrives.
 */
export async function openInNewTab(getUrl) {
  const tab = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** Fetch a PDF from the API (`api` is config/api.js) and open it in a new tab. */
export function openPdf(api, path, params) {
  return openInNewTab(async () => {
    const res = await api.get(path, { responseType: "blob", params });
    const url = URL.createObjectURL(res.data);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return url;
  });
}
```

`apps/web/src/lib/lab-board.js`: delete `errorText`, `blobErrorText`, `isStale` and `openInNewTab` (and their comments).

Update the importers:
- `pages/lab/LabBoardPage.jsx`: `import { groupByStatus, quickMoves, boardParams } from "../../lib/lab-board.js";` and `import { errorText, isStale } from "../../lib/requests.js";`.
- `pages/app/AdminOrdersPage.jsx` and `pages/app/AdminDepartmentsPage.jsx`: `import { errorText } from "../../lib/requests.js";`.
- `pages/lab/LabOrderDetailPage.jsx`:
  - imports: `import { describeEvent } from "../../lib/lab-board.js";` and `import { errorText, blobErrorText, isStale, openInNewTab, openPdf } from "../../lib/requests.js";`;
  - replace `printTicket` with:

```jsx
  const printTicket = () =>
    openPdf(api, `/lab/orders/${order.id}/ticket.pdf`).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));
```

- [ ] **Step 4: Invoice helpers, the cents allocation hook and the payment modal**

`apps/web/src/lib/invoices.js`:

```js
import { invoiceStatusLabel, isoDateIn, LAB_TIMEZONE, parseMoneyInput, formatUsDate, formatLabDate } from "@my-app/shared";

/** The lab's today, "YYYY-MM-DD": what "past due" is measured against. */
export const labToday = (now = new Date()) => isoDateIn(LAB_TIMEZONE, now);

export const STATUS_TONES = {
  Draft: "bg-gray-100 text-gray-700",
  Open: "bg-blue-500/10 text-blue-700",
  "Past due": "bg-red-500/10 text-red-700",
  Paid: "bg-emerald-500/10 text-emerald-700",
  Void: "bg-gray-200 text-gray-500",
};

export const statusOf = (inv, todayIso = labToday()) => invoiceStatusLabel(inv, todayIso);
export const isPayable = (inv) => inv.status === "issued" && inv.balanceCents > 0;

export const dateText = (iso) => formatUsDate(iso) || "—";
export const instantText = (instant) => formatLabDate(instant) || "—";
/** A ledger date ("YYYY-MM-DD", already lab-local) or a timestamp, as the lab's calendar day. */
export const dayText = (d) => (d && String(d).length > 10 ? instantText(d) : dateText(d));

export const ENTRY_LABELS = { payment: "Payment", credit: "Credit", refund: "Refund" };

/** Cents from what a person typed in an amount box; 0 for blank, junk or negative ("12." counts as 12). */
export function typedCents(str) {
  const c = parseMoneyInput(String(str ?? "").replace(/\.$/, ""));
  return Number.isSafeInteger(c) && c > 0 ? c : 0;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** The `count` most recent months, newest first: [{ value: "YYYY-MM", label: "October 2026" }]. */
export function recentMonths(todayIso, count = 12) {
  const [y, m] = todayIso.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return { value: d.toISOString().slice(0, 7), label: MONTH_LABEL.format(d) };
  });
}
```

`apps/web/src/hooks/useInvoiceAllocation.js` (whole file):

```js
import { useMemo, useState } from "react";
import { allocateOldestFirst, sortOldestFirst, parseMoneyInput, toDecimalString } from "@my-app/shared";
import { typedCents } from "../lib/invoices.js";

/**
 * Oldest-due-first allocation of one payment across a fixed set of invoices,
 * in integer cents. It uses the same allocateOldestFirst the server uses for
 * AutoPay and manual payments, so the split a person previews is the split
 * that gets recorded. Shared by the doctor's PaymentModal and the admin
 * DoctorPaymentDrawer.
 *
 * `invoices` ([{ id, invoiceNumber, balanceCents, dueDate }]) must be STABLE
 * for the component's lifetime: the allocation is seeded once. Mount the
 * component after the list has loaded, or key it on the list; re-seeding on
 * every render would throw away in-progress edits.
 */
export function useInvoiceAllocation(invoices) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ordered = useMemo(() => sortOldestFirst(invoices), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalBalanceCents = useMemo(() => invoices.reduce((s, i) => s + i.balanceCents, 0), []);
  const spread = (cents) =>
    Object.fromEntries(allocateOldestFirst(invoices, cents).allocations.map((a) => [a.invoiceId, a.amountCents]));

  const [alloc, setAlloc] = useState(() => spread(totalBalanceCents));
  const [targetStr, setTargetStr] = useState(() => toDecimalString(totalBalanceCents));

  const handleTargetChange = (val) => {
    setTargetStr(val);
    const cents = parseMoneyInput(String(val ?? "").replace(/\.$/, ""));
    if (Number.isSafeInteger(cents) && cents >= 0) setAlloc(spread(cents));
  };

  const setRow = (inv, val) => {
    const cents = Math.min(typedCents(val), inv.balanceCents);
    setAlloc((prev) => {
      const next = { ...prev, [inv.id]: cents };
      setTargetStr(toDecimalString(Object.values(next).reduce((s, v) => s + (v || 0), 0)));
      return next;
    });
  };

  const payTotalCents = Object.values(alloc).reduce((s, v) => s + (v || 0), 0);
  const allocations = ordered
    .filter((inv) => (alloc[inv.id] ?? 0) > 0)
    .map((inv) => ({ invoiceId: inv.id, amountCents: alloc[inv.id] }));

  return {
    ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations,
    canPay: payTotalCents > 0 && allocations.length > 0,
  };
}
```

`apps/web/src/components/doctor/PaymentModal.jsx` (whole file):

```jsx
import { useState, useEffect } from "react";
import { X, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import { HostedPaymentForm } from "./HostedPaymentForm.jsx";
import { useInvoiceAllocation } from "../../hooks/useInvoiceAllocation.js";
import { formatCents } from "../../lib/money.js";
import api from "../../config/api.js";

/**
 * Pay one or more of the doctor's invoices: a new card on Authorize.net's
 * hosted form (card data never touches this site) or a saved card.
 * `invoices`: [{ id, invoiceNumber, balanceCents, dueDate }]. Money is cents.
 */
export function PaymentModal({ invoices, onClose, onSuccess }) {
  const [method, setMethod] = useState("new"); // "new" | "saved"
  const [savedCards, setSavedCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
  const [launched, setLaunched] = useState(false); // hosted card form shown?
  const [saveCard, setSaveCard] = useState(false);
  const { addToast } = useToast();

  const { ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations, canPay } =
    useInvoiceAllocation(invoices);

  useEffect(() => {
    api.get("/payments/saved-cards")
      .then(({ data }) => {
        const list = data.data || [];
        setSavedCards(list);
        if (list.length > 0) setSelectedCard((list.find((c) => c.isDefault) || list[0]).paymentProfileId);
      })
      .catch(() => {})
      .finally(() => setLoadingCards(false));
  }, []);

  const payWithSavedCard = async () => {
    if (!selectedCard) {
      addToast({ message: "Select a card", type: "error" });
      return;
    }
    if (!canPay) {
      addToast({ message: "Enter an amount to pay.", type: "error" });
      return;
    }
    setProcessing(true);
    try {
      // One idempotency key per submit, so a double click or retry can't double-charge.
      await api.post(
        "/payments/charge-saved",
        { paymentProfileId: selectedCard, amountCents: payTotalCents, allocations },
        { headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      onSuccess();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Payment failed", type: "error" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="h-5 w-5" />
        </button>

        <h3 className="mb-1 text-lg font-semibold">Pay invoices</h3>
        <p className="mb-4 text-sm text-gray-500">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} selected · balance {formatCents(totalBalanceCents)}
        </p>

        <div className="mb-5 rounded-xl border border-gray-200 p-4">
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="pay-amount">Amount to pay</label>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              id="pay-amount"
              type="text"
              inputMode="decimal"
              value={targetStr}
              onChange={(e) => handleTargetChange(e.target.value)}
              disabled={launched}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-400">applied oldest-first; adjust rows below</span>
          </div>

          <div className="max-h-44 space-y-1 overflow-y-auto">
            {ordered.map((inv) => {
              const applied = alloc[inv.id] ?? 0;
              const label = applied <= 0 ? "" : applied >= inv.balanceCents ? "paid in full" : "partial";
              return (
                <div key={inv.id} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 font-medium">#{inv.invoiceNumber}</span>
                  <span className="w-20 shrink-0 text-gray-400">{formatCents(inv.balanceCents)}</span>
                  <span className="text-gray-300">→</span>
                  <input
                    type="number"
                    min="0"
                    max={inv.balanceCents / 100}
                    step="0.01"
                    value={applied / 100}
                    onChange={(e) => setRow(inv, e.target.value)}
                    disabled={launched}
                    aria-label={`Amount for invoice ${inv.invoiceNumber}`}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  {label && <span className={`text-xs ${applied >= inv.balanceCents ? "text-green-600" : "text-amber-600"}`}>{label}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-5 flex gap-2">
          {[["new", "New card"], ["saved", `Saved card${savedCards.length ? ` (${savedCards.length})` : ""}`]].map(([value, text]) => (
            <button
              key={value}
              onClick={() => setMethod(value)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                method === value ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        {method === "new" ? (
          <div className="space-y-3">
            {!launched ? (
              <>
                <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <span>Card details are entered on Authorize.net's secure form — they never touch this site.</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="accent-brand-600" />
                  Save this card for later
                </label>
                <Button onClick={() => setLaunched(true)} disabled={!canPay} className="w-full">
                  Pay {formatCents(payTotalCents)} with a card
                </Button>
              </>
            ) : (
              <HostedPaymentForm
                tokenEndpoint="/payments/hosted-token"
                completeEndpoint="/payments/hosted-complete"
                tokenBody={{ allocations, saveCard }}
                completeBody={{ allocations }}
                onComplete={() => onSuccess()}
                onError={(msg) => {
                  addToast({ message: msg, type: "error" });
                  setLaunched(false);
                }}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {loadingCards ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : savedCards.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No saved cards. Use "New card" to pay.</p>
            ) : (
              <>
                {savedCards.map((card) => (
                  <label
                    key={card.paymentProfileId}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedCard === card.paymentProfileId ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input type="radio" name="savedCard" value={card.paymentProfileId} checked={selectedCard === card.paymentProfileId}
                      onChange={() => setSelectedCard(card.paymentProfileId)} className="accent-brand-600" />
                    <CreditCard className="h-5 w-5 text-gray-400" />
                    <span className="text-sm">{card.cardType || "Card"} ****{card.cardNumber?.slice(-4)}</span>
                    {card.isDefault && (
                      <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">Default</span>
                    )}
                  </label>
                ))}
                <Button onClick={payWithSavedCard} loading={processing} disabled={!canPay} className="w-full">
                  Pay {formatCents(payTotalCents)}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: The shared invoice view and statement picker**

`apps/web/src/components/billing/InvoiceView.jsx`:

```jsx
import { formatCents } from "../../lib/money.js";
import { STATUS_TONES, statusOf, dateText, instantText, dayText, ENTRY_LABELS } from "../../lib/invoices.js";

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function TotalRow({ label, cents, bold = false }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-gray-900" : "text-gray-600"}`}>
      <span>{label}</span>
      <span>{formatCents(cents)}</span>
    </div>
  );
}

/**
 * One invoice, read-only: header, lines, totals, and dated payments and
 * credits. Shared by the doctor's detail page and the admin detail page. The
 * admin page passes `actions` and, while the invoice is a draft, its own
 * editable `linesSlot`.
 *
 * invoice: { invoiceNumber, status, issuedAt, dueDate, subtotalCents, taxCents, shippingCents, totalCents, paidCents, balanceCents }
 * order:   { orderNumber, caseNumber, patientName, shopOrderNumber } | null
 * lines:   [{ id, qty, code, description, unitCents, lineCents }]
 * payments:[{ date, kind, amountCents }]
 */
export function InvoiceView({ invoice, order, lines, payments, actions = null, linesSlot = null }) {
  const status = statusOf(invoice);
  const issued = invoice.status === "issued";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900">Invoice #{invoice.invoiceNumber}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[status] ?? "bg-gray-100 text-gray-700"}`}>{status}</span>
            <span>Issued {invoice.issuedAt ? instantText(invoice.issuedAt) : "—"}</span>
            <span>· Due {dateText(invoice.dueDate)}</span>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-4">
        <Field
          label={order?.shopOrderNumber ? "Shop order" : "Lab order"}
          value={order?.shopOrderNumber ?? (order?.orderNumber ? `#${order.orderNumber}` : "—")}
        />
        <Field label="Case" value={order?.caseNumber ?? "—"} />
        <Field label="Patient" value={order?.patientName ?? "—"} />
        <Field label="Balance" value={formatCents(Math.max(0, invoice.balanceCents ?? 0))} />
      </dl>

      {linesSlot ?? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Unit</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-right">{l.qty}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.code ?? "—"}</td>
                  <td className="px-4 py-2">{l.description}</td>
                  <td className="px-4 py-2 text-right">{formatCents(l.unitCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(l.lineCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <TotalRow label="Subtotal" cents={invoice.subtotalCents} />
        {invoice.shippingCents ? <TotalRow label="Shipping" cents={invoice.shippingCents} /> : null}
        <TotalRow label="Tax" cents={invoice.taxCents} />
        <TotalRow label="Total" cents={invoice.totalCents} bold />
        {issued && <TotalRow label="Paid" cents={invoice.paidCents} />}
        {issued && <TotalRow label="Balance due" cents={Math.max(0, invoice.balanceCents)} bold />}
      </div>

      {payments.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Payments and credits</h2>
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white text-sm">
            {payments.map((p, i) => (
              <li key={p.id ?? i} className="flex justify-between px-4 py-2">
                <span className="text-gray-600">{dayText(p.date)} · {ENTRY_LABELS[p.kind] ?? p.kind}</span>
                <span className={p.kind === "refund" ? "text-amber-700" : "text-gray-900"}>
                  {p.kind === "refund" ? "+" : "−"}{formatCents(Math.abs(p.amountCents))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

`apps/web/src/components/billing/StatementDownload.jsx`:

```jsx
import { useState } from "react";
import { FileDown } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { recentMonths, labToday } from "../../lib/invoices.js";
import { openPdf, blobErrorText } from "../../lib/requests.js";

/**
 * Pick a month and open that statement as a PDF. `path` is
 * "/invoices/statement.pdf" (a doctor's own) or
 * "/admin/clients/:userId/statement.pdf".
 */
export function StatementDownload({ path, compact = false }) {
  const months = recentMonths(labToday(), 12);
  const [month, setMonth] = useState(months[0].value);
  const { addToast } = useToast();
  const open = () =>
    openPdf(api, path, { month }).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));
  return (
    <div className="flex items-center gap-2">
      <select
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        aria-label="Statement month"
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
      >
        {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-200"
      >
        <FileDown size={12} /> {compact ? "Statement" : "Download statement"}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: The doctor's invoice list, detail page and payment history**

`apps/web/src/config/routes.js`:
- add `DOCTOR_INVOICE_DETAIL: "/doctor/invoices/:id",` after `DOCTOR_INVOICES`;
- add after `labOrderPath`:

```js
export const doctorInvoicePath = (id) => `/doctor/invoices/${id}`;
```

`apps/web/src/App.jsx`:
- add `import { InvoiceDetailPage } from "./pages/doctor/InvoiceDetailPage.jsx";`;
- inside the doctor `<Route element={<DoctorShell />}>` add, after the `invoices` route:

```jsx
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
```

`apps/web/src/pages/doctor/InvoicesPage.jsx` (whole file):

```jsx
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { CreditCard, CheckSquare, Square, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../hooks/usePagination.js";
import { formatCents } from "../../lib/money.js";
import { STATUS_TONES, statusOf, isPayable, labToday, dateText, instantText } from "../../lib/invoices.js";
import { doctorInvoicePath } from "../../config/routes.js";

/** The doctor's invoices (issued and void; drafts are never shown), with pay-selected and statements. */
export function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showPayment, setShowPayment] = useState(false);
  const { addToast } = useToast();

  const fetchInvoices = useCallback(async () => {
    try {
      const { data } = await api.get("/invoices");
      setInvoices(data.data || []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      addToast({ message: "Failed to load invoices", type: "error" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const today = labToday();
  const payable = invoices.filter(isPayable);
  const toggle = (inv) => {
    if (!isPayable(inv)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(inv.id)) next.delete(inv.id);
      else next.add(inv.id);
      return next;
    });
  };
  const allSelected = selected.size > 0 && selected.size === payable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(payable.map((i) => i.id)));
  const selectedInvoices = invoices.filter((inv) => selected.has(inv.id));
  const selectedTotal = selectedInvoices.reduce((s, inv) => s + inv.balanceCents, 0);
  const pagination = usePagination(invoices);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-gray-500">Your Diamond Labs invoices. Open one for its lines and PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatementDownload path="/invoices/statement.pdf" />
          {selected.size > 0 && (
            <Button onClick={() => setShowPayment(true)}>
              <CreditCard className="mr-2 h-4 w-4" />
              Pay selected ({selected.size}) — {formatCents(selectedTotal)}
            </Button>
          )}
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">{loadFailed ? "Couldn't load your invoices. Please refresh to try again." : "No invoices yet."}</p>
        </div>
      ) : (
        <>
          <Pagination {...pagination} itemLabel="invoices" className="mb-4" />
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="w-10 px-4 py-3">
                    <button onClick={toggleAll} disabled={payable.length === 0} aria-label="Select all payable invoices"
                      className="text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40">
                      {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Lab order</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagination.paged.map((inv) => {
                  const canPay = isPayable(inv);
                  const isSelected = selected.has(inv.id);
                  const status = statusOf(inv, today);
                  return (
                    <tr key={inv.id} onClick={() => toggle(inv)}
                      className={canPay ? (isSelected ? "cursor-pointer bg-brand-50" : "cursor-pointer hover:bg-gray-50") : "bg-gray-50/50"}>
                      <td className="px-4 py-3">
                        {canPay && isSelected ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className={`h-4 w-4 ${canPay ? "text-gray-300" : "text-gray-200"}`} />}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link to={doctorInvoicePath(inv.id)} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">
                          #{inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{inv.labOrderNumber ? `#${inv.labOrderNumber}` : "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.patientInitials ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.issuedAt ? instantText(inv.issuedAt) : "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{dateText(inv.dueDate)}</td>
                      <td className="px-4 py-3 text-right">{formatCents(inv.totalCents)}</td>
                      <td className="px-4 py-3 text-right font-medium">{inv.status === "void" ? "—" : formatCents(Math.max(0, inv.balanceCents))}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[status]}`}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination {...pagination} itemLabel="invoices" className="mt-6" />
        </>
      )}

      {showPayment && (
        <PaymentModal
          invoices={selectedInvoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, balanceCents: i.balanceCents, dueDate: i.dueDate }))}
          onClose={() => setShowPayment(false)}
          onSuccess={() => {
            setShowPayment(false);
            setSelected(new Set());
            fetchInvoices();
            addToast({ message: "Payment successful!", type: "success" });
          }}
        />
      )}
    </div>
  );
}
```

`apps/web/src/pages/doctor/InvoiceDetailPage.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, FileDown, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { InvoiceView } from "../../components/billing/InvoiceView.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";
import { ROUTES } from "../../config/routes.js";
import { formatCents } from "../../lib/money.js";
import { isPayable } from "../../lib/invoices.js";
import { openPdf, blobErrorText } from "../../lib/requests.js";

/** One of the doctor's invoices, read-only, with its PDF and a pay button while it owes. */
export function InvoiceDetailPage() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [paying, setPaying] = useState(false);
  const { addToast } = useToast();

  const load = useCallback(() => {
    api.get(`/invoices/${id}`)
      .then((res) => { setInv(res.data.data); setFailed(false); })
      .catch(() => setFailed(true));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const back = (
    <Link to={ROUTES.DOCTOR_INVOICES} className="mb-6 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
      <ArrowLeft size={12} /> Invoices
    </Link>
  );
  if (failed) {
    return <div className="mx-auto max-w-4xl px-4 py-8">{back}<p className="text-sm text-red-600">We couldn't load this invoice.</p></div>;
  }
  if (!inv) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

  const downloadPdf = () =>
    openPdf(api, `/invoices/${inv.id}/pdf`).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {back}
      <InvoiceView
        invoice={inv}
        order={{ orderNumber: inv.labOrderNumber, caseNumber: inv.caseNumber, patientName: inv.patientName }}
        lines={inv.lines}
        payments={inv.payments}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={downloadPdf}><FileDown size={14} /> PDF</Button>
            {isPayable(inv) && (
              <Button size="sm" onClick={() => setPaying(true)}><CreditCard size={14} /> Pay {formatCents(inv.balanceCents)}</Button>
            )}
          </>
        }
      />
      {paying && (
        <PaymentModal
          invoices={[{ id: inv.id, invoiceNumber: inv.invoiceNumber, balanceCents: inv.balanceCents, dueDate: inv.dueDate }]}
          onClose={() => setPaying(false)}
          onSuccess={() => {
            setPaying(false);
            load();
            addToast({ message: "Payment successful!", type: "success" });
          }}
        />
      )}
    </div>
  );
}
```

`apps/web/src/pages/doctor/PaymentsPage.jsx`:
- delete the local `formatUSD` and add `import { formatCents } from "../../lib/money.js";`;
- add to `SOURCE_LABEL`:

```js
  admin_check: "Check (recorded by lab)",
  admin_cash: "Cash (recorded by lab)",
  admin_ach: "ACH (recorded by lab)",
  admin_other: "Recorded by lab",
  credit: "Credit from lab",
```

- in the row:
  - `inv.invoiceNumber || inv.seazonaInvoiceId` becomes `inv.invoiceNumber || inv.invoiceId`;
  - `formatUSD(p.gross)` becomes `formatCents(p.grossCents)`;
  - `{p.refunded > 0 ? \`-${formatUSD(p.refunded)}\` : "—"}` becomes `{p.refundedCents > 0 ? \`-${formatCents(p.refundedCents)}\` : "—"}`;
  - `formatUSD(p.net)` becomes `formatCents(p.netCents)`.

- [ ] **Step 7: Move the admin drawer's charge panel onto the cents hook**

`DoctorPaymentDrawer` uses `useInvoiceAllocation`, so it changes with the hook. Task 13 replaces its offline-payment section.

In `apps/web/src/components/admin/DoctorPaymentDrawer.jsx`:
- replace the hook import with `import { useInvoiceAllocation } from "../../hooks/useInvoiceAllocation.js";` and add `import { formatCents } from "../../lib/money.js";`. `formatUSD` stays: the AutoPay form's amounts are dollars;
- replace the whole `ChargePanel` function with:

```jsx
function ChargePanel({ invoices, cards, cardsUnavailable, doctorUserId, onSuccess }) {
  const { addToast } = useToast();
  const [selectedCard, setSelectedCard] = useState(
    () => (cards.find((c) => c.isDefault) || cards[0])?.paymentProfileId || ""
  );
  const [processing, setProcessing] = useState(false);

  // Card actions reload `cards` without remounting this panel; if the selected
  // card was deleted, fall back so the <select> and the charge agree.
  useEffect(() => {
    if (cards.some((c) => c.paymentProfileId === selectedCard)) return;
    setSelectedCard((cards.find((c) => c.isDefault) || cards[0])?.paymentProfileId || "");
  }, [cards, selectedCard]);

  const { ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations, canPay } =
    useInvoiceAllocation(invoices);

  const charge = async () => {
    if (!selectedCard) {
      addToast({ message: "Select a card to charge.", type: "error" });
      return;
    }
    if (!canPay) {
      addToast({ message: "Enter an amount to charge.", type: "error" });
      return;
    }
    setProcessing(true);
    try {
      // Fresh key per submit: a duplicate click or retry must not double-charge.
      await api.post(
        `/admin/users/${doctorUserId}/payments/charge-saved`,
        { paymentProfileId: selectedCard, amountCents: payTotalCents, allocations },
        { headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      addToast({ message: `Charged ${formatCents(payTotalCents)}.`, type: "success" });
      onSuccess?.();
    } catch (err) {
      if (isGatewayError(err)) {
        addToast({ message: errMsg(err, "Could not reach the card processor. Please try again shortly."), type: "error" });
      } else if (err.response?.status === 409) {
        addToast({ message: errMsg(err, "This charge is already being processed."), type: "error" });
      } else {
        addToast({ message: errMsg(err, "Charge failed."), type: "error" });
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-navy/40">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={targetStr}
          onChange={(e) => handleTargetChange(e.target.value)}
          disabled={processing}
          aria-label="Amount to charge"
          className={`${INPUT} w-28`}
        />
        <span className="text-xs text-navy/40">applied oldest-first · balance {formatCents(totalBalanceCents)}</span>
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto">
        {ordered.map((inv) => (
          <div key={inv.id} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 font-mono text-xs text-navy/60">#{inv.invoiceNumber}</span>
            <span className="w-20 shrink-0 text-xs text-navy/40">{formatCents(inv.balanceCents)}</span>
            <span className="text-navy/20">→</span>
            <input
              type="number"
              min="0"
              max={inv.balanceCents / 100}
              step="0.01"
              value={(alloc[inv.id] ?? 0) / 100}
              onChange={(e) => setRow(inv, e.target.value)}
              disabled={processing}
              aria-label={`Amount for invoice ${inv.invoiceNumber}`}
              className={`${INPUT} w-24 !py-1`}
            />
          </div>
        ))}
      </div>

      <select
        value={selectedCard}
        onChange={(e) => setSelectedCard(e.target.value)}
        disabled={processing || cards.length === 0}
        className={INPUT}
      >
        {cards.length === 0 && (
          <option value="">{cardsUnavailable ? "Couldn't check — try again" : "No cards on file"}</option>
        )}
        {cards.map((c) => (
          <option key={c.paymentProfileId} value={c.paymentProfileId}>
            {c.cardType || "Card"} ****{c.cardNumber?.slice(-4)} — exp {c.expirationDate}
            {c.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={charge}
        disabled={processing || !canPay || cards.length === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-brand-600 disabled:opacity-50"
      >
        {processing && <Loader2 size={12} className="animate-spin" />}
        Charge {formatCents(payTotalCents)}
      </button>
    </div>
  );
}
```

- replace `loadInvoices` (and the comment above it) with:

```jsx
  // This doctor's open invoices, from our ledger.
  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const { data } = await api.get(`/admin/clients/${doctor.userId}/invoices`, { params: { open: "true" } });
      setInvoices(data.data || []);
      setInvoicesUnavailable(false);
    } catch {
      setInvoicesUnavailable(true);
    } finally {
      setInvoicesLoading(false);
      setInvoiceGen((n) => n + 1);
    }
  }, [doctor.userId]);
```

- change `const payableInvoices = invoices.filter((inv) => !inv.portalPaid);` to `const payableInvoices = invoices.filter((inv) => inv.balanceCents > 0);`;
- in "Charge a card":
  - delete the `!doctor.accountNumber ? (… isn't linked to a Seazona client …) :` branch, so the chain starts at `invoicesLoading ?`;
  - change the unavailable message to `Couldn't load this doctor's invoices — try again.`;
- in the offline section's `<select>`:
  - options become `<option key={inv.id} value={inv.id}>#{inv.invoiceNumber} — {formatCents(inv.balanceCents)} due</option>`;
  - the Record button's lookup becomes `payableInvoices.find((inv) => inv.id === offlineInvoiceId)`.
  (Task 13 replaces this whole section.)
- in the doc comment above `DoctorPaymentDrawer`, replace the paragraph about matching invoices by Seazona account number with "`doctor` — { userId, name, email, accountNumber }; invoices load from GET /admin/clients/:userId/invoices."

- [ ] **Step 8: Run the tests and the build**

```bash
pnpm --filter @my-app/web exec vitest run    # PASS
pnpm --filter @my-app/web build              # succeeds
grep -rn "round2\|balanceOf\|portalBalance\|seazonaUnavailable" apps/web/src/pages/doctor apps/web/src/components/doctor apps/web/src/hooks   # no output
pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): doctor invoices from our ledger — list, detail, PDF, statements, payments in cents

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 13: Web: the admin side

**Files:**
- Create:
  - `apps/web/src/components/ui/ConfirmButton.jsx`, `apps/web/src/components/admin/RecordPaymentModal.jsx`;
  - `apps/web/src/pages/app/AdminInvoiceDetailPage.jsx`, `apps/web/src/pages/app/AdminReceivablesPage.jsx`.
- Modify (rewrite): `apps/web/src/pages/app/AdminInvoicesPage.jsx`
- Modify:
  - `apps/web/src/lib/invoices.js`, `apps/web/src/lib/__tests__/invoices.test.js`;
  - `apps/web/src/components/admin/RefundPaymentModal.jsx`, `apps/web/src/pages/app/AdminPaymentsPage.jsx`, `apps/web/src/components/admin/DoctorPaymentDrawer.jsx` (offline section);
  - `apps/web/src/config/routes.js`, `apps/web/src/App.jsx`, `apps/web/src/components/layout/Sidebar.jsx`;
  - `apps/api/src/routes/__tests__/seazona-invoice-retired.test.js` (scan the web too).

**Interfaces:**
- Consumes (API):
  - `GET /admin/invoices?status&needsPrice&clientUserId&number` → `{ invoices, truncated }`;
  - `GET /admin/invoices/:id` → `{ invoice, lines, payments, labOrder, client, activity }`;
  - `PATCH /admin/invoices/:id/lines`, `POST /admin/invoices/:id/{issue,void,credit,email}`, `GET /admin/invoices/:id/pdf`;
  - `GET /admin/clients/:userId/invoices?open=true`, `POST /admin/clients/:userId/payments`;
  - `GET /admin/receivables?pastDueOnly`, `GET /admin/clients/:userId/statement.pdf?month`, `POST /admin/clients/:userId/statement/email`;
  - `POST /admin/payments/refund { transactionId, allocations?: [{ invoiceId, amountCents }] }` → `{ action, amountCents, ledgerWriteFailed? }`.
- Consumes (Task 12): `InvoiceView`, `StatementDownload`, `lib/invoices.js`, `lib/requests.js`.
- Produces:
  - `ConfirmButton({ onConfirm, children, confirmLabel?, className?, disabled?, windowMs? })`;
  - `RecordPaymentModal({ clientUserId, clientName, onClose, onRecorded })`;
  - `lib/invoices.js` `refundSelection(lines) → { parsed, anySelected, allValid, isFull, totalCents, allocations }`;
  - routes `ROUTES.ADMIN_INVOICE_DETAIL`, `ROUTES.ADMIN_RECEIVABLES`, `adminInvoicePath(id)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/__tests__/invoices.test.js` (and add `refundSelection` to its import):

```js
test("refund lines: full when every invoice is included at its full amount, otherwise the slices", () => {
  const lines = [
    { invoiceId: "a", maxCents: 6000, include: true, amountStr: "60.00" },
    { invoiceId: "b", maxCents: 4000, include: true, amountStr: "40" },
  ];
  assert.equal(refundSelection(lines).isFull, true);
  const partial = refundSelection([{ ...lines[0], include: false }, { ...lines[1], amountStr: "15.5" }]);
  assert.deepEqual([partial.isFull, partial.totalCents, partial.allocations], [false, 1550, [{ invoiceId: "b", amountCents: 1550 }]]);
  assert.equal(refundSelection([{ ...lines[0], amountStr: "60.01" }]).allValid, false, "never more than was charged");
  assert.equal(refundSelection([{ ...lines[0], include: false }]).anySelected, false);
});
```

In `apps/api/src/routes/__tests__/seazona-invoice-retired.test.js`, change `ROOTS` to include the web:

```js
const ROOTS = ["apps/api/src", "apps/api/scripts", "apps/web/src", "scripts"].map((p) => join(repo, p));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @my-app/web exec vitest run src/lib/__tests__/invoices.test.js && cd apps/api && pnpm vitest run src/routes/__tests__/seazona-invoice-retired.test.js`
Expected: FAIL.
- `refundSelection` doesn't exist.
- The guard flags `apps/web/src/pages/app/AdminInvoicesPage.jsx` (`seazonaUnavailable`, `recordInSeazona`).

- [ ] **Step 3: The shared pieces: confirm button, refund selection, routes and nav**

`apps/web/src/components/ui/ConfirmButton.jsx`:

```jsx
import { useEffect, useRef, useState } from "react";

/**
 * A button that asks twice instead of a browser dialog: the first click arms
 * it ("Click again to …"), a second click within `windowMs` runs the action.
 * For irreversible or outward-facing actions: issue, void, email, remove.
 */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Click again to confirm", className = "", disabled = false, windowMs = 4000 }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const click = async () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), windowMs);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={click} disabled={disabled || busy}
      className={`${className} ${armed ? "ring-2 ring-red-400 ring-offset-1" : ""} disabled:opacity-50`}>
      {armed ? confirmLabel : children}
    </button>
  );
}
```

Append to `apps/web/src/lib/invoices.js`:

```js
/**
 * The refund modal's per-invoice lines ([{ invoiceId, maxCents, include, amountStr }])
 * → what to send. Full reversal when every line is included at its full amount;
 * otherwise the included slices, each no more than was charged.
 */
export function refundSelection(lines) {
  const parsed = lines.map((l) => {
    const cents = typedCents(l.amountStr);
    return { ...l, cents, valid: !l.include || (cents > 0 && cents <= l.maxCents) };
  });
  const included = parsed.filter((l) => l.include);
  return {
    parsed,
    anySelected: included.length > 0,
    allValid: parsed.every((l) => l.valid),
    isFull: parsed.length > 0 && parsed.every((l) => l.include && l.cents === l.maxCents),
    totalCents: included.reduce((s, l) => s + l.cents, 0),
    allocations: included.map((l) => ({ invoiceId: l.invoiceId, amountCents: l.cents })),
  };
}
```

`apps/web/src/config/routes.js`:
- add `ADMIN_INVOICE_DETAIL: "/admin/invoices/:id",` and `ADMIN_RECEIVABLES: "/admin/receivables",` after `ADMIN_INVOICES`;
- after `doctorInvoicePath`, add:

```js
export const adminInvoicePath = (id) => `/admin/invoices/${id}`;
```

`apps/web/src/App.jsx`:
- import `AdminInvoiceDetailPage` from `./pages/app/AdminInvoiceDetailPage.jsx` and `AdminReceivablesPage` from `./pages/app/AdminReceivablesPage.jsx`;
- inside `<Route element={<RequireAdmin />}>`, after the `/admin/invoices` route, add:

```jsx
          <Route path="/admin/invoices/:id" element={<AdminInvoiceDetailPage />} />
          <Route path="/admin/receivables" element={<AdminReceivablesPage />} />
```

`apps/web/src/components/layout/Sidebar.jsx`:
- add `Landmark,` to the lucide import;
- after the `Invoices` admin item add:

```js
  { label: "Receivables", to: ROUTES.ADMIN_RECEIVABLES, icon: Landmark },
```

- [ ] **Step 4: Record payment, refunds and admin payment history in cents**

`apps/web/src/components/admin/RecordPaymentModal.jsx`:

```jsx
import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { MANUAL_PAYMENT_METHODS, MANUAL_PAYMENT_LABELS } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { labToday, typedCents, dateText } from "../../lib/invoices.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 disabled:bg-surface-100";

/**
 * "Record payment" for a client: a check, cash, ACH or other payment the lab
 * received. No card is charged. Applied oldest-first, or to the invoices staff
 * choose; the server refuses more than is owed and a date before an
 * invoice was issued.
 */
export function RecordPaymentModal({ clientUserId, clientName, onClose, onRecorded }) {
  const { addToast } = useToast();
  const [invoices, setInvoices] = useState(null);
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidOn, setPaidOn] = useState(labToday());
  const [choose, setChoose] = useState(false);
  const [chosen, setChosen] = useState({}); // invoiceId → amount typed
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/admin/clients/${clientUserId}/invoices`, { params: { open: "true" } })
      .then((res) => setInvoices(res.data.data || []))
      .catch((e) => { setInvoices([]); setErr(errorText(e)); });
  }, [clientUserId]);

  const amountCents = typedCents(amountStr);
  const openCents = (invoices || []).reduce((s, i) => s + i.balanceCents, 0);
  const allocations = Object.entries(chosen)
    .map(([invoiceId, str]) => ({ invoiceId, amountCents: typedCents(str) }))
    .filter((a) => a.amountCents > 0);
  const chosenCents = allocations.reduce((s, a) => s + a.amountCents, 0);
  const valid = amountCents > 0 && amountCents <= openCents && paidOn && (!choose || chosenCents === amountCents) && !submitting;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/admin/clients/${clientUserId}/payments`, {
        method, reference: reference.trim() || undefined, amountCents, paidOn, ...(choose ? { allocations } : {}),
      });
      addToast({ message: `Recorded ${formatCents(amountCents)} (${MANUAL_PAYMENT_LABELS[method]}) for ${clientName || "this client"}.`, type: "success" });
      onRecorded?.();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-navy/30 hover:text-navy" aria-label="Close"><X size={18} /></button>
        <h3 className="font-heading text-lg font-bold text-navy">Record a payment</h3>
        <p className="mt-1 text-xs text-navy/50">
          {clientName ? `${clientName} · ` : ""}open balance {invoices ? formatCents(openCents) : "…"}. No card is charged.
        </p>

        {invoices === null ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-navy/30" /></div>
        ) : invoices.length === 0 ? (
          <p className="py-6 text-sm text-navy/50">No open invoices to apply a payment to.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-navy/60">Method
                <select className={`${INPUT} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)}>
                  {MANUAL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{MANUAL_PAYMENT_LABELS[m]}</option>)}
                </select>
              </label>
              <label className="text-xs text-navy/60">Reference (check #)
                <input className={`${INPUT} mt-1`} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
              </label>
              <label className="text-xs text-navy/60">Amount
                <input className={`${INPUT} mt-1`} inputMode="decimal" placeholder="0.00" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
              </label>
              <label className="text-xs text-navy/60">Received on
                <input className={`${INPUT} mt-1`} type="date" max={labToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy/70">
              <input type="checkbox" className="accent-brand-600" checked={choose} onChange={(e) => setChoose(e.target.checked)} />
              Apply to specific invoices (otherwise oldest due first)
            </label>

            {choose && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-surface-300/50 p-3">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 font-mono text-xs">#{inv.invoiceNumber}</span>
                    <span className="w-24 shrink-0 text-xs text-navy/50">due {dateText(inv.dueDate)}</span>
                    <span className="w-20 shrink-0 text-xs text-navy/50">{formatCents(inv.balanceCents)}</span>
                    <input className={`${INPUT} !py-1`} inputMode="decimal" placeholder="0.00" value={chosen[inv.id] ?? ""}
                      aria-label={`Amount for invoice ${inv.invoiceNumber}`}
                      onChange={(e) => setChosen((prev) => ({ ...prev, [inv.id]: e.target.value }))} />
                  </div>
                ))}
                <p className={`pt-1 text-xs ${chosenCents === amountCents ? "text-navy/50" : "text-amber-700"}`}>
                  Applied {formatCents(chosenCents)} of {formatCents(amountCents)}
                </p>
              </div>
            )}
            {amountCents > openCents && <p className="text-xs text-red-600">More than the open balance — the lab doesn't hold unapplied credit.</p>}
          </div>
        )}

        {err && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{err}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-xs font-semibold text-navy/60 hover:bg-surface-100">Cancel</button>
          <button type="button" onClick={submit} disabled={!valid}
            className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {submitting && <Loader2 size={12} className="animate-spin" />} Record {amountCents ? formatCents(amountCents) : "payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`apps/web/src/components/admin/RefundPaymentModal.jsx`. Replace everything above `return (` with:

```jsx
import { useState } from "react";
import { X, AlertCircle, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { formatCents } from "../../lib/money.js";
import { refundSelection } from "../../lib/invoices.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25 disabled:bg-surface-100 disabled:text-navy/60";

/**
 * Admin refund/void modal. `payment` is a payment-history row
 * ({ invoices: [{ invoiceId, invoiceNumber, amountCents }] }); with it, staff
 * can refund specific invoice slices (settled charges only). Every invoice at
 * its full amount sends a full reversal.
 */
export function RefundPaymentModal({ onClose, presetTransactionId = "", payment = null, onDone }) {
  const [transactionId, setTransactionId] = useState(presetTransactionId);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const { addToast } = useToast();

  const invoices = payment?.invoices || [];
  const hasBreakdown = invoices.length > 0;
  const [lines, setLines] = useState(() =>
    invoices.map((inv) => ({
      invoiceId: inv.invoiceId,
      label: inv.invoiceNumber || inv.invoiceId,
      maxCents: inv.amountCents,
      include: true,
      amountStr: (inv.amountCents / 100).toFixed(2),
    }))
  );
  const setLine = (i, patch) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const sel = refundSelection(lines);

  const trimmedTxn = transactionId.trim();
  const locked = Boolean(presetTransactionId);
  const valid = trimmedTxn.length > 0 && !submitting && (!hasBreakdown || (sel.anySelected && sel.allValid));

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setErr(null);
    try {
      const body = { transactionId: trimmedTxn };
      // Only a genuine partial sends slices; a full selection reverses the whole charge.
      if (hasBreakdown && !sel.isFull) body.allocations = sel.allocations;
      const res = await api.post("/admin/payments/refund", body);
      const d = res.data?.data || {};
      const verb = d.action === "void" ? "Void" : "Refund";
      addToast(
        d.ledgerWriteFailed
          ? { message: `${verb} of ${formatCents(d.amountCents)} succeeded at the gateway, but the ledger needs manual reconciliation (txn ${trimmedTxn}).`, type: "warning" }
          : { message: `${d.action === "void" ? "Voided" : "Refunded"} ${formatCents(d.amountCents)} (txn ${trimmedTxn}).`, type: "success" }
      );
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error?.message || e.message || "Failed to refund the payment.");
    } finally {
      setSubmitting(false);
    }
  };
```

and in the JSX:
- `{parsed.map((l, i) => (` becomes `{sel.parsed.map((l, i) => (`;
- `/ {formatUSD(l.max)}` becomes `/ {formatCents(l.maxCents)}`;
- `{isFull ? "Full refund" : \`Partial refund · ${formatUSD(selectedTotal)}\`}` becomes `{sel.isFull ? "Full refund" : \`Partial refund · ${formatCents(sel.totalCents)}\`}`;
- in the intro paragraph, "un-pays the affected invoices in the portal." becomes "reopens the affected invoices' balances.".

`apps/web/src/pages/app/AdminPaymentsPage.jsx`:
- add `import { formatCents } from "../../lib/money.js";` (keep `formatUSD` for audit entries written before this piece, whose metadata is in dollars);
- add to `AUDIT_ACTION_LABEL`: `"payment.manual_recorded": "Payment recorded",`;
- add to `SOURCE_LABEL`:

```js
  admin_check: "Check",
  admin_cash: "Cash",
  admin_ach: "ACH",
  admin_other: "Other (recorded)",
  credit: "Credit",
```

- in the row:
  - `inv.invoiceNumber || inv.seazonaInvoiceId` becomes `inv.invoiceNumber || inv.invoiceId`;
  - `formatUSD(p.gross)` becomes `formatCents(p.grossCents)`;
  - the refunded cell becomes `{p.refundedCents > 0 ? \`-${formatCents(p.refundedCents)}\` : "—"}`;
  - `formatUSD(p.net)` becomes `formatCents(p.netCents)`;
- in the audit list, replace the `{e.metadata?.amount != null && (…)}` block with:

```jsx
                                  {e.metadata?.amountCents != null ? (
                                    <span className="text-navy/70">{formatCents(e.metadata.amountCents)}</span>
                                  ) : e.metadata?.amount != null ? (
                                    <span className="text-navy/70">{formatUSD(e.metadata.amount)}</span>
                                  ) : null}
```

`apps/web/src/components/admin/DoctorPaymentDrawer.jsx`. Replace the offline-payment flow with Record payment:
- delete the `OfflinePaymentModal` import (and its comment) and add `import { RecordPaymentModal } from "./RecordPaymentModal.jsx";`;
- replace the `offlineInvoiceId` / `offlineModalInvoice` state with `const [recording, setRecording] = useState(false);`;
- replace the whole `{/* ── Offline payment ── */}` `SectionCard` with:

```jsx
              {/* ── Record a payment ── */}
              <SectionCard title="Record a payment" icon={Banknote}>
                <p className="mb-2 text-xs text-navy/50">
                  A check, cash, ACH or other payment the lab received. No card is charged.
                </p>
                {invoicesLoading ? (
                  <div className="flex items-center gap-2 py-4 text-xs text-navy/40">
                    <Loader2 size={14} className="animate-spin" /> Loading invoices…
                  </div>
                ) : invoicesUnavailable ? (
                  <p className="text-xs text-amber-700">Couldn't load this doctor's invoices — try again.</p>
                ) : payableInvoices.length === 0 ? (
                  <p className="text-xs text-navy/40">No open invoices to record against.</p>
                ) : (
                  <button type="button" onClick={() => setRecording(true)}
                    className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy/70 hover:bg-surface-200">
                    Record payment
                  </button>
                )}
              </SectionCard>
```

- replace the `{offlineModalInvoice && (<OfflinePaymentModal … />)}` block at the end with:

```jsx
      {recording && (
        <RecordPaymentModal
          clientUserId={doctor.userId}
          clientName={doctor.name}
          onClose={() => setRecording(false)}
          onRecorded={() => {
            notifyChanged();
            loadInvoices();
          }}
        />
      )}
```

- [ ] **Step 5: Admin › Invoices (list) and the invoice detail page**

`apps/web/src/pages/app/AdminInvoicesPage.jsx` (whole file):

```jsx
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw, Search, AlertCircle, X } from "lucide-react";
import { INVOICE_STATUSES } from "@my-app/shared";
import api from "../../config/api.js";
import { adminInvoicePath } from "../../config/routes.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { STATUS_TONES, statusOf, labToday, dateText, instantText } from "../../lib/invoices.js";

const INPUT = "px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";
const STATUS_WORDS = { draft: "Drafts", issued: "Issued", void: "Void" };

/** Admin › Invoices: our invoices, filtered on the server (the list is capped at 500, newest first). */
export function AdminInvoicesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const needsPrice = params.get("needsPrice") === "true";
  const clientUserId = params.get("clientUserId") ?? "";
  const [number, setNumber] = useState("");
  const [rows, setRows] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const seq = useRef(0);
  const load = async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const query = {};
      if (status) query.status = status;
      if (needsPrice) query.needsPrice = "true";
      if (clientUserId) query.clientUserId = clientUserId;
      if (/^\d+$/.test(number.trim())) query.number = number.trim();
      const res = await api.get("/admin/invoices", { params: query });
      if (mine !== seq.current) return;
      setRows(res.data.data.invoices);
      setTruncated(Boolean(res.data.data.truncated));
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(errorText(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    const t = setTimeout(load, number ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, needsPrice, clientUserId, number]);

  const today = labToday();
  const outstanding = rows.filter((r) => r.status === "issued").reduce((s, r) => s + Math.max(0, r.balanceCents), 0);

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Invoices</h1>
          <p className="mt-1 text-sm text-navy/50">{rows.length} shown · {formatCents(outstanding)} outstanding on these</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input className={`${INPUT} w-52 pl-8`} placeholder="Invoice number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <select className={INPUT} value={status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
        </select>
        <button type="button" onClick={() => setFilter("needsPrice", needsPrice ? "" : "true")}
          className={`rounded-full px-4 py-2 text-xs font-semibold ${needsPrice ? "bg-red-500/10 text-red-700" : "bg-surface-100 text-navy/70 hover:bg-surface-200"}`}>
          Needs a price
        </button>
        {clientUserId && (
          <button type="button" onClick={() => setFilter("clientUserId", "")} className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">
            One client <X size={12} />
          </button>
        )}
      </div>

      {error && <p className="mb-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</p>}
      {truncated && <p className="mb-2 text-xs text-amber-700">Showing the newest 500 — narrow the filters to see older invoices.</p>}

      <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-50 text-[11px] uppercase tracking-wide text-navy/50">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Lab order</th>
              <th className="px-4 py-3">Issued</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = statusOf(r, today);
              return (
                <tr key={r.id} className="border-t border-surface-300/30 hover:bg-surface-50/50">
                  <td className="px-4 py-3 font-medium"><Link to={adminInvoicePath(r.id)} className="text-brand-700 hover:underline">#{r.invoiceNumber}</Link></td>
                  <td className="px-4 py-3 text-navy/80">{r.practice || r.clientName || (r.kind === "shop" ? "Guest (shop)" : "—")}</td>
                  <td className="px-4 py-3 text-navy/60">{r.labOrderNumber ? `#${r.labOrderNumber}` : "—"}</td>
                  <td className="px-4 py-3 text-navy/60">{r.issuedAt ? instantText(r.issuedAt) : "—"}</td>
                  <td className="px-4 py-3 text-navy/60">{dateText(r.dueDate)}</td>
                  <td className="px-4 py-3 text-right">{formatCents(r.totalCents)}</td>
                  <td className="px-4 py-3 text-right font-medium">{r.status === "issued" ? formatCents(Math.max(0, r.balanceCents)) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[label]}`}>{label}</span>
                    {r.needsPrice && <span className="ml-1 rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-700">Needs a price</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-navy/40">No invoices match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

`apps/web/src/pages/app/AdminInvoiceDetailPage.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileDown, Loader2 } from "lucide-react";
import { INVOICE_LINE_KINDS, LINE_KIND_LABELS, PRICE_SOURCE_LABELS, parseMoneyInput } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { InvoiceView } from "../../components/billing/InvoiceView.jsx";
import { RecordPaymentModal } from "../../components/admin/RecordPaymentModal.jsx";
import { formatCents } from "../../lib/money.js";
import { errorText, isStale, openPdf, blobErrorText } from "../../lib/requests.js";
import { typedCents, instantText } from "../../lib/invoices.js";

const INPUT = "rounded-lg border border-surface-300/60 bg-white px-2.5 py-1.5 text-sm text-navy focus:border-brand-500 focus:outline-none";
const PILL = "rounded-full px-3 py-1.5 text-xs font-semibold";

/** A draft's lines, editable: quantity, price (with a reason), remove, and add a free-form line. */
function DraftLinesEditor({ lines, onEdit, busy }) {
  const [pricing, setPricing] = useState(null); // { lineId, priceStr, reason }
  const [adding, setAdding] = useState({ kind: "fee", description: "", qty: "1", priceStr: "", taxable: false });
  const addCents = parseMoneyInput(adding.priceStr, { allowNegative: adding.kind === "adjustment" });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-50 text-[11px] uppercase tracking-wide text-navy/50">
            <tr><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Unit</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-surface-300/30 align-top">
                <td className="px-3 py-2">
                  <input className={`${INPUT} w-16`} type="number" min="1" max="999" defaultValue={l.qty} disabled={busy} aria-label={`Quantity for ${l.description}`}
                    onBlur={(e) => { const qty = Number(e.target.value); if (Number.isInteger(qty) && qty !== l.qty) onEdit({ op: "update", lineId: l.id, qty }); }} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{l.code ?? "—"}</td>
                <td className="px-3 py-2">
                  {l.description}
                  <div className={`text-[11px] ${l.priceSource === "unpriced" ? "font-semibold text-red-700" : "text-navy/40"}`}>
                    {LINE_KIND_LABELS[l.kind]} · {PRICE_SOURCE_LABELS[l.priceSource]}{l.priceNote ? ` — ${l.priceNote}` : ""}
                  </div>
                  {pricing?.lineId === l.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input className={`${INPUT} w-24`} inputMode="decimal" placeholder="0.00" value={pricing.priceStr} onChange={(e) => setPricing({ ...pricing, priceStr: e.target.value })} aria-label="New unit price" />
                      <input className={`${INPUT} flex-1`} placeholder="Why (required)" value={pricing.reason} onChange={(e) => setPricing({ ...pricing, reason: e.target.value })} aria-label="Reason for the price change" />
                      <button type="button" className={`${PILL} bg-brand-500 text-white disabled:opacity-50`} disabled={busy || !pricing.reason.trim() || parseMoneyInput(pricing.priceStr, { allowNegative: l.kind === "adjustment" }) == null}
                        onClick={async () => {
                          const unitCents = parseMoneyInput(pricing.priceStr, { allowNegative: l.kind === "adjustment" });
                          if (await onEdit({ op: "update", lineId: l.id, unitCents, reason: pricing.reason.trim() })) setPricing(null);
                        }}>Save price</button>
                      <button type="button" className={`${PILL} text-navy/50`} onClick={() => setPricing(null)}>Cancel</button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-brand-700 hover:underline" disabled={busy}
                    onClick={() => setPricing({ lineId: l.id, priceStr: (l.unitCents / 100).toFixed(2), reason: "" })}>
                    {formatCents(l.unitCents)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">{formatCents(l.lineCents)}</td>
                <td className="px-3 py-2 text-right">
                  <ConfirmButton className={`${PILL} text-red-600`} confirmLabel="Remove?" disabled={busy} onConfirm={() => onEdit({ op: "remove", lineId: l.id })}>Remove</ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed border-surface-300 p-3">
        <select className={INPUT} value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} aria-label="Line kind">
          {INVOICE_LINE_KINDS.map((k) => <option key={k} value={k}>{LINE_KIND_LABELS[k]}</option>)}
        </select>
        <input className={`${INPUT} min-w-[12rem] flex-1`} placeholder="Description (e.g. Rush fee)" value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} />
        <input className={`${INPUT} w-16`} type="number" min="1" max="999" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} aria-label="Quantity" />
        <input className={`${INPUT} w-24`} inputMode="decimal" placeholder={adding.kind === "adjustment" ? "-0.00" : "0.00"} value={adding.priceStr} onChange={(e) => setAdding({ ...adding, priceStr: e.target.value })} aria-label="Unit price" />
        {adding.kind !== "shipping" && (
          <label className="flex items-center gap-1 text-xs text-navy/60">
            <input type="checkbox" className="accent-brand-600" checked={adding.taxable} onChange={(e) => setAdding({ ...adding, taxable: e.target.checked })} /> Taxable
          </label>
        )}
        <button type="button" className={`${PILL} bg-surface-100 text-navy hover:bg-surface-200 disabled:opacity-50`}
          disabled={busy || !adding.description.trim() || addCents == null || !Number.isInteger(Number(adding.qty))}
          onClick={async () => {
            const ok = await onEdit({ op: "add", kind: adding.kind, description: adding.description.trim(), qty: Number(adding.qty), unitCents: addCents, taxable: adding.taxable });
            if (ok) setAdding({ kind: "fee", description: "", qty: "1", priceStr: "", taxable: false });
          }}>
          Add line
        </button>
      </div>
    </div>
  );
}

const ACTIVITY_WORDS = {
  "invoice.drafted": "Draft created", "invoice.edited": "Edited", "invoice.issued": "Issued", "invoice.issue_held": "Held at draft (needs a price)",
  "invoice.voided": "Voided", "invoice.credited": "Credit applied", "invoice.emailed": "Emailed to the client", "invoice.pdf_downloaded": "PDF downloaded",
};

/** Admin invoice detail: edit and issue a draft; credit, void or email an issued invoice; record a payment. */
export function AdminInvoiceDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [credit, setCredit] = useState({ amountStr: "", reason: "" });
  const [voidReason, setVoidReason] = useState("");
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/invoices/${id}`);
      setData(res.data.data);
      setNotes(res.data.data.invoice.notes ?? "");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) addToast({ message: success, type: "success" });
      await load();
      return true;
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
      if (isStale(err)) await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <div className="p-8 text-sm text-red-600">Couldn't load this invoice.</div>;
  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-navy/30" /></div>;

  const { invoice, lines, payments, labOrder, client, activity } = data;
  const draft = invoice.status === "draft";
  const issued = invoice.status === "issued";
  const edit = (e) => act(() => api.patch(`/admin/invoices/${invoice.id}/lines`, { expectedVersion: invoice.version, edit: e }));
  const creditCents = typedCents(credit.amountStr);
  const pdf = () => openPdf(api, `/admin/invoices/${invoice.id}/pdf`).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <Link to={ROUTES.ADMIN_INVOICES} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy"><ArrowLeft size={12} /> Invoices</Link>
      <p className="mb-2 text-sm text-navy/60">
        {client ? (client.practice || client.name) : "Guest (shop)"}
        {client?.accountNumber ? ` · Account ${client.accountNumber}` : ""}
        {labOrder ? <> · <Link className="text-brand-700 hover:underline" to={`/lab/orders/${labOrder.id}`}>Lab order #{labOrder.orderNumber}</Link></> : null}
      </p>

      <InvoiceView
        invoice={invoice}
        order={labOrder}
        lines={lines}
        payments={payments}
        linesSlot={draft ? <DraftLinesEditor lines={lines} onEdit={edit} busy={busy} /> : null}
        actions={
          <>
            <button type="button" onClick={pdf} className={`${PILL} flex items-center gap-1 bg-surface-100 text-navy hover:bg-surface-200`}><FileDown size={12} /> PDF</button>
            {draft && (
              <ConfirmButton className={`${PILL} bg-brand-500 text-white`} confirmLabel="Click again to issue" disabled={busy}
                onConfirm={() => act(() => api.post(`/admin/invoices/${invoice.id}/issue`, { expectedVersion: invoice.version }), `Invoice #${invoice.invoiceNumber} issued.`)}>
                Issue invoice
              </ConfirmButton>
            )}
            {issued && client?.email && (
              <ConfirmButton className={`${PILL} bg-surface-100 text-navy`} confirmLabel={`Email ${client.email}?`} disabled={busy}
                onConfirm={() => act(() => api.post(`/admin/invoices/${invoice.id}/email`), "Notice sent to the client.")}>
                Email invoice
              </ConfirmButton>
            )}
            {issued && invoice.balanceCents > 0 && client && (
              <button type="button" onClick={() => setRecording(true)} className={`${PILL} bg-surface-100 text-navy hover:bg-surface-200`}>Record payment</button>
            )}
          </>
        }
      />

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {draft && (
          <section className="rounded-2xl border border-surface-300/50 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy">Staff notes</h2>
            <textarea className={`${INPUT} h-24 w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
            <button type="button" className={`${PILL} mt-2 bg-surface-100 text-navy`} disabled={busy || notes === (invoice.notes ?? "")}
              onClick={() => edit({ op: "notes", notes })}>Save notes</button>
          </section>
        )}
        {issued && (
          <section className="rounded-2xl border border-surface-300/50 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy">Credit (write-off)</h2>
            <p className="mb-2 text-xs text-navy/50">Reduces what's owed by up to {formatCents(Math.max(0, invoice.balanceCents))}. No card is touched.</p>
            <div className="flex flex-wrap gap-2">
              <input className={`${INPUT} w-28`} inputMode="decimal" placeholder="0.00" value={credit.amountStr} onChange={(e) => setCredit({ ...credit, amountStr: e.target.value })} aria-label="Credit amount" />
              <input className={`${INPUT} flex-1`} placeholder="Why (required)" value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} aria-label="Credit reason" />
              <ConfirmButton className={`${PILL} bg-surface-100 text-navy`} confirmLabel={`Credit ${formatCents(creditCents)}?`}
                disabled={busy || creditCents <= 0 || creditCents > invoice.balanceCents || !credit.reason.trim()}
                onConfirm={async () => {
                  const ok = await act(() => api.post(`/admin/invoices/${invoice.id}/credit`, { amountCents: creditCents, reason: credit.reason.trim() }), "Credit applied.");
                  if (ok) setCredit({ amountStr: "", reason: "" });
                }}>
                Apply credit
              </ConfirmButton>
            </div>
          </section>
        )}
        {(draft || (issued && invoice.paidCents === 0)) && (
          <section className="rounded-2xl border border-red-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-red-700">Void</h2>
            <p className="mb-2 text-xs text-navy/50">A void keeps its number and owes nothing. Not possible once a payment or credit is applied.</p>
            <div className="flex flex-wrap gap-2">
              <input className={`${INPUT} flex-1`} placeholder="Why (required)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} aria-label="Void reason" />
              <ConfirmButton className={`${PILL} bg-red-600 text-white`} confirmLabel="Click again to void" disabled={busy || !voidReason.trim()}
                onConfirm={() => act(() => api.post(`/admin/invoices/${invoice.id}/void`, { expectedVersion: invoice.version, reason: voidReason.trim() }), "Invoice voided.")}>
                Void invoice
              </ConfirmButton>
            </div>
          </section>
        )}
      </div>

      {payments.some((p) => p.reference || p.note) && (
        <section className="mt-6 text-xs text-navy/60">
          {payments.filter((p) => p.reference || p.note).map((p) => (
            <p key={p.id}>{p.kind === "credit" ? "Credit" : "Payment"} {formatCents(Math.abs(p.amountCents))}: {p.reference ? `ref ${p.reference}` : ""}{p.note ? ` — ${p.note}` : ""}</p>
          ))}
        </section>
      )}

      {activity.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-navy">History</h2>
          <ol className="space-y-1 text-xs text-navy/60">
            {activity.map((a) => (
              <li key={a.id}>{instantText(a.createdAt)} · {ACTIVITY_WORDS[a.action] ?? a.action}{a.actorName ? ` by ${a.actorName}` : ""}</li>
            ))}
          </ol>
        </section>
      )}

      {recording && client && (
        <RecordPaymentModal clientUserId={client.id} clientName={client.practice || client.name} onClose={() => setRecording(false)} onRecorded={load} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Admin › Accounts receivable**

`apps/web/src/pages/app/AdminReceivablesPage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, AlertCircle } from "lucide-react";
import { AGING_BUCKETS } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { dateText, labToday, recentMonths } from "../../lib/invoices.js";

/** Admin › Accounts receivable: one row per client with a balance, aged; worst past due first. */
export function AdminReceivablesPage() {
  const { addToast } = useToast();
  const [pastDueOnly, setPastDueOnly] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastMonth = recentMonths(labToday(), 2)[1];

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/receivables", { params: { pastDueOnly: pastDueOnly ? "true" : "false" } });
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [pastDueOnly]);

  const emailStatement = async (row) => {
    try {
      const res = await api.post(`/admin/clients/${row.clientUserId}/statement/email`, { month: lastMonth.value });
      addToast(res.data.data.sent
        ? { message: `${lastMonth.label} statement notice sent to ${row.practice || row.name}.`, type: "success" }
        : { message: "The notice could not be sent (no email configured?).", type: "error" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Accounts receivable</h1>
          <p className="mt-1 text-sm text-navy/50">As of {data ? dateText(data.asOf) : "…"} · aged by due date</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPastDueOnly(!pastDueOnly)}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${pastDueOnly ? "bg-red-500/10 text-red-700" : "bg-surface-100 text-navy/70 hover:bg-surface-200"}`}>
            Past due only
          </button>
          <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-50 text-[11px] uppercase tracking-wide text-navy/50">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3 text-right">Balance</th>
              {AGING_BUCKETS.map((b) => <th key={b.key} className="px-4 py-3 text-right">{b.label}</th>)}
              <th className="px-4 py-3">Oldest due</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.clientUserId} className="border-t border-surface-300/30 align-middle">
                <td className="px-4 py-3">
                  <div className="font-medium text-navy">{r.practice || r.name || "—"}</div>
                  <div className="text-xs text-navy/40">{r.practice && r.name ? r.name : ""}{r.accountNumber ? ` · Acct ${r.accountNumber}` : ""}</div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{formatCents(r.balanceCents)}</td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b.key} className={`px-4 py-3 text-right ${b.key !== "current" && r.buckets[b.key] ? "text-red-700" : "text-navy/60"}`}>
                    {r.buckets[b.key] ? formatCents(r.buckets[b.key]) : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-navy/60">{dateText(r.oldestDueDate)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Link to={`${ROUTES.ADMIN_INVOICES}?clientUserId=${r.clientUserId}`} className="text-xs font-semibold text-brand-700 hover:underline">Invoices</Link>
                    <StatementDownload path={`/admin/clients/${r.clientUserId}/statement.pdf`} compact />
                    <ConfirmButton className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy" confirmLabel={`Email ${lastMonth.label}?`}
                      onConfirm={() => emailStatement(r)}>
                      Email statement
                    </ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
            {data && data.rows.length > 0 && (
              <tr className="border-t-2 border-surface-300 bg-surface-50 font-semibold">
                <td className="px-4 py-3">Total ({data.rows.length} clients)</td>
                <td className="px-4 py-3 text-right">{formatCents(data.totals.balanceCents)}</td>
                {AGING_BUCKETS.map((b) => <td key={b.key} className="px-4 py-3 text-right">{formatCents(data.totals.buckets[b.key])}</td>)}
                <td colSpan={2} />
              </tr>
            )}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={AGING_BUCKETS.length + 4} className="px-4 py-10 text-center text-sm text-navy/40">{pastDueOnly ? "Nothing past due." : "No open balances."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the tests and the build**

```bash
pnpm --filter @my-app/web exec vitest run    # PASS
pnpm --filter @my-app/web build              # succeeds
grep -rn "seazonaUnavailable\|recordInSeazona\|OfflinePaymentModal\|portalBalance\|portalPaid\|window\.confirm\|alert(" apps/web/src/pages/app/Admin*Invoice* apps/web/src/pages/app/AdminReceivablesPage.jsx apps/web/src/components/admin apps/web/src/components/billing apps/web/src/components/ui/ConfirmButton.jsx   # no output
pnpm test                                    # includes seazona-invoice-retired.test.js over apps/web/src
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/api/src/routes/__tests__/seazona-invoice-retired.test.js
git commit -m "feat(web): admin invoices, invoice editing, credits and voids, accounts receivable, record payment

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---
### Task 14: Whole-piece verification and PR

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-3
pnpm test
(cd apps/api && pnpm db:generate)        # expect "No schema changes"
pnpm --filter @my-app/web build
git status --short                        # clean
grep -rn "invoice-ledger.service\|appliedAmount\|getClientPaidMap\|recordInSeazona\|writeToSeazona" apps packages --include='*.js' --include='*.jsx' | grep -v node_modules | grep -v "db/migrations"   # no output
```

- [ ] **Step 2: Prove the ledger conversion on a copy of piece 2's database**

The three ledger migrations (0028 add, 0029 backfill, 0030 drop) must convert real dollar rows exactly, inside one migrator transaction:

```bash
createdb diamond_labs_p3_migrate_check
pg_dump diamond_labs_own_the_lab_2 | psql -q diamond_labs_p3_migrate_check
psql diamond_labs_p3_migrate_check -c "insert into invoice_payments (id, user_id, seazona_client_id, seazona_invoice_id, invoice_number, applied_amount, transaction_id, source) values
  ('mc1','u1','c1','sz1','41201', 12.35, 'T1', 'doctor_card'), ('mc2','u1','c1','sz1','41201', -5.50, 'R1', 'refund'), ('mc3','u1','c1','sz2','41202', 0.00, 'REFUND-PENDING-T1', null)"
(cd apps/api && DATABASE_URL=postgresql://bif@localhost:5432/diamond_labs_p3_migrate_check pnpm db:migrate)
psql diamond_labs_p3_migrate_check -c "select id, applied_cents from invoice_payments where id like 'mc%' order by id"   # 1235, -550, 0
psql diamond_labs_p3_migrate_check -c "select count(*) from invoice_payments where applied_cents is null"            # 0
dropdb diamond_labs_p3_migrate_check
```

- [ ] **Step 3: The size and safety checks the house rules require**

```bash
# Every touched source file under 1,000 code lines (blank and comment lines excluded).
for f in $(git diff --name-only origin/feat/own-the-lab...HEAD -- '*.js' '*.jsx' | grep -v test); do
  [ -f "$f" ] && n=$(grep -v '^\s*$' "$f" | grep -cv '^\s*\(//\|\*\|/\*\)') && [ "$n" -ge 1000 ] && echo "OVER CAP: $f $n"
done
# No native dialogs in what this piece added or rewrote.
git diff origin/feat/own-the-lab...HEAD -- apps/web/src | grep -n "^+.*\(window\.confirm\|alert(\|prompt(\)"   # no output
```

Read the PHI boundaries once more:
- `grep -n "request.log" apps/api/src/routes/invoice.routes.js apps/api/src/routes/admin-invoice.routes.js apps/api/src/routes/receivables.routes.js`: no log line includes a detail object, a patient name or a reason.
- `grep -n "metadata" apps/api/src/services/billing/*.js apps/api/src/routes/*invoice*.js apps/api/src/routes/receivables.routes.js`: audit metadata is ids, numbers, amounts, months and field names only.
- The doctor routes return `doctorInvoiceRow` / `doctorInvoiceView` only.

- [ ] **Step 4: Cut the API branch and count files (CodeRabbit silently skips PRs over 150 files)**

The API half ends at Task 11's commit ("feat(billing): accounts receivable, monthly statements, invoice and statement notices").

```bash
git fetch origin
api_tip=$(git log --format=%H --grep="accounts receivable, monthly statements" -1)
git branch feat/own-the-lab-3a-billing-api "$api_tip"
git diff --name-only origin/feat/own-the-lab...feat/own-the-lab-3a-billing-api | wc -l   # PR A: expect ~118
git diff --name-only feat/own-the-lab-3a-billing-api...HEAD | wc -l                      # PR B: expect ~28
git diff --name-only feat/own-the-lab-3a-billing-api...HEAD | grep -v '^apps/web/' | grep -v 'seazona-invoice-retired'   # no output: PR B is web-only
```

If either count is near or over 150, stop and report; don't open the PRs.

- [ ] **Step 5: Check CodeRabbit capacity, then push once and open both PRs**

Two PRs use both included reviews for the hour. Look at the repo's PRs from the last hour for a "Review paused — included plan limit reached" notice, and count CodeRabbit reviews in that hour (2 included per hour). If both slots aren't free, open PR A now and PR B once a slot frees. Don't push into a paused window, and never tick "Run this review for free".

```bash
git push origin feat/own-the-lab-3a-billing-api
git push origin feat/own-the-lab-3-invoicing
gh pr create --base feat/own-the-lab --head feat/own-the-lab-3a-billing-api \
  --title "Own the lab · piece 3A: invoicing & AR (API)" \
  --body "$(cat <<'BODY'
Piece 3 of retiring Seazona, API half (spec: docs/superpowers/specs/2026-10-15-invoicing-and-ar-design.md; plan: docs/superpowers/plans/2026-10-15-invoicing-and-ar.md, Tasks 1–11). The web half is the stacked PR 3B; merge 3B into this branch first, then this one, so staging never runs the new API with the old pay screens.

- Invoices are ours: invoices / invoice_lines, numbered from INVOICE_NUMBER_START.
  - A draft is created with each released Rx case and remake (remakes free unless edited).
  - A paid shop order gets an issued, paid shop invoice.
  - Ship issues the draft (due ship date + INVOICE_TERMS_DAYS) unless a line is unpriced — billing never blocks the bench.
  - Cancel voids the draft.
- Ledger in cents: invoice_payments.applied_amount → applied_cents (migrations 0028 add / 0029 backfill / 0030 drop, one transaction). Paid and balance are derived by one rule (deriveBalance).
- Every money path (saved card, Accept Hosted, admin charge, AutoPay, refunds) verifies against local invoices under the existing per-invoice locks.
- Seazona payment writes and the Seazona invoice routes are gone; a guard test keeps them out.
- Staff can:
  - edit drafts (qty, a price override with a reason, free-form lines), issue, void (only with nothing applied) and credit with a reason;
  - record check / cash / ACH / other payments (oldest-first or chosen invoices; no overpayment).
- Accounts receivable with aging, and monthly statements.
- Invoice and statement PDFs on one shared PDF layer; the work ticket moved onto it too.
- Email notices carry no PDF and no patient data.
- payment.routes.js (1,414 lines) is split along its seams first, as a pure move.

Decisions for review:
- Invoice ownership is the doctor user (clientUserId), as for lab orders. Today a second login sharing one Seazona client sees the same invoices; after this it sees only its own. Changing that needs a local "practice" concept.
- AUTOPAY_LIVE_RUN is untouched. The out-of-band precondition is retired because staff payments now land in our ledger.

Cutover notes:
- Set INVOICE_NUMBER_START to Seazona's last invoice number + 1 before any invoice is created in production (piece 5 imports legacy invoices under their own numbers).
- INVOICE_TERMS_DAYS defaults to 30.
- Staging scrub: the new columns are classified in db/scrub/plan.js.

N files changed. No Seazona calls; no prod deploy from this branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
gh pr create --base feat/own-the-lab-3a-billing-api --head feat/own-the-lab-3-invoicing \
  --title "Own the lab · piece 3B: invoicing & AR (web)" \
  --body "$(cat <<'BODY'
Piece 3, web half (plan Tasks 12–13), stacked on 3A.

- Doctors: their invoices (drafts never shown) with lab order, patient initials, due, balance and status; an invoice detail with PDF; pay in cents (same oldest-first allocator as the server); monthly statement download; payment history in cents.
- Admins:
  - Admin › Invoices (status / needs-a-price / client / number filters);
  - invoice detail: edit a draft, issue, credit, void, email, PDF, history;
  - Accounts receivable with aging, statements and statement notices;
  - Record payment (check / cash / ACH / other) from the drawer and the invoice;
  - refunds and payment history in cents.
- Shared request helpers moved out of lib/lab-board.js. A two-click ConfirmButton replaces native dialogs.

N files changed. Merge this into 3A before 3A merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

Replace each `N` with that PR's Step 4 count before running.

- [ ] **Step 6: Confirm the review actually ran**

A while after opening, check each PR for CodeRabbit's inline findings, not just its walkthrough comment. A walkthrough with no review, or a "Review paused" notice, means it didn't run.

Address findings in one batch per PR, run Step 1 again, and push once per review round. A fix in the API half goes on `feat/own-the-lab-3a-billing-api`; merge that into `feat/own-the-lab-3-invoicing` before B's next push. Merging into `feat/own-the-lab` deploys staging, and it needs the user's explicit sign-off.

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage:**
  - Model: Task 3.
  - Lifecycle:
    - draft at release / remake / shop: Task 5;
    - editing a draft: Tasks 4 and 9;
    - issue on ship, unpriced hold, staff issue: Tasks 4, 5 and 9;
    - cancel voids: Task 5;
    - issued is immutable, credit / void: Tasks 4 and 9.
  - Payments:
    - card paths on local invoices, no Seazona writes: Task 6;
    - manual payments: Task 9;
    - AutoPay: Task 7.
  - Statements and AR: Tasks 10 and 11. Admin AR page and doctor views: Tasks 12–13.
  - PDFs: Task 10. Email: Task 11.
  - Code shape:
    - shared money, `nextSequenceNumber`: Task 2;
    - `services/billing/*`, `priceLabOrderLines`: Tasks 4–11;
    - `payment.routes.js` split: Task 1;
    - `invoice.routes.js` rewrite: Task 8;
    - web: Tasks 12–13.
  - Errors and safety:
    - 422 / 409: `invoiceErrorReply`;
    - audit: every service action;
    - admin-only: `ADMIN`;
    - release fails as a whole and shop logs `[LAB][SHOP_ORDER_FAILED]`: Task 5.
  - Testing list: totals, remake zeroing, unpriced, transitions, edit planning, balance, cents allocation, aging boundaries, statement month boundary in the lab timezone, models, PDF smoke, source-inspection routes, the createPayment / getInvoice guard. All present.
- **Placeholders:** none. Every code step has its code. The one `N` in the PR body is filled from a command in the same task.
- **Names used across tasks:**
  - `deriveBalance`, `paidCentsByInvoice`, `withBalances`, `openInvoicesForClient`;
  - `allocateOldestFirst` (`@my-app/shared`, cents), `recordPaymentAndAllocations({ amountCents, … })`, `verifyAllocations`;
  - `auditInvoice`, `loadLines`, `getInvoiceDetail`, `buildInvoiceModel`, `buildStatementModel`, `statementPdfFor`, `sendPdf`, `ADMIN`, `DOCTOR`;
  - `useInvoiceAllocation` (`payTotalCents`, `totalBalanceCents`), `openPdf(api, path, params)`.
  These are the same in every task that defines or consumes them.
