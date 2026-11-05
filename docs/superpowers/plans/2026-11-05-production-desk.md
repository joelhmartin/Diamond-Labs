# Production Desk (piece 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab staff enter orders by hand (full and quick). They track pans,
enclosed items, materials and lots. They label, star, scan and merge cases.
They pick remake and discount reasons from a list, and turn scanner-export
drops into orders. All of it is built on four generic modules: `record-tags`,
`barcode-lookup`, `record-files` and `upload-intake`.

**Architecture:** Each generic module lives in three places:
- `apps/api/src/modules/<name>/`: service, pure rules, `routes.js` factory,
  `schema.js` and `README.md`
- `apps/web/src/modules/<name>/`
- `packages/shared/src/<name>/schemas.js`

Lab glue lives in `services/lab/*`, `routes/lab-desk.routes.js` and the lab
pages. Order changes reuse `mutate`/`planFieldChange`/`lab_order_events`.
Billing changes reuse the draft-invoice path in
`services/billing/invoices.service.js`.

**Tech Stack:** Fastify 5, Drizzle (postgres.js), zod via `@my-app/shared`,
vitest; React 18 + Vite + Tailwind, `DataTable`/`useDataTable`, lucide-react;
pdfkit (existing `pdf-layout.js`).

**Spec:** `docs/superpowers/specs/2026-11-05-production-desk-design.md` (read
it first; its rulings are binding here). Roadmap:
`docs/superpowers/specs/2026-11-05-lab-parity-roadmap.md`.

## Global Constraints

**Code rules**
- Generic modules contain no lab/doctor/dental/patient words. Their record
  types are strings the glue passes in, such as `"lab_order"` or `"intake"`.
- Every list uses `DataTable` + `useDataTable`. A table feature that is
  missing is added to the shared component (Task 8 adds BulkBar menu
  actions), never written as a one-off.
- Never use `alert()`, `confirm()` or `prompt()`. Destructive steps use
  `ConfirmButton`, and messages use `useToast()`.
- Files stay under 1,000 lines and functions under 150 (300 for a component
  with its markup).
- Money is integer cents and is computed on the server.

**PHI**
- No PHI in logs, audit metadata, events or toasts.
- `patient_name`, `enclosures`, `intakes.hints` and
  `intakes.discard_reason` are sealed with `fieldSealer`.
- Audit metadata carries ids, fields and versions only.
- Patient names are never server-searchable.

**Seazona and migrations**
- Nothing calls Seazona. The import only reads the raw store.
- Migrations: `cd apps/api && pnpm db:generate`. The reasons seed is
  `pnpm drizzle-kit generate --custom --name=seed_adjustment_reasons`. When
  rebasing after piece 7, drop this piece's generated SQL and journal
  entries, regenerate, and recreate the custom seed with identical SQL.

**Commands**
- API tests: `pnpm --filter @my-app/api test -- <path>`
- Web tests: `pnpm --filter @my-app/web test -- <path>`
- Web build: `pnpm --filter @my-app/web build` must pass at the end of every
  web task.

**Git**
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push only with `git push origin <branch>`.

**Values the spec pins**
- `LAB_ENCLOSED_KINDS = ["impression","model","bite","digital","other"]`
- `LAB_DELIVERY_METHODS = ["local_delivery","ups","fedex","pickup","other"]`
- Default lead time is 13 calendar days, rolled off Sat/Sun.
- Merge takes 2–5 orders.
- Tag apply takes ≤500 ids. Uploads are ≤10 files at 75 MB each.
- `pan_number varchar(30)`.

## Review Focus

1. **Pan import on a re-run:** loaded legacy orders whose pan is null get it
   backfilled, and a pan that is already set is never overwritten (Task 3
   test `backfill fills only null pans`).
2. **Line edit after the invoice was issued:** the order line must not change
   and the request returns 422 with "invoice already issued". Line edits
   must never leave the bench and the bill disagreeing (Task 5 test
   `line add refuses when the draft is issued and writes nothing`).
3. **Bulk label over 500 ids, or with a tag from another record type, or an
   inactive tag:** refused before any write. Ids that no longer exist come
   back in `failed`, and the rest apply (Task 1 tests).
4. **Merge where one order changed since the modal opened, or the patients
   differ only by case or spacing:** a STALE refusal with nothing written;
   names are compared normalised (Task 9 tests).
5. **A scan of a bare number that is both an order number and a pan:** every
   hit is listed, and the page does not jump to the first one (Task 4 test
   `ambiguous code returns all hits`; `ScanBox` test `many hits render a
   choice list`).

---

### Task 1: `record-tags` module (API) + README

**Files:**
- Create: `apps/api/src/modules/record-tags/schema.js`, `rules.js`,
  `service.js`, `routes.js`, `index.js`, `README.md`
- Create: `packages/shared/src/record-tags/schemas.js`; export from
  `packages/shared/src/index.js`
- Modify: `apps/api/src/db/schema/index.js` (re-export the module schema)
- Migration: generated (`tag_definitions`, `record_tags`, `record_stars`)
- Test: `apps/api/src/modules/record-tags/rules.test.js`,
  `routes.test.js`

