# Piece 6: Production desk (design)

_2026-11-05 · roadmap: `2026-11-05-lab-parity-roadmap.md` (binding) · builds on
piece 2 (lab orders), piece 3 (invoicing), piece 5 (import) · merges second,
after piece 7_

## Intent

Today the lab can only get a job onto the bench by releasing a doctor's Rx
case or through a paid shop order. In Labzona, staff type cases in by hand
every day (full and quick entry), and they track each one by its **pan** (the
physical tray). They tick off what came in the box, put labels like
"SAMPLE MODEL" or "ATTN" on rows, scan the slip barcode to find a case, and
pick remake and discount reasons from a list. This piece gives the lab all of
that. It is built as four generic modules plus thin lab glue, so the same
modules can be reused for another client.

## Goals

1. Staff create an order for any practice without an Rx. There is a full
   form and a quick one. Products come from the catalog, with client prices
   shown. The order takes a due date (defaulted), pan, enclosed items,
   delivery method, notes and files.
2. Orders have a pan number. It is shown on the board, the order page and the
   slip, it is searchable and scannable, and it is imported from Seazona.
3. Labels and stars work on any record. Admin manages the label vocabulary.
   The board and the order tables filter by labels and apply them in bulk.
4. One scan box resolves an order, invoice or pan barcode to its order.
5. Enclosed items (Impression / Model / Bite / Digital / Other), each with an
   optional date and a short note.
6. Materials and lot numbers per order line.
7. A pick-list of remake and discount reasons. Remake codes carry a default
   discount of 100%. Free text is still allowed.
8. Merge 2–5 open orders for the same practice and patient into one.
9. A scanner-export file drop creates a pending intake with the files
   attached. Staff turn the intake into an order with one click.
10. The lab slip prints the pan, a due-day badge, delivery method, enclosed
    items, materials/lots, labels and "merged from".

## Non-goals

- Scanner-portal APIs (Dexis, iTero, Medit, …). The user deferred them. The
  intake has a parser registry they plug into later.
- Per-step workflow tasks, and the due-date planner itself. Both belong to
  piece 7, through the `defaultDueAt()` seam.
- Notifications and messages (piece 8). Piece 6 calls a no-op `notify()` seam.
- Product settings per line (occlusal contact etc.). The evidence shows 0 use.
- Showing staff-entered orders in the doctor's "My cases". See the rulings.

## What exists today (survey, file:line)

- `lab_orders` (`apps/api/src/db/schema/lab-orders.js:30-74`) has no pan, no
  patient field except `legacy_patient`, no delivery method, no enclosed
  items, and no reason code. `source` + `source_id` are NOT NULL, and there is
  a unique index on `(source, source_id)` for non-remakes.
- Orders are created in three ways: `releaseRxCase`, `createShopLabOrder` and
  `remakeOrder` (`services/lab/lab-orders.service.js`). All go through
  `insertPlan` + `createDraftForLabOrder`. The draft invoice prices lines with
  client prices (`services/billing/invoices.service.js:52-65`).
- Lab order lines are snapshotted at release and **never edited**. Prices live
  on the draft invoice (`DraftLinesEditor.jsx`). An invoice line added there
  does not appear on the order or the slip.
- Remakes are always free: `asRemakeLines` sets unitCents to 0
  (`invoice-rules.js:53`). The remake reason is free text only
  (`labRemakeSchema`, `lab.schema.js`).
- **The work ticket already prints a Code 128 barcode of the order number**
  (`ticket-pdf.js:17-31`, `ticket-model.js:31`). The roadmap's "the lab slip
  prints the barcode" is already true; piece 6 adds what the slip lacks.
- Field edits go through `planFieldChange` with the FIELDS map
  (`lab-order-rules.js:182-213`): one patch plus one `lab_order_events` row,
  with optimistic `version`.
- Free text is sealed through `fieldSealer` (`lab-order-crypto.js`).
- Rx files are uploaded by `uploadCaseFile` (`storage.service.js:34`), which
  is hard-wired to an `rx-cases/` prefix and `rx_case_files`. No other record
  can hold files.
- **There is no server-side due-date default anywhere.** The only one is the
  web `DueDatePicker.jsx:11-16` (14 days out, skip weekends) on the Rx form.
  The roadmap's "existing due logic behind `defaultDueAt()`" does not exist,
  so this piece creates the seam.
