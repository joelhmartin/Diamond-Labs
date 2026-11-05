# exports

## Purpose

Named export formats over a query. An app registers **sources** (what can be
exported: a keyed query with typed fields and parameters) and **formats** (how
rows are written: CSV built in). The module validates parameters, reads a
source one page at a time, and streams the file, so a very large export never
loads all rows at once. It knows nothing about any application's data.

## Public interface

```js
import { createExportRegistry, csvFormat, createExportsRoutes, runExport, previewExport } from "../modules/exports/index.js";
```

- `createExportRegistry()` returns `{ defineSource(def), defineFormat(def), source(key), format(key), list() }`.
  Defining a duplicate key throws. `list()` returns
  `[{ key, label, params, fields, formats: [{ key, label, extension }] }]`,
  where `formats` holds only the formats whose `supports(source)` accepts that source.
- **Source contract**

  ```
  defineSource({
    key, label,
    params: [{ id, label, type: "date" | "select" | "multiselect", options?, required? }],
    paramsSchema,   // zod; params are validated against it before any read
    fields: [{ key, label, type: "text" | "cents" | "date" | "int" }],
    fetchPage(db, params, { limit, offset }) -> Promise<{ rows, total }>,
  })
  ```

  `fetchPage` must use a stable order so pages do not overlap or skip.
  A param named `from` plus one named `to` name the download file
  (`<key>-<from>-<to>.<ext>`); otherwise it is `<key>.<ext>`.
- **Format contract**

  ```
  defineFormat({
    key, label, extension, contentType,
    bom?,                          // true writes a UTF-8 byte order mark first
    supports(source) -> boolean,
    header?(source) -> string,     // no line ending; the service adds one
    serializeRow(row, source) -> string,
    footer?(source) -> string,
  })
  ```

- `runExport({ registry, db, sourceKey, formatKey, params, pageSize = 1000 })`
  returns `{ filename, contentType, params, stream, countPromise }`. It throws
  `ExportError` with code `EXPORT_SOURCE_UNKNOWN` (404),
  `EXPORT_FORMAT_UNSUPPORTED` (422) or `EXPORT_PARAMS_INVALID` (422).
  `countPromise` resolves with the rows written when the stream ends or is
  abandoned.
- `previewExport({ registry, db, sourceKey, params, limit, offset })` returns
  `{ rows, total, fields }`.
- `createExportsRoutes({ registry, db, preHandler, audit, pathPrefix = "/exports" })`
  returns a Fastify plugin with `GET <prefix>`, `GET <prefix>/:source/preview`
  and `GET <prefix>/:source/download.:format`. `preHandler` guards every route.
  `audit({ actorId, sourceKey, formatKey, params, rowCount })` is called once
  a download stream ends.

## Configuration

None.

## Data model

None. The module is stateless; sources own their queries.

## Adding a format

A new accounting layout is one file in the app plus one `defineFormat` call;
no module code changes. Take a QuickBooks IIF export. IIF is tab-separated and
a transaction is a block: a `!TRNS` header row, a `!SPL` header row and an
`!ENDTRNS` header row, then for each record one `TRNS` row, one `SPL` row per
split and an `ENDTRNS` row. Define the format with
`supports: s => s.key === "sales"` so it only appears for the source it fits.
Put the three header rows in `header(source)`. In `serializeRow(row, source)`
map the source's `fields` keys onto the columns (for example a `date` field to
the TRNS date, a `total` field in cents to the amount, converted with
`toDecimalString`), and return the whole block as one string joined with
newlines. Set `extension: "iif"` and a `contentType` of `text/plain`. Register
it next to the CSV format when the app builds its registry, and it shows up in
`list()` and the download route automatically.

## Wiring into another app

(Filled in when the module is wired a second time.)