**Interfaces:**
- Produces (service, `database` is an optional last arg defaulting to
  `config/database.js` `db`):
  - `listDefinitions(recordType, { includeInactive = false })` →
    `Tag[]`, where `Tag = { id, recordType, label, color, position, active }`
  - `createDefinition({ recordType, label, color })`,
    `updateDefinition(id, patch)`. Rows are never deleted.
  - `tagsFor(recordType, ids)` → `Map<recordId, Tag[]>` (roadmap name;
    includes inactive tags that are already applied)
  - `starsFor(recordType, ids, userId)` → `Set<recordId>`
  - `applyTags({ recordType, ids, add = [], remove = [], byUserId, exists, onChange })`
    → `{ ok, failed: [{ id, message }] }`
    - `exists(ids)` → `Set` of ids that exist
    - `onChange(tx, [{ recordId, added: Tag[], removed: Tag[] }])` runs in
      the same transaction
  - `setStar({ recordType, recordId, userId, starred })`
  - `taggedWithAny(recordType, idColumn, tagIds)` and
    `starredBy(recordType, idColumn, userId)` → Drizzle `SQL` `exists(...)`
    conditions
- Produces (routes): `recordTagRoutes(fastify, { recordTypes: { [type]: { exists, onChange } }, staffGuard, adminGuard })`.
  It mounts the 4 route groups in the spec's table.
- Produces (shared): `tagDefinitionCreateSchema`, `tagDefinitionUpdateSchema`,
  `tagApplySchema` (`ids` 1–500, `add`/`remove` arrays of ids, at least one
  of them non-empty), `TAG_COLORS` (8 palette keys).

- [ ] **Step 1: Write failing rule tests** in `rules.test.js` for the pure
  `planApply({ definitions, current, ids, add, remove, existing })`:
  - `refuses a tag from another record type` (throws `TagError("INVALID")`)
  - `refuses adding an inactive tag but allows removing one`
  - `missing ids land in failed and the rest apply`, where
    `failed[0].message === "not found"`
  - `adding an already-applied tag is a no-op, not a change`
  - `more than 500 ids is refused`
  - Also: `normalizeLabel("  Sample   Model ") === "Sample Model"`, and a
    duplicate label differing only by case is refused by
    `assertUniqueLabel`.
- [ ] **Step 2: Run** `pnpm --filter @my-app/api test -- src/modules/record-tags`.
  Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `schema.js` (tables per the spec, unique
  `(record_type, lower(label))` via `uniqueIndex(...).on(t.recordType, sql\`lower(${t.label})\`)`),
  `rules.js` (`planApply`, `normalizeLabel`, `assertUniqueLabel`,
  `TagError`), and `service.js`. Apply inserts with `onConflictDoNothing`
  and deletes in one transaction, then calls `onChange`.
- [ ] **Step 4: Routes test** `routes.test.js` uses `handlerSource`, like
  `routes/__tests__/lab-routes.test.js`. It asserts that the admin
  definition routes use `adminGuard`, and that apply/star use `staffGuard`.
  It also asserts that an unknown `:recordType` returns 404 (a fastify
  `inject` with a stub service).
- [ ] **Step 5: Generate the migration** (`pnpm db:generate`). Check that
  the SQL creates the three tables and the unique and index definitions.
- [ ] **Step 6: Write `README.md`**: purpose, the public interface above,
  configuration (`recordTypes` map, guards), the data model, and a
  "Wiring it into another app" stub. Task 12 completes the stub.
- [ ] **Step 7: Run the tests (PASS), then commit**
  `feat(record-tags): generic labels and per-user stars module`.

### Task 2: `record-files` module (API + web) over the private bucket

**Files:**
- Modify: `apps/api/src/services/storage.service.js`. Extract
  `uploadPrivateObject({ prefix, ownerId, kind, buffer, originalName, contentType })`
  and turn `uploadCaseFile` into a one-line wrapper with
  `prefix: "rx-cases"`.
- Create: `apps/api/src/modules/record-files/schema.js`, `service.js`,
  `routes.js`, `index.js`, `README.md`
- Create: `packages/shared/src/record-files/schemas.js`
- Create: `apps/web/src/modules/record-files/FileDrop.jsx`, `FileList.jsx`,
  `index.js`
- Migration: generated (`record_files`)
- Test: `apps/api/src/services/storage.service.test.js` (extend),
  `apps/api/src/modules/record-files/service.test.js`,
  `apps/web/src/modules/record-files/FileDrop.test.jsx`

**Interfaces:**
- Produces:
  - `attachFiles({ recordType, recordId, files: [{ kind, buffer, originalName, contentType }], byUserId }, database)`
    → `FileRow[]`. Uploads first, then inserts. If the insert fails, the
    uploaded objects are deleted.
  - `filesFor(recordType, ids)` → `Map<recordId, FileRow[]>`
  - `relinkFiles(tx, { fromType, fromId, toType, toId })` → count
  - `signedUrlFor(fileId)` → `{ url, file }`
  - `removeFile(fileId)` (deletes the row, then the object, best-effort)
  - `recordFileRoutes(fastify, { recordTypes: { [type]: { exists } }, staffGuard, onRead })`.
    `onRead` is the audit hook.
  - `FileRow = { id, recordType, recordId, kind, originalName, contentType, size, createdAt }`.
    `storageUrl` is never returned.
  - Web: `<FileDrop accept maxFiles onFiles(files[]) />` and
    `<FileList recordType recordId />`, which lists files and opens the
    signed URL.

