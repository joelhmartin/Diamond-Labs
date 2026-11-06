# organizations (web)

## Purpose

Screens for named groups of accounts and the people who administer them: a
searchable list with bulk archive, and a detail view with Accounts, Admins and
Settings tabs. The module knows nothing about what an account is; the host
supplies the account and user lists and how an account row reads.

## Public interface

Everything is exported from `index.js`.

- `OrganizationsTable({ onOpen, noun = "group", base, refreshKey })`: server-paged list, Active / Archived filter, bulk Archive (inline confirm) and Restore, "New" button.
- `OrganizationDetail({ organizationId, accountsSource, describeAccount, accountNoun, usersSource, settingsHelp, base })`
- `AccountsTab`, `AdminsTab`, `SettingsTab`, `PickerModal` (the parts, usable alone).
- `api.js`: one wrapper per route of `apps/api/src/modules/organizations`.

Props the host provides:

- `accountsSource.list({ q, limit, offset, ungrouped }) -> { rows: [{ id, label, detail?, organizationId? }], total }`. The picker sends `ungrouped: true` and also drops any row that carries an `organizationId`, so an account already in an organization is never offered.
- `describeAccount(account) -> { title, subtitle?, to? }`: how a member row reads.
- `usersSource.list(...)` (same shape) and `usersSource.labels(ids) -> { [id]: label }`.

## Configuration

`base` (API path) defaults to `/admin/organizations`. No env vars.

## Wiring it into another app

1. Serve the API module (`apps/api/src/modules/organizations`) and keep the default `base`, or pass your own.
2. Build the two sources from your own endpoints: `accountsSource.list({ q, limit, offset, ungrouped })` and `usersSource.list(...)` / `usersSource.labels(ids)` (shapes under Public interface). Both return `{ rows, total }`.
3. Write `describeAccount(account) -> { title, subtitle?, to? }` so a member row reads the way your app names an account, and pass `accountNoun` if "account" is the wrong word.
4. Mount `OrganizationsTable` on a list page whose `onOpen` navigates to a detail page, and `OrganizationDetail` on the detail page with `organizationId` and the props above.

Worked example: `apps/web/src/pages/app/AdminGroupsPage.jsx` and `AdminGroupDetailPage.jsx`, and the data-source file beside them (Admin > Groups). Environment variables: none.
