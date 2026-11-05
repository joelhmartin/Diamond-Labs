# barcode-lookup

One text box that takes a scanned or typed code and finds the records it may
identify. The module owns the registry, the route and the web `ScanBox`; the
host app supplies the resolvers, so the module knows nothing about what the
records are.

## Purpose

A scanner types a code and presses Enter. Several resolvers may recognise the
same code (a number can be an order, an invoice and a tag), so a lookup returns
every hit and the box lets the user choose when there is more than one.

## Public interface

From `index.js`:

- `createLookupRegistry({ log? })` → `{ defineResolver, lookup }`
  - `defineResolver({ key, match(code), resolve(normalized, database) })`:
    `match` returns a normalized value, or `null` when the code is not this
    resolver's shape; `resolve` returns `Hit[]`.
  - `lookup(code, database)` → `{ code, hits }`. Hits are deduped by
    `recordType:recordId`. A resolver that throws is logged by key only and
    skipped, so one broken resolver never fails the lookup.
- `barcodeLookupRoutes(fastify, { registry, path = "/lookup", guard })`

`Hit = { recordType, recordId, title, subtitle?, href }`. Titles must not carry
sensitive personal data; the host decides what is safe to show.

Shared validation: `lookupQuerySchema` in `packages/shared/src/barcode-lookup/schemas.js`
(`code` trimmed, 1-64 printable characters).

Web (`apps/web/src/modules/barcode-lookup`): `<ScanBox placeholder autoFocus onHit? lookupPath? />`.
Enter submits. One hit navigates to its `href`, many hits show a choice list,
none shows "No match for <code>" and keeps focus. It calls `GET {lookupPath}`
(default `/lookup`).

## Configuration

```js
const registry = createLookupRegistry();
registry.defineResolver({ key: "widget", match: (c) => (/^\d+$/.test(c) ? Number(c) : null), resolve: async (n, db) => [] });
await fastify.register(barcodeLookupRoutes, { registry, guard: [authenticate] });
```

## Data model

None. The module stores nothing.

## Wiring it into another app

1. Schema: nothing to re-export or migrate (no tables).
2. Create a registry, define one resolver per record type, and register `barcodeLookupRoutes` with the app's guard and a `path`. Keep the registry in its own file so other code can add resolvers.
3. Render `<ScanBox lookupPath="<the same path>" />` where staff need it. It uses the app's shared `api` client, so the API base is whatever it already points at.
4. Environment variables: none.
5. Worked example, find invoices by number (about five lines of glue):

```js
const registry = createLookupRegistry();
registry.defineResolver({ key: "invoice", match: (c) => (/^\d{1,9}$/.test(c) ? Number(c) : null),
  resolve: async (n, db) => (await db.select().from(invoices).where(eq(invoices.number, n))).map((i) => ({ recordType: "invoice", recordId: i.id, title: `Invoice ${i.number}`, href: `/invoices/${i.id}` })) });
await fastify.register(barcodeLookupRoutes, { registry, path: "/invoices/lookup", guard: STAFF });
// UI: <ScanBox lookupPath="/invoices/lookup" autoFocus />
```
