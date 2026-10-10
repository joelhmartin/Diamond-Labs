# Piece 2: Lab Orders & Production Board (design)

_2026-10-07 · roadmap: `2026-10-05-own-the-lab-roadmap.md` · builds on piece 1
(catalog & pricing)_

## Goal

Our backend becomes the system of record for **what the lab is building and
where each job is**. That covers every Rx case and every shop order, from the
moment the lab accepts it until it ships. Seazona's order and production role
ends: no more `createOrder` pushes.

## What exists today (survey 2026-10-07)

- **Rx cases** (`rx_cases`) have an *intake* vocabulary: new, in_review,
  awaiting_doctor, pushed, failed, cancelled. "Pushed" means "sent to Seazona"
  and is terminal. Nothing records production after that.
- **Shop orders** (`orders`) only ever hold `status="paid"`. Nothing reads them.
  The admin Orders page shows **live Seazona** orders (status, department,
  assignedTo).
- **Roles:** `user | doctor | admin`. There is no lab-staff role, so every lab
  route is admin-only.
- **No PDF exists.** The old JotForm flow produced an Rx PDF; our forms do not.
  Technicians currently have nothing printable.
- **Doctors cannot see their cases.** The API exists, but no page uses it.

## Model

A **lab order** is one job on the bench. Every Rx case that is released to the
lab, and every paid shop order, produces exactly one lab order.

- **`lab_orders`**
  - Keys: `id`, `orderNumber` (unique int; continues Seazona's order numbering
    from `LAB_ORDER_NUMBER_START`, so the lab's paperwork stays continuous),
    `source` (`rx_case` | `shop_order`), `sourceId` (unique per source),
    `clientUserId` (nullable for guest shop orders).
  - Production: `status`, `departmentId`, `assigneeUserId`, `dueDate` (`date`),
    `rush`, `rushTier`, `isRemake`, `remakeOfOrderId`, `holdReason`.
  - Stage timestamps: `receivedAt`, `startedAt`, `shippedAt`, `cancelledAt`.
  - Notes: `labNotes` (staff-only), plus `createdAt` and `updatedAt`.
- **`lab_order_lines`** are snapshotted at release, so later catalog edits never
  change an order. Columns: `labOrderId`, `position`, `variantId`, `code`,
  `name`, `arch`, `qty`, `noteOnly`, `sourceLabel`.
- **`lab_order_events`** is the append-only history: `labOrderId`, `type`
  (status | assign | department | due | note | hold | release), `from`, `to`,
  `byUserId`, `note`, `at`. It drives the timeline.
- **`lab_departments`** is admin-managed: `name`, `position`, `active`.
  Departments are not hard-coded; the lab names its own rooms.

**Statuses:** `received` → `in_production` → `quality_check` → `ready_to_ship`
→ `shipped`, with `on_hold` (needs a reason) and `cancelled` (needs a reason)
reachable from any non-terminal status. `shipped` and `cancelled` are
terminal. One pure transition table (`lab-order-status.js`, in
`packages/shared` so the UI and API agree) owns every rule.

**Remakes:** a staff action on a shipped order creates a new lab order with
`isRemake=true` and `remakeOfOrderId`, copying the lines. Whether a remake is
charged is piece 3's concern.

## Flows

- **Rx release replaces the Seazona push.**
  - Staff "Release to lab" on a reviewed case. The same gates as today's push
    apply: every line is resolved, nothing open.
  - In one transaction it creates the lab order and lines, sets
    `rx_cases.status` to the new value `released`, and writes a release event.
  - Old `pushed` cases stay readable and are labelled "Sent to Seazona
    (legacy)".
  - `RX_LIVE_PUSH` auto-push becomes **auto-release**, under the same gate:
    clean cases skip the queue.
- **Shop orders:** checkout creates the lab order (status `received`) in its
  own transaction right after the paid order commits. A failure is logged
  (`[LAB][SHOP_ORDER_FAILED]`) for backfill and never rolls back the paid
  order. Shop lines are picked and shipped, not fabricated; the lab handles
  them on the same board.
- **Seazona order code removed on this branch:**
  - `pushCaseToSeazona`, `build-order-payload` and the send-test route;
  - checkout's `pushOrderToSeazona`;
  - live Seazona `/admin/orders`;
  - `mark-manual` and `clear-push-lock`.

  The `seazona*` columns stay, since data is still migrating; piece 5 drops
  them.

## Who sees what

- **New `lab` user role** for technicians. They get the production board,
  order detail, Rx cases (read plus release), and case files and work tickets.
  They do **not** get pricing, payments, users or the catalog editor. Admin can
  do everything lab can.
  - The role enum gains `lab`.
  - Every lab route uses `requireRole("admin","lab")`.
- **Doctors** get a "My cases" page: case number, device, submitted date,
  production status in plain words (Received / In production / On hold /
  Shipped), due date and a remake flag. **Hold reasons and lab notes are
  staff-only.**

## Work ticket (PDF)

`GET /lab/orders/:id/ticket.pdf` (lab or admin) renders a one-page work ticket:
- order and case number, practice and doctor;
- patient name, which is needed on the bench;
- device lines with codes and arches;
- every non-empty Rx answer, grouped as on the form;
- due date, rush and remake banners;
- a file list;
- a barcode (Code 128) of the order number, for scan-to-open.

Implementation details:
- Rendered server-side with **pdfkit**, the one PDF library for the project;
  piece 3's invoices reuse it.
- Each download is audit-logged, as file access is today.
- The ticket is generated on demand and never stored, because it contains PHI.

## UI

- **Production board** (`/lab`): one column per status. Each card shows order
  number, practice, device summary, due date, rush/remake badges and assignee
  initials.
  - Filters: department, assignee, rush, due ≤ date, search by order, case or
    practice.
  - Status changes use buttons on the card or detail page, never drag-and-drop
    alone, so every move is deliberate and logged.
  - Overdue cards are flagged.
- **Order detail** (`/lab/orders/:id`): lines, Rx answers, files (signed URLs),
  the work-ticket button, status, assign, department and due controls, hold
  and cancel with a reason, the event timeline, and remake.
- **Admin › Departments:** a small CRUD page.
- **Admin › Orders:** now lists local lab orders (both sources), not Seazona.

## Errors and safety

- Illegal transitions return 422 with the allowed next statuses.
- Every mutation runs in a transaction that also writes the event row.
- Concurrent edits: every mutation carries `expectedVersion` (the `version`
  the client saw) and every change increments it. A mismatch returns 409 "This order changed — reload", so two technicians can't
  silently overwrite each other.
- PHI: patient fields stay encrypted at rest, as in `rx_cases`. Lab orders
  reference the case rather than copying patient data. Lab-role access to
  tickets and files is audit-logged.

## Testing

Vitest pure tests for:
- the transition table (every allowed and forbidden move);
- the release planner (case and lines to lab order and lines);
- order-number allocation;
- doctor-facing status mapping, which must hide staff-only fields;
- ticket content assembly (a pure `buildTicketModel(order, case)`), with PDF
  rendering smoke-tested to "produces a non-empty PDF buffer".

Route tests follow the existing pure-helper pattern. There is still no DB
harness.

## Out of scope

- Invoicing remakes or orders (piece 3).
- Tracking numbers, labels, shipped emails to doctors (piece 4).
- Importing historical Seazona orders (piece 5).
- Drag-and-drop board reordering, and per-technician workload analytics.
