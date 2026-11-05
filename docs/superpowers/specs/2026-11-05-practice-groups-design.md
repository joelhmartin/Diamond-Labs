# Piece 11: Practice groups (design)

_2026-11-05. Branch: `feat/own-the-lab-practice-groups`, PR into
`feat/own-the-lab`. Builds after piece 8 (messaging) merges; plans against
`origin/feat/own-the-lab-messaging`. Roadmap rules
(`2026-11-05-lab-parity-roadmap.md`) are binding._

## Intent

Some clients are multi-location practices or DSOs. The lab wants to group
those practices so one login can manage all of them, while each practice
keeps its own account number, invoices and statement.

User decisions (2026-11-05, binding):

- The lab defines groups of practices.
- One login can manage several practices.
- **Group admins see and pay ALL of the group's practices' invoices, cases,
  messages and pickups. Individual practice staff see only their own
  practice.**
- Each practice keeps its own account number, invoices and statement.

Security is the main risk of this piece. Today's rule is "same
`seazonaClientId`". It is replaced by one authorization seam, and every
client-facing read and write goes through it.

## Goals

1. A generic `organizations` module: groups → member accounts → group
   admins. Practice staff stay on the existing `accounts` / `memberships`
   tables, which are extended rather than paralleled.
2. A practice becomes a real entity: an `accounts` row with an account
   number. Practice-owned records (`rx_cases`, `lab_orders`, `invoices`)
   carry `account_id`.
3. One authorization seam, `services/client-scope.js`, answers "which
   practices can this login act for". Every place that assumes one practice
   per login is repointed at it (inventory below).
4. Portal: a practice switcher, plus an "All practices" view with combined
   cases, invoices and balance. One card charge can pay invoices across the
   group's practices.
5. Statements stay per practice. An optional combined group statement can
   be turned on per group.
6. Admin: create a group, add practices, assign group admins and practice
   staff. Every list is a DataTable.
7. The `payments-match` import tool accepts a payment that names a sibling
   practice's invoice when both practices are in one group.
8. Receivables gain a group rollup.

## Non-goals

- Group-level pricing or price lists. Prices stay per client user
  (`client_prices.priced_for_user_id`, piece 10 lists).
- Nested groups, or a practice in two groups.
- Case submission by non-doctor logins. Rx submit stays doctor-only; staff
  and group admins see cases but do not submit them.
- A group-level AutoPay schedule. AutoPay stays per enrolled login (see
  rulings).
- Piece 9 report changes. A follow-up list is at the end.

## What exists today (survey, file:line)

The single "practice" today is **every doctor user sharing a non-null
`users.seazonaClientId`**. There is no practice entity.

- `services/billing/invoice-rules.js:423` `canActOnInvoice(user, invoice, ownerSeazonaClientId)`:
  the requester is the owner, or both share `seazonaClientId`. (The brief
  says `:299`; that line is now `assertShipmentCharge`.)
- `services/billing/ledger.service.js:65` `practiceUserIds(user)`: the
  doctors sharing the requester's `seazonaClientId`. Used by
  `routes/invoice.routes.js:25,38` (list and statement) and
  `openInvoicesForClient` (`:81`).
- `services/payment-recording.service.js:126-147` `verifyAllocations`:
  joins the owner and calls `canActOnInvoice` per allocation. Used by every
  card, hosted, saved-card, admin and AutoPay payment.
- `services/autopay-runner.service.js:111,303`: AutoPay pays "practice-wide"
  through the same rule.
- `services/billing/invoice-actions.service.js:143-165`: admin "pay as
  the client sees it" uses `practiceUserIds`.
- `services/billing/statement-run.service.js:122-170`: `practiceKey(d)` is
  `p:<seazonaClientId>`, and each approved doctor gets the practice-wide
  statement. `statement_sends` is unique on `(client_user_id, month)`
  (`db/schema/statement-sends.js:24`).
- `services/billing/statements.service.js:83`: `listReceivables` groups
  per `clientUserId`. The comment defers practice grouping to "a practice
  entity".
- `lib/payment-helpers.js:58`: the invoice lock is invoice-global because
  several logins share one practice. This stays correct.
- `routes/rx.routes.js:561,618,667`: **My Cases is per user**
  (`rxCases.userId = request.user.id`), not per practice. That is
  inconsistent with invoices today.