- [ ] **Step 1: Failing tests**
  - Storage: `uploadPrivateObject builds <prefix>/<owner>/<kind>/<uuid>-<name> with sanitized segments`
    (`".."` in the owner becomes `"__"`), and `uploadCaseFile still writes under rx-cases/`.
  - Service, with a fake db and a fake uploader:
    - `attachFiles deletes uploaded objects when the insert fails`
    - `relinkFiles moves rows without touching storage`
    - `rows returned never include storageUrl`
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** The multipart route reuses the limits pattern
  in `routes/rx.routes.js:74-110` (10 files, 75 MB each; export
  `MAX_FILE_SIZE_BYTES` from one place, not a copy). Unknown `recordType` →
  404. A record that does not exist (`exists`) → 404.
- [ ] **Step 4: Web test** `FileDrop.test.jsx`
  (`// @vitest-environment jsdom`):
  - `rejects a file over 75 MB with an inline message and does not call onFiles`
  - `drop of 2 files calls onFiles with both`
- [ ] **Step 5: Generate the migration.** Write the README (as in Task 1).
  Run both test suites and the web build (PASS).
- [ ] **Step 6: Commit**
  `feat(record-files): generic private attachments; storage upload made generic`.

### Task 3: Pan numbers, delivery method, enclosed items (schema, edits, search, import)

**Files:**
- Modify: `apps/api/src/db/schema/lab-orders.js` (add `panNumber`,
  `deliveryMethod`, `enclosures`, and index `lab_orders_pan_idx`)
- Modify: `apps/api/src/services/lab/lab-order-crypto.js`
  (`SECRET_ORDER_FIELDS` += `enclosures`)
- Create: `packages/shared/src/lab/production-desk.js`
  (`LAB_ENCLOSED_KINDS`, `LAB_DELIVERY_METHODS`,
  `LAB_DELIVERY_LABELS`, `LAB_ENCLOSED_LABELS`, `formatEnclosure(e)`);
  export it
- Modify: `packages/shared/src/schemas/lab.schema.js`
  (`labFieldChangeSchema` adds `pan` (string ≤30, nullable), `delivery`
  (enum, nullable) and `enclosures` (array ≤5 of
  `{ kind: enum, date?: isoDate, note?: string ≤60 }`, one per kind))
- Modify: `apps/api/src/services/lab/lab-order-rules.js`
  - `FIELDS` gains pan, delivery and enclosures (events `pan`, `delivery`,
    `enclosed`)
  - Enclosures compare by JSON and write a fixed note:
    `"Enclosed items updated"`
  - `presentBoardCard` adds `panNumber` and `deliveryMethod`
- Modify: `apps/api/src/services/lab/lab-orders.service.js`
  (`boardWhere`: `q` also matches `ilike(labOrders.panNumber, \`${q}%\`)`)
- Modify: `apps/api/src/import/map-orders.js` (`panNumber` from
  `summary.panNumber ?? detail.panNumber`, trimmed, cut to 30, empty →
  null) and `apps/api/src/import/load-orders.js` (pan backfill)
- Modify (web): `apps/web/src/pages/lab/LabOrderDetailPage.jsx`, adding a
  new `apps/web/src/components/lab/ProductionPanel.jsx` (pan, delivery,
  enclosed checkboxes with a date and note each);
  `apps/web/src/components/lab/board-columns.jsx` (Pan column, plus pan on
  `BoardCard`); `AdminOrdersPage.jsx` (Pan column). The search placeholder
  becomes "Order #, pan, case #, practice…".
- Migration: generated
- Test: `lab-order-rules.test.js`, `map-orders.test.js`,
  `load-orders.test.js`, `packages/shared/src/lab/production-desk.test.js`,
  `apps/web/src/components/lab/ProductionPanel.test.jsx`

**Interfaces:**
- Produces:
  - Fields `pan | delivery | enclosures` on `PATCH /lab/orders/:id`
  - Card fields `panNumber` and `deliveryMethod`
  - `planPanBackfill(existing: [{ id, sourceId, panNumber }], summaries)` →
    `[{ id, panNumber }]` in `import/map-orders.js`
- Consumes: `planFieldChange`, `mutate` (existing).

- [ ] **Step 1: Failing tests**
  - Rules:
    - `pan edit writes a pan event with from/to`
    - `enclosures edit stores sealed JSON and an event without the notes`
    - `same enclosures in a different order is no change`
    - `shipped order refuses a pan edit` (terminal rule)
  - Import:
    - `mapLegacyOrder maps panNumber`
    - `blank pan maps to null`
    - `backfill fills only null pans` (a set pan stays as it was)
  - Shared: `formatEnclosure({kind:"digital",date:"2026-10-01",note:"scanner"}) === "Digital (scanner 10/01/2026)"`.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - `load-orders.js` runs the backfill inside the live run after the
    inserts, in batches of 500, with `update ... where pan_number is null`.
  - Report `counts.panBackfilled`.
  - Dry runs report the planned count only.
