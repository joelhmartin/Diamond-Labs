# record-tags (web)

## Purpose

The browser half of the record-tags module: colored labels and per-user stars
on any `(recordType, recordId)`. Components take the record type as a plain
string and know nothing about what the records are. The server half, routes and
data model are in `apps/api/src/modules/record-tags/README.md`.

## Public interface

Everything is exported from `index.js`.

- `<TagChips tags />` read-only chips for `[{ id, label, color }]`.
- `<TagPicker recordType value onChange applied? disabled? />` toggle chips over
  the active labels; controlled (`value` is tag ids, `onChange(nextIds)`).
  `applied` keeps an already-applied inactive label visible so it can be removed.
- `<StarToggle recordType recordId starred onChanged? />` the caller's own star.
- `<TagDefinitionsAdmin recordType />` add, rename, recolor and deactivate labels.
- `useTagDefinitions(recordType, { includeInactive })` → `{ definitions, loading, error, reload }`.
- `tagBulkActions(selectedRows, { recordType, definitions, after?, labelOf?, client? })`
  → BulkBar actions "Label…", "Remove label…" (both pick-a-value `choices`) and
  "Star". Rows are `{ id, tags? }`; "Remove label…" offers the labels the
  selected rows carry. Applies post one request per 500 ids and return
  `{ ok, failed }` for the BulkBar toast; `labelOf(row)` names failed rows.
- `tagColorClass(color)` maps a palette key to chip classes.

## Configuration

Props only. The palette keys come from `TAG_COLORS` in `@my-app/shared`.
Requests go to `/tags/:recordType/...` (staff) and `/admin/tags/:recordType/...`
(admin, used only by `TagDefinitionsAdmin`).

## Data model

None in the browser. A host list row carries `tags: Tag[]` and `starred: boolean`
(the host's list endpoint joins `tagsFor` / `starsFor`).

## Wiring it into another app

1. Register the server routes for the record type (see the API README).
2. Have the list endpoint return `tags` and `starred` per row and accept
   `tagIds` / `starred` filters (`taggedWithAny` / `starredBy`).
3. Show `TagChips` in rows, `TagPicker` + `StarToggle` on the record page, spread
   `tagBulkActions(...)` into the table's `bulkActions`, and mount
   `TagDefinitionsAdmin` on an admin page.