- Piece 8 (`origin/feat/own-the-lab-messaging`):
  - `services/practice.js`: `practiceKeyFor(user)` →
    `practice:<seazonaClientId>` | `user:<id>`, and the sync
    `partyKeysFor(user)`.
  - `services/lab/lab-messaging.js:31-40,126,177`: owner keys from
    `users.seazonaClientId`.
  - `services/lab/pickups.service.js:41,75,183`: `pickups.party_key` is
    stored at request time.
  - `modules/messaging/schema.js:13`: `party_key` is stored on threads.
  - `services/lab/lab-notifications.js:122-170`: `practice:X` resolves to
    approved doctors with that `seazonaClientId`.
- `middleware/authenticate.js:28`: loads `seazonaClientId` onto
  `request.user`. All client routes use `requireApprovedDoctor`
  (`middleware/require-role.js:19`).
- `accounts` / `memberships` / `invitations` exist from the SaaS template:
  - `auth.service.js:127,506` creates an "X's Account" or "X's Practice"
    account plus an owner membership for **every** registrant, shoppers
    included.
  - `import/map-clients.js:96-108` creates one account per new imported
    client. The link path (`:166`) creates none.
  - Accounts are never read for authorization. An invited practice member
    (role `user`) gets nothing in the portal today.
- `middleware/require-account.js:31-44` loads the membership but does not
  check `memberships.status`. Only `authorize()` does. `DELETE
  /accounts/:accountId` (`routes/account.routes.js:36`) uses only
  `requireAccount`. It is harmless today (the service checks the owner),
  but it must be fixed before memberships carry authorization.
- The account number lives per doctor on `users.seazona_account_number`.
- `import/payment-match.js:107-110`: `crossClient`, a payment whose client
  differs from a named invoice's client, is never applied.
- `apps/web/src/stores/account.store.js` and `AccountSwitcher.jsx` already
  exist (Topbar). `config/api.js:20` sends `x-account-id` on every request.

### Every place that assumes one practice per login

| File | What changes |
|---|---|
| `services/billing/invoice-rules.js` `canActOnInvoice` | `canActOnInvoice(scope, invoice)`: is `invoice.accountId` in scope? |
| `services/billing/ledger.service.js` `practiceUserIds`, `openInvoicesForClient` | Deleted. Replaced by `openInvoicesForAccounts(accountIds)`. |
| `services/billing/invoice-queries.js:133,200-216` | `listClientInvoices(accountIds)`; the detail returns `accountId`, not `seazonaClientId`. |
| `routes/invoice.routes.js` | Scope-filtered list, detail, PDF and statement, with `?account=`. |
| `services/payment-recording.service.js` `verifyAllocations` | Uses the scope; payability is checked per account. |
| `routes/invoice-payment.routes.js`, `routes/saved-cards.routes.js`, `routes/autopay.routes.js`, `routes/payment.routes.js` `/payments/history` | Guard becomes `requireClientPortal`; scope-based. |
| `routes/admin-payment.routes.js:390` (charge as client), `services/billing/invoice-actions.service.js:143-165` | Use the target user's scope. |
| `services/autopay-runner.service.js:111,303` | The enrollee's scope, loaded at run time. |
| `services/billing/statement-run.service.js`, `statements.service.js` | Per account, plus combined per group. |
| `routes/receivables.routes.js`, `statements.service.js` `listReceivables` | Per account, with a group rollup. |
| `routes/rx.routes.js` list, detail and file (My Cases) | By account scope. Submit stamps `account_id`. |
| `services/practice.js` (piece 8) | Keys become `practice:<accountId>`; `partyKeysFor` reads the scope. |
| `services/lab/lab-messaging.js`, `pickups.service.js`, `lab-notifications.js` (piece 8) | Owner key comes from the record's `account_id`; audience comes from account members and group admins. |
| `middleware/authenticate.js` | Attaches `user.scope`. Stops loading `seazonaClientId` for authorization. |
| `middleware/require-account.js` | Refuses a non-active membership. |
| `lib/refund-plan.js:7`, `routes/admin-payment.routes.js:63`, `routes/admin.routes.js:35` | Display only. They keep the legacy column and add `accountNumber` from `accounts`. |
| `import/map-clients.js`, `load-invoices.js`, `load-orders.js`, `reattach.js`, `owners.js` | Stamp the account and fill the practice columns. |
| `services/lab/staff-orders.service.js`, `lab-orders.service.js:54`, `billing/invoices.service.js:35,86` | Stamp `account_id` on create. |

