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

1. Create a registry and define resolvers for your record types.
2. Register `barcodeLookupRoutes` with your auth guard.
3. Render `<ScanBox lookupPath="/your/path" />` where staff need it.
