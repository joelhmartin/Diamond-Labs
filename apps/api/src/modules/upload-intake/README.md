# upload-intake

## Purpose

A drop of files (for example a scanner export) becomes a pending "intake" that
a person later turns into a record or discards. Nothing about the record is
created until a person promotes the intake, so junk uploads burn no numbers and
show up nowhere else. The module knows nothing about what the record is: the
host passes the record type and id when it promotes.

## Public interface

Everything is exported from `index.js`. Service functions take an optional
`database` as the last argument (defaults to the app db).

- `createIntakes({ files, split, channel, byUserId, parsers, storage }, database)`
  → `{ intakes, refused }`. `split` is `"one"` (one intake for all files) or
  `"per_file"`. A file with an unaccepted extension is refused by name and the
  rest proceed; a group whose upload fails is reported in `refused` and leaves
  no row. Files are stored with `record-files` under record type `"intake"`.
- `listIntakes({ status, limit, offset })` → `{ rows, total }`, newest first,
  each row with its `files`.
- `discardIntake(id, { reason, byUserId })`: only a pending intake can be discarded.
- `promoteIntake(tx, id, { recordType, recordId, byUserId })`: a conditional
  update `where status = 'pending'`, then the intake's files are relinked to the
  new record. A second promote throws `IntakeError("CONFLICT", "Already used.")`.
  Call it inside the same transaction that creates the record.
- `intakeIdsThatExist(ids)` for the host's `record-files` record-type map.
- `defineIntakeParser({ key, accepts(file), parse(files) })`, `createParserRegistry`,
  `defaultParsers`, `genericParser`: the parser registry. `generic` accepts
  everything and extracts only the file names.
- `intakeRoutes(fastify, { staffGuard, path?, onCreated?, onDiscarded?, enrich?, service? })`
- `IntakeError` (codes `NOT_FOUND`, `CONFLICT`, `INVALID`, `TOO_LARGE`), `intakeErrorReply`

Accepted extensions: `.zip .xml .html .htm .pdf .stl .ply .obj`. Validators and
constants live in `packages/shared/src/upload-intake/schemas.js`.

`hints` and the discard reason are encrypted at rest with the app's generic
field sealer (`lib/crypto.js`); the module cannot be used without sealing.

## Routes

| Method | Path | Notes |
|---|---|---|
| POST | `/intake` | multipart; any field name carries a file; a `split` field (`one` or `per_file`); up to 10 files of 75 MB; replies `{ intakes, refused }` |
| GET | `/intake` | paged (`limit`, `offset`), `status` filter |
| POST | `/intake/:id/discard` | `{ reason? }` |

The path is configurable. All routes use `staffGuard`.

## Configuration

```js
await fastify.register(intakeRoutes, {
  staffGuard: [authenticate, requireRole(...)],
  onCreated: (request, intakes) => {},   // the host notifies (ids only)
  onDiscarded: (request, id) => {},      // the host audit-logs
  enrich: async (rows) => rows,          // optional: add display fields such as who dropped it
});
```

Mount `record-files` for record type `"intake"` too, so the queue and the
record form can list and open an intake's files.

## Data model

- `intakes`: id, channel (`upload`), status (`pending|promoted|discarded`), parser_key, hints (sealed JSON), promoted_record_type, promoted_record_id, created_by, created_at, decided_by, decided_at, discard_reason (sealed). Index on `(status, created_at)`.

No database foreign keys (repo convention). Hints and reasons can name a person, so the staging scrub deletes every row.

## Web

`apps/web/src/modules/upload-intake/`: `<IntakeDropZone basePath onDropped />` (drop
zone with a one-intake / one-per-file choice; reports refused files) and
`<IntakeQueue basePath createHref />` (a `DataTable` of intakes with a
"Create order"-style link per row, per-row discard, and bulk discard behind a
confirm click).

## Wiring it into another app

1. Re-export `schema.js` from the app's Drizzle schema index and run `db:generate`. Install `record-files` first: intake files are stored through it.
2. Register `intakeRoutes` with a guard and `path`, and register `recordFileRoutes` with a record type `"intake"` whose `exists` is `intakeIdsThatExist`.
3. Where the record is created, call `promoteIntake(tx, intakeId, { recordType, recordId, byUserId })` in the same transaction. Mount `<IntakeDropZone>` and `<IntakeQueue>` on a page and point the queue's `createHref` at the record form. They use the app's shared `api` client, so the API base is whatever it already points at.
4. Environment variables: the same as `record-files` (`RX_GCS_BUCKET`, the private bucket), plus `PHI_ENCRYPTION_KEY`, the key behind `lib/crypto.js` (the module seals hints and discard reasons with it and cannot run without it).
5. Worked example, a drop queue for invoices (about five lines of glue):

```js
await fastify.register(recordFileRoutes, { recordTypes: { intake: { exists: intakeIdsThatExist } }, staffGuard: STAFF });
await fastify.register(intakeRoutes, { staffGuard: STAFF, path: "/invoice-intake" });
// create-invoice route, inside its transaction: await promoteIntake(tx, body.intakeId, { recordType: "invoice", recordId: invoice.id, byUserId });
// UI: <IntakeDropZone basePath="/invoice-intake" /> and <IntakeQueue basePath="/invoice-intake" createHref={(row) => `/invoices/new?intake=${row.id}`} />
```