`auth.service.js` keeps its Seazona-link logic (identity, not
authorization).

## Module boundaries

**Generic: `apps/api/src/modules/organizations/`.** It contains no
lab/practice/client words; it speaks of organizations, accounts and
admins.

- `schema.js`, holding three tables:
  - `organizations`
  - `organization_accounts`
  - `organization_admins`
- `rules.js`, which is pure:
  - `resolveScope({ memberships, adminOf, orgAccounts })` →
    `{ accountIds, viaOrganization: Map<accountId, orgId>, roles: Map<accountId, role|"org-admin"> }`
  - `mayAdminister(scope, accountId)`
- `service.js`:
  - CRUD for organizations
  - `addAccounts`, `removeAccount`
  - `addAdmin`, `removeAdmin`
  - `organizationOf(accountIds)`
  - `scopeForUser(userId, { memberships })`
- `routes.js`: `createOrganizationsRoutes({ guard, accountLabel })`, the
  admin CRUD routes.
- `README.md`.

It takes the account and membership rows it needs as input (`memberships`
is generic SaaS, not lab). It does not import from `services/`.

Web: `apps/web/src/modules/organizations/`.
- `api.js`
- `OrganizationsTable.jsx`
- `OrganizationDetail.jsx`, which has three tabs:
  - Accounts
  - Admins
  - Settings
- `README.md`

Shared: `packages/shared/src/organizations/schemas.js`.

**Lab glue:**
- `services/client-scope.js`, the one authorization seam:
  - `loadClientScope(userId, db)`
  - `canActForAccount(scope, accountId, { pay })`
  - `requestedAccounts(scope, param)`
  - `requireClientPortal`
- `services/practice.js`: repointed keys.
- `services/practices.service.js`: practice list and members for admin.
- `routes/admin-practices.routes.js`
- `routes/client-scope.routes.js`, serving `GET /client/scope`.
- `db/backfill-practices.js` plus the CLI.
- Statement, receivables and import changes in place.

## Data model

### Generic (`modules/organizations/schema.js`)

**`organizations`**

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar(128)` | primary key |
| `name` | `varchar(120)` | not null, unique on `lower(name)` |
| `settings` | `jsonb` | not null, default `{}`; validated by shared `organizationSettingsSchema` |
| `status` | `varchar(10)` | `active` \| `archived` |
| `created_at`, `updated_at` | | |

**`organization_accounts`**

| Column | Type | Notes |
|---|---|---|
| `organization_id` | | FK, cascade |
| `account_id` | `varchar(128)` | **unique**: one organization per account |
| `added_by`, `created_at` | | |

**`organization_admins`**

| Column | Type | Notes |
|---|---|---|
| `id` | | |
| `organization_id` | | |
| `user_id` | | |
| `status` | | `active` \| `removed` |
| `added_by`, `created_at`, `updated_at` | | |

`organization_admins` is unique on `(organization_id, user_id)`.

The module stores `account_id` as an opaque string with no FK, like
`record_tags`. The glue's admin route checks that it exists.

`organizationSettingsSchema` = `{ combinedStatement: boolean (default false) }`.
Unknown keys are refused.

### Glue columns (one generated migration)

- `accounts.is_client boolean not null default false`: this account is a
  client practice (shopper and staff personal accounts stay false).
- `accounts.account_number varchar(100)`: unique where not null. Copied
  from the doctor's `seazona_account_number` by the backfill. New practices
  get one from staff.
- `accounts.legacy_client_key varchar(100)`: unique where not null. This is
  the Seazona client id, the import's join key.
- `rx_cases.account_id`, `lab_orders.account_id`, `invoices.account_id`:
  `varchar(128)`, indexed, nullable. A null value with a non-null owner is
  a backfill gap, and every scope check **fails closed** on it.
- `statement_sends.subject_key varchar(160) not null`:
  - `account:<id>` or `organization:<id>`;
  - the unique index changes to `(subject_key, client_user_id, month)`;
  - `client_user_id` is now the recipient.

`invoice_payments` is unchanged. A row is per invoice, `user_id` is the
payer, and an invoice's account comes from the invoice. A charge that mixes
practices is just rows whose invoices have different `account_id`s.

## Authorization seam

`loadClientScope(userId, database)` → `ClientScope`:

```
{ accountIds: string[],                 // every practice this login may see
  payable: Set<accountId>,               // the subset it may pay (not "viewer")
  via: Map<accountId, "member" | "org-admin">,
  roles: Map<accountId, membershipRole | "org-admin">,
  organizations: [{ id, name, accountIds }] }  // where the login is an active group admin