- [ ] **Step 4: Web test** `ProductionPanel.test.jsx`:
  - `ticking Digital and entering a date PATCHes enclosures with that item`
  - `a STALE reply shows the reload toast`
- [ ] **Step 5: Generate the migration.** Run the API and web tests and the
  build (PASS).
- [ ] **Step 6: Commit**
  `feat(lab): pan numbers, delivery method, enclosed items; import maps and backfills pan`.

### Task 4: `barcode-lookup` module + lab resolvers + ScanBox

**Files:**
- Create: `apps/api/src/modules/barcode-lookup/registry.js`, `routes.js`,
  `index.js`, `README.md`
- Create: `packages/shared/src/barcode-lookup/schemas.js`
  (`lookupQuerySchema`: `code` trimmed, 1–64 printable chars)
- Create: `apps/api/src/services/lab/lab-lookups.js` (registers resolvers;
  imported once from `routes/lab-desk.routes.js`)
- Create: `apps/api/src/routes/lab-desk.routes.js` (new lab glue route
  module, registered in `apps/api/src/index.js` under `/api/v1`)
- Create: `apps/web/src/modules/barcode-lookup/ScanBox.jsx`, `index.js`
- Modify: `apps/web/src/pages/lab/LabBoardPage.jsx` and `ShipmentsPage.jsx`
  (put `<ScanBox />` in the header)
- Test: `apps/api/src/modules/barcode-lookup/registry.test.js`,
  `apps/api/src/services/lab/lab-lookups.test.js`,
  `apps/web/src/modules/barcode-lookup/ScanBox.test.jsx`

**Interfaces:**
- Produces:
  - `createLookupRegistry()` → `{ defineResolver({ key, match(code) → normalized|null, resolve(normalized, database) → Hit[] }), lookup(code, database) → { code, hits } }`
  - `Hit = { recordType, recordId, title, subtitle?, href }`
  - Hits are deduped by `recordType:recordId`. A resolver that throws is
    logged by key only and skipped.
  - `barcodeLookupRoutes(fastify, { registry, path = "/lookup", guard })`
  - `<ScanBox placeholder autoFocus onHit? />`. Enter submits. One hit
    navigates to `href`, many hits render a choice list, and none shows
    "No match for <code>". It never uses `alert`.
- Lab resolvers:
  - `order` (digits): `#<orderNumber>`
  - `invoice` (digits): the invoice → its `labOrderId`
  - `pan` (`/^[A-Za-z0-9-]{1,30}$/`): open orders first, then those shipped
    in the last 14 days, max 10
  - Titles carry order number, practice and status only, never a patient.

- [ ] **Step 1: Failing tests**
  - Registry:
    - `ambiguous code returns all hits`
    - `duplicate hits from two resolvers collapse`
    - `a throwing resolver does not fail the lookup`
  - Lab: `pan resolver ignores orders shipped more than 14 days ago`
    (stubbed query builder, or a pure `rankPanHits(rows, now)`)
  - ScanBox:
    - `one hit navigates`
    - `many hits render a choice list`
    - `no hit shows the message and keeps focus`
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Write the README.
- [ ] **Step 4: Run the tests and the build (PASS). Commit**
  `feat(barcode-lookup): scan box resolving order, invoice and pan`.

### Task 5: Staff order entry API, the `defaultDueAt` seam, editable lines

**Files:**
- Modify: `apps/api/src/db/schema/lab-orders.js` (`patientName` text)
- Modify: `lab-order-crypto.js` (seal `patientName`)
- Modify: `packages/shared/src/lab/lab-order-status.js` (`staff` source and
  label)
- Create: `packages/shared/src/schemas/lab-desk.schema.js`
  (`labOrderCreateSchema`, `labLineEditSchema`, `labPricePreviewSchema`)
- Create:
  - `apps/api/src/services/lab/due-default.js`
  - `staff-order-rules.js`
  - `staff-orders.service.js`
  - `lab-order-lines.service.js`
  - `apps/api/src/services/notify-seam.js` (no-op `notify`; skip if piece 7
    already created it)
- Modify:
  - `apps/api/src/services/billing/invoice-rules.js` (`planLinkedLineAdd`,
    `planLinkedLineRemove`, `planLinkedLineQty`)
  - `invoices.service.js` (`syncDraftLine(tx, { labOrderId, op, line, byUserId })`)
- Modify: `lab-orders.service.js` (`getLabOrderDetail` returns `staff` as
  `{ patientName }`, plus `recordFiles` from `filesFor("lab_order", [id])`)
- Modify: `routes/lab-desk.routes.js`. Mount `recordFileRoutes` for
  `lab_order` and `recordTagRoutes` for `lab_order` (the tag `onChange`
  writes `label` events in Task 8; register with a no-op now).
- Migration: generated
- Test: `due-default.test.js`, `staff-order-rules.test.js`,
  `lab-order-lines.test.js` (pure plan), `invoice-rules.test.js`
  (extend), `routes/__tests__/lab-desk-routes.test.js`

