# Practice Groups (piece 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lab can group practices. Group admins see and pay every
practice in their group; practice staff see only their own practice. Each
practice keeps its own account number, invoices and statement.

**Architecture:**
- Generic `organizations` module: groups → accounts → admins.
- Practices are `accounts` rows (`is_client`), and practice staff are
  `memberships`.
- One seam, `services/client-scope.js`, loads a login's scope on every
  request. Every client read and write checks it: invoices, payments,
  cases, messages, pickups and notifications.
- Practice-owned records carry `account_id`.

**Tech Stack:** Fastify 5, Drizzle (postgres.js), zod via `@my-app/shared`,
vitest; React 18 + Vite + Tailwind, `DataTable` / `useDataTable` /
`usePagedList`, zustand.

**Spec:** `docs/superpowers/specs/2026-11-05-practice-groups-design.md`
(binding; read it first, especially "Every place that assumes one practice
per login"). Roadmap: `docs/superpowers/specs/2026-11-05-lab-parity-roadmap.md`.

**Base:** branch `feat/own-the-lab-practice-groups` from `feat/own-the-lab`
**after piece 8 (`feat/own-the-lab-messaging`) has merged**. Piece 8's
`services/practice.js`, `pickups`, `message_threads` and
`lab-notifications.js` must exist.

## Global Constraints

**Code rules**
- `modules/organizations` (api, web, shared) contains no
  lab/doctor/patient/dental/rx words, and no "practice" or "client" either.
  Add its shared dir to `ROOTS` in `apps/api/src/modules/module-vocabulary.test.js`.
- Every list uses `DataTable` + `useDataTable` (server paging via
  `usePagedList`). Group rollups use DataTable's existing `renderExpanded`.
- Never use `alert()`, `confirm()` or `prompt()`. Destructive steps use
  `ConfirmButton`; messages use `useToast()`.
- Files stay under 1,000 lines and functions under 150 (300 for a
  component with its markup).
- Money is integer cents.

**Security (the main risk)**
- Every client-facing read or write of an invoice, case, payment, pickup,
  message thread or statement goes through `services/client-scope.js`. No
  route compares `seazonaClientId` for authorization after this piece.
  Task 4 adds a grep test.
- Scope is loaded from the DB per request and never cached.
- An out-of-scope id or `?account=` reads as 404 `NOT_FOUND`, never 403.
- A null `account_id` on an owned record fails closed: nobody but staff
  sees it.

**PHI**
- No PHI in logs, audit metadata, notifications or emails. Emails say that
  something happened and link in.
- Audit metadata carries ids only: `organization.created`,
  `organization.account_added`, `organization.account_removed`,
  `organization.admin_added`, `organization.admin_removed`,
  `practice.member_added`, `practice.member_removed`,
  `practice.member_role_changed`, `practice.account_number_set`.

**Seazona and migrations**
- Nothing calls Seazona.
- Migrations: `cd apps/api && pnpm db:generate`. On rebase, drop this
  piece's generated SQL and journal entries and regenerate.

**Commands**
- API tests: `pnpm --filter @my-app/api test -- <path>`
- Web tests: `pnpm --filter @my-app/web test -- <path>`
- `pnpm --filter @my-app/web build` must pass at the end of every web task.

**Git**
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push only with `git push origin <branch>`.

**Values the spec pins**
- `organizationSettingsSchema = { combinedStatement: boolean, default false }`.
  It is strict: unknown keys are refused.
- Party keys are `practice:<accountId>` and `user:<userId>`.
- Statement subject keys are `account:<id>` and `organization:<id>`.
- Practice member roles assignable by staff: `admin`, `member`, `viewer`.
  `viewer` cannot pay.
- `?account=` accepts `all`, `<accountId>`, or for statements only,
  `organization:<orgId>`.

## Review Focus

1. **A practice staff member opens a sibling practice's invoice, case,
   pickup or thread by id or `?account=`:** 404 every time. A Task 4 test
   table pins every route listed there (`sibling ids read as not found`).
2. **A member is removed (membership `removed`/`suspended`), a group
   admin is removed, a practice is removed from a group, or a group is
   archived:** the very next request with the same token loses that access,
   and AutoPay stops paying those invoices. Task 3 tests: `removed
   membership drops the account`, `removed admin drops the group's
   accounts`, `archived organization grants nothing`. Task 5 test:
   `autopay uses the scope at run time`.
3. **A group admin's one charge includes an invoice outside the group, or
   from a group they were just removed from:** the whole request is refused
   before any card call, and nothing is written. Task 5 test: `mixed
   allocation with one foreign invoice charges nothing`.
4. **A notification, message alert, pickup alert, receipt or statement
   email for practice A reaches a member of sibling practice B:** never.
   Recipients are A's members and A's group admins only. Task 6 test:
   `practice audience excludes siblings`; Task 7 test: `combined statement
   goes to group admins only`.
5. **A viewer-role member tries to pay, or the backfill left an invoice
   with a null `account_id`:** the payment is refused (404 for the
   unpayable invoice), and the null-account invoice is invisible to clients.
   Parity reports it. Task 4 test: `viewer cannot pay`; Task 2 test:
   `parity counts owned records without account`.

---

### Task 1: `organizations` generic module (API) + README

**Files:**
- Create in `apps/api/src/modules/organizations/`: `schema.js`, `rules.js`,
  `service.js`, `routes.js`, `index.js`, `README.md`
- Create: `packages/shared/src/organizations/schemas.js`; export from
  `packages/shared/src/index.js`
- Modify: `apps/api/src/db/schema/index.js` (re-export the module schema),
  `apps/api/src/modules/module-vocabulary.test.js` (add the shared dir to
  ROOTS, and ban `practice|client` for this module only)
- Migration: generated (`organizations`, `organization_accounts`,
  `organization_admins`, per the spec's Data model)
- Test: `rules.test.js`, `service.test.js` (fake-tx, as in
  `modules/record-tags`), `routes.test.js`

**Interfaces:**
- Produces (rules, pure):
  - `resolveScope({ memberships, adminOf, orgAccounts })`:
    - `memberships`: `[{ accountId, role, status, accountActive, accountEligible }]`
    - `adminOf`: `[{ organizationId, status, organizationActive }]`
    - `orgAccounts`: `[{ organizationId, accountId, accountActive, accountEligible }]`
    - returns `{ accountIds: string[] (sorted), roles: Map<string, string>, via: Map<string, "member"|"org-admin">, organizations: [{ id, accountIds }] }`
  - An org-admin grant wins over a member role for `roles` and `via`.
- Produces (service, optional last arg `database`):
  - `listOrganizations({ q, status, limit, offset })` → `{ rows, total }`
  - `getOrganization(id)` → `{ ...org, accountIds, admins: [{ userId, status }] }`
  - `createOrganization({ name, settings, byUserId })`, `updateOrganization(id, patch, byUserId)`
  - `addAccounts(orgId, accountIds, { byUserId, exists })` → `{ added, alreadyInOther: [accountId] }`
  - `removeAccount(orgId, accountId, { byUserId })`
  - `addAdmin(orgId, userId, { byUserId })`, `removeAdmin(orgId, userId, { byUserId })`
  - `organizationOf(accountIds)` → `Map<accountId, { id, name, settings }>`
  - `scopeForUser(userId, { loadMemberships, isEligibleAccount })` →
    the `resolveScope` result. The two callbacks are glue-supplied.
  - `onAudit` hook: `createOrganizationsService({ audit })` takes the
    app's `audit.service` writer, so the module never imports it.
- Produces (routes): `createOrganizationsRoutes({ service, guard, describeAccounts })`.
  The paths are in the spec's API table. `describeAccounts(ids)` → labels
  for the detail view.
- Shared: `organizationSettingsSchema`, `createOrganizationSchema`,
  `updateOrganizationSchema`, `organizationAccountsSchema` (`{ accountIds: string[1..500] }`),
  `organizationAdminSchema`.

- [ ] **Step 1: Write the failing rules tests**

```js
test("removed membership drops the account", () => {
  const s = resolveScope({ memberships: [{ accountId: "a1", role: "member", status: "removed", accountActive: true, accountEligible: true }], adminOf: [], orgAccounts: [] });
  assert.deepEqual(s.accountIds, []);
});
test("removed admin drops the group's accounts", () => { /* adminOf status removed → [] */ });
test("archived organization grants nothing", () => { /* organizationActive false → [] */ });
test("org admin sees every eligible active account in the org", () => { /* a1,a2 eligible; a3 accountActive false → ["a1","a2"] */ });
test("org-admin grant wins over a viewer membership", () => { /* roles.get("a1") === "org-admin" */ });
test("ineligible accounts are never in scope", () => { /* accountEligible false via membership and org */ });
```

- [ ] **Step 2: Run, expect FAIL** (`resolveScope` not defined).
- [ ] **Step 3: Implement `rules.js`, `schema.js`, shared schemas.**
- [ ] **Step 4: Service and route tests**:
  - `addAccounts refuses an account already in another organization` (it
    is listed in `alreadyInOther`; nothing is written for it);
  - `addAccounts over 500 ids is refused by the schema`;
  - `settings with an unknown key → 422`;
  - `name taken (case-insensitive) → 409`;
  - `non-admin guard → 403`;
  - `every write calls the audit hook with ids only`.
- [ ] **Step 5: Implement `service.js`, `routes.js` and `index.js`.**
  Mount the routes at `/admin/organizations` in `apps/api/src/index.js`
  with the admin guard. Generate the migration.
- [ ] **Step 6: Write `README.md`.** Cover purpose, public interface, data
  model and configuration. Leave "Wiring it into another app" as a stub;
  Task 11 fills it.
- [ ] **Step 7: Run the module tests and the vocabulary test; expect
  PASS.**
- [ ] **Step 8: Commit** `feat(organizations): generic organizations module`.

---

### Task 2: Practice accounts: columns, backfill CLI, parity check

**Files:**
- Modify:
  - `apps/api/src/db/schema/accounts.js` (`isClient`, `accountNumber`,
    `legacyClientKey` + partial unique indexes)
  - `rx-cases.js`, `lab-orders.js`, `invoices.js` (`accountId` + index)
  - `statement-sends.js` (`subjectKey`; the unique index becomes
    `(subject_key, client_user_id, month)`)
  - `apps/api/src/db/scrub/plan.js` and `COLUMNS.md` (new columns: keep)
- Create: `apps/api/src/db/backfill-practices.js` (pure planner +
  writer), `apps/api/src/db/backfill-practices-cli.js`; script
  `db:backfill-practices` in `apps/api/package.json`
- Modify: `apps/api/src/import/parity-queries.js`, `parity.js` (new kind
  `records_without_account`)
- Migration: generated. Add `statement_sends.subject_key` as
  `not null default ''`, with the new unique index including it. The CLI
  rewrites `''` rows to `account:<id>`.
- Test: `backfill-practices.test.js`, parity test additions

**Interfaces:**
- Produces:
  - `planPracticeBackfill({ users, accounts, memberships, now })` →
    ```
    { markClient: [accountId],
      setFields: [{ accountId, accountNumber, legacyClientKey }],
      addMemberships: [{ userId, accountId, role }],
      deleteAccounts: [accountId],
      reportShared: [accountId],
      practiceOfUser: Map<userId, accountId> }
    ```
  - `writePracticeBackfill(plan, tx)` additionally:
    - sets `account_id` where null on `rx_cases` (by `user_id`) and on
      `lab_orders` / `invoices` (by `client_user_id`);
    - rewrites `pickups.party_key` and `message_threads.party_key` from
      `practice:<legacyKey>` to `practice:<accountId>`;
    - sets `statement_sends.subject_key = 'account:'||<practice>` where it
      is `''`.
    - It returns counts.
  - `practiceOfUser` is reused by Task 3.
- The canonical account per `seazonaClientId` is the active account owned
  by the oldest active linked doctor (use `import/owners.js` `oldestByKey`);
  the oldest such account wins a tie. When that doctor owns none, a new
  account is planned (name from `doctor_profiles.company_name`).

- [ ] **Step 1: Failing planner tests**:
  - `two doctors sharing a client id → one client account, the other gets
    an admin membership`;
  - `canonical account is the oldest linked doctor's`;
  - `approved doctor without a client id → own account marked client`;
  - `shopper accounts are never marked client`;
  - `empty duplicate personal account is deleted; one with other active
    members is reported, not deleted`;
  - `account number copied from the owner's seazona account number`;
  - `re-running on the planned result plans nothing` (idempotent).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the schema columns, generate the migration, and
  implement the planner and writer.** The CLI defaults to a dry run
  (printing counts only, no names) and writes with `--live`, in one
  transaction.
- [ ] **Step 4: Writer test (fake-tx)**:
  - `party keys rewritten only for practice:<legacy key> rows`;
  - `account_id filled only where null`.
- [ ] **Step 5: Parity test** `parity counts owned records without
  account`: an invoice with `client_user_id` set and `account_id` null →
  kind `records_without_account` count 1. The kind cannot be accepted away.
- [ ] **Step 6: Run the tests; expect PASS.**
- [ ] **Step 7: Commit** `feat(practices): practice accounts, backfill CLI, parity check`.

---

### Task 3: Stamp `account_id` on every create path (app + import)

**Files:**
- Create: `apps/api/src/services/practice-of.js`
- Modify:
  - `routes/rx.routes.js` (both inserts, `:211` and `:466`)
  - `services/lab/staff-orders.service.js`
  - `services/lab/lab-orders.service.js:54` (from the rx case, or the input)
  - `services/billing/invoices.service.js:35` (`createDraftForLabOrder`
    copies `labOrder.accountId`) and `:86` (shop: the buyer's practice, or
    null for a guest)
  - `import/map-clients.js` (`newDoctor`'s account gets `isClient`,
    `accountNumber`, `legacyClientKey`)
  - `import/load-invoices.js`, `load-orders.js` (`account_id` from
    `legacy_client_key`)
  - `import/reattach.js` (sets `account_id` together with `clientUserId`)
  - `apps/web/src/pages/lab/*` staff order entry (a practice picker when
    the client belongs to more than one)
- Test: `practice-of.test.js`, additions to `staff-orders.service.test.js`,
  `invoices.service.test.js`, `map-clients.test.js`, `load-orders.test.js`,
  `load-invoices.test.js`, rx route test

**Interfaces:**
- Produces: `practiceForNewRecord(tx, { ownerUserId, requestedAccountId = null, directOnly = true })`
  → `accountId | null`.
  - It loads the owner's active direct memberships in client accounts.
  - Requested and in that set → it; requested and not in the set → throws
    `InvoiceError("NOT_FOUND")`.
  - None requested and exactly one → it; more than one → throws
    `PRACTICE_REQUIRED` (422, "Choose which practice this is for.").
  - Zero → null.
- `POST /rx/cases` and staff order input accept `accountId`.

- [ ] **Step 1: Failing tests**:
  - `one practice → defaulted`;
  - `two practices and none chosen → PRACTICE_REQUIRED`;
  - `chosen practice the owner is not a member of → NOT_FOUND`;
  - `draft invoice inherits the lab order's account`;
  - `guest shop invoice has null account`;
  - `import stamps account from legacy client key`;
  - `reattach sets account with owner`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `practiceForNewRecord` and call it at each
  create path above. Staff order entry shows a practice select only when
  `/admin/practices?memberUserId=` returns more than one.
- [ ] **Step 4: Run the touched suites and the web build; expect PASS.**
- [ ] **Step 5: Commit** `feat(practices): stamp account on cases, orders and invoices`.

---

### Task 4: The client-scope seam, guards, and `canActOnInvoice`

**Files:**
- Create: `apps/api/src/services/client-scope.js`,
  `apps/api/src/routes/client-scope.routes.js`
- Modify:
  - `middleware/authenticate.js` (attach `user.scope`)
  - `middleware/require-role.js` (add `requireClientPortal`)
  - `middleware/require-account.js` (refuse a non-active membership)
  - `services/billing/invoice-rules.js:405-427` (new signature, doc
    comment)
  - `services/practice.js` (piece 8; keys per the spec)
- Test: `client-scope.test.js`, `require-account.test.js`,
  `practice.test.js` (rewrite), `routes/__tests__/scope-isolation.test.js`,
  `routes/__tests__/no-seazona-authz.test.js`

**Interfaces:**
- Produces:
  - `loadClientScope(userId, database = db)` → `ClientScope` (spec,
    "Authorization seam"):
    - uses `organizations.scopeForUser`;
    - eligibility = `accounts.status='active' AND is_client`;
    - `payable` = accounts whose role is not `viewer`.
  - `canActForAccount(scope, accountId, { pay = false })` → boolean
  - `requestedAccounts(scope, param)` → `string[]`; throws a 404 `NOT_FOUND`
    app error on an out-of-scope value
  - `canActOnInvoice(scope, invoice)` → boolean (replaces the
    three-argument version; every caller is updated in Task 5)
  - `requireClientPortal` (Fastify preHandler)
  - `practiceKeyFor({ accountId, ownerId })`, `partyKeysFor(user)` (reads
    `user.scope`), `parsePartyKey` (unchanged)
  - `GET /client/scope` (spec response shape)

- [ ] **Step 1: Failing tests**:
  - `scope from direct membership only includes client accounts`;
  - `removed or suspended membership is out of scope on the next
    authenticate`;
  - `viewer cannot pay` (`canActForAccount(s, a, { pay: true })` false);
  - `group admin can pay every group account`;
  - `requestedAccounts("all")` returns all; an out-of-scope id throws
    `NOT_FOUND`; `"organization:x"` throws for non-statement callers;
  - `canActOnInvoice is false for a null accountId`;
  - `require-account refuses a removed membership with 403`;
  - `partyKeysFor lists user key plus every scoped practice key`.
- [ ] **Step 2: Grep-guard test** `no-seazona-authz.test.js`: under
  `apps/api/src/routes` and `services` (excluding `import/`, `db/`,
  `auth.service.js`, display-only files named in the spec table),
  `seazonaClientId` must not appear in a comparison (`===`, `eq(`,
  `inArray(`). It fails now.
- [ ] **Step 3: Implement** the seam, the guards and the new
  `canActOnInvoice`. `authenticate` keeps the `seazonaClientId` select for
  display only.
- [ ] **Step 4: `scope-isolation.test.js`**: a route table (built with the
  handler-source pattern used in `routes/__tests__/rx-doctor-view.test.js`,
  plus service-level fakes) asserting `sibling ids read as not found` for:
  - `/invoices/:id`, `/invoices/:id/pdf`, `/invoices/statement.pdf?account=`
  - `/rx/cases/:id`, `/rx/cases/:id/files/:fileId`
  - `/pickups/:id`
  - messaging thread open
  - `/payments/charge-saved`
  It stays red until Tasks 5–6 land. Mark it with `test.todo` entries
  that Tasks 5 and 6 flip to `test`.
- [ ] **Step 5: Run the seam tests; expect PASS** (todo entries pending).
- [ ] **Step 6: Commit** `feat(practices): client scope seam and guards`.

---

### Task 5: Billing and payments on the scope

**Files:**
- Modify:
  - `services/billing/ledger.service.js` (delete `practiceUserIds`;
    `openInvoicesForAccounts`)
  - `services/billing/invoice-queries.js:133-216`
  - `routes/invoice.routes.js`
  - `services/payment-recording.service.js:113-175`
  - `routes/invoice-payment.routes.js`, `saved-cards.routes.js`,
    `autopay.routes.js`, `payment.routes.js:26`
  - `services/autopay-runner.service.js:100-320`
  - `services/billing/invoice-actions.service.js:140-170`
  - `routes/admin-payment.routes.js:390`
  - `services/email.service.js` receipt (payer only; invoice numbers and
    account numbers, no names)
- Test: `ledger.service.test.js`, `payment-recording.service.test.js`,
  `autopay.service.test.js`, `invoice-actions.service.test.js`, invoice
  route tests, flip Task 4's billing todos

**Interfaces:**
- Consumes: `ClientScope`, `canActOnInvoice(scope, invoice)`,
  `canActForAccount`, `requestedAccounts` (Task 4).
- Produces:
  - `listClientInvoices(accountIds, { includeDrafts = false })`: rows gain
    `accountId`, `accountName`, `accountNumber`.
  - `openInvoicesForAccounts(accountIds, database)`: same row shape as
    today's `openInvoicesForClient`, plus `accountId`.
  - `verifyAllocations(allocations, scope, { enforceCap, database })`:
    requires every invoice payable in scope.
  - `GET /invoices` returns `{ data: rows, meta: { balanceCents } }`.

- [ ] **Step 1: Failing tests**:
  - `group admin pays invoices of two practices in one charge` →
    `verifyAllocations` null, and the recorded ledger has one row per
    invoice, each with the same `transactionId` and `userId` = admin;
  - `mixed allocation with one foreign invoice charges nothing` (the route
    test asserts the card gateway fake was never called);
  - `practice staff cannot pay a sibling practice's invoice` → forbidden;
  - `viewer allocation refused`;
  - `autopay uses the scope at run time` (an admin removed between
    enrolment and run → nothing charged);
  - `receipt goes to the payer only and lists invoice numbers only`;
  - `GET /invoices?account=all sums balanceCents over scoped rows`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Swap `requireApprovedDoctor` for `requireClientPortal` on the routes
    listed in the spec table.
  - Keep `withInvoiceLocks` invoice-global and update its comment: "several
    logins share an invoice across practices and groups".
- [ ] **Step 4: Flip the billing `test.todo`s in `scope-isolation.test.js`
  to tests; run all billing, payment and route suites; expect PASS.**
- [ ] **Step 5: Commit** `feat(practices): invoices and payments by practice scope`.

---

### Task 6: Cases, messages, pickups and notifications on the scope

**Files:**
- Modify:
  - `routes/rx.routes.js:555-700` (list, detail, files by
    `rx_cases.account_id` in `requestedAccounts`)
  - `services/lab/lab-messaging.js` (owner key from the record's
    `account_id`; party search and picker by account; labels from
    `accounts.name` + `account_number`)
  - `services/lab/pickups.service.js` (`partyKey` = the chosen practice's
    key; create requires one practice in scope; list by
    `requestedAccounts`)
  - `services/lab/lab-notifications.js:120-170` (audience)
- Test: `lab-messaging.test.js`, `pickups.service.test.js`,
  `lab-notifications.test.js`, rx route tests, flip Task 4's remaining
  todos

**Interfaces:**
- Consumes: Task 4 seam, `organizationOf`.
- Produces: `resolveLabAudience(db, { party: "practice:<accountId>" })` →
  - active members of that account, any role;
  - active admins of its active organization;
  - deduped; never members of a sibling account.
  `audienceMembers` takes `{ accountMembers, orgAdmins }` rows in place of
  the `seazonaClientId` filter.

- [ ] **Step 1: Failing tests**:
  - `practice audience excludes siblings` (A's alert reaches A's member
    and the group admin, not B's member);
  - `removed member gets no alert`;
  - `My Cases in all practices lists both practices for a group admin and
    one for staff`;
  - `pickup create with account=all → 422 choose a practice`;
  - `thread on a case of practice B is not openable by A's staff` (404).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Flip the remaining todos; run the suites; expect PASS.**
  Also run `no-seazona-authz.test.js`, which must now pass.
- [ ] **Step 5: Commit** `feat(practices): cases, messages, pickups and alerts by practice scope`.

---

### Task 7: Statements: per practice, plus the optional combined group statement

**Files:**
- Modify:
  - `services/billing/statement-run.service.js` (candidates per account;
    organization candidates)
  - `services/billing/statements.service.js` (`statementFor` takes
    `{ accountIds, header }`)
  - `services/billing/statement-model.js` (combined model: a section per
    practice with its own account number, then a group total)
  - `services/billing/billing-pdf.js`
  - `routes/statement-run.routes.js`
  - `routes/invoice.routes.js` statement handler
  - `routes/receivables.routes.js:18-45`
- Test: `statement-run.service.test.js`, `statement-model.test.js`,
  `billing-pdf.test.js`

**Interfaces:**
- Produces:
  - `buildStatementCandidates({ accounts, members, organizations, activity, sends, month })`
    → rows `{ subject: "account"|"organization", subjectId, recipientUserId, name, accountNumber, openingCents, closingCents, activityCount, alreadySentAt, planned }`.
    - Account rows have one row per approved doctor member, as today.
    - Organization rows have one row per active admin, only when
      `settings.combinedStatement`.
  - `buildCombinedStatementModel(org, perAccountModels)`
  - `statement_sends.subject_key` per the spec.

- [ ] **Step 1: Failing tests**:
  - `each practice keeps its own statement and account number`;
  - `combined statement only when the group setting is on`;
  - `combined statement goes to group admins only` (no practice member is a
    recipient of the organization row);
  - `same month never sent twice per subject and recipient`;
  - `combined PDF shows one section per practice and a group total equal
    to the sum`;
  - `doctor statement.pdf?account=organization:<id> by a non-admin → 404`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Admin's per-client statement routes take an
  account (`/admin/practices/:id/statement.pdf`, `/statement/email`).
  Keep the old `/admin/clients/:userId/...` paths as thin wrappers onto
  the user's single practice; refuse with 422 when there is more than one.
- [ ] **Step 4: Run the tests; expect PASS.**
- [ ] **Step 5: Commit** `feat(practices): per-practice and combined group statements`.

---

### Task 8: Receivables group rollup + `payments-match` same-group rule

**Files:**
- Modify:
  - `services/billing/statements.service.js` `listReceivables`
    (per account; `groupBy`)
  - `routes/receivables.routes.js`
  - `packages/shared` `receivablesQuerySchema` (`groupBy: account|organization`)
  - `apps/web/src/pages/app/AdminReceivablesPage.jsx` (toggle + `renderExpanded`)
  - `apps/api/src/import/payment-match.js` (`matchPayments({ invoices, payments, groupOf })`)
  - `payments-match-command.js` (`--groups <csv>` flag, CSV reader, summary
    `sameGroup` count)
- Test: `statements.service.test.js`, `AdminReceivablesPage.test.jsx`,
  `payment-match.test.js`, `payments-match-command.test.js`

**Interfaces:**
- Produces:
  - `listReceivables({ pastDueOnly, groupBy = "account" })` → rows
    `{ accountId, name, accountNumber, organizationId, organizationName, buckets, totalCents }`.
    With `groupBy: "organization"`, it also returns
    `groups: [{ organizationId, name, buckets, totalCents, accountIds }]`.
    Ungrouped practices stay as plain rows.
  - `groupOf`: a `Map<clientKey, groupLabel>`. When both keys map to the
    same label, a cross-client payment is attributed as normal and counted
    in `out.sameGroup` (a list of payment ids), not `crossClient`.
  - `readGroupsCsv(bytes, resolveClient)` → `{ groupOf, problems }`:
    - header `account_number,group`;
    - an account number resolved through `clientResolver`;
    - an unknown or duplicate account is a problem;
    - under `--live`, problems refuse unless `--accept-group-problems` is
      given.

- [ ] **Step 1: Failing tests**:
  - `payment naming a sibling invoice in the same group is applied`;
  - `same payment without groups stays crossClient`;
  - `different groups stay crossClient`;
  - `groups csv with an unknown account is a problem`;
  - `group rollup total equals the sum of its practices`;
  - `ungrouped practice is a plain row`;
  - the web test: `By group toggle expands a group to its practices`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Output stays counts, numbers and ids only:
  no group labels or client names are printed.
- [ ] **Step 4: Run the tests and the web build; expect PASS.**
- [ ] **Step 5: Commit** `feat(practices): receivables group rollup and same-group payment matching`.

---

### Task 9: Admin UI: Groups and Practices

**Files:**
- Create in `apps/web/src/modules/organizations/`: `api.js`,
  `OrganizationsTable.jsx`, `OrganizationDetail.jsx`, `AccountsTab.jsx`,
  `AdminsTab.jsx`, `SettingsTab.jsx`, `index.js`, `README.md`,
  `__tests__/*.test.jsx`
- Create:
  - `apps/web/src/pages/app/AdminGroupsPage.jsx`
  - `AdminGroupDetailPage.jsx`
  - `AdminPracticesPage.jsx`
  - `PracticeDrawer.jsx` (account number + members DataTable)
- Create (API glue): `apps/api/src/services/practices.service.js`,
  `routes/admin-practices.routes.js` (+ tests); mount it in `index.js`
- Modify: `apps/web/src/config/routes.js` (`ADMIN_GROUPS`,
  `ADMIN_GROUP_DETAIL: "/admin/groups/:id"`, `ADMIN_PRACTICES`),
  `App.jsx`, admin `Sidebar.jsx` (entries "Groups" and "Practices" under
  Clients)

**Interfaces:**
- Consumes: Task 1 routes, `/admin/practices*` (spec table).
- Produces:
  - `practices.service.js`:
    - `listPractices({ q, organizationId, missingNumber, memberUserId, limit, offset })`
    - `setAccountNumber(id, value, byUserId)` (409 `ACCOUNT_NUMBER_TAKEN`)
    - `listMembers(id)`
    - `addMember(id, { userId, role })` (role ∈ admin|member|viewer;
      re-activates a removed row)
    - `setMemberRole`
    - `removeMember` (sets `removed`; refuses the account owner)
  - The web module's components take `accountsSource` / `describeAccount`
    props, so they carry no lab words.

- [ ] **Step 1: Failing tests**:
  - API:
    - `add member re-activates a removed membership`;
    - `cannot assign owner`;
    - `cannot remove the owner`;
    - `account number clash → 409`;
    - `audit metadata ids only`.
  - Web:
    - `groups table bulk archive asks inline confirm`;
    - `add practices picker excludes practices already in another group`;
    - `admins tab remove uses ConfirmButton`;
    - `practice drawer role change saves`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** All lists use DataTable with server paging,
  filters, bulk select and bulk actions as configuration.
- [ ] **Step 4: Run the tests and the web build; expect PASS.**
- [ ] **Step 5: Commit** `feat(practices): admin groups and practices screens`.

---

### Task 10: Portal: practice switcher and "All practices"

**Files:**
- Modify:
  - `apps/web/src/stores/account.store.js` (add `clientScope`,
    `practiceScope` ("all" | accountId), `fetchClientScope`,
    `setPracticeScope`; sessionStorage wrapped in try/catch)
  - `components/account/AccountSwitcher.jsx` (a `variant="practice"` mode
    with an "All practices" entry, shown only when there are more than one
    accounts)
  - `components/layout/DoctorShell.jsx`
- Create: `apps/web/src/hooks/usePracticeScope.js` → `{ scope, accounts, isAll, param, set }`
- Modify:
  - `pages/doctor/InvoicesPage.jsx` (Practice column + filter, combined
    balance header, cross-practice pay)
  - `components/doctor/PaymentModal.jsx` (practice per invoice; viewer
    rows not selectable)
  - `pages/doctor/MyCasesPage.jsx`, `PickupsPage.jsx`, `MessagesPage.jsx`
    (Practice column + filter; "new" actions require one practice)
  - statement download (per practice, plus combined for group admins)
  - `config/routes.js` landing (a non-doctor login with scope →
    `/doctor/invoices`; "New case" hidden)
- Test: `usePracticeScope.test.jsx`, `InvoicesPage.test.jsx`,
  `PickupsPage.test.jsx` additions, `AccountSwitcher.test.jsx`

**Interfaces:**
- Consumes: `GET /client/scope`, `?account=` on the list endpoints (Tasks
  4–7).

- [ ] **Step 1: Failing tests**:
  - `switcher hidden with one practice`;
  - `All practices shows the Practice column and combined balance`;
  - `pay selects invoices from two practices and posts one charge`;
  - `viewer rows are not selectable for pay`;
  - `new pickup in All practices asks for a practice`;
  - `a stored scope no longer in clientScope falls back to all`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and the web build; expect PASS.**
- [ ] **Step 5: Commit** `feat(practices): portal practice switcher and all-practices view`.

---

### Task 11: READMEs "wiring into another app", runbook, docs

**Files:**
- Modify:
  - `apps/api/src/modules/organizations/README.md` and
    `apps/web/src/modules/organizations/README.md` ("Wiring it into another
    app", with the steps below)
  - `docs/cutover-runbook.md`
  - `docs/import-operations.md` (`--groups`)
  - `apps/api/src/modules/messaging/README.md` (party keys are
    `practice:<accountId>` in this app)
  - `CLAUDE.md` (one line under Authentication & Roles: "Client access is
    `services/client-scope.js`; never compare seazonaClientId")
- Test: `apps/api/src/modules/readme.test.js` still passes (a README per
  module with the required sections)

The README wiring steps:
1. Add the schema to drizzle.
2. Mount `createOrganizationsRoutes` with your admin guard.
3. Supply `loadMemberships` / `isEligibleAccount` to `scopeForUser`.
4. Load the scope in your auth middleware per request; never cache it.
5. Filter every account-owned query by `scope.accountIds`.

- [ ] **Step 1: Runbook.**
  - Insert `pnpm --filter @my-app/api db:backfill-practices` (dry run, then
    `--live`) into step 5, between `import:load clients` and
    `import:load invoices`.
  - Add `records_without_account` to the parity notes (must be 0; not
    acceptable).
  - Add a new section **"5c. Practice groups re-entry (before unfreeze)"**:
    - create each group in Admin › Groups;
    - add its practices;
    - turn on the combined statement where the lab wants it;
    - add group admins (inviting any login that doesn't exist yet);
    - add practice staff in Admin › Practices;
    - fill in missing account numbers (filter "no account number");
    - confirm one known group's combined balance against Labzona's
      per-client balances summed.
  - Add to the T-1 week list: "the lab supplies the groups CSV
    (`account_number,group`) for `payments-match --groups`".
- [ ] **Step 2: Write the READMEs and the docs lines above.**
- [ ] **Step 3: Run** `pnpm --filter @my-app/api test -- src/modules`;
  expect PASS.
- [ ] **Step 4: Commit** `docs(practices): module wiring guides and cutover re-entry steps`.