```

The scope is built from:
- **Direct memberships**: `memberships.status = 'active'`, `accounts.status
  = 'active'`, and `accounts.is_client = true`.
- **Group admin rows**: `organization_admins.status = 'active'` and the
  organization is `active`. These give every account in
  `organization_accounts` that is active and a client account.

A doctor's own practice comes through their membership. After the backfill,
every approved doctor has one.

Rules:
- `authenticate` calls `loadClientScope` **on every request** and sets
  `request.user.scope`. It is never cached in the token, Redis or the
  browser, so removing a member takes effect on that login's next request.
- `canActOnInvoice(scope, invoice)`: `invoice.accountId != null &&
  scope.accountIds.includes(invoice.accountId)`. It is still pure, and the
  owner user no longer matters.
- `canActForAccount(scope, accountId, { pay = false })`: `pay` also requires
  `payable`. A `viewer` membership may read but not pay. Group admins may
  always pay.
- `requestedAccounts(scope, param)`:
  - `param` absent or `"all"` → all of `scope.accountIds`;
  - an id in scope → `[id]`;
  - anything else → throws `NOT_FOUND`;
  - never widens; never falls back.
- `requireClientPortal`: `request.user.scope.accountIds.length > 0`, or an
  approved doctor. A doctor with no scope yet gets empty lists, not other
  data.
- Piece 8 keys:
  - `practiceKeyFor({ accountId, ownerId })` → `practice:<accountId>`, or
    `user:<ownerId>` when the account is null (a guest shop order);
  - `partyKeysFor(user)` → `["user:<id>", ...scope.accountIds.map(practice:)]`.
  - It stays sync because the scope is already on `request.user`.

## API routes (all under `/api/v1`)

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/client/scope` | authenticate | `{ accounts: [{ id, name, accountNumber, organizationId, via, role, payable }], organizations: [{ id, name, combinedStatement }] }` |
| GET | `/invoices?account=<id\|all>` | client portal | Rows gain `accountId`, `accountName`, `accountNumber`. The response gains `balanceCents` (the sum over the rows). |
| GET | `/invoices/:id`, `/invoices/:id/pdf` | client portal | `canActOnInvoice(scope, …)`. Not yours reads as 404. |
| GET | `/invoices/statement.pdf?month&account=<id>` | client portal | One practice's statement. `account=organization:<orgId>` → the combined statement, only for that group's admins and only when `combinedStatement` is on. |
| POST | `/payments/charge-saved`, `/payments/hosted-token`, `/payments/hosted-complete` | client portal | Allocations may span the scope. Each invoice's account must be `payable`. |
| GET/PUT/DELETE | `/payments/saved-cards*`, `/autopay*` | client portal | Cards and enrollment belong to the login. |
| GET | `/payments/history?account=` | client portal | Ledger rows whose invoice is in the requested accounts, plus the login's own payments. |
| GET | `/rx/cases?account=`, `/rx/cases/:id`, `/rx/cases/:id/files/:fileId` | client portal | By `rx_cases.account_id` in scope. |
| POST | `/rx/cases` | approved doctor | Body `accountId`: required when the doctor is a direct member of more than one practice, else defaulted. Must be a direct membership. |
| — | `/admin/organizations*` | admin | Module routes: list (paged), create, patch, get, `POST /:id/accounts {accountIds}`, `DELETE /:id/accounts/:accountId`, `POST /:id/admins {userId}`, `DELETE /:id/admins/:userId`. |
| GET | `/admin/practices` | admin | Paged list of client accounts: number, name, organization, member count, open balance. |
| PATCH | `/admin/practices/:id` | admin | `{ accountNumber }`. Unique; 409 on a clash. |
| GET/POST/PATCH/DELETE | `/admin/practices/:id/members[/:userId]` | admin | Staff on the existing `memberships` table. Roles: `admin`, `member`, `viewer` (not `owner`). Delete sets `status = 'removed'`. |
| GET | `/admin/receivables?groupBy=account\|organization` | admin | Rows are per account; `organization` adds the group rollup rows. |
| GET/POST | `/admin/statements/run` | admin | Preview and run include `subject: "organization"` rows for groups with `combinedStatement`. |

