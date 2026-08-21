# Lab-facing Rx case review + manual push to Seazona — Design

**Date:** 2026-08-07
**Status:** Approved (sections 1–3)

## Problem

A doctor submits a prescription and **nobody at the lab ever sees it.**

Three paths were checked and all three are closed:

- **No admin UI.** Nine admin pages exist (Orders, Invoices, Payments, Users, Rx
  Mapping, …) and none for Rx cases. No list, no detail, no search.
- **The only read endpoint is doctor-scoped.** `GET /rx/cases`
  (`rx.routes.js:515`) requires `requireApprovedDoctor` and filters
  `WHERE userId = request.user.id`. A doctor sees their own; lab staff see none.
- **No notification.** `POST /rx/form-submissions` sends no email. The eleven
  templates in `email.service.js` are auth, payments and receipts only.

So a submitted prescription is written to `rx_cases`, encrypted, and sits there
invisible. That is worse than the JotForm workflow it replaced, where at least
an email arrived.

This also reframes `RX_LIVE_PUSH`. Auto-pushing prescriptions nobody can open
means the first person to notice a bad mapping is a technician holding the wrong
appliance. The review queue is not an alternative to the automation — it is the
half that makes the automation safe.

## Blocking dependency

**Every form submission stores `deviceKey: null` and `deviceOptions: {}`**
(`rx.routes.js:~474`), because the form→device adapter `formAnswersToCaseInput`
lives only in the browser (`apps/web/src/data/forms/form-to-case.js`).

No devices means no order lines means nothing to review. Porting that adapter
server-side is the foundation of this work, not an optional extra. It is
follow-up #6 in `docs/rx-forms/follow-ups.md`.

## Decisions taken

| Question | Decision |
|---|---|
| What can staff edit? | The **order lines**, which are seeded from the doctor's answers. The prescription itself is never rewritten — it lives on a read-only tab. Staff always see the corrected state, never stale answers. |
| Unmapped lines? | Assign a code inline, with **"just this once"** or **"always"**. "Always" writes an `rx_code_overrides` row, so the open mapping questions answer themselves through real work. |
| Case states | `new` · `in_review` · `awaiting_doctor` · `pushed` · `failed` · `cancelled` |

## Section 1 — Data

**Port the adapter.** `formAnswersToCaseInput` becomes shared (or is ported into
`apps/api`), and `POST /rx/form-submissions` runs it at submit so a case arrives
with real `deviceKey` / `deviceOptions`.

**New table — the editable order:**

```
rx_case_lines
  id · caseId · position
  seazonaCode · seazonaProductId · name · arch
  mapKey                 which mapping produced it
  status                 confirmed | proposed | open
  origin                 auto | manual        <- staff-added or edited
  noteOnly               boolean, default false
  createdAt · updatedAt
```

Seeded at submit by running `resolveLineItems`, so the queue can show
"4 lines · 1 unmapped" without recomputing.

`origin: manual` is what stops a re-resolve from silently discarding staff edits.
`noteOnly` marks a selection the lab has ruled is an instruction rather than a
charged product — it travels in the notes, not as a line.

**Re-resolve is explicit, never automatic.** When the lab answers a mapping
question, already-seeded lines are stale. A "re-resolve from prescription"
button recomputes `auto` lines and leaves `manual` ones alone. Automatic
recomputation could silently change a case someone had already corrected.

**Reuse existing columns.** `seazonaPushStatus`, `seazonaOrderId`,
`seazonaPushError` and `payloadSnapshot` already exist on `rx_cases` and already
mean the right things. `status` migrates from `pending_approval` to the six
states above.

**Audit every edit** via the existing non-blocking `logSafe` in
`audit.service.js`: who changed which line, from what to what.

## Section 2 — Interface

Two pages, following the existing `AdminOrdersPage` / `AdminOrderDetailPage`
pattern (~230 lines each) rather than inventing a new one.

**Queue — `/admin/rx-cases`.** Defaults to everything needing attention (`new`,
`in_review`, `awaiting_doctor`, `failed`), with status pills to widen it, and
search by case number / patient / practice. Columns: case number, patient,
practice, devices, lines summary, status, age.

The lines summary — **"4 lines · 1 unmapped"** — is the useful column. It tells
staff which cases are blocked and which are ready without opening anything.

**Case — `/admin/rx-cases/:id`.** Order lines are the page; everything else is a
tab (`Order` · `Prescription` · `Files` · `History`).

An unmapped line offers three resolutions:

1. **Assign a code** — inline catalog search, `once` or `always`
2. **Not a line item — send as a note** — sets `noteOnly`, also `once` or
   `always`
3. Leave it — the case stays blocked

Resolution 2 is required, not a nicety: the questionnaire asks the lab exactly
this about five build instructions ("charge it, or is it just an instruction?").
Without it, a case containing "Wrap distal of last molars" could never be
pushed, because no product exists to assign.

**Push is gated on zero unmapped lines** — the same never-send-a-partial-order
invariant as the rest of this work. The three resolutions are what make that
gate passable rather than a dead end.

**Files are not decoration.** Scans, photos and artboard drawings are already in
`rx_case_files` with a download endpoint at
`GET /rx/cases/:id/files/:fileId`. Staff reviewing a prescription need them.

## Section 3 — Push, failure, and the switch

**Push reads the stored lines, not the prescription.** `build-order-payload.js`
re-runs `resolveLineItems` today; if the push route did that, every staff edit
would be discarded at the moment it mattered. The push builds `items` from
`rx_case_lines` and reuses the existing note compilation, appending any
`noteOnly` selections.

**Failure keeps the case editable.** Rejected or unreachable → status `failed`,
error in `seazonaPushError`, lines untouched, Retry re-attempts.

**Double-push is guarded at the database.** Seazona has no idempotency key, so a
double-click or a retry after an ambiguous timeout could create two orders. The
guard is a conditional update — `WHERE status != 'pushed'` — the same pattern
`/rx/cases/:id/approve` already uses. A disabled button is not a guard.

**`RX_LIVE_PUSH` becomes the auto-push switch:**

| | Off (today) | On (later) |
|---|---|---|
| Case arrives | status `new`, waits for a human | push attempted immediately |
| Push succeeds | — | status `pushed` |
| Push fails, or a line is unmapped | — | lands in the queue as `failed` / `new` |

The bottom row is the point: **auto-push failing is never silent.** It falls
into the queue a human already watches. This is why the queue is built first
regardless of when the flag is flipped.

**Notification.** Nobody is told a prescription arrived. A short
`sendRxSubmissionReceived` to the lab is included — a queue nobody knows to
check is the same invisibility problem in a new place. Separable if not wanted.

## Testing

- Lines seed correctly from a real form submission (requires the ported adapter)
- A `manual` line survives re-resolve; `auto` lines are recomputed
- Push is blocked while any line is `open` and not `noteOnly`
- Push builds its payload from stored lines, **not** by re-resolving
- A second push cannot create a second Seazona order
- An auto-push failure under `RX_LIVE_PUSH=true` lands in the queue
- `noteOnly` selections appear in the order notes and not as line items

## Out of scope

- Editing the doctor's submitted answers. The prescription is a clinical record;
  the order derived from it is the lab's document.
- A separate lab-staff role. `admin` covers it today (`user | doctor | admin`).
- Doctor-facing status. Doctors see their own cases via the existing endpoint;
  exposing review state to them is a separate decision.