- `BulkBar` actions are buttons only (`BulkBar.jsx:23-27`). There is no
  "pick a value" action, which "apply label…" needs. `FilterControl` already
  has `multiselect`.
- The board has its own filter bar (`LabBoardPage.jsx:163-185`). Admin ›
  Orders uses DataTable filters (`AdminOrdersPage.jsx:16-25`).
- The import maps orders in `import/map-orders.js:35-56`. It has no pan, and
  a re-run skips loaded orders (`planOrders`), so a mapping change alone never
  reaches rows that are already loaded.

## Module boundaries

Generic modules have no lab words in them. Each one has a README (purpose,
public interface, configuration, data model, wiring it into another app).

| Module | API (`apps/api/src/modules/…`) | Web (`apps/web/src/modules/…`) | Shared (`packages/shared/src/…`) |
|---|---|---|---|
| `record-tags` | labels (definitions + applications) and per-user stars on `(recordType, recordId)`; SQL filter helpers; routes factory | `TagChips`, `TagPicker`, `StarToggle`, `useTagDefinitions`, `tagBulkActions`, `TagDefinitionsAdmin` | `record-tags/schemas.js` |
| `barcode-lookup` | resolver registry; `lookup(code)`; routes factory | `ScanBox` | `barcode-lookup/schemas.js` |
| `record-files` | private file attachments on `(recordType, recordId)` over the existing private bucket; routes factory | `FileDrop`, `FileList` | `record-files/schemas.js` |
| `upload-intake` | pending intakes made from dropped files; parser registry (`generic` only); promote/discard; routes factory | `IntakeDropZone`, `IntakeQueue` | `upload-intake/schemas.js` |

`record-files` and `upload-intake` are not in the roadmap's table. They are
added because the roadmap's own rule 3 forbids a second file implementation.
Staff orders, intakes and piece 8's message attachments all need "files on a
record", and `rx_case_files` cannot be reused without a lab-specific prefix.

**Lab glue** stays outside the modules:
- `services/lab/staff-order-rules.js`, `staff-orders.service.js`,
  `lab-order-lines.service.js`, `merge-rules.js`, `merge.service.js`,
  `lab-lookups.js`, `lab-tags.js`, `lab-intake.js`, `due-default.js`,
  `materials.service.js`
- `services/billing/adjustment-reasons.service.js`
- `services/notify-seam.js`
- routes in `routes/lab-desk.routes.js`; `lab.routes.js` is already 111
  lines and stays the core.
- web pages under `pages/lab/` and `pages/app/`.

## Data model

### Generic tables

- `tag_definitions`: `id`, `record_type varchar(40)`, `label varchar(40)`,
  `color varchar(20)` (one of a fixed palette key), `position int`,
  `active bool`, timestamps. Unique on `(record_type, lower(label))`.
  Definitions are deactivated, never deleted.
- `record_tags`: `id`, `record_type`, `record_id varchar(128)`, `tag_id`,
  `created_by`, `created_at`. Unique on `(record_type, record_id, tag_id)`,
  plus an index on `(tag_id)`.
- `record_stars`: `record_type`, `record_id`, `user_id`, `created_at`.
  Primary key `(record_type, record_id, user_id)`.
- `record_files`: `id`, `record_type`, `record_id`, `kind varchar(30)`,
  `original_name varchar(255)`, `storage_url text`,
  `content_type varchar(120)`, `size int`, `uploaded_by`, `created_at`.
  Index on `(record_type, record_id)`.
- `intakes`: `id`, `channel varchar(40)` (`upload` now), `status`
  (`pending|promoted|discarded`), `parser_key varchar(40)`, `hints text`
  (sealed JSON), `promoted_record_type`, `promoted_record_id`, `created_by`,
  `created_at`, `decided_by`, `decided_at`, `discard_reason text` (sealed).

### Lab glue columns and tables

- `lab_orders` gains these columns:
  - `pan_number varchar(30)`, indexed
  - `patient_name text`, sealed; used by staff orders
  - `delivery_method varchar(30)`
  - `enclosures text`, sealed JSON `[{ kind, date?, note? }]`
  - `remake_reason_id varchar(128)`
  - `merged_into_order_id varchar(128)`
- `lab_order_line_materials`: `id`, `lab_order_id`, `lab_order_line_id`,
  `position`, `material varchar(120)`, `lot_number varchar(60)`,
  `created_by`, `created_at`. Indexes on `(lab_order_id)` and
  `(material)`.
