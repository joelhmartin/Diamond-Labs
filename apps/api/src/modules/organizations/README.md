# organizations

## Purpose

Named groups of accounts, with admins who act across the whole group. The
module knows nothing about what an account is: account ids are opaque strings
the host app passes in, and the host supplies how to check an account exists,
which accounts count, and where audit entries go. It also resolves, as a pure
function, which accounts a user can reach through direct memberships and
through organization-admin grants.

## Public interface

Everything is exported from `index.js`.

- `createOrganizationsService({ audit })` returns the service. `audit(entry)` is the
  host's writer, called after each write with
  `{ userId, action, targetType: "organization", targetId, metadata }`; metadata is
  ids and field names only. The module never imports the host's audit code.
  Every function takes an optional `database` as its last argument.
  - `listOrganizations({ q, status, limit, offset })` -> `{ rows, total }` (rows carry `accountCount`, `adminCount`)
  - `getOrganization(id)` -> `{ ...org, accountIds, admins: [{ userId, status }] }`
  - `createOrganization({ name, settings, byUserId })`, `updateOrganization(id, patch, byUserId)` (rename, settings merge, archive)
  - `addAccounts(orgId, accountIds, { byUserId, exists })` -> `{ added, alreadyInOther }`
    (`exists(ids)` returns the Set of ids that exist; an account lives in at most one organization)
  - `removeAccount(orgId, accountId, { byUserId })`
  - `addAdmin(orgId, userId, { byUserId, exists? })`, `removeAdmin(orgId, userId, { byUserId })`
  - `organizationOf(accountIds)` -> `Map<accountId, { id, name, settings }>` (active organizations only)
  - `scopeForUser(userId, { loadMemberships, eligibleAccounts })` -> the `resolveScope` result, read live each call.
    `loadMemberships(userId)` returns `[{ accountId, role, status, accountActive }]`; `eligibleAccounts(accountIds)` is
    called once per resolution and returns the `Set` of ids that are active and eligible (one batch, not one query per account)
- `resolveScope({ memberships, adminOf, orgAccounts })` (pure) ->
  `{ accountIds (sorted), roles: Map, via: Map<"member"|"org-admin">, organizations: [{ id, accountIds }] }`.
  Only active rows of active, eligible accounts count; an organization-admin grant wins over a member role.
- `mayAdminister(scope, accountId)`, `OrganizationError` (codes `NOT_FOUND`, `INVALID`, `CONFLICT`)
- `createOrganizationsRoutes({ service, guard, describeAccounts, userExists? })` returns a Fastify plugin.

Shared validation lives in `packages/shared/src/organizations/schemas.js`
(`organizationSettingsSchema`, `createOrganizationSchema`, `updateOrganizationSchema`,
`organizationAccountsSchema`, `organizationAdminSchema`, `listOrganizationsQuerySchema`).

## Routes

Paths are relative to the prefix the host registers the plugin under.

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `?q&status&limit&offset` |
| POST | `/` | `{ name, settings? }`; 409 when the name is taken (case-insensitive) |
| GET | `/:id` | detail with `accounts` labels from `describeAccounts` |
| PATCH | `/:id` | `{ name?, settings?, status? }`; unknown settings keys are a 422 |
| POST | `/:id/accounts` | `{ accountIds }` (1 to 500) |
| DELETE | `/:id/accounts/:accountId` | |
| POST | `/:id/admins` | `{ userId }` |
| DELETE | `/:id/admins/:userId` | |

Every route runs the host's `guard`.

## Configuration

```js
await fastify.register(
  createOrganizationsRoutes({
    service: createOrganizationsService({ audit: writeAuditEntry }),
    guard: [authenticate, requireAdmin],
    describeAccounts: async (ids) => [{ id, label }],   // ids it omits are treated as unknown accounts
    userExists: async (userId) => true,                  // optional
  }),
  { prefix: "/api/v1/admin/organizations" },
);
```

`settings` is validated by `organizationSettingsSchema`: `{ combinedStatement: boolean }` (default false); unknown keys are refused.

## Data model

- `organizations`: id, name (<= 120, unique on `lower(name)`), settings (jsonb), status (`active` | `archived`), timestamps.
- `organization_accounts`: organization_id (FK, cascade), account_id (unique: one organization per account), added_by, created_at.
- `organization_admins`: id, organization_id (FK, cascade), user_id, status (`active` | `removed`), added_by, timestamps. Unique on `(organization_id, user_id)`.

`account_id`, `user_id` and the `*_by` columns have no foreign keys (repo
convention); the host checks they exist. Admins and accounts are never
deleted by archiving an organization; an archived organization simply grants
nothing.

## Wiring it into another app

Stub: the full worked example is added when the host-side authorization layer is built.

1. Re-export `schema.js` from the app's Drizzle schema index and run `db:generate` (three tables, see Data model).
2. Create the service with the app's audit writer and register `createOrganizationsRoutes` with an admin guard and `describeAccounts` (see Configuration).
3. Environment variables: none.