**Interfaces:**
- Produces:
  - `defaultDueAt({ startAt = new Date(), rush = false } = {})` →
    `"YYYY-MM-DD"` (lab timezone; +13 days; Sat/Sun → Monday). This is the
    seam piece 7 repoints.
  - `planStaffOrder({ input, variantsById, orderNumber, labOrderId, byUserId, now, dueDefault })`
    → `{ labOrder, lines, event }`
    - `source: "staff"`, `sourceId: labOrderId`
    - Line names and codes come from the catalog; the client's are ignored.
    - A note line is `noteOnly: true`.
  - `createStaffOrder({ input, byUserId })` → `{ labOrder: { id, orderNumber }, invoice, panWarning: { orderNumber } | null }`.
    One transaction covers: the client is an active doctor
    (`LabOrderError("INVALID", "Pick a practice.")`), number allocation,
    `insertPlan`, `createDraftForLabOrder`, `applyTags` when `tagIds` is
    given, and intake promotion when `intakeId` is given (Task 10 fills
    `promoteIntakeIn`; a stub throws "Intake not available" until then).
  - `changeLines(id, { edit, expectedVersion, byUserId })` uses `mutate`.
    - `planLineChange(order, lines, edit)` refuses legacy, shipped and
      cancelled orders, and keeps qty in 1–99.
    - `after` calls `syncDraftLine`, which throws
      `InvoiceError("INVALID_TRANSITION", "Invoice already issued — edit it with a credit.")`
      when the invoice is not a draft.
    - Event `lines`, with the note
      `"Added 2× <name>" | "Removed <name>" | "Qty <name> 1→2"`. Product
      names only.
  - `previewPrices({ clientUserId, lines })` → `priceLabOrderLines` output
    (no write)
  - Routes: `POST /lab/orders`, `GET /lab/orders/default-due`,
    `POST /lab/orders/price-preview`, `POST /lab/orders/:id/lines`, all
    `STAFF`, with audit `lab_order.created_by_staff` and
    `lab_order.lines_changed` (ids and counts only).

- [ ] **Step 1: Failing tests**
  - Due:
    - `Friday + 13 days lands on Thursday`
    - `a start that lands on Saturday rolls to Monday`
    - `uses the lab timezone at 11pm Pacific` (pass `startAt` as UTC next
      day)
  - Plan:
    - `quick entry with no lines makes an order with no lines`
    - `client-supplied line names are ignored`
    - `missing due uses dueDefault`
    - `patientName is required and trimmed`
  - Lines:
    - `line add refuses when the draft is issued and writes nothing`
    - `remove deletes the invoice line linked by labOrderLineId`
    - `a remake order's added line is priced as remake`
  - Routes: every new route is `STAFF`.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** `syncDraftLine` recomputes totals via
  `computeTotals`, as `planLineEdit` does.
- [ ] **Step 4: Generate the migration. Run the tests (PASS). Commit**
  `feat(lab): staff order entry API, defaultDueAt seam, editable lines mirrored to draft`.

### Task 6: New order page (full + quick), lines editor, files panel

