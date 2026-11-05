# record-tags

## Purpose

Colored labels (admin-managed vocabulary) and per-user stars on any
`(recordType, recordId)`. The module knows nothing about what the records are:
record types are plain strings the host app passes in, and the host supplies
how to check a record exists and what to do when its labels change.

## Public interface

Everything is exported from `index.js`. Service functions take an optional
`database` as the last argument (defaults to the app db).

- `listDefinitions(recordType, { includeInactive = false })` → `Tag[]`
  where `Tag = { id, recordType, label, color, position, active }`
- `createDefinition({ recordType, label, color })`, `updateDefinition(id, patch, recordType, database)`
  (rename, recolor, reorder, deactivate; rows are never deleted)
- `tagsFor(recordType, ids)` → `Map<recordId, Tag[]>` (includes inactive tags already applied)
- `starsFor(recordType, ids, userId)` → `Set<recordId>`
- `applyTags({ recordType, ids, add, remove, byUserId, exists, onChange })` → `{ ok, failed }`
  - `exists(ids)` returns the `Set` of ids that exist; the rest land in `failed` as `{ id, message: "not found" }`
  - `onChange(tx, [{ recordId, added, removed }], { byUserId })` runs in the same transaction as the writes
  - at most 500 ids; tags must belong to `recordType`; inactive tags can be removed but not added
- `setStar({ recordType, recordId, userId, starred })`
- `taggedWithAny(recordType, idColumn, tagIds)` and `starredBy(recordType, idColumn, userId)`
  return Drizzle `exists(...)` conditions to AND into a host list query
- `planApply`, `normalizeLabel`, `assertUniqueLabel`, `TagError` (codes `NOT_FOUND`, `INVALID`, `CONFLICT`)
- `recordTagRoutes(fastify, { recordTypes, staffGuard, adminGuard, service?, audit? })`

Shared validation lives in `packages/shared/src/record-tags/schemas.js`
(`tagDefinitionCreateSchema`, `tagDefinitionUpdateSchema`, `tagApplySchema`, `TAG_COLORS`).

## Routes

| Method | Path | Guard |
|---|---|---|
| GET | `/tags/:recordType/definitions` (`?includeInactive=true`) | `staffGuard` |
| POST | `/admin/tags/:recordType/definitions` | `adminGuard` |
| PATCH | `/admin/tags/:recordType/definitions/:id` | `adminGuard` |
| POST | `/tags/:recordType/apply` `{ ids, add, remove }` | `staffGuard` |
| PUT / DELETE | `/tags/:recordType/:recordId/star` (the caller's own star) | `staffGuard` |

An unknown `:recordType` is a 404. `TagError` codes map to 404 / 409 / 422.

## Configuration

```js
await fastify.register(recordTagRoutes, {
  recordTypes: {
    // one entry per record type the host labels
    widget: {
      exists: async (ids) => new Set(/* ids found in the host's table */),
      onChange: async (tx, changes, { byUserId }) => { /* optional: record history in the same tx */ },
    },
  },
  staffGuard: [authenticate, requireRole(...)],   // preHandler function or array
  adminGuard: [authenticate, requireAdmin],
  audit: (request, action, targetId, metadata) => {}, // optional; ids and fields only
});
```

## Data model

- `tag_definitions`: id, record_type, label (<= 40), color (palette key), position, active, timestamps. Unique on `(record_type, lower(label))`.
- `record_tags`: id, record_type, record_id, tag_id, created_by, created_at. Unique on `(record_type, record_id, tag_id)`; index on `tag_id`.
- `record_stars`: record_type, record_id, user_id, created_at. Primary key `(record_type, record_id, user_id)`.

No database foreign keys (repo convention). Tags and stars never touch the host
record's own row or version; the host records history through `onChange`.

## Wiring it into another app

1. Re-export `schema.js` from the app's Drizzle schema index and run `db:generate` (three tables, see Data model).
2. Register `recordTagRoutes` with the app's two guards and a `recordTypes` map (see Configuration).
3. Mount the web components (`TagChips`, `TagPicker`, `StarToggle`, `TagDefinitionsAdmin`, `tagBulkActions`). They call the app's shared `api` client, so the API base is whatever that client already points at.
4. Environment variables: none.
5. Worked example, add labels to invoices (about five lines of glue):

```js
// 1. schema index:  export * from "../../modules/record-tags/schema.js";
await fastify.register(recordTagRoutes, {
  recordTypes: { invoice: { exists: async (ids) => new Set((await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.id, ids))).map((r) => r.id)) } },
  staffGuard: STAFF, adminGuard: ADMIN,
});
// list route: tags = await tagsFor("invoice", ids); starred = await starsFor("invoice", ids, userId)
// UI: <TagChips tags={row.tags} /> in the row, <TagDefinitionsAdmin recordType="invoice" /> on an admin page
```

## Web

`apps/web/src/modules/record-tags/` is the browser half: see its
[README](../../../../web/src/modules/record-tags/README.md) (`TagChips`, `TagPicker`,
`StarToggle`, `tagBulkActions`, `TagDefinitionsAdmin`).
