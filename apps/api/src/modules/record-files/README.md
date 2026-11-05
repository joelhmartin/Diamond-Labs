# record-files

## Purpose

Private file attachments on any `(recordType, recordId)`, stored in the app's
private bucket and served only through short-lived signed links. The module
knows nothing about what the records are: record types are plain strings the
host app passes in, and the host supplies how to check a record exists and how
to audit a read.

## Public interface

Everything is exported from `index.js`. Service functions take an optional
`database` as the last argument (defaults to the app db).

- `attachFiles({ recordType, recordId, files: [{ kind, buffer, originalName, contentType }], byUserId }, database)`
  → `FileRow[]`. Uploads first, then inserts; if an upload or the insert fails,
  the objects already uploaded are deleted.
- `filesFor(recordType, ids)` → `Map<recordId, FileRow[]>` (oldest first)
- `relinkFiles(tx, { fromType, fromId, toType, toId })` → count of rows moved; storage is not touched
- `getFile(fileId)` → `FileRow`
- `signedUrlFor(fileId)` → `{ url, file }`; the link is valid for 5 minutes
- `removeFile(fileId)`: deletes the row, then the object (best effort)
- `recordFileRoutes(fastify, { recordTypes, staffGuard, onRead?, onChange?, service? })`
- `FileError` (codes `NOT_FOUND`, `INVALID`, `TOO_LARGE`), `fileErrorReply`

`FileRow = { id, recordType, recordId, kind, originalName, contentType, size, createdAt }`.
The storage url is never returned.

Limits and the kind validator live in `packages/shared/src/record-files/schemas.js`
(`MAX_FILE_SIZE_BYTES` 75 MB, `RECORD_FILES_MAX_COUNT` 10, `recordFileKindSchema`).
The same constant is used by any other upload route in the app.

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/files/:recordType/:recordId` | list |
| POST | `/files/:recordType/:recordId` | multipart; each part's field name is its `kind`; up to 10 files of 75 MB |
| GET | `/files/:recordType/:recordId/:fileId/url` | issues a signed link and calls `onRead` |
| DELETE | `/files/:recordType/:recordId/:fileId` | |

An unknown `:recordType`, a record that does not exist, or a file that belongs
to a different record is a 404. All routes use `staffGuard`.

## Configuration

```js
await fastify.register(recordFileRoutes, {
  recordTypes: {
    // one entry per record type the host attaches files to
    widget: { exists: async (ids) => new Set(/* ids found in the host's table */) },
  },
  staffGuard: [authenticate, requireRole(...)],
  onRead: (request, file) => {},   // audit hook: the host logs who opened which file (ids only)
  onChange: (request, { action, recordType, recordId, fileIds }) => {},  // optional
});
```

The object key is `record-files/<recordId>/<kind>/<uuid>-<name>` in the bucket
configured for `storage.service.js`; a local-disk fallback is used in dev.

## Data model

- `record_files`: id, record_type, record_id, kind (<= 40), original_name, storage_url (internal), content_type, size, created_by, created_at. Index on `(record_type, record_id)`.

No database foreign keys (repo convention). File names can identify a person, so
the staging scrub deletes every row.

## Web

`apps/web/src/modules/record-files/`: `<FileDrop accept maxFiles onFiles />` (drag
and drop, inline size/count messages) and `<FileList recordType recordId />`
(lists files, opens the signed link, optional delete).

## Wiring it into another app

1. Re-export `schema.js` from the app's Drizzle schema index and run `db:generate`.
2. Register `recordFileRoutes` with a `recordTypes` map, a guard and an `onRead` audit hook (see Configuration). The routes are nested under the record: `/files/:recordType/:recordId[/:fileId[/url]]`.
3. Render `<FileList recordType recordId />` and `<FileDrop />` where the record is shown. They use the app's shared `api` client, so the API base is whatever it already points at. Use `attachFiles` directly when an upload arrives as part of a larger submission.
4. Environment variables: `RX_GCS_BUCKET`, the app's private bucket, read by `services/storage.service.js` (declared in `config/env.js`). Unset, files go to local disk with a warning, which is fine in dev only.
5. Worked example, attach files to invoices (about five lines of glue):

```js
await fastify.register(recordFileRoutes, {
  recordTypes: { invoice: { exists: async (ids) => new Set((await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.id, ids))).map((r) => r.id)) } },
  staffGuard: STAFF, onRead: (request, file) => audit(request, "invoice.file.open", file.id),
});
// UI: <FileList recordType="invoice" recordId={invoice.id} /> on the invoice page
```