**Files:**
- Create: `apps/web/src/pages/lab/NewLabOrderPage.jsx`
- Create: `apps/web/src/components/lab/order-entry/` — `PracticePicker.jsx`
  (search `/admin/users?role=doctor`, reuse the existing admin user list
  endpoint), `LinePicker.jsx` (catalog families → variant, with the price
  from `/lab/orders/price-preview`), `EnclosedFields.jsx` (shared with
  `ProductionPanel`; refactor Task 3's inline fields into it)
- Create: `apps/web/src/components/lab/LinesEditor.jsx` (order detail;
  add/qty/remove via `POST /lab/orders/:id/lines`)
- Modify: `apps/web/src/config/routes.js` (`LAB_ORDER_NEW: "/lab/orders/new"`,
  declared before `LAB_ORDER_DETAIL`), `App.jsx` (route),
  `components/layout/Sidebar.jsx` (lab section entry "New order", icon
  `FilePlus`)
- Modify: `LabOrderDetailPage.jsx` (mount `LinesEditor` and `<FileList recordType="lab_order" />`;
  show the patient for staff orders; the source label is "Staff entry")
- Test: `NewLabOrderPage.test.jsx`, `LinesEditor.test.jsx`

**Interfaces:**
- Consumes: Task 5 routes, Task 2 `FileDrop`/`FileList`, Task 1 tag
  definitions (via `GET /tags/lab_order/definitions`; a plain checkbox
  list here, and the shared picker arrives in Task 8).
- Behaviour:
  - Quick mode shows only practice, patient, due, pan and notes.
  - Due is prefilled from `/lab/orders/default-due`.
  - Submit creates the order, uploads the files to
    `/files/lab_order/:id`, and navigates to the order.
  - When the upload fails, the order stays, a toast names the failed
    files, and the user still navigates.
  - A `panWarning` shows a toast "Pan X is also on open order #N".

- [ ] **Step 1: Failing tests**
  - `quick mode hides lines, enclosed and files`
  - `submit posts the body and then uploads files`
  - `a failed upload still navigates and toasts`
  - `price preview shows client price and source badge`
  - `LinesEditor qty change sends expectedVersion and reloads on STALE`
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement. Check `routes.test.js` still passes** (the route
  order).
- [ ] **Step 4: Run the web tests and build (PASS). Commit**
  `feat(web): staff new-order page (full/quick), lines editor, order files`.

### Task 7: Remake/discount reasons + materials and lot numbers

**Files:**
- Create: `apps/api/src/db/schema/production-desk.js`
  (`adjustmentReasons`, `labOrderLineMaterials`); re-export it
- Modify: `lab-orders.js` (`remakeReasonId`)
- Migration: generated, plus custom `seed_adjustment_reasons`
  (`INSERT … ON CONFLICT DO NOTHING`, rows exactly as in the spec ruling)
- Create: `apps/api/src/services/billing/adjustment-reasons.service.js`,
  `apps/api/src/services/lab/materials.service.js`
- Modify:
  - `invoice-rules.js`: `asRemakeLines(pricedLines, percent = 100)` →
    unitCents = `Math.round(unit * (100 - percent) / 100)`; new
    `planDiscountLine(invoice, lines, { label, text, percent, amountCents }, { now, taxRateBps })`
  - `invoices.service.js`: `createDraftForLabOrder` reads the order's
    reason percent
  - `invoice line edit route + schema`: `op: "discount"`
- Modify: `lab-order-rules.js` `planRemake` (accepts `reason` and/or
  `reasonLabel`; requires at least one; stores `remakeReasonId`); and
  `labRemakeSchema` (`reasonId` optional, `reason` optional; refine: one of
  them is required)
- Modify: `routes/lab-desk.routes.js` (reasons GET plus admin POST/PATCH,
  materials PUT, suggestions GET)
- Create (web): `apps/web/src/pages/app/AdminAdjustmentReasonsPage.jsx`
  (DataTable with inline edit/deactivate); `components/lab/MaterialsRow.jsx`
  (in `LinesEditor`, with the material autocomplete from suggestions)
- Modify (web): the remake modal in `LabOrderDetailPage.jsx` (reason
  select + text); `components/admin/DraftLinesEditor.jsx` ("Add discount");
  routes/App/Sidebar (admin "Reasons")
- Test: `invoice-rules.test.js`, `lab-order-rules.test.js`,
  `materials.service.test.js` (pure `planMaterials`),
  `AdminAdjustmentReasonsPage.test.jsx`, `DraftLinesEditor.test.jsx`

**Interfaces:**
- Produces:
  - `listReasons({ appliesTo, includeInactive })`, `createReason`,
    `updateReason`
  - `planMaterials(order, line, materials)` → `{ rows, event }`. Max 10
    rows; material 1–120 chars, lot ≤60. Refused on a cancelled order,
    allowed on a shipped one.
  - `replaceLineMaterials(orderId, lineId, { materials, byUserId })`. It
    does not bump the version; it writes a `materials` event.
  - `materialSuggestions(q)` → `string[]` (distinct, the last 365 days, 20)
  - `materialsFor(orderId)` → `Map<lineId, rows>`, used by the detail and
    the slip

- [ ] **Step 1: Failing tests**
  - `asRemakeLines with 100 is free`
  - `asRemakeLines with 50 halves 1999 to 1000` (rounding)
  - `discount at 10% of 12345 item subtotal is -1235 adjustment`
  - `discount with amountCents uses it negated`
  - `discount needs a reason or text`
  - `remake with only reasonId is accepted and the note carries the label`
  - `materials refused on a cancelled order, allowed on shipped`
  - `11 materials refused`
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Generate the migrations. Check that the custom
  seed SQL inserts exactly 9 rows.
- [ ] **Step 4: Web tests:**
  - `Add discount with a percent reason posts op discount`
  - `reasons page deactivates via ConfirmButton`
- [ ] **Step 5: Run everything and the build (PASS). Commit**
  `feat(lab): remake/discount reason list with default percent; materials and lots per line`.

### Task 8: Labels and stars in the lab (web module, BulkBar menus, filters, admin)

**Files:**
- Modify: `apps/web/src/components/ui/data-table/BulkBar.jsx`. A menu
  action is `{ id, label, options: [{ value, label }], run(rows, value) }`,
  rendered as a button that opens an option list (Esc closes it).
- Create: `apps/web/src/modules/record-tags/TagChips.jsx`, `TagPicker.jsx`,
  `StarToggle.jsx`, `useTagDefinitions.js`, `tagBulkActions.js`,
  `TagDefinitionsAdmin.jsx`, `index.js`, `README.md`. The web half of the
  module; link it from the API README.
- Create: `apps/api/src/services/lab/lab-tags.js`
  - `exists` uses lab_orders ids
  - `onChange` writes one `label` event per order, with `to` the label
    (≤128) and `note` "Label added"/"Label removed"
- Modify: `lab-orders.service.js` and `lab.schema.js`
  - `labOrderListQuerySchema` gains `tagIds` (comma → array ≤20) and
    `starred` (flag)
  - `boardWhere` uses `taggedWithAny`/`starredBy`
  - `listLabOrders` attaches `tags` (`tagsFor`) and `starred` (`starsFor`,
    with the viewer from `filters.viewerUserId`, set by the route)
- Modify (web):
  - `LabBoardPage.jsx` and `lib/lab-board.js` `boardParams` (a label
    multiselect and a starred toggle)
  - `BoardTableView.jsx` and `AdminOrdersPage.jsx` (filters, a chips
    column, bulk "Label…", "Remove label…", "Star")
  - `BoardCard.jsx` (chips)
  - `LabOrderDetailPage.jsx` (`TagPicker` + `StarToggle`)
  - new `pages/app/AdminLabelsPage.jsx`, which wraps
    `<TagDefinitionsAdmin recordType="lab_order" />`, with a hint: "Labels
    are visible to all staff; don't put patient names in them."
  - routes, App and Sidebar (admin "Labels")
- Test: `BulkBar` cases in `DataTable.test.jsx`, `tagBulkActions.test.js`,
  `lab-tags.test.js`, `lab-board.test.js` (`boardParams`)

**Interfaces:**
- Consumes: Task 1 service and routes.
- Produces: `tagBulkActions(selectedRows, { recordType, definitions, after })`
  → BulkBar actions that call `POST /tags/:recordType/apply` once with all
  ids and return `{ ok, failed }`.

- [ ] **Step 1: Failing tests**
  - `menu action runs with the picked value`
  - `Esc closes the menu without clearing selection`
  - `tagBulkActions posts one request with every selected id`
  - `boardParams joins tagIds with commas and drops empty`
  - `onChange writes one event per order and none for no-op adds`
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Re-run the existing `DataTable.test.jsx` and
  `BoardTableView.test.jsx` unchanged (PASS).
- [ ] **Step 4: Run everything and the build (PASS). Commit**
  `feat(lab): labels and stars on orders — filters, bulk apply, admin vocabulary`.

### Task 9: Merge cases

**Files:**
- Modify: `lab-orders.js` (`mergedIntoOrderId`). Migration: generated.
- Create: `apps/api/src/services/lab/merge-rules.js`, `merge.service.js`
- Modify: `routes/lab-desk.routes.js` (`POST /lab/orders/merge`, `STAFF`,
  audit `lab_order.merged` `{ primaryId, mergedIds }`)
- Modify: `lab-orders.service.js` `getLabOrderDetail` (`mergedFrom: [{ id, orderNumber }]`,
  `mergedInto: { id, orderNumber } | null`)
- Create (web): `components/lab/MergeModal.jsx` (pick the primary; a
  ConfirmButton reading "Click again to merge N orders into #P"); a bulk
  "Merge…" action in `BoardTableView.jsx` and `AdminOrdersPage.jsx`,
  enabled for 2–5 selected
- Test: `merge-rules.test.js`, `MergeModal.test.jsx`

**Interfaces:**
- Produces:
  - `planMerge({ primary, others, patients: Map<id, string|null>, invoices: Map<id, {status}>, linesByOrder, now, byUserId })`
    → `{ primaryPatch, appendLines, otherPatches, events }`. It uses
    `planStatusChange(other, "cancelled", { reason: "Merged into #P" })`
    for each other order.
  - `mergeOrders({ primaryId, otherIds, versions, byUserId })`. In one
    transaction it:
    - reads the orders and checks freshness for each
    - decrypts patients server-side (Rx case → `caseSummary`; staff →
      `patientName`)
    - applies the plan
    - calls `billingFollowUp("cancelled")` for the others and
      `syncDraftLine` add for each moved line
    - unions tags via `applyTags`
    - runs `relinkFiles` from each other order to the primary
- Refusals (`LabOrderError("INVALID", …)`, product text only): fewer than
  2 or more than 5 orders; different `clientUserId`; patients differ after
  `normalizePatient` (lowercase, collapse spaces, trim); shop/legacy
  source; terminal; labelled; any invoice not a draft. A primary that is
  also among the others is refused.

- [ ] **Step 1: Failing tests:**
  - `patients equal after normalising merge`
  - `different practices refuse`
  - `a labelled order refuses`
  - `due becomes the earliest non-null and rush ORs`
  - `others are cancelled with Merged into #P and point at the primary`
  - `appended lines continue the primary's positions`
  - `six orders refuse`
  - `stale version on any order refuses with nothing planned`
    (service-level, with a fake tx)
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Generate the migration.
- [ ] **Step 4: Web test:** `MergeModal requires choosing a primary and a second click`.
- [ ] **Step 5: Run everything and the build (PASS). Commit**
  `feat(lab): merge 2–5 open orders for the same practice and patient`.

### Task 10: `upload-intake` module + lab intake page

**Files:**
- Create: `apps/api/src/modules/upload-intake/schema.js`, `parsers.js`,
  `rules.js`, `service.js`, `routes.js`, `index.js`, `README.md`
- Create: `packages/shared/src/upload-intake/schemas.js`
- Create: `apps/web/src/modules/upload-intake/IntakeDropZone.jsx`,
  `IntakeQueue.jsx`, `index.js`
- Create: `apps/api/src/services/lab/lab-intake.js`. It mounts the routes
  with `recordType` `"intake"` for files, calls
  `notify(db, { event: "intake.created", recordType: "intake", recordId, audience: "staff", data: {} })`,
  and exports `promoteIntakeIn(tx, intakeId, { labOrderId, byUserId })` for
  Task 5's create.
- Create: `apps/web/src/pages/lab/IntakePage.jsx`; routes, App and Sidebar
  (lab "Intake", icon `Inbox`). The `NewLabOrderPage` reads `?intake=` and
  shows that intake's files (`FileList recordType="intake"`).
- Migration: generated (`intakes`)
- Test: `rules.test.js`, `parsers.test.js`, `IntakeQueue.test.jsx`

**Interfaces:**
- Produces:
  - `defineIntakeParser({ key, accepts(file) → bool, parse(files) → hints })`
  - The built-in `generic` parser accepts everything and returns
    `{ files: [names] }`.
  - `createIntakes({ files, split: "one"|"per_file", channel = "upload", byUserId })`
    → `Intake[]`. It uses `attachFiles` per intake.
  - `listIntakes({ status, limit, offset })` → `{ rows, total }`
  - `discardIntake(id, { reason, byUserId })`
  - `promoteIntake(tx, id, { recordType, recordId, byUserId })`. A
    conditional update `where status = 'pending'` (a second promote fails
    `"Already used"`) is followed by `relinkFiles("intake", id → recordType, recordId)`.
  - Accepted extensions: `.zip .xml .html .htm .pdf .stl .ply .obj`.
    Anything else is refused per file with a message.

- [ ] **Step 1: Failing tests:**
  - `per_file split makes one intake per file`
  - `one split makes a single intake`
  - `a .exe is refused by name and the rest proceed`
  - `promote twice fails the second time`
  - `discarded intake cannot be promoted`
  - `hints are sealed at rest`
  - Web: `IntakeQueue Create order links to /lab/orders/new?intake=<id>`
    and `bulk discard uses ConfirmButton`
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** Replace Task 5's intake stub with
  `promoteIntakeIn`. Generate the migration. Write the README.
- [ ] **Step 4: Run everything and the build (PASS). Commit**
  `feat(upload-intake): scanner-export drop creates pending intakes; promote into a staff order`.

### Task 11: Lab slip additions

**Files:**
- Modify: `apps/api/src/services/lab/ticket-model.js`,
  `apps/api/src/services/lab/ticket-pdf.js`
- Modify: `apps/api/src/services/lab/lab-orders.service.js`
  `getLabOrderDetail`. Add `materials` (`materialsFor`), `tags`
  (`tagsFor`), and `recordFiles` (already added in Task 5). Keep the
  function under 150 lines by extracting `loadProductionExtras(id)`.
- Test: `ticket-model.test.js`, `ticket-pdf.test.js`

**Interfaces:**
- The model gains:
  - `pan` (string|null)
  - `dueBadge` (`"THU"` from the due date in the lab timezone, or null)
  - `delivery` (its label)
  - `enclosed` (`formatEnclosure` strings)
  - `labels` (label strings)
  - `lines[].materials` (`"<material> · lot <lot>"`)
  - `mergedFrom` (`"#123, #124"`)
  - patient from `detail.staff?.patientName`
  - files that include record files
- The renderer prints:
  - the pan large beside the order number
  - the due badge as a filled box under the barcode
  - "Enclosed", with `[x]` lines
  - materials indented under each line
  - labels as a banner row

- [ ] **Step 1: Failing tests:**
  - `dueBadge is the weekday of the due date in the lab timezone`
  - `staff order prints its patient`
  - `enclosed digital with date formats per formatEnclosure`
  - `materials attach to their line`
  - `no pan prints no pan block` (model `pan === null`)
  - `pdf renders with every addition present` (smoke)
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run (PASS). Commit**
  `feat(lab): slip prints pan, due-day badge, delivery, enclosed, materials, labels`.

### Task 12: Module READMEs "wiring into another app", runbook, docs

**Files:**
- Modify: `apps/api/src/modules/{record-tags,barcode-lookup,record-files,upload-intake}/README.md`
  (complete "Wiring it into another app")
- Modify: `docs/cutover-runbook.md` (new section "Production desk
  re-entry", after "5. Load into production, then parity")
- Modify: `docs/import-operations.md` (the `panBackfilled` count)
- Modify: `CLAUDE.md` Key File Paths (add `apps/api/src/modules/` and
  `apps/web/src/modules/`; one line each)
- Test: none (docs). Run the full API and web suites and the build as the
  final gate.

- [ ] **Step 1: Write the wiring steps for each README:**
  1. Re-export `schema.js` from the app's Drizzle schema index and run
     `db:generate`.
  2. Register the routes factory with the app's guards and a `recordTypes`
     map.
  3. Mount the web components and give the API base.
  4. List the env vars it reads (record-files: `RX_GCS_BUCKET`, the
     private bucket; others: none).
  5. Add a worked example: "add labels to invoices", in 5 lines of glue.
- [ ] **Step 2: Add the runbook steps.** Each is a checkbox:
  - Admin › Labels: recreate Labzona's label list.
  - Re-apply labels to open orders (filter Labzona's Active list by label).
  - Admin › Reasons: add the remaining Labzona remake codes with their
    percents.
  - Enclosed items are entered as each open case is next touched.
  - Confirm `import:load orders` reported `panBackfilled` equal to the
    loaded legacy orders that had a pan.
  - Stars and materials: nothing to re-enter.
- [ ] **Step 3: Run the full gate:** `pnpm --filter @my-app/api test`,
  `pnpm --filter @my-app/web test`, `pnpm --filter @my-app/web build`
  (all PASS).
- [ ] **Step 4: Commit**
  `docs(production-desk): module wiring guides and cutover re-entry steps`.