- `adjustment_reasons`: `id`, `applies_to` (`remake|discount|both`),
  `label varchar(80)`, `discount_percent int null` (0–100), `active`,
  `position`, timestamps. Unique on `lower(label)`. A custom migration seeds
  it (see rulings).
- Shared vocabulary (`packages/shared/src/lab/lab-order-status.js` and a new
  `lab/production-desk.js`):
  - `LAB_ORDER_SOURCES` gains `staff`, with the label "Staff entry".
  - `LAB_ENCLOSED_KINDS = ["impression", "model", "bite", "digital", "other"]`
  - `LAB_DELIVERY_METHODS = ["local_delivery", "ups", "fedex", "pickup", "other"]`
  - `canRemake` stays true for `staff`.
- New `lab_order_events.type` values: `pan`, `delivery`, `enclosed`,
  `lines`, `materials`, `label`, `merge`.

## API routes (all under `/api/v1`)

Generic modules, as mounted by the lab glue:

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/tags/:recordType/definitions` | staff | `?includeInactive=true` |
| POST / PATCH | `/admin/tags/:recordType/definitions[/:id]` | admin | create, rename, recolor, reorder, deactivate |
| POST | `/tags/:recordType/apply` | staff | `{ ids[≤500], add[], remove[] }` → `{ ok, failed }` |
| PUT / DELETE | `/tags/:recordType/:recordId/star` | staff | the caller's own star |
| GET | `/lookup?code=` | staff | → `{ code, hits: [{ recordType, recordId, title, subtitle, href }] }` |
| POST | `/files/:recordType/:recordId` | staff | multipart, ≤10 files, 75 MB each |
| GET | `/files/:recordType/:recordId` | staff | list |
| GET | `/files/:id/url` | staff | 5-minute signed URL; audit-logged |
| DELETE | `/files/:id` | staff | |
| POST | `/intake` | staff | multipart; `split=one\|per_file` |
| GET | `/intake` | staff | paged; `status` filter |
| POST | `/intake/:id/discard` | staff | `{ reason? }` |

Lab glue:

| Method | Path | Notes |
|---|---|---|
| POST | `/lab/orders` | staff entry (full and quick). Returns `{ labOrder: { id, orderNumber }, invoice, panWarning? }` |
| GET | `/lab/orders/default-due` | `{ dueDate }` from `defaultDueAt()` |
| POST | `/lab/orders/price-preview` | `{ clientUserId, lines }` → priced lines (no write) |
| POST | `/lab/orders/:id/lines` | `{ op: add\|update\|remove, …, expectedVersion }`; mirrors onto the draft invoice |
| PUT | `/lab/orders/:id/lines/:lineId/materials` | replaces that line's materials list |
| GET | `/lab/materials/suggestions?q=` | distinct recent materials (20) |
| POST | `/lab/orders/merge` | `{ primaryId, otherIds[1–4], versions: { id: n } }` |
| GET | `/lab/adjustment-reasons` | active reasons |
| POST / PATCH | `/admin/lab/adjustment-reasons[/:id]` | admin |
| PATCH | `/lab/orders/:id` | gains `field: pan \| delivery \| enclosures` |
| POST | `/lab/orders/:id/remake` | gains `reasonId`; needs `reasonId` or `reason` |
| POST | `/admin/invoices/:id/lines` | gains `op: "discount"` `{ reasonId?, text?, percent? \| amountCents? }` |
| GET | `/lab/orders` | gains `tagIds` (comma list, any-of), `starred=true`; `q` also matches pan by prefix; cards gain `panNumber`, `tags`, `starred`, `deliveryMethod` |

## UI screens

- **Production board** (`/lab`):
  - a `ScanBox` in the header
  - label and star filters in its filter bar
  - pan and label chips on cards and table rows
  - bulk "Label…", "Remove label…", "Star" and "Merge…" in each status
    section's BulkBar
- **Admin › Orders**: label (multiselect) and starred filters, a pan column,
  and the same bulk actions.
- **New order** (`/lab/orders/new`, nav "New order"): a Full / Quick toggle
  (`SegmentedControl`).
  - Quick has practice, patient, due, pan and notes.
  - Full adds rush, delivery method, enclosed items, product lines (catalog
    picker showing the client price and its source), labels and files.
  - `?intake=<id>` pre-attaches that intake's files.
- **Order detail**:
  - new panels for production (pan, delivery, enclosed items) and labels/star
  - a lines editor with an add/remove/qty editor and a materials/lots
    sub-row per line
  - a files panel (record files plus the Rx files already shown)
  - "Merged from / into" links
  - the remake modal gains a reason picker
- **Intake** (`/lab/intake`, nav "Intake"): a drop zone and a queue
  (DataTable: when, files, by, status). Row actions: "Create order" and
  "Discard". Bulk discard uses ConfirmButton.
- **Admin › Labels** (`/admin/lab/labels`) and **Admin › Reasons**
  (`/admin/lab/adjustment-reasons`): DataTable lists with inline edit and
  deactivate.
- **Invoice draft editor**: "Add discount" picks a reason, with percent or
  amount and optional text.
- **Shipments page**: the same `ScanBox`.

## Audit rows → coverage

| Audit row | Covered by |
|---|---|
| Orders list: labels, stars, scan/search by invoice/pan, bulk mark/assign | record-tags + board/admin filters + bulk; ScanBox; pan search (bulk move and assign exist already) |
| New order (full entry) | `/lab/orders/new` Full |
| New order (quick entry) | `/lab/orders/new` Quick |
| New order from IOS | upload-intake (file drop → pending intake → order); vendor parsers deferred |
| Merge cases | merge (2–5, same practice and patient) |
| Order detail: pan, delivery, Remake | pan/delivery fields; remake reason picker |
| Products & Services tab (hand-edited lines, typed discounts) | lines editor mirrored onto the draft; discount op with reasons |
| Files / Materials tabs | record-files on lab orders; materials/lots per line |
| Lab slip (barcode, pan, due-day badge, enclosed, files) | slip additions (barcode already printed) |
| Settings › Enclosed & label options | fixed enclosed kinds (shared); label vocabulary admin |
| Settings › Remake policy | adjustment reasons with default percent |
| Reports › Pan Numbers | data now exists; piece 9 registers the report |

## Cutover / import impact

- **Imported:** `panNumber` maps to `pan_number` for every legacy order. A
  live `import:load orders` re-run also **backfills** pan onto legacy orders
  already loaded with a null pan (counted as `panBackfilled`). This is
  needed because staging and the rehearsal database were loaded before this
  mapping existed.
- **Not imported (no API field):** labels, stars, enclosed items,
  materials/lots, remake reason codes, delivery method per order. Staff
  re-enter these:
  1. The label vocabulary, from Labzona's label list (SAMPLE MODEL, ATTN …).
  2. Labels on **open** orders only.
  3. The remake codes beyond the seeded three, from Labzona's Remake Policy
     screen, with their percents.
  4. Enclosed items on open orders, as each case is next touched (not up
     front).

  Stars: none in use. Materials: none visible in Labzona. These steps go
  into `docs/cutover-runbook.md`.
- Pieces 7–10 merge after or around this one. Each regenerates its own
  migrations (roadmap). The adjustment-reasons seed is a **custom**
  migration (`drizzle-kit generate --custom`). When it is regenerated on a
  rebase, it must be recreated with the same SQL, not dropped.

## Rulings

- **Ruling: staff orders are `source: "staff"`, with `source_id` = the order's
  own id, and the patient in a new sealed `patient_name` column.** Why: an Rx
  case row would put a fake prescription in the doctor's "My cases" and drag
  in form/gate logic. Renaming `legacy_patient` touches piece 5 code for no
  gain. Cost if wrong: one later migration to merge `legacy_patient` into
  `patient_name`.
- **Ruling: staff orders are not shown in the doctor portal's "My cases"**
  (it lists Rx cases). Their invoices still reach the doctor as usual. Why:
  Labzona shows no evidence that clients look at staff-entered orders, and a
  portal view of non-Rx orders is a separate screen. Cost if wrong: one
  read-only portal list; piece 8's threads can link in meanwhile.
- **Ruling: lab order lines become editable** (add, qty, remove) on
  non-legacy orders that are not shipped or cancelled. Each edit mirrors onto
  the order's **draft** invoice through `labOrderLineId`, and is refused once
  the invoice is issued. Why: quick entry creates orders with no lines, and
  Labzona's Products tab is hand-edited daily. Lines added only on the invoice
  never reach the bench or slip. Cost if wrong: if the lab really wants bench
  lines and billed lines to differ, staff can still edit the invoice
  directly; nothing is removed.
- **Ruling: the client is required on staff entry**, and it must be an
  existing doctor user. Unowned walk-ins go through the shop. Why: pricing,
  invoices and statements all key off `clientUserId`. Cost if wrong: an
  "unassigned practice" placeholder user.
- **Ruling: `defaultDueAt({ startAt, rush })` lives in
  `services/lab/due-default.js` and is the only due default on the server.**
  It returns the start day in the lab's timezone + 13 calendar days, moved
  forward off Saturday/Sunday. Rush is ignored. 13 days is Labzona's lead
  time. Piece 7 repoints the body to `planFor`. Why: no server default exists
  today. Cost if wrong: one function body. The web `DueDatePicker` keeps its
  own 14-day guess on the Rx form, a known second copy that piece 7 replaces.
- **Ruling: pan numbers are not unique.** Pans are reused trays. Entry warns
  (`panWarning`) when another **open** order holds the same pan, and never
  blocks. Why: history repeats pans, and a unique index would fail the
  import. Cost if wrong: a partial unique index on open orders later.
- **Ruling: tags and stars do not bump `lab_orders.version`.** Labelling is
  not a conflicting edit, and bumping would make every bulk label throw STALE
  at other technicians. The change is still recorded as a `label` event
  through the module's `onChange` hook. Cost if wrong: a stale label chip
  until refresh.
- **Ruling: stars are per user** (`record_stars.user_id`). Why: "Starred" in
  Labzona is a personal view, and piece 9's per-user report favourites can
  reuse the same table (`recordType: "report"`). Cost if wrong: add a shared
  flag.
- **Ruling: the enclosed-item kinds are a fixed shared list**, not admin
  vocabulary. Labzona's settings show exactly these five, unchanged. Cost if
  wrong: move them to `tag_definitions`-style admin rows.
- **Ruling: materials and lot numbers are plain text, length-capped and
  labelled "material name / lot", not sealed.** They name products, not
  people. Edits are allowed on shipped orders (traceability is often
  recorded late), but not on cancelled ones. Cost if wrong: seal two columns.
- **Ruling: remake pricing uses the reason's `discount_percent`; no reason, or
  a null percent, means 100%.** This is today's behaviour, now
  `asRemakeLines(priced, percent = 100)`. Discounts on drafts compute the
  amount server-side from the item-line subtotal when a percent is given.
  Why: money stays in integer cents on the server. Cost if wrong: one
  default.
- **Ruling: reasons are seeded by a custom migration** so every environment
  has them. The seed is three remake codes at 100% (Lab error, Change of
  occlusion, Client/patient error), plus discounts from the import's free
  text (Courtesy, VA patient, Model, Family, Employee at no default percent,
  and "No charge for remake" at 100%, `both`). Initials in the evidence
  ("per MR") are dropped. Cost if wrong: admin edits rows.
- **Ruling: merge keeps a chosen primary.** The others' lines are appended
  to it and the others are cancelled ("Merged into #P"), with
  `merged_into_order_id` set. Their draft invoices are voided by the
  existing cancel follow-up, and the moved lines are added to the primary's
  draft. Labels are unioned, record files are relinked, due becomes the
  earliest, and rush becomes the OR. Refused when:
  - the practices or patients differ
  - an order is a shop, legacy, terminal or labelled order
  - an invoice is not a draft

  Why: this is the smallest merge that keeps billing and history true. Cost
  if wrong: merge is rare (LIGHT USE), so it can be revisited.
- **Ruling: a "draft order" from the scanner drop is an `intakes` row, not a
  lab order.** Promoting it opens New order prefilled, and the order is
  created with `intakeId` in the same transaction. Why: no order number is
  burned on junk uploads, there is no new status in the shared status table,
  and nothing lands on the board. Cost if wrong: a `draft` status later.
- **Ruling: the `generic` intake parser extracts no hints.** It only lists
  files. Vendor parsers plug into the registry later. Why: guessing patient
  fields from unknown XML is worse than typing them. Cost if wrong: none
  until a vendor format is known.
- **Ruling: the slip keeps one barcode (the order number)** and prints the
  pan large beside it. Lookup resolves both. Cost if wrong: a second
  barcode block.
- **Ruling: `notify()` is a no-op seam in `services/notify-seam.js`**. It is
  called on `intake.created` only, because a staff-entered order needs no
  alert to staff. If piece 7 has already created the same seam file on
  rebase, use theirs. Piece 8 repoints it.
