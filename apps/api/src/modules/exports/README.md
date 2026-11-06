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
    params: [{ name, label, type, options?, required? }],  // report param specs (PARAM_TYPES)
    paramsSchema,   // zod; params are validated against it before any read
    fields: [{ key, label, type, timeZone? }],             // type is a column type (COLUMN_TYPES)
    fetchPage(db, params, { limit, offset }) -> Promise<{ rows, total }>,
  })
  ```

  Params and fields share the reports module's vocabulary (both lists live in
  `packages/shared/src/reports`), so the web draws an export's params with the
  same controls as a report's, and a cell is written the way a report column's
  is: `money` is integer cents written "1234.50", `int` a number, `date` a
  calendar day (in the field's `timeZone`, default UTC), `text` as is.
  `defineSource` throws on an unknown field or param type or a param without a
  `name`. The query keys are the param names; the screen sends a multiselect
  comma-joined, so a `paramsSchema` should accept a comma list.

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
  validates, reads the first page, and returns
  `{ filename, contentType, params, stream, countPromise }`. It throws
  `ExportError` with code `EXPORT_SOURCE_UNKNOWN` (404),
  `EXPORT_FORMAT_UNSUPPORTED` (422) or `EXPORT_PARAMS_INVALID` (422), and a
  failing first read rejects too, so the route answers with an error rather
  than an empty file. Pages after the first stop at the first page's `total`.
  `countPromise` resolves with the rows written when the stream ends or is
  abandoned.
- The paging and writing are the shared paged writer,
  `openExportStream({ source, format, readPage, pageSize, maxRows? })` in
  `packages/shared/src/exports/stream.js`, and the built-in format is
  `csvFormat` from `packages/shared/src/exports/csv-format.js` (re-exported
  here). The reports module writes its CSV through the same two, so a report's
  file and an export's are built by one implementation.
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

## Wiring it into another app

The module has three parts: this server module, the pure writer in
`packages/shared/src/exports` (the CSV field encoder, the paged writer and the
CSV format), and the screen in `apps/web/src/modules/exports`. Everything
app-specific lives in the app's own glue directory (here
`apps/api/src/exports/`), never inside the module.

1. **Copy the code.** Copy `apps/api/src/modules/exports`,
   `packages/shared/src/exports` and the shared report vocabulary it builds on,
   `packages/shared/src/reports` (column and param types, `csvValue`) with
   `packages/shared/src/money.js`; plus `apps/web/src/modules/exports` and the
   param controls in `apps/web/src/components/ui/params` for the screen.
   Re-export `exports/csv.js`, `exports/csv-format.js`, `exports/stream.js`
   and `reports/index.js` from the shared package's index: the module and any
   client-side CSV import their helpers from there.
2. **Create the registry in the app's glue.** One file builds it once and
   registers the built-in format:

   ```js
   import { createExportRegistry, csvFormat } from "../modules/exports/index.js";
   export const appExports = createExportRegistry();
   appExports.defineFormat(csvFormat);
   ```

3. **Define one source per query.** Each `defineSource` call gives a `key`,
   a `label`, the `params` the screen draws, a zod `paramsSchema`, the
   `fields` that make up a row and a `fetchPage(db, params, { limit, offset })`
   with a stable order (see the source contract above). Keep each source in
   its own glue file and register it beside the format.
4. **Mount the routes.** Register
   `createExportsRoutes({ registry: appExports, db, preHandler, audit })` under
   the app's API prefix. `preHandler` is the app's own guard (for example
   authenticate plus an admin check); `audit` records who downloaded what, with
   the source, format, params and row count and never row data.
5. **Render the screen.** A page renders
   `<ExportScreen basePath="/admin/exports" defaultSource="<key>" />`, where
   `basePath` is the mounted route prefix. The screen reads everything else
   from `GET <basePath>`.

**Sources choose which fields leave the app.** A downloaded file is outside
the app's encryption, access control and audit trail. A source lists only the
columns its readers need, and sensitive columns (personal or health details,
free-text notes, secrets, payment tokens) are left out by default. Adding
one is a deliberate change to that source, reviewed as such, ideally behind an
explicit option that the audit records. The CSV writer already neutralises
text that starts with `=`, `+`, `-` or `@` so a spreadsheet does not run it as
a formula; numbers are written as numbers.

To add a format, follow "Adding a format" above: one file in the app's glue
and one `defineFormat` call next to `csvFormat`.