## UI screens

**Admin**

- **Admin › Groups** (new nav entry, `ADMIN_GROUPS: "/admin/groups"`).
  - The list is a DataTable with server paging: name, practices, admins,
    combined statement, status.
  - Bulk archive goes through ConfirmButton.
  - "New group" opens a modal.
  - Group detail (`/admin/groups/:id`) has three tabs:
    - **Practices**: a DataTable with bulk "Remove from group" (inline
      ConfirmButton) and an "Add practices" picker over `/admin/practices`
      that is itself a DataTable with selection.
    - **Admins**: a DataTable with bulk remove, plus an "Add admin" user
      search.
    - **Settings**: the combined statement toggle.
- **Admin › Practices** (new, `ADMIN_PRACTICES: "/admin/practices"`).
  - A DataTable of client accounts, with filters for group and "no
    account number".
  - Row click opens the practice drawer:
    - the account number field;
    - a members DataTable (role select, bulk remove, add by user search).
- **Admin › Receivables**: a "By group" toggle. Group rows use DataTable's
  existing `renderExpanded` to list their practices.

**Portal** (`DoctorShell`)

- **Practice switcher** in the shell header. It shows when scope has more
  than one account: "All practices" plus each practice (name and account
  number). It reuses `account.store.js`, which gains `practiceScope` and
  `setPracticeScope`, and `AccountSwitcher.jsx`'s menu. The choice is kept
  in sessionStorage (a per-viewer convenience) and sent as `?account=`.
- **Invoices**:
  - In "All practices" the table gains a Practice column and filter, and
    the header shows the combined balance.
  - Pay selects invoices across practices. `PaymentModal` shows each
    invoice's practice. Unpayable (viewer) rows are not selectable.
- **My Cases, Pickups and Messages** gain a Practice column and filter in
  "All practices".
- "New pickup" and "New message" need a single practice chosen.
- **Statements**:
  - a per-practice download;
  - a "Combined statement" download for group admins of a group with the
    setting on.
- Non-doctor client logins (practice staff, group admins) land on
  `/doctor/invoices`. "New case" is hidden for them.

## Audit rows → coverage

The Labzona audit has **no row for practice groups**. "Client product
categories" (`ClientGroups.aspx`, NOT USED) is about product categories,
not groups of practices. This piece comes from the user's 2026-11-05
decisions, not the audit.

The adjacent rows it touches:
- **Client accounts** (HEAVY USE): the account number moves onto the
  practice (`accounts.account_number`).
- **Client logins** (HEAVY USE): practice members now really reach the
  portal.
- **Payments** (multi-invoice): mixed practices are allowed in one charge.
- **Statements**: per practice, plus combined.

## Cutover / import impact

- Seazona never exposed groups, so **every group is re-entered** by staff
  after the clients load: create groups, add practices, assign admins and
  invite staff. The cutover runbook gets the step.
- `import:load clients` creates new practice accounts with `is_client`,
  `account_number` and `legacy_client_key`. Linked existing users are
  handled by the backfill.
- **`db:backfill-practices`** (dry run by default, `--live`, idempotent)
  runs after `import:load clients` and before `invoices` / `orders`:
  - one client account per `seazonaClientId`, chosen as the account owned
    by the oldest active linked doctor (`owners.js` `oldestByKey`);
  - every other doctor sharing that id gets an `admin` membership in it;
  - doctors with no Seazona id who are approved have their own account
    marked `is_client`;
  - empty duplicate personal accounts of those doctors are set to
    `deleted`, unless they have other active members, which are reported
    instead;
  - fills `account_id` on existing `rx_cases`, `lab_orders` and `invoices`
    from the owner's practice;
  - rewrites `practice:<seazonaClientId>` party keys on pickups and
    message threads to `practice:<accountId>`;
  - maps existing `statement_sends` to `account:<id>`.
- The `invoices` / `orders` loads stamp `account_id` from
  `legacy_client_key`. `reattach.js` sets it together with `clientUserId`.
- Parity gains `records_without_account` (owned records with a null
  `account_id`). It must be 0.
- `payments-match` gains `--groups <csv>` (`account_number,group`). The lab
  supplies it. Cross-client payments inside one group are attributed; the
  report counts them as `sameGroup`.

## Rulings

- **Ruling: a practice is an `accounts` row.**
  - Why: the user asked to extend `accounts` and `memberships`. Invitations,
    member roles and the switcher store already exist.
  - Cost if wrong: a rename. Every consumer goes through `client-scope.js`.
- **Ruling: `rx_cases`, `lab_orders` and `invoices` carry `account_id`,
  stamped at create.** The practice is not derived from the owner user.
  - Why: a DSO doctor can work at two locations, and "each practice keeps
    its own invoices" needs the bill to know which.
  - Cost if wrong: one extra column and a backfill. Deriving it would have
    put a doctor's history under whichever practice they joined last.
- **Ruling: one group per practice** (unique `organization_accounts.account_id`).
  - Why: statements and rollups need one parent.
  - Cost if wrong: drop the unique index and give the rollup a primary
    group.
- **Ruling: the scope is loaded from the DB on every request and never
  cached.**
  - Why: a removed member must lose access on their next request.
  - Cost: one indexed query per authenticated request. Measure it; if it
    matters, cache per request only.
- **Ruling: out-of-scope `?account=` and out-of-scope ids read as 404.**
  - Why: this matches the existing "not found and not yours read the same"
    (`payment-recording.service.js:144`), so ids can't be probed.
  - Cost if wrong: support confusion only.
- **Ruling: group admins are `organization_admins` rows; practice staff
  are `memberships`.** `viewer` may not pay; group admins may.
  - Why: this separates "all practices" from "this practice" in the data
    itself.
  - Cost if wrong: a role enum later.
- **Ruling: non-doctor logins get the client portal when their scope is
  non-empty.** Rx submit stays doctor-only.
  - Why: a DSO billing manager is not a doctor.
  - Cost if wrong: a guard change.
- **Ruling: party keys become `practice:<accountId>`; stored keys are
  rewritten by the backfill.**
  - Why: Seazona ids do not exist for practices created after cutover.
  - Cost if wrong: threads or pickups whose key was missed become
    invisible to clients, never visible to others (fail closed). Parity
    counts unmatched keys.
- **Ruling: notifications for `practice:X` go to X's active members and
  X's active group admins, never siblings.**
  - Why: this is the user's visibility rule.
  - Cost if wrong: noisy inboxes for group admins (they can mute through
    piece 8's preferences).
- **Ruling: per-practice statements go to that practice's approved doctor
  members, as today.** The combined statement goes to the group's admins
  only, when `combinedStatement` is on.
  - Why: "per practice as today, plus optional combined".
  - Cost if wrong: a recipient list setting.
- **Ruling: saved cards and AutoPay belong to the paying login.** A group
  admin pays any group invoice with their own cards. AutoPay pays
  everything in the enrollee's scope as loaded at run time.
  - Why: CIM profiles are per user. A removed admin's AutoPay then pays
    nothing.
  - Cost if wrong: a per-account AutoPay later.
- **Ruling: account numbers for new practices are staff-entered (unique,
  optional).** There is no sequence.
  - Why: Labzona numbers were assigned by staff, and the legacy ones are
    free text.
  - Cost if wrong: add a sequence.
- **Ruling: the backfill is an idempotent CLI, not a SQL migration.**
  - Why: choosing the canonical account needs the import's owner rule and
    pure tests. Code fails closed on a null `account_id` meanwhile.
  - Cost if wrong: a missed run shows clients empty lists. Parity catches
    it.
- **Ruling: the matcher reads groups from a `--groups` CSV.**
  - Why: it runs on the import DB before cutover, when no groups exist in
    the app yet.
  - Cost if wrong: an extra file to prepare.

## Follow-ups for piece 9 (reports gain an `organization` filter)

- `accounting.account-balance`
- `accounting.aging-summary`
- `accounting.invoices`
- `accounting.invoices-summary`
- `accounting.invoices-payments`
- `accounting.payments-received`
- `accounting.statements-summary`
- `clients.list`
- `clients.health`
- `clients.top`
- `clients.bottom`
- `sales.by-client`
- `sales.summary`

The `client` lookup should become practice (account)-based. Piece 9
registers an `organization` lookup over `listOrganizations`.
