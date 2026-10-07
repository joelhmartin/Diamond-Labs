# Lab Orders & Production Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make our database the record of what the lab is building and where each job is. Every released Rx case and every paid shop order becomes exactly one lab order. Lab orders move across a production board, print as a work ticket, are worked by a new `lab` role, and show to doctors as "My cases". The Seazona order push is retired.

**Architecture:**
- Four new tables: `lab_orders`, `lab_order_lines`, `lab_order_events` and `lab_departments`. `user_role` gains `lab`.
- The status transition table and the doctor-facing status mapping live in `packages/shared/src/lab/lab-order-status.js`, so the API and web read the same rules.
- Pure planners in `apps/api/src/services/lab/lab-order-rules.js` turn a case, a paid order or a remake into rows. They also turn every staff action into a patch plus an event.
- `lab-orders.service.js` runs those plans in transactions, with an optimistic `version` check.
- Rx release replaces the Seazona push, behind the same gate (`canPush`, renamed `canRelease`). Checkout creates the lab order in the transaction that records the paid order.
- The work ticket is a pure `buildTicketModel`. A thin pdfkit renderer lays it out and draws a vector Code 128 barcode from a pure, tested encoder.
- The Rx form definitions move to `packages/shared`, so the server can group answers the way the form does.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM 0.36 / drizzle-kit 0.30.6 (Postgres 15), Zod 3 (`@my-app/shared`), Vitest (+ `node:assert/strict`), **pdfkit 0.20.2 (pinned exact)**, React + Vite + React Router 7, axios (`apps/web/src/config/api.js`).

**Spec:** `docs/superpowers/specs/2026-10-07-lab-orders-and-production-design.md` (roadmap: `docs/superpowers/specs/2026-10-05-own-the-lab-roadmap.md`)

## Spec corrections

Each item below is a spec decision that is wrong against the real code. The plan builds the corrected version.

1. **Concurrency token: `version`, not `updatedAt`.** The `timestamp(..., { withTimezone: true })` columns default through `defaultNow()` and store microseconds. postgres-js returns a JS `Date`, which keeps only milliseconds. So the `updatedAt` a client echoes back never equals the stored value on an order's first edit, and an equality check would 409 every first move. The plan uses `lab_orders.version integer not null default 1`. Every mutation increments it, the client sends `expectedVersion`, and a mismatch returns 409 "This order changed — reload".
2. **`sourceId` unique per source would block remakes.** The spec makes a remake a new lab order for the same case, so a plain unique `(source, sourceId)` refuses it. The plan uses a partial unique index `WHERE is_remake = false`. The precedent is `autopay_attempts_user_cycle_success_idx` (`schema/autopay.js:74`, migration 0024).
3. **The live form never writes `rx_cases.rush`.** The insert in `POST /rx/form-submissions` (`rx.routes.js` ~480–505) sets no `rush` or `rushTier`. The doctor's choice lives in `formData.rushCase` (`["Yes"]`) plus `rushChargeNylon` / `rushChargeBiomed` (`apps/web/src/data/forms/rx-common.sections.js:126–143`). Copying `rx_cases.rush` would mark every rushed case as not rushed. The plan adds `rushFromCase()`, which reads the columns first (the retired wizard used them) and then `formData`.
4. **Deleting `build-order-payload` would delete the only renderer of design intent.** `compileNotes` and `compileNotesMulti` turn several answers into text: occlusal contact, design preference, guard clearance, VDO, the ortho build answers and rush. The mapping preview uses them, and they are the only path for those answers onto an order. The plan moves them to `services/rx/case-notes.js` and prints them as **Build notes** on the ticket and the order detail. Only the Seazona payload builders are deleted.
5. **Removing `clear-push-lock` strands legacy cases.** A case left at `seazonaPushStatus = "pushing"` may already have reached Seazona. Without clear-push-lock it either can never be resolved, or it can be released into a duplicate job. The plan has release refuse such a case (409 `LEGACY_PUSH_UNCONFIRMED`) unless the request carries `confirmNotInSeazona: true`, and the UI first asks staff to check Seazona.
6. **"Grouped as on the form" needs the form on the server.** The definitions live in `apps/web/src/data/forms/`, which the API image doesn't contain (`apps/api/Dockerfile` stage 2 copies only `apps/web/dist`). Three API tests already import them across that boundary. Task 8 moves them to `packages/shared/src/rx/forms/`.
7. **On-hold orders need to know where to resume.** The spec has no column for this, so the plan adds `lab_orders.held_from`. Resume goes back to that status.
8. **Free-text staff fields are encrypted at rest.** Technicians will type patient names into lab notes, hold reasons and event notes. B4 (`rx_cases.manualNote`, `phi-crypto.js`) set the precedent, so these fields go through `lib/crypto.js` `encryptField` / `decryptField`.
9. **"One page" can't be guaranteed.** A long ortho Rx overflows a page, and truncating clinical answers is worse than printing a second page. The renderer lets pdfkit flow onto page 2. The header, barcode and banners always sit on page 1.
10. **Nothing grants the `lab` role.** The repo has no role-edit route; `db/create-admin.js` only makes admins. The plan adds `PUT /admin/users/:id/role`, which toggles only `user` ↔ `lab` and refuses admin, doctor and self.
11. **The doctor case API leaks staff fields today.** `GET /rx/cases` and `/rx/cases/:id` return the full decrypted row, including `manualNote`, `payloadSnapshot`, `seazonaPushError` and raw `gcsUrl` file pointers. "My cases" would sit on top of that. The plan swaps both routes to the doctor allow-list view (Task 11).
12. **Keep Seazona order reads.** `seazona.service.js` `getOrders` / `getOrder` stay, because piece 5 imports historical orders with them. Only `createOrder` and its callers are removed.

## Global Constraints

- All work happens in the worktree `/Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2` on branch `feat/own-the-lab-2-orders`, which already contains piece 1. Never `cd` to the main checkout; other agents work there.
- Push only with `git push origin feat/own-the-lab-2-orders`, never a bare `git push` (`push.default=matching` would push local `main`).
- **No Seazona API calls.** No reads, no writes, from code, tests, scripts or a dev server. Seazona's host rate limit blocks the whole integration, production included. Nothing in this piece may name the Seazona host or read its credentials (`seazona-access.test.js` on `main` enforces this after the next merge).
- **Never run a real checkout.** `AUTHORIZE_NET_ENV` is production. Checkout changes are verified by tests and source checks only.
- **Never use browser or Chrome tools** (no `mcp__claude-in-chrome__*`, no `mcp__MCP_DOCKER__browser_*`). The UI is verified by `pnpm build` and pure-helper tests.
- **No DB foreign keys** (repo convention). Ids are cuid2 via `createId()` from `apps/api/src/lib/id.js`, `varchar(128)`.
- **Money is integer cents** via `apps/api/src/lib/money.js`. Lab orders carry no prices; prices stay on `order_items` until piece 3.
- **Migrations come only from `cd apps/api && pnpm db:generate`.** Expect `0027_*`, after piece 1's `0026_spicy_network.sql`. Never hand-number or hand-edit a generated file.
- **The `user_role` enum gotcha:**
  - drizzle-kit 0.30.6 emits `ALTER TYPE "public"."user_role" ADD VALUE 'lab';` (`AlterTypeAddValueConvertor`).
  - drizzle-orm 0.36's migrator (`pg-core/dialect.js` `migrate()`) runs **all pending migrations in one transaction**.
  - Postgres 15 (prod Cloud SQL and local 15.12) allows `ADD VALUE` inside a transaction, but the new value can't be *used* until that transaction commits.
  - So no migration SQL may reference `'lab'` beyond the `ADD VALUE`: no default, backfill, check or index predicate. Runtime queries are fine. Task 2's test enforces this.
- **Tests:** Vitest files import `{ test } from "vitest"` and `assert from "node:assert/strict"`. Rules live in pure helpers and are tested there. There is no DB or Fastify harness: route wiring is pinned by the repo's source-inspection pattern (`routes/__tests__/admin-rx-cases.test.js` `handlerSource`).
- **One implementation per job.** Reuse `getSignedReadUrl` through the existing `GET /admin/rx-cases/:id/files/:fileId`, the audit service (`logSafe`), `decryptRxPhi`, `canRelease` (renamed from `canPush`, never forked), `compileNotesMulti`, `devicesForCase` and `validate` / `validateQuery`.
- **PHI:**
  - Lab tables reference the case and never copy patient data.
  - Free text is encrypted (correction 8).
  - Decrypted rows are never logged.
  - The ticket is generated on demand and never stored (`Cache-Control: no-store`).
  - Every ticket print, order read and file link is audit-logged.
- **Verification bar for every task:**
  - `pnpm test` at the repo root passes.
  - `pnpm --filter @my-app/web build` succeeds.
  - After any schema task, `cd apps/api && pnpm db:generate` prints "No schema changes".
- **Commits:** messages end with `Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>`. Replace `<implementer model>` with the name of the model that actually did the work. Subagents run on Sonnet at minimum, never Haiku.

## Sequencing

- **Stacked PR.** Piece 1 (PR #46, base `feat/own-the-lab`) is still open, and this branch contains it. Open piece 2's PR with `--base feat/own-the-lab-1-catalog`. After #46 merges, retarget it with `gh pr edit <n> --base feat/own-the-lab`. Count files against the right base (Task 13).
- **`main` is ahead.** It has #46-docs and #48 (`seazona-access.test.js`), which this branch lacks. When `feat/own-the-lab` next merges `main`, that test scans every file. Nothing here names the Seazona host or credentials; keep it that way.
- **Order-number seed.** `LAB_ORDER_NUMBER_START` defaults to `100000`, a dev placeholder. Piece 5 sets it to Seazona's last order number + 1 before cutover. Allocation is `max(existing + 1, start)`, so raising it later never reuses a number.
- **Renamed env flag.** `RX_LIVE_PUSH` is replaced by `RX_AUTO_RELEASE` (exact `"true"` gate, same as before). This branch never deploys to prod. At cutover, drop `RX_LIVE_PUSH` and `SEAZONA_ORDER_USER_ID` from the Cloud Run env. Put that in the PR body.
- **Staging scrub.** If the staging plan's scrub job (`feat/own-the-lab-0-staging`, Task S3) lands, add `lab_orders.hold_reason`, `lab_orders.lab_notes` and `lab_order_events.note` to its scrub list. Put that in the PR body.
- **Rx replay harness.** `apps/api/scripts/rx-replay/run.mjs` imports `canPush`, and Task 3 renames it. The harness needs a de-identified cases file kept outside the repo. If one exists at `~/rx-replay/cases.json`, run `node apps/api/scripts/rx-replay/run.mjs ~/rx-replay/cases.json --out /tmp/replay.md` after Tasks 3 and 12, and confirm the pushable/releasable count is unchanged. If not, the vitest `translate.test.js` run is the check.

## Review Focus

These are the five input classes most likely to bite a real user, each pinned to a test in the task that owns it:

1. **Two technicians move the same card at once.** The second gets 409 "This order changed — reload", never a silent overwrite. Pinned by `assertFresh` / `planStatusChange` version tests in **Task 4**. The service's conditional `WHERE version = expected` update is in Task 5.
2. **A doctor opens My cases while their case is on hold.** They see "On hold" but never the hold reason, lab notes, assignee or department. Pinned by the `doctorCaseView` allow-list test in **Task 1**. The doctor API (Task 11) is wired to that view only.
3. **A legacy case is stuck at `seazonaPushStatus = "pushing"`.** It may already exist in Seazona, so release refuses it until staff confirm they checked. Pinned by the `releaseRefusal` tests in **Task 3**.
4. **The doctor ticks "rush" on the live form.** `rx_cases.rush` stays false, but the lab order must still be rush, with its tier, and the ticket shows the RUSH banner. Pinned by the `rushFromCase` tests in **Task 3** and the ticket banner test in **Task 9**.
5. **A guest buys a shop item whose variant has no lab code.** Creating the lab order runs inside the checkout transaction *after* the card is charged, so it must never refuse what pricing accepted. Pinned by the `planShopLabOrder` guest/codeless test in **Task 3**. The checkout wiring source test is in **Task 7**.

---

## File Structure

**Shared (`packages/shared/src`) — new**
- `lab/lab-order-status.js` (+ test): the status table, labels, `isOverdue`, `isoDateIn`, the doctor mapping and `doctorCaseView`.
- `schemas/lab.schema.js` (+ test): Zod bodies and queries for the lab routes, release and role change.
- `rx/forms/{digital-rx.form.js, ortho-rx.form.js, form-fields.js, rx-common.sections.js, ortho.sections.js}`: moved from web with `git mv`.
- `rx/forms/index.js`: the form registry.
- `rx/forms/answers.js` (+ test): `groupRxAnswers`, `formatRxAnswer`.

**Shared — modified:** `index.js`, `package.json` (exports `./rx/*`).

**API — new**
- `db/schema/lab-orders.js` (+ `lab-orders.test.js`).
- `services/lab/lab-order-rules.js` (+ test): the pure planners.
- `services/lab/lab-orders.service.js`, `services/lab/departments.service.js`.
- `services/lab/ticket-model.js` (+ test), `services/lab/ticket-pdf.js` (+ test).
- `lib/code128.js` (+ test), `lib/staff-roles.js` (+ test).
- `routes/lab.routes.js`.
- `routes/__tests__/lab-routes.test.js`, `routes/__tests__/rx-release.test.js`, `routes/__tests__/seazona-order-retired.test.js`.
- `services/rx/case-notes.js` (+ test), renamed from `build-order-payload.js`.

**API — modified**
- `db/schema/users.js`, `db/schema/index.js`, `db/schema/orders.js` (comment only).
- `config/env.js`, `index.js`.
- `services/rx/case-gates.js` (+ test).
- `routes/admin-rx-cases.routes.js`, `routes/rx.routes.js`, `routes/payment.routes.js`, `routes/admin.routes.js`, `routes/admin-rx-mapping.routes.js`.
- `services/seazona.service.js`, `services/rx/phi-crypto.test.js`, `services/rx/catalog-map/resolvers/ortho.review-fixes.test.js`.
- `routes/__tests__/{admin-rx-cases,rx-form-submit,rx-status-vocabulary,checkout-lines}.test.js`.
- `scripts/rx-replay/{run.mjs,report.js,translate.js}`, plus three API tests that import form definitions.
- `package.json` (pdfkit).

**API — deleted**
- `services/rx/push-case.service.js` (+ test), `services/rx/order-diff.js` (+ test), `services/rx/build-order-payload.test.js`.
- `config/rx-live-push-comment.test.js`.
- `routes/__tests__/rx-auto-push-claim.test.js`, `routes/__tests__/rx-mapping-send-test-gate.test.js`.
- Repo root `scripts/rx-dryrun.mjs` and the `rx:dryrun` script.

**Web — new**
- `guards/RequireStaff.jsx`.
- `lib/lab-board.js` (+ test), `lib/staff.js` (+ test).
- `pages/lab/LabBoardPage.jsx`, `pages/lab/LabOrderDetailPage.jsx`.
- `pages/app/AdminDepartmentsPage.jsx`, `pages/doctor/MyCasesPage.jsx`.

**Web — modified**
- `App.jsx`, `config/routes.js`, `components/layout/Sidebar.jsx`, `components/layout/DoctorShell.jsx`.
- `pages/app/{AdminRxCasesPage,AdminRxCaseDetailPage,AdminOrdersPage,AdminUsersPage,AdminRxMappingPage}.jsx` and the two page tests.
- `lib/rx-case-labels.js` (+ test).
- `data/forms/index.js` and the two form tests.

**Web — deleted:** `pages/app/AdminOrderDetailPage.jsx`.

## Task order and batching

| # | Task | Batch |
|---|---|---|
| 1 | Piece environment + shared lab-order rules | **Batch A** (1+2) |
| 2 | Lab tables, `lab` role, migration 0027 | **Batch A** |
| 3 | Pure planners: numbering, due/rush, release, shop, remake; `canRelease` | **Batch B** (3+4) |
| 4 | Pure production moves and board cards | **Batch B** |
| 5 | Lab order and department services | — |
| 6 | Staff API: lab routes, departments, role change, Rx read access | — |
| 7 | Creation flows: Rx release (manual + auto) and checkout | — |
| 8 | Rx form definitions → shared; grouped answers | — |
| 9 | Work ticket PDF (Code 128, model, renderer, route) | — |
| 10 | Web: production board, order detail, staff guard and nav | — |
| 11 | Web: admin departments, admin orders, lab role toggle; doctor My cases | — |
| 12 | Retire the Seazona order path (API + web), release UI | — |
| 13 | Whole-piece verification and PR | — |

---

### Task 1: Piece environment + shared lab-order rules  _(Batch A with Task 2)_

**Files:**
- Create: `packages/shared/src/lab/lab-order-status.js`, `packages/shared/src/lab/lab-order-status.test.js`
- Modify: `packages/shared/src/index.js`

**Interfaces:**
- Produces (from `@my-app/shared`):
  - `LAB_ORDER_STATUSES`, `LAB_BOARD_COLUMNS`, `TERMINAL_LAB_STATUSES`, `REASON_REQUIRED_STATUSES`, `LAB_STATUS_LABELS`, `LAB_TIMEZONE`, `DOCTOR_STATUS_LABELS`;
  - `isTerminalLabStatus(status) → boolean`;
  - `allowedNextStatuses(status, { heldFrom }?) → string[]`;
  - `canMoveLabOrder(from, to, { heldFrom }?) → boolean`;
  - `reasonRequiredFor(to) → boolean`;
  - `isoDateIn(timeZone?, now?) → "YYYY-MM-DD"`;
  - `isOverdue(dueDate, status, todayIso) → boolean`;
  - `doctorStatusFor({ caseStatus, labOrderStatus }) → string`;
  - `currentLabOrder(labOrders) → row|null`;
  - `doctorCaseView(caseRow, labOrders) → { id, caseNumber, patientName, deviceSummary, submittedAt, status, dueDate, isRemake, orderNumber }`.

- [ ] **Step 1: Give the worktree its own database and env**

The worktree's `.env` is a symlink to piece 1's worktree (`../own-the-lab/.env`), which points at `diamond_labs_own_the_lab`. This piece's migrations must not land there.

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2
git branch --show-current            # must print feat/own-the-lab-2-orders
git check-ignore .env apps/api/.env  # both must print — never commit .env
rm .env
cp /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab/.env .env
createdb diamond_labs_own_the_lab_2
pg_dump diamond_labs_own_the_lab | psql -q diamond_labs_own_the_lab_2
sed -i '' 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://bif@localhost:5432/diamond_labs_own_the_lab_2#' .env
ls -l apps/api/.env                  # still ../../.env → now the copied file
pnpm install
grep '^DATABASE_URL' .env | sed -E 's#//[^@]*@#//***@#'   # expect diamond_labs_own_the_lab_2
```

- [ ] **Step 2: Write the failing test**

`packages/shared/src/lab/lab-order-status.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  LAB_ORDER_STATUSES, LAB_BOARD_COLUMNS, LAB_STATUS_LABELS, allowedNextStatuses, canMoveLabOrder,
  reasonRequiredFor, isOverdue, isoDateIn, doctorStatusFor, doctorCaseView,
} from "./lab-order-status.js";

// The whole table, written out. Every pair not listed here must be refused.
const ALLOWED = {
  received: ["in_production", "on_hold", "cancelled"],
  in_production: ["quality_check", "on_hold", "cancelled"],
  quality_check: ["ready_to_ship", "in_production", "on_hold", "cancelled"],
  ready_to_ship: ["shipped", "quality_check", "on_hold", "cancelled"],
  shipped: [],
  cancelled: [],
};

test("every move between non-hold statuses is exactly the table", () => {
  for (const from of Object.keys(ALLOWED)) {
    for (const to of LAB_ORDER_STATUSES) {
      assert.equal(canMoveLabOrder(from, to), ALLOWED[from].includes(to), `${from} → ${to}`);
    }
  }
});

test("an on-hold order resumes where it was held from, or is cancelled — nothing else", () => {
  for (const heldFrom of ["received", "in_production", "quality_check", "ready_to_ship"]) {
    for (const to of LAB_ORDER_STATUSES) {
      const expected = to === heldFrom || to === "cancelled";
      assert.equal(canMoveLabOrder("on_hold", to, { heldFrom }), expected, `on_hold(${heldFrom}) → ${to}`);
    }
  }
});

test("an on-hold row with no usable heldFrom resumes at received instead of being stuck", () => {
  assert.deepEqual(allowedNextStatuses("on_hold"), ["received", "cancelled"]);
  assert.deepEqual(allowedNextStatuses("on_hold", { heldFrom: "shipped" }), ["received", "cancelled"]);
});

test("unknown or missing statuses allow nothing", () => {
  assert.deepEqual(allowedNextStatuses("bogus"), []);
  assert.deepEqual(allowedNextStatuses(undefined), []);
});

test("hold and cancel need a reason; ordinary moves do not", () => {
  assert.equal(reasonRequiredFor("on_hold"), true);
  assert.equal(reasonRequiredFor("cancelled"), true);
  for (const s of ["received", "in_production", "quality_check", "ready_to_ship", "shipped"]) {
    assert.equal(reasonRequiredFor(s), false, s);
  }
});

test("every status has a staff label and every board column is a status", () => {
  for (const s of LAB_ORDER_STATUSES) assert.ok(LAB_STATUS_LABELS[s], s);
  for (const c of LAB_BOARD_COLUMNS) assert.ok(LAB_ORDER_STATUSES.includes(c), c);
});

test("overdue means past due and still open", () => {
  assert.equal(isOverdue("2026-10-01", "in_production", "2026-10-07"), true);
  assert.equal(isOverdue("2026-10-07", "in_production", "2026-10-07"), false);
  assert.equal(isOverdue("2026-10-01", "shipped", "2026-10-07"), false);
  assert.equal(isOverdue("2026-10-01", "cancelled", "2026-10-07"), false);
  assert.equal(isOverdue(null, "received", "2026-10-07"), false);
});

test("the lab's today is computed in the lab's timezone", () => {
  // 03:00 UTC on Oct 8 is still Oct 7 in San Antonio.
  assert.equal(isoDateIn("America/Chicago", new Date("2026-10-08T03:00:00Z")), "2026-10-07");
});

test("doctors see production in plain words", () => {
  assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: "received" }), "Received");
  for (const s of ["in_production", "quality_check", "ready_to_ship"]) {
    assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: s }), "In production");
  }
  assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: "on_hold" }), "On hold");
  assert.equal(doctorStatusFor({ caseStatus: "released", labOrderStatus: "shipped" }), "Shipped");
  assert.equal(doctorStatusFor({ caseStatus: "new" }), "Submitted");
  assert.equal(doctorStatusFor({ caseStatus: "awaiting_doctor" }), "Submitted");
  assert.equal(doctorStatusFor({ caseStatus: "pushed" }), "Sent to lab");
  assert.equal(doctorStatusFor({ caseStatus: "cancelled" }), "Cancelled");
});

const caseRow = {
  id: "c1", caseNumber: "RX-ABC", patientFirst: "Jane", patientLast: "Doe", status: "released",
  createdAt: "2026-10-01T10:00:00Z", dueDate: "2026-10-20",
  deviceOptions: { devices: [{ deviceKey: "ddso", label: "DDSO" }, { deviceKey: "guard", label: "Nightguard" }] },
};

// Review Focus 2.
test("a case on hold shows On hold to the doctor and never the reason, notes, or who has it", () => {
  const held = {
    id: "lo1", orderNumber: 100245, status: "on_hold", holdReason: "Bite is wrong — call Dr Lee about Jane",
    labNotes: "Redo the scan trim", assigneeUserId: "u-tech", departmentId: "d-acrylic",
    dueDate: "2026-10-22", isRemake: false, createdAt: "2026-10-02T10:00:00Z",
  };
  const view = doctorCaseView(caseRow, [held]);
  assert.equal(view.status, "On hold");
  const json = JSON.stringify(view);
  for (const secret of ["Bite is wrong", "Redo the scan", "u-tech", "d-acrylic", "holdReason", "labNotes"]) {
    assert.ok(!json.includes(secret), `leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(view).sort(), [
    "caseNumber", "deviceSummary", "dueDate", "id", "isRemake", "orderNumber", "patientName", "status", "submittedAt",
  ]);
});

test("the newest lab order (a remake) is what the doctor sees", () => {
  const original = { status: "shipped", isRemake: false, orderNumber: 100245, dueDate: "2026-10-10", createdAt: "2026-10-02T10:00:00Z" };
  const remake = { status: "received", isRemake: true, orderNumber: 100300, dueDate: null, createdAt: "2026-10-15T10:00:00Z" };
  const view = doctorCaseView(caseRow, [original, remake]);
  assert.equal(view.status, "Received");
  assert.equal(view.isRemake, true);
  assert.equal(view.orderNumber, 100300);
  assert.equal(view.dueDate, "2026-10-20"); // the remake has no due date yet → the case's requested date
  assert.equal(view.deviceSummary, "DDSO, Nightguard");
  assert.equal(view.patientName, "Jane Doe");
});

test("a case not yet released has no lab order", () => {
  const view = doctorCaseView({ ...caseRow, status: "in_review" }, []);
  assert.equal(view.status, "Submitted");
  assert.equal(view.orderNumber, null);
  assert.equal(view.isRemake, false);
});

test("a case whose PHI failed to decrypt still renders", () => {
  const view = doctorCaseView({ id: "c2", caseNumber: "RX-X", status: "new", patientFirst: null, patientLast: null, deviceOptions: null }, []);
  assert.equal(view.patientName, null);
  assert.equal(view.deviceSummary, null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/shared && pnpm vitest run src/lab/lab-order-status.test.js`
Expected: FAIL — cannot resolve `./lab-order-status.js`.

- [ ] **Step 4: Implement**

`packages/shared/src/lab/lab-order-status.js`:

```js
/**
 * Lab order status rules — the ONE table both the API (lab-order-rules.js,
 * lab.routes.js) and the web (board, order detail, doctor "My cases") read,
 * so a move the UI offers is a move the API accepts.
 *
 *   received → in_production → quality_check → ready_to_ship → shipped
 *   quality_check → in_production    (failed QC goes back to the bench)
 *   ready_to_ship → quality_check    (caught at packing)
 *   any non-terminal → on_hold (reason) → back to where it was held from
 *   any non-terminal → cancelled (reason)
 */
export const LAB_ORDER_STATUSES = [
  "received", "in_production", "quality_check", "ready_to_ship", "shipped", "on_hold", "cancelled",
];

/** Board columns, left to right. Cancelled orders live on Admin › Orders, not the board. */
export const LAB_BOARD_COLUMNS = [
  "received", "in_production", "quality_check", "ready_to_ship", "on_hold", "shipped",
];

export const TERMINAL_LAB_STATUSES = ["shipped", "cancelled"];
export const REASON_REQUIRED_STATUSES = ["on_hold", "cancelled"];

const FLOW = {
  received: ["in_production"],
  in_production: ["quality_check"],
  quality_check: ["ready_to_ship", "in_production"],
  ready_to_ship: ["shipped", "quality_check"],
};

export const LAB_STATUS_LABELS = {
  received: "Received",
  in_production: "In production",
  quality_check: "Quality check",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export function isTerminalLabStatus(status) {
  return TERMINAL_LAB_STATUSES.includes(status);
}

/**
 * Every status `status` may move to. `heldFrom` is where an on-hold order
 * resumes; an on-hold row without a usable one resumes at received rather
 * than being stuck with no way out but cancel.
 */
export function allowedNextStatuses(status, { heldFrom = null } = {}) {
  if (!LAB_ORDER_STATUSES.includes(status) || isTerminalLabStatus(status)) return [];
  if (status === "on_hold") {
    const resume = FLOW[heldFrom] ? heldFrom : "received";
    return [resume, "cancelled"];
  }
  return [...FLOW[status], "on_hold", "cancelled"];
}

export function canMoveLabOrder(from, to, opts) {
  return allowedNextStatuses(from, opts).includes(to);
}

export function reasonRequiredFor(to) {
  return REASON_REQUIRED_STATUSES.includes(to);
}

/** The lab is in San Antonio; "today" for due dates is the lab's today. */
export const LAB_TIMEZONE = "America/Chicago";

/** "YYYY-MM-DD" for `now` in `timeZone`. */
export function isoDateIn(timeZone = LAB_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Past its due date and still open. Due dates are "YYYY-MM-DD", so string order is date order. */
export function isOverdue(dueDate, status, todayIso) {
  if (!dueDate || isTerminalLabStatus(status)) return false;
  return dueDate < todayIso;
}

// ── Doctor-facing view ─────────────────────────────────────────────────────
// Doctors see production in plain words. Hold reasons, lab notes, assignee
// and department are staff-only: doctorCaseView builds its result from an
// explicit allow-list, so a column added to lab_orders later can never reach
// a doctor by default.

export const DOCTOR_STATUS_LABELS = {
  received: "Received",
  in_production: "In production",
  quality_check: "In production",
  ready_to_ship: "In production",
  on_hold: "On hold",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

export function doctorStatusFor({ caseStatus, labOrderStatus } = {}) {
  if (labOrderStatus) return DOCTOR_STATUS_LABELS[labOrderStatus] ?? "In production";
  if (caseStatus === "cancelled") return "Cancelled";
  if (caseStatus === "pushed") return "Sent to lab";
  return "Submitted";
}

/** The lab order that represents a case now: the newest (a remake supersedes the original). */
export function currentLabOrder(labOrders = []) {
  return [...labOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null;
}

/**
 * One row of a doctor's "My cases".
 * @param {object} caseRow   DECRYPTED rx_cases row (or the redacted placeholder a failed decrypt yields)
 * @param {Array}  labOrders lab_orders rows for this case — only allow-listed fields are read
 */
export function doctorCaseView(caseRow, labOrders = []) {
  const current = currentLabOrder(labOrders);
  const devices = caseRow?.deviceOptions?.devices ?? [];
  return {
    id: caseRow.id,
    caseNumber: caseRow.caseNumber,
    patientName: `${caseRow.patientFirst ?? ""} ${caseRow.patientLast ?? ""}`.trim() || null,
    deviceSummary: devices.map((d) => d.label || d.deviceKey).filter(Boolean).join(", ") || null,
    submittedAt: caseRow.createdAt,
    status: doctorStatusFor({ caseStatus: caseRow.status, labOrderStatus: current?.status }),
    dueDate: current?.dueDate ?? caseRow.dueDate ?? null,
    isRemake: Boolean(current?.isRemake),
    orderNumber: current?.orderNumber ?? null,
  };
}
```

`packages/shared/src/index.js` — append:

```js
// Lab
export * from "./lab/lab-order-status.js";
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/shared && pnpm vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/lab packages/shared/src/index.js
git commit -m "feat(lab): shared lab-order status table and doctor-facing view

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 2: Lab tables, `lab` role, migration  _(Batch A with Task 1)_

**Files:**
- Create: `apps/api/src/db/schema/lab-orders.js`, `apps/api/src/db/schema/lab-orders.test.js`
- Modify: `apps/api/src/db/schema/users.js`, `apps/api/src/db/schema/index.js`
- Generated: `apps/api/src/db/migrations/0027_*.sql` + `meta/0027_snapshot.json`, `meta/_journal.json`

**Interfaces:**
- Produces (Drizzle tables from `db/schema/index.js`):
  - `labDepartments`;
  - `labOrders`;
  - `labOrderLines`;
  - `labOrderEvents` (JS keys `from` / `to`, columns `from_value` / `to_value`);
  - `userRoleEnum.enumValues === ["user","doctor","admin","lab"]`.
- Column names used by later tasks:
  - `labOrders`: `id, orderNumber, source, sourceId, clientUserId, status, heldFrom, departmentId, assigneeUserId, dueDate ("YYYY-MM-DD" string), rush, rushTier, isRemake, remakeOfOrderId, holdReason, labNotes, version, receivedAt, startedAt, shippedAt, cancelledAt, createdAt, updatedAt`;
  - `labOrderLines`: `id, labOrderId, position, variantId, code, name, arch, qty, noteOnly, sourceLabel, createdAt`;
  - `labOrderEvents`: `id, labOrderId, type, from, to, byUserId, note, at`;
  - `labDepartments`: `id, name, position, active, createdAt, updatedAt`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/schema/lab-orders.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { labOrders, labOrderLines, labOrderEvents, labDepartments, userRoleEnum } from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};

test("lab orders carry the production fields the board, ticket and doctor view read", () => {
  has(labOrders, [
    "id", "orderNumber", "source", "sourceId", "clientUserId", "status", "heldFrom", "departmentId",
    "assigneeUserId", "dueDate", "rush", "rushTier", "isRemake", "remakeOfOrderId", "holdReason", "labNotes",
    "version", "receivedAt", "startedAt", "shippedAt", "cancelledAt", "createdAt", "updatedAt",
  ]);
  assert.equal(labOrders.version.notNull, true);
  assert.equal(labOrders.clientUserId.notNull, false, "guest shop orders have no client");
  assert.equal(labOrders.orderNumber.notNull, true);
});

test("lines are a snapshot, events are the history, departments are the lab's own", () => {
  has(labOrderLines, ["id", "labOrderId", "position", "variantId", "code", "name", "arch", "qty", "noteOnly", "sourceLabel"]);
  has(labOrderEvents, ["id", "labOrderId", "type", "from", "to", "byUserId", "note", "at"]);
  has(labDepartments, ["id", "name", "position", "active"]);
});

test("the user role enum gains lab, appended (existing values keep their order)", () => {
  assert.deepEqual(userRoleEnum.enumValues, ["user", "doctor", "admin", "lab"]);
});

// drizzle's migrator applies every pending migration in ONE transaction, and
// Postgres can't USE an enum value added in the same transaction. So the
// migration that adds 'lab' must be the only SQL that mentions it.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

test("no migration uses the 'lab' role value — it is only ever added", () => {
  const hits = [];
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    for (const line of sql.split("\n")) if (line.includes("'lab'")) hits.push(`${f}: ${line.trim()}`);
  }
  assert.equal(hits.length, 1, `expected exactly the ADD VALUE line, got:\n${hits.join("\n")}`);
  assert.match(hits[0], /ALTER TYPE "public"\."user_role" ADD VALUE 'lab';/);
});

test("a remake may share its source; an original may not (partial unique index)", () => {
  const latest = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort().at(-1);
  const sql = readFileSync(join(migrationsDir, latest), "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX "lab_orders_source_idx" ON "lab_orders" USING btree \("source","source_id"\) WHERE is_remake = false/);
  assert.match(sql, /CREATE UNIQUE INDEX "lab_orders_order_number_idx"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/db/schema/lab-orders.test.js`
Expected: FAIL — `labOrders` is undefined.

- [ ] **Step 3: Implement the tables**

`apps/api/src/db/schema/lab-orders.js`:

```js
import { sql } from "drizzle-orm";
import { pgTable, varchar, text, integer, boolean, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Lab orders: one job on the bench. Every Rx case released to the lab and
// every paid shop order produces exactly one (a remake adds another, flagged
// isRemake). Patient data is NOT copied here — a lab order references its
// case (source = "rx_case", sourceId = rx_cases.id) and reads PHI from there.
//
// Free text staff type (holdReason, labNotes, event notes) is encrypted at
// rest by services/lab/lab-orders.service.js (enc:v1:, lib/crypto.js), the
// same treatment rx_cases.manualNote got in B4.
//
// No DB foreign keys (repo convention); services/lab holds integrity inside
// transactions.

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** The lab's own rooms/benches. Deactivated, never deleted (orders point at them). */
export const labDepartments = pgTable("lab_departments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...stamps,
}, (t) => [uniqueIndex("lab_departments_name_idx").on(t.name)]);

export const labOrders = pgTable("lab_orders", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Continues the lab's paperwork numbering from LAB_ORDER_NUMBER_START
  // (lab-orders.service allocateOrderNumber, under an advisory lock).
  orderNumber: integer("order_number").notNull(),
  // rx_case | shop_order
  source: varchar("source", { length: 20 }).notNull(),
  sourceId: varchar("source_id", { length: 128 }).notNull(),
  // The doctor (Rx) or the approved doctor the shop order was priced for;
  // null for a guest shop order.
  clientUserId: varchar("client_user_id", { length: 128 }),
  // packages/shared lab-order-status.js owns the vocabulary and every move.
  status: varchar("status", { length: 30 }).notNull().default("received"),
  // Where an on_hold order resumes.
  heldFrom: varchar("held_from", { length: 30 }),
  departmentId: varchar("department_id", { length: 128 }),
  assigneeUserId: varchar("assignee_user_id", { length: 128 }),
  dueDate: date("due_date", { mode: "string" }),
  rush: boolean("rush").notNull().default(false),
  rushTier: varchar("rush_tier", { length: 40 }),
  isRemake: boolean("is_remake").notNull().default(false),
  remakeOfOrderId: varchar("remake_of_order_id", { length: 128 }),
  // Encrypted free text (see header).
  holdReason: text("hold_reason"),
  labNotes: text("lab_notes"),
  // Optimistic concurrency: every mutation increments it; a client that saw
  // an older version gets 409 "This order changed — reload".
  version: integer("version").notNull().default(1),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  ...stamps,
}, (t) => [
  uniqueIndex("lab_orders_order_number_idx").on(t.orderNumber),
  // One ORIGINAL lab order per case / shop order. Remakes share the source.
  uniqueIndex("lab_orders_source_idx").on(t.source, t.sourceId).where(sql`is_remake = false`),
  index("lab_orders_source_lookup_idx").on(t.source, t.sourceId),
  index("lab_orders_status_idx").on(t.status),
  index("lab_orders_client_idx").on(t.clientUserId),
]);

/** Snapshotted at release: later catalog or case edits never change a job on the bench. */
export const labOrderLines = pgTable("lab_order_lines", {
  id: varchar("id", { length: 128 }).primaryKey(),
  labOrderId: varchar("lab_order_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  variantId: varchar("variant_id", { length: 128 }),
  // The lab's product code the bench reads ("2608"). Null on instruction lines.
  code: varchar("code", { length: 60 }),
  name: text("name").notNull(),
  arch: varchar("arch", { length: 20 }),
  qty: integer("qty").notNull().default(1),
  // A build instruction, not a product (rx_case_lines.noteOnly).
  noteOnly: boolean("note_only").notNull().default(false),
  sourceLabel: text("source_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("lab_order_lines_order_idx").on(t.labOrderId)]);

/** Append-only history; drives the timeline. type: status | assign | department | due | note | hold | release */
export const labOrderEvents = pgTable("lab_order_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  labOrderId: varchar("lab_order_id", { length: 128 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  from: varchar("from_value", { length: 128 }),
  to: varchar("to_value", { length: 128 }),
  // Null for system actions (checkout, auto-release).
  byUserId: varchar("by_user_id", { length: 128 }),
  // Encrypted free text.
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("lab_order_events_order_idx").on(t.labOrderId, t.at)]);
```

`apps/api/src/db/schema/users.js` — change the role enum line:

```js
// `lab` (own-the-lab piece 2): technicians — production board, order detail,
// Rx cases (read + release), case files and work tickets. Never pricing,
// payments, users or the catalog editor. Admins can do everything lab can.
export const userRoleEnum = pgEnum("user_role", ["user", "doctor", "admin", "lab"]);
```

`apps/api/src/db/schema/index.js` — append:

```js
export { labDepartments, labOrders, labOrderLines, labOrderEvents } from "./lab-orders.js";
```

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate`
Expected: a new `src/db/migrations/0027_<name>.sql` containing:
- `ALTER TYPE "public"."user_role" ADD VALUE 'lab';`;
- four `CREATE TABLE` statements;
- `CREATE UNIQUE INDEX "lab_orders_source_idx" ON "lab_orders" USING btree ("source","source_id") WHERE is_remake = false;`.

Do not edit it. If drizzle-kit asks an interactive rename question, answer "create table" (every table is new).

Check that nothing else in the migration mentions `'lab'`:

```bash
grep -n "'lab'" apps/api/src/db/migrations/0027_*.sql   # exactly one line: the ADD VALUE
```

- [ ] **Step 5: Apply it locally and run the suite**

```bash
cd apps/api && pnpm db:migrate
psql diamond_labs_own_the_lab_2 -c "select unnest(enum_range(null::user_role))"   # user, doctor, admin, lab
pnpm vitest run
pnpm db:generate   # expect "No schema changes"
```
Expected: the migration applies in one transaction without error, and every test passes, including `lab-orders.test.js`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema apps/api/src/db/migrations
git commit -m "feat(lab): lab order tables and the lab staff role

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 3: Pure planners — numbering, due/rush, release, shop, remake; `canRelease`  _(Batch B with Task 4)_

**Files:**
- Create: `apps/api/src/services/lab/lab-order-rules.js`, `apps/api/src/services/lab/lab-order-rules.test.js`
- Modify:
  - `apps/api/src/services/rx/case-gates.js` and its test `case-gates.test.js`;
  - rename `canPush` → `canRelease` in every importer: `routes/admin-rx-cases.routes.js`, `routes/rx.routes.js`, `services/rx/push-case.service.js`, `services/rx/push-case.service.test.js`, `routes/__tests__/admin-rx-cases.test.js`, `services/rx/catalog-map/resolvers/ortho.review-fixes.test.js`, `apps/api/scripts/rx-replay/run.mjs`, `apps/api/scripts/rx-replay/report.js`;
  - `routes/__tests__/rx-status-vocabulary.test.js` (the status count).

**Interfaces:**
- Consumes: `canRelease(lines)` (case-gates).
- Produces from `services/rx/case-gates.js`:
  - `CASE_STATUSES` now includes `"released"`;
  - `isFrozen(status)` is true for `pushed` and `released`;
  - `canTransition` refuses any move *to* `released` / `pushed` and any move *from* a frozen status;
  - `canRelease(lines) → { ok, reason?, blocking? }` (renamed `canPush`, same rule);
  - `releaseRefusal(caseRow, { confirmNotInSeazona }?) → null | { status: 409, error: { code, status, message } }`.
- Produces from `services/lab/lab-order-rules.js`:
  - `class LabOrderError(code, message, extra?)`. Codes: `NOT_FOUND`, `STALE`, `INVALID_TRANSITION`, `REASON_REQUIRED`, `INVALID`, `RELEASE_BLOCKED`, `ALREADY_RELEASED`, `CONFLICT`. `extra` may carry `allowed` or `blocking`;
  - `nextLabOrderNumber(maxExisting, start) → integer`;
  - `parseDueDate(value) → "YYYY-MM-DD" | null`;
  - `rushFromCase(caseRow) → { rush, rushTier }`;
  - `planRxRelease({ caseRow, lines, variantIdByCode, orderNumber, labOrderId, byUserId, now }) → { labOrder, lines, event, unknownCodes }` (throws `RELEASE_BLOCKED`);
  - `planShopLabOrder({ orderId, clientUserId, quoteLines, orderNumber, labOrderId, now }) → { labOrder, lines, event }`;
  - `planRemake({ original, originalLines, reason, orderNumber, labOrderId, byUserId, now }) → { labOrder, lines, events }` (throws `INVALID` / `REASON_REQUIRED`).
  - Planned rows have no `id` (except `labOrder.id = labOrderId`); the service adds ids.

- [ ] **Step 1: Rename `canPush` → `canRelease` everywhere (mechanical)**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2
grep -rl --exclude-dir=node_modules --include='*.js' --include='*.mjs' '\bcanPush\b' apps/api | xargs perl -pi -e 's/\bcanPush\b/canRelease/g'
grep -rn --exclude-dir=node_modules '\bcanPush\b' apps/api packages   # expect no output
```

In `services/rx/push-case.service.test.js`, the circular-import test's regex follows the rename automatically (`/canRelease.*from\s+["']\.\/case-gates\.js["']/`). In `scripts/rx-replay/report.js`, the summary line now reads "canRelease ok"; leave it.

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/src/services/rx/case-gates.test.js`:

```js
import { CASE_STATUSES, canTransition, isFrozen, releaseRefusal } from "./case-gates.js";

test("released is a case status, and a released case is frozen like a pushed one", () => {
  assert.ok(CASE_STATUSES.includes("released"));
  assert.equal(isFrozen("released"), true);
  assert.equal(isFrozen("pushed"), true);
  assert.equal(isFrozen("in_review"), false);
});

test("only the release route moves a case to released; nothing moves it back", () => {
  assert.equal(canTransition("in_review", "released"), false);
  assert.equal(canTransition("in_review", "pushed"), false, "pushed is legacy — no new case may enter it");
  assert.equal(canTransition("released", "in_review"), false);
  assert.equal(canTransition("released", "cancelled"), false);
  assert.equal(canTransition("failed", "in_review"), true);
});

// Review Focus 3.
test("a case whose Seazona push never confirmed is not released until staff say they checked", () => {
  const stuck = { status: "failed", seazonaPushStatus: "pushing" };
  const r = releaseRefusal(stuck);
  assert.equal(r.status, 409);
  assert.equal(r.error.code, "LEGACY_PUSH_UNCONFIRMED");
  assert.match(r.error.message, /Check Seazona/);
  assert.equal(releaseRefusal(stuck, { confirmNotInSeazona: true }), null);
});

test("release refuses released, legacy-pushed and cancelled cases with distinct codes", () => {
  assert.equal(releaseRefusal({ status: "released" }).error.code, "CASE_ALREADY_RELEASED");
  assert.equal(releaseRefusal({ status: "pushed" }).error.code, "CASE_ALREADY_PUSHED");
  assert.equal(releaseRefusal({ status: "cancelled" }).error.code, "CASE_CANCELLED");
  assert.equal(releaseRefusal({ status: "in_review", seazonaPushStatus: null }), null);
  assert.equal(releaseRefusal({ status: "new", seazonaPushStatus: "failed" }), null);
});
```

(The file already imports `test`, `assert` and `canRelease`. Merge the new names into its existing `./case-gates.js` import rather than adding a duplicate import line.)

`apps/api/src/services/lab/lab-order-rules.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  LabOrderError, nextLabOrderNumber, parseDueDate, rushFromCase, planRxRelease, planShopLabOrder, planRemake,
} from "./lab-order-rules.js";

const now = new Date("2026-10-07T15:00:00Z");
const isCode = (code) => (err) => err instanceof LabOrderError && err.code === code;

test("order numbers continue from the start and never reuse one", () => {
  assert.equal(nextLabOrderNumber(null, 100000), 100000);
  assert.equal(nextLabOrderNumber(100244, 100000), 100245);
  assert.equal(nextLabOrderNumber(12, 100000), 100000, "raising the start later jumps ahead");
  assert.throws(() => nextLabOrderNumber(null, 0), RangeError);
  assert.throws(() => nextLabOrderNumber(null, 1.5), RangeError);
});

test("due dates must be real YYYY-MM-DD dates", () => {
  assert.equal(parseDueDate("2026-10-21"), "2026-10-21");
  assert.equal(parseDueDate(" 2026-10-21 "), "2026-10-21");
  assert.equal(parseDueDate("2026-02-30"), null);
  assert.equal(parseDueDate("10/21/2026"), null);
  assert.equal(parseDueDate(""), null);
  assert.equal(parseDueDate(undefined), null);
});

// Review Focus 4.
test("rush comes from the live form's answers, since the form never sets rx_cases.rush", () => {
  assert.deepEqual(rushFromCase({ rush: false, formData: { rushCase: ["Yes"], rushChargeNylon: "Expedited" } }),
    { rush: true, rushTier: "Expedited" });
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"], rushChargeNylon: "Max Rush", rushChargeBiomed: "Standard" } }),
    { rush: true, rushTier: "Max Rush / Standard" });
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"], rushChargeNylon: "Standard", rushChargeBiomed: "Standard" } }),
    { rush: true, rushTier: "Standard" });
});

test("asking for a rush then choosing No Rush everywhere is not a rush; a tick with no tier still is", () => {
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"], rushChargeNylon: "No Rush", rushChargeBiomed: "No Rush" } }),
    { rush: false, rushTier: null });
  assert.deepEqual(rushFromCase({ formData: { rushCase: ["Yes"] } }), { rush: true, rushTier: null });
  assert.deepEqual(rushFromCase({ formData: { rushChargeNylon: "Expedited" } }), { rush: false, rushTier: null });
  assert.deepEqual(rushFromCase({}), { rush: false, rushTier: null });
});

test("the retired wizard's rush columns still win when set", () => {
  assert.deepEqual(rushFromCase({ rush: true, rushTier: "nylon", formData: null }), { rush: true, rushTier: "nylon" });
});

const caseRow = {
  id: "case-1", userId: "doc-1", status: "in_review", dueDate: null,
  formData: { dueDate: "2026-10-21", rushCase: ["Yes"], rushChargeNylon: "Expedited" },
};
const lines = [
  { mapKey: "primary:ddso:nylon", seazonaCode: "2608", name: "DDSO Nylon", arch: "Upper", status: "confirmed", noteOnly: false, sourceLabel: null },
  { mapKey: "mod:wrap-distal", seazonaCode: null, name: null, arch: null, status: "open", noteOnly: true, sourceLabel: "Wrap distal of last molars" },
  { mapKey: "service:model-fab", seazonaCode: "2367", name: "Model fabrication", arch: null, status: "confirmed", noteOnly: false, sourceLabel: null },
];

test("a released case becomes a received lab order with its lines snapshotted in order", () => {
  const plan = planRxRelease({
    caseRow, lines, variantIdByCode: new Map([["2608", "var-2608"]]),
    orderNumber: 100245, labOrderId: "lo-1", byUserId: "staff-1", now,
  });
  assert.equal(plan.labOrder.id, "lo-1");
  assert.equal(plan.labOrder.orderNumber, 100245);
  assert.equal(plan.labOrder.source, "rx_case");
  assert.equal(plan.labOrder.sourceId, "case-1");
  assert.equal(plan.labOrder.clientUserId, "doc-1");
  assert.equal(plan.labOrder.status, "received");
  assert.equal(plan.labOrder.version, 1);
  assert.equal(plan.labOrder.dueDate, "2026-10-21", "falls back to formData.dueDate");
  assert.equal(plan.labOrder.rush, true);
  assert.equal(plan.labOrder.rushTier, "Expedited");
  assert.equal(plan.labOrder.isRemake, false);
  assert.deepEqual(plan.lines.map((l) => [l.position, l.code, l.variantId, l.noteOnly, l.name]), [
    [0, "2608", "var-2608", false, "DDSO Nylon"],
    [1, null, null, true, "Wrap distal of last molars"],
    [2, "2367", null, false, "Model fabrication"],
  ]);
  assert.equal(plan.lines[0].arch, "Upper");
  assert.ok(plan.lines.every((l) => l.labOrderId === "lo-1" && l.qty === 1));
  assert.deepEqual(plan.unknownCodes, ["2367"], "a code with no catalog variant is kept and reported");
  assert.deepEqual(plan.event, { labOrderId: "lo-1", type: "release", from: "in_review", to: "received", byUserId: "staff-1", note: null, at: now });
});

test("release re-checks the gate itself and refuses a case with an unresolved line", () => {
  const open = [...lines, { mapKey: "mod:anterior-pad", seazonaCode: null, status: "open", noteOnly: false, sourceLabel: "Anterior Pad" }];
  assert.throws(
    () => planRxRelease({ caseRow, lines: open, orderNumber: 1, labOrderId: "x", now }),
    (err) => isCode("RELEASE_BLOCKED")(err) && err.blocking.includes("mod:anterior-pad"),
  );
  assert.throws(() => planRxRelease({ caseRow, lines: [], orderNumber: 1, labOrderId: "x", now }), isCode("RELEASE_BLOCKED"));
});

test("a case's own dueDate column wins over the form answer", () => {
  const plan = planRxRelease({ caseRow: { ...caseRow, dueDate: "2026-11-01" }, lines, orderNumber: 1, labOrderId: "x", now });
  assert.equal(plan.labOrder.dueDate, "2026-11-01");
  const junk = planRxRelease({ caseRow: { ...caseRow, dueDate: "next week", formData: {} }, lines, orderNumber: 1, labOrderId: "x", now });
  assert.equal(junk.labOrder.dueDate, null);
});

// Review Focus 5.
test("a guest's shop order with a codeless item still makes a lab order — checkout already charged the card", () => {
  const plan = planShopLabOrder({
    orderId: "ord-1", clientUserId: null, orderNumber: 100246, labOrderId: "lo-2", now,
    quoteLines: [
      { variantId: "v-kit", code: null, name: "Bite registration kit", qty: 3, unitCents: 1999 },
      { variantId: "v-case", code: "4410", name: "Retainer case", qty: 1, unitCents: 500 },
    ],
  });
  assert.equal(plan.labOrder.source, "shop_order");
  assert.equal(plan.labOrder.sourceId, "ord-1");
  assert.equal(plan.labOrder.clientUserId, null);
  assert.equal(plan.labOrder.status, "received");
  assert.deepEqual(plan.lines.map((l) => [l.position, l.variantId, l.code, l.qty, l.name]), [
    [0, "v-kit", null, 3, "Bite registration kit"],
    [1, "v-case", "4410", 1, "Retainer case"],
  ]);
  assert.ok(!("unitCents" in plan.lines[0]), "lab lines carry no money");
  assert.equal(plan.event.type, "release");
  assert.equal(plan.event.from, "paid");
});

const shipped = {
  id: "lo-1", orderNumber: 100245, status: "shipped", source: "rx_case", sourceId: "case-1", clientUserId: "doc-1",
};
const shippedLines = [
  { id: "l1", labOrderId: "lo-1", position: 0, variantId: "var-2608", code: "2608", name: "DDSO Nylon", arch: "Upper", qty: 1, noteOnly: false, sourceLabel: null },
];

test("a remake is a new received order for the same case, pointing back at the original", () => {
  const plan = planRemake({ original: shipped, originalLines: shippedLines, reason: " Cracked on seating ", orderNumber: 100300, labOrderId: "lo-9", byUserId: "staff-1", now });
  assert.equal(plan.labOrder.isRemake, true);
  assert.equal(plan.labOrder.remakeOfOrderId, "lo-1");
  assert.equal(plan.labOrder.source, "rx_case");
  assert.equal(plan.labOrder.sourceId, "case-1");
  assert.equal(plan.labOrder.status, "received");
  assert.equal(plan.labOrder.dueDate, null);
  assert.equal(plan.lines[0].code, "2608");
  assert.equal(plan.lines[0].labOrderId, "lo-9");
  assert.ok(!("id" in plan.lines[0]), "copied lines get fresh ids from the service");
  assert.deepEqual(plan.events.map((e) => [e.labOrderId, e.type, e.note]), [
    ["lo-9", "release", "Remake of #100245: Cracked on seating"],
    ["lo-1", "note", "Remake created: #100300"],
  ]);
});

test("only a shipped order can be remade, and only with a reason", () => {
  assert.throws(() => planRemake({ original: { ...shipped, status: "in_production" }, originalLines: [], reason: "x", orderNumber: 1, labOrderId: "x", now }), isCode("INVALID"));
  assert.throws(() => planRemake({ original: shipped, originalLines: [], reason: "   ", orderNumber: 1, labOrderId: "x", now }), isCode("REASON_REQUIRED"));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/lab src/services/rx/case-gates.test.js`
Expected: FAIL — `./lab-order-rules.js` doesn't exist; `releaseRefusal` is undefined; `released` is not in `CASE_STATUSES`.

- [ ] **Step 4: Implement `case-gates.js` changes**

In `apps/api/src/services/rx/case-gates.js`:

Replace `CASE_STATUSES` (keep its docstring and add one line to it: "`released` = on the production board (own-the-lab piece 2); `pushed` is legacy (sent to Seazona before the cutover) and no new case enters it."):

```js
export const CASE_STATUSES = [
  "new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled",
];
```

Replace the body of `canTransition` (and add to its docstring: "`released` is entered only through POST /admin/rx-cases/:id/release, which also creates the lab order; `pushed` is legacy-only."):

```js
export function canTransition(from, to) {
  if (!CASE_STATUSES.includes(from)) return false;
  if (!CASE_STATUSES.includes(to)) return false;
  if (isFrozen(from)) return false;
  if (to === "released" || to === "pushed") return false;
  return true;
}
```

Replace `isFrozen`:

```js
export function isFrozen(status) {
  return status === "pushed" || status === "released";
}
```

Update `canRelease`'s first refusal message to `"This case has no lines to release."`. Rewrite its docstring's first lines to say "Whether a case may be released to the lab … never release a partial job." The rule itself doesn't change.

Append:

```js
/**
 * Why a case can't be released right now, or null. Runs BEFORE the line gate
 * (canRelease) — these refusals don't depend on the lines.
 *
 * A case left at seazonaPushStatus "pushing" had a Seazona push start and
 * never confirm: the order may exist there. clear-push-lock is gone (piece
 * 2), so the human check it forced moves here — release is refused until the
 * request says staff checked Seazona (confirmNotInSeazona: true).
 *
 * @returns {null | { status: 409, error: { code: string, status: 409, message: string } }}
 */
export function releaseRefusal(caseRow, { confirmNotInSeazona = false } = {}) {
  const refuse = (code, message) => ({ status: 409, error: { code, status: 409, message } });
  if (caseRow.status === "released") {
    return refuse("CASE_ALREADY_RELEASED", "This case is already on the production board.");
  }
  if (caseRow.status === "pushed") {
    return refuse("CASE_ALREADY_PUSHED", "This case was sent to Seazona before the lab moved to the portal. It is tracked there.");
  }
  if (caseRow.status === "cancelled") {
    return refuse("CASE_CANCELLED", "This case is cancelled. Move it back to In review before releasing it.");
  }
  if (caseRow.seazonaPushStatus === "pushing" && !confirmNotInSeazona) {
    return refuse(
      "LEGACY_PUSH_UNCONFIRMED",
      "A Seazona push for this case started and was never confirmed. Check Seazona for an order first; if there is none, release again and confirm.",
    );
  }
  return null;
}
```

Update the existing tests that pinned the old vocabulary:
- `routes/__tests__/admin-rx-cases.test.js`: the test titled "the six agreed states exist and nothing else" becomes "the seven agreed states exist and nothing else", expecting `["awaiting_doctor", "cancelled", "failed", "in_review", "new", "pushed", "released"]`.
- In "a non-pushed case is not frozen…", keep the list `["new", "in_review", "awaiting_doctor", "failed", "cancelled"]`; it still holds.
- `routes/__tests__/rx-status-vocabulary.test.js` needs no change. `DEFAULT_QUEUE_STATUSES` is still a subset of `CASE_STATUSES`.

- [ ] **Step 5: Implement the planners**

`apps/api/src/services/lab/lab-order-rules.js`:

```js
import { canRelease } from "../rx/case-gates.js";

/**
 * Pure rules for lab orders: numbering, and turning a released Rx case, a
 * paid shop order or a remake into the rows to insert. No DB and no clock —
 * callers pass ids and `now` — so every rule here is unit-tested and
 * lab-orders.service.js only runs the plans inside a transaction.
 */

export class LabOrderError extends Error {
  /**
   * @param {"NOT_FOUND"|"STALE"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"INVALID"|"RELEASE_BLOCKED"|"ALREADY_RELEASED"|"CONFLICT"} code
   * @param {string} message  safe to show staff
   * @param {{ allowed?: string[], blocking?: string[] }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "LabOrderError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/** The next order number: continues from `start`, never reuses one. */
export function nextLabOrderNumber(maxExisting, start) {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new RangeError(`LAB_ORDER_NUMBER_START must be a positive integer, got ${start}`);
  }
  if (maxExisting == null) return start;
  return Math.max(Number(maxExisting) + 1, start);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A "YYYY-MM-DD" that is a real calendar date, else null. */
export function parseDueDate(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

const NO_RUSH = "No Rush";

/**
 * Whether the doctor asked for a rush, and which tier. The live form never
 * writes rx_cases.rush — the answer lives in formData: `rushCase` (["Yes"])
 * plus a tier per material, `rushChargeNylon` / `rushChargeBiomed`
 * (rx-common.sections.js). The retired wizard wrote the columns, so they win
 * when set.
 */
export function rushFromCase(caseRow = {}) {
  if (caseRow.rush) return { rush: true, rushTier: caseRow.rushTier ?? null };
  const f = caseRow.formData || {};
  if (![].concat(f.rushCase ?? []).includes("Yes")) return { rush: false, rushTier: null };
  const picks = [f.rushChargeNylon, f.rushChargeBiomed].filter((t) => typeof t === "string" && t !== "");
  const tiers = [...new Set(picks.filter((t) => t !== NO_RUSH))];
  if (picks.length > 0 && tiers.length === 0) return { rush: false, rushTier: null };
  return { rush: true, rushTier: tiers.length ? tiers.join(" / ").slice(0, 40) : null };
}

function newOrder({ labOrderId, orderNumber, source, sourceId, clientUserId, now }) {
  return {
    id: labOrderId, orderNumber, source, sourceId, clientUserId: clientUserId ?? null,
    status: "received", heldFrom: null, departmentId: null, assigneeUserId: null,
    dueDate: null, rush: false, rushTier: null, isRemake: false, remakeOfOrderId: null,
    holdReason: null, labNotes: null, version: 1,
    receivedAt: now, startedAt: null, shippedAt: null, cancelledAt: null, createdAt: now, updatedAt: now,
  };
}

/**
 * A released Rx case → its lab order, line snapshot and release event.
 *
 * `lines` are the case's STORED rx_case_lines in position order (staff
 * corrections included). The gate is re-checked here so no caller can
 * release a partial job. `variantIdByCode` maps a lab code to its catalog
 * variant; a code with no variant is kept (the code is what the bench reads)
 * and reported in `unknownCodes` for invoicing (piece 3) to catch.
 */
export function planRxRelease({ caseRow, lines, variantIdByCode = new Map(), orderNumber, labOrderId, byUserId = null, now }) {
  const gate = canRelease(lines);
  if (!gate.ok) throw new LabOrderError("RELEASE_BLOCKED", gate.reason, { blocking: gate.blocking ?? [] });
  const labOrder = {
    ...newOrder({ labOrderId, orderNumber, source: "rx_case", sourceId: caseRow.id, clientUserId: caseRow.userId, now }),
    dueDate: parseDueDate(caseRow.dueDate) ?? parseDueDate(caseRow.formData?.dueDate),
    ...rushFromCase(caseRow),
  };
  const unknownCodes = [];
  const orderLines = lines.map((l, position) => {
    const code = l.noteOnly ? null : (l.seazonaCode ?? null);
    const variantId = code ? (variantIdByCode.get(code) ?? null) : null;
    if (code && !variantId && !unknownCodes.includes(code)) unknownCodes.push(code);
    return {
      labOrderId, position, variantId, code,
      name: l.name || l.sourceLabel || l.mapKey || "Unnamed line",
      arch: l.arch ?? null, qty: 1, noteOnly: Boolean(l.noteOnly), sourceLabel: l.sourceLabel ?? null,
    };
  });
  const event = { labOrderId, type: "release", from: caseRow.status ?? null, to: "received", byUserId, note: null, at: now };
  return { labOrder, lines: orderLines, event, unknownCodes };
}

/**
 * A paid shop order → its lab order. Runs inside the checkout transaction
 * AFTER the card is charged, so it must not refuse anything the pricing
 * service accepted: a guest, a codeless variant — all still make a job.
 * Shop lines are picked and shipped, not fabricated; same board.
 */
export function planShopLabOrder({ orderId, clientUserId = null, quoteLines, orderNumber, labOrderId, now }) {
  const labOrder = newOrder({ labOrderId, orderNumber, source: "shop_order", sourceId: orderId, clientUserId, now });
  const lines = quoteLines.map((l, position) => ({
    labOrderId, position, variantId: l.variantId ?? null, code: l.code ?? null,
    name: l.name || "Unnamed item", arch: null, qty: l.qty, noteOnly: false, sourceLabel: null,
  }));
  const event = { labOrderId, type: "release", from: "paid", to: "received", byUserId: null, note: null, at: now };
  return { labOrder, lines, event };
}

/**
 * A remake of a shipped order: a new lab order for the same source, flagged
 * isRemake and pointing back at the original, with its lines copied. The
 * reason is required — "why was this remade" is what the lab and invoicing
 * (piece 3) both ask. Whether it is charged is piece 3's concern.
 */
export function planRemake({ original, originalLines, reason, orderNumber, labOrderId, byUserId = null, now }) {
  if (original.status !== "shipped") throw new LabOrderError("INVALID", "Only a shipped order can be remade.");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) throw new LabOrderError("REASON_REQUIRED", "Say why this order is being remade.");
  const labOrder = {
    ...newOrder({ labOrderId, orderNumber, source: original.source, sourceId: original.sourceId, clientUserId: original.clientUserId, now }),
    isRemake: true,
    remakeOfOrderId: original.id,
  };
  const lines = originalLines.map((l, position) => ({
    labOrderId, position, variantId: l.variantId ?? null, code: l.code ?? null, name: l.name,
    arch: l.arch ?? null, qty: l.qty, noteOnly: Boolean(l.noteOnly), sourceLabel: l.sourceLabel ?? null,
  }));
  const events = [
    { labOrderId, type: "release", from: null, to: "received", byUserId, note: `Remake of #${original.orderNumber}: ${why}`, at: now },
    { labOrderId: original.id, type: "note", from: null, to: null, byUserId, note: `Remake created: #${orderNumber}`, at: now },
  ];
  return { labOrder, lines, events };
}
```

- [ ] **Step 6: Run the API suite**

Run: `cd apps/api && pnpm vitest run`
Expected: PASS. That includes the renamed `canRelease` tests in `admin-rx-cases.test.js`, `ortho.review-fixes.test.js` and `push-case.service.test.js`. If `rx-replay/translate.test.js` imports nothing renamed, it is untouched.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/lab apps/api/src/services/rx apps/api/src/routes apps/api/scripts/rx-replay
git commit -m "feat(lab): release, shop and remake planners; canPush becomes canRelease

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 4: Pure production moves and board cards  _(Batch B with Task 3)_

**Files:**
- Modify: `apps/api/src/services/lab/lab-order-rules.js`, `apps/api/src/services/lab/lab-order-rules.test.js`

**Interfaces:**
- Consumes: `allowedNextStatuses`, `reasonRequiredFor`, `isTerminalLabStatus`, `isOverdue`, `LAB_STATUS_LABELS` (shared, Task 1); `parseDueDate`, `LabOrderError` (Task 3).
- Produces:
  - `assertFresh(order, expectedVersion)`: throws `STALE`.
  - `planStatusChange(order, to, { reason, byUserId, now }) → { patch, event }`: throws `INVALID_TRANSITION` with `allowed`, or `REASON_REQUIRED`.
  - `LAB_FIELDS = ["assign","department","due","notes"]`.
  - `planFieldChange(order, field, value, { byUserId, now }) → { patch, event } | null`: `null` means a no-op; throws `INVALID`.
  - `initialsFor(name) → string|null`.
  - `presentBoardCard(row, lines, todayIso)`, where `row` is `{ order, caseNumber, practiceName, shopOrderNumber, shipping, clientName, assigneeName }` and the result is `{ id, orderNumber, source, sourceId, reference, status, heldFrom, version, practice, deviceSummary, dueDate, rush, rushTier, isRemake, departmentId, assigneeUserId, assigneeInitials, overdue, receivedAt }`.
  - Every patch includes `version: order.version + 1` and `updatedAt: now`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/lab/lab-order-rules.test.js`:

```js
import { assertFresh, planStatusChange, planFieldChange, initialsFor, presentBoardCard } from "./lab-order-rules.js";

const order = {
  id: "lo-1", orderNumber: 100245, status: "received", heldFrom: null, holdReason: null, version: 3,
  startedAt: null, assigneeUserId: null, departmentId: null, dueDate: "2026-10-21", labNotes: null,
};

// Review Focus 1.
test("a move made from a stale view is refused, not applied over someone else's", () => {
  assert.throws(() => assertFresh(order, 2), isCode("STALE"));
  assert.throws(() => assertFresh(order, undefined), isCode("STALE"));
  assert.throws(() => assertFresh(order, "3"), isCode("STALE"));
  assert.doesNotThrow(() => assertFresh(order, 3));
  const { patch } = planStatusChange(order, "in_production", { now });
  assert.equal(patch.version, 4, "every change bumps the version the next writer must quote");
});

test("an illegal move is refused with the moves that are allowed", () => {
  assert.throws(() => planStatusChange(order, "shipped", { now }), (err) =>
    isCode("INVALID_TRANSITION")(err) && err.allowed.join() === "in_production,on_hold,cancelled"
    && /can't move from Received to Shipped/.test(err.message));
});

test("starting production stamps startedAt once; shipping and cancelling stamp theirs", () => {
  const start = planStatusChange(order, "in_production", { byUserId: "u1", now });
  assert.equal(start.patch.startedAt, now);
  assert.deepEqual(start.event, { labOrderId: "lo-1", type: "status", from: "received", to: "in_production", byUserId: "u1", note: null, at: now });
  const back = planStatusChange({ ...order, status: "quality_check", startedAt: new Date("2026-10-01") }, "in_production", { now });
  assert.ok(!("startedAt" in back.patch), "a QC bounce keeps the original start");
  assert.equal(planStatusChange({ ...order, status: "ready_to_ship" }, "shipped", { now }).patch.shippedAt, now);
  assert.equal(planStatusChange(order, "cancelled", { reason: "Doctor withdrew", now }).patch.cancelledAt, now);
});

test("hold needs a reason, remembers where it was, and resume returns there and clears it", () => {
  assert.throws(() => planStatusChange(order, "on_hold", { reason: "  ", now }), isCode("REASON_REQUIRED"));
  const hold = planStatusChange({ ...order, status: "quality_check" }, "on_hold", { reason: " Waiting on bite ", byUserId: "u1", now });
  assert.equal(hold.patch.holdReason, "Waiting on bite");
  assert.equal(hold.patch.heldFrom, "quality_check");
  assert.equal(hold.event.type, "hold");
  assert.equal(hold.event.note, "Waiting on bite");
  const held = { ...order, status: "on_hold", heldFrom: "quality_check", holdReason: "Waiting on bite" };
  assert.throws(() => planStatusChange(held, "in_production", { now }), isCode("INVALID_TRANSITION"));
  const resume = planStatusChange(held, "quality_check", { now });
  assert.equal(resume.patch.holdReason, null);
  assert.equal(resume.patch.heldFrom, null);
  assert.equal(resume.event.type, "status");
  assert.throws(() => planStatusChange(held, "cancelled", { now }), isCode("REASON_REQUIRED"));
  assert.equal(planStatusChange(held, "cancelled", { reason: "Patient moved", now }).patch.status, "cancelled");
});

test("assign, department and due changes are recorded with before and after", () => {
  const a = planFieldChange(order, "assign", "tech-1", { byUserId: "u1", now });
  assert.deepEqual(a.patch, { assigneeUserId: "tech-1", version: 4, updatedAt: now });
  assert.deepEqual(a.event, { labOrderId: "lo-1", type: "assign", from: null, to: "tech-1", byUserId: "u1", note: null, at: now });
  assert.equal(planFieldChange(order, "department", "dep-1", { now }).patch.departmentId, "dep-1");
  const due = planFieldChange(order, "due", "2026-10-25", { now });
  assert.deepEqual([due.event.from, due.event.to], ["2026-10-21", "2026-10-25"]);
  assert.equal(planFieldChange(order, "due", "", { now }).patch.dueDate, null, "clearing is allowed");
  assert.throws(() => planFieldChange(order, "due", "2026-02-30", { now }), isCode("INVALID"));
});

test("an unchanged value is a no-op, not an event", () => {
  assert.equal(planFieldChange(order, "due", "2026-10-21", { now }), null);
  assert.equal(planFieldChange(order, "assign", null, { now }), null);
});

test("lab notes are recorded without copying the text into the history", () => {
  const n = planFieldChange(order, "notes", "Patient name on the box: Jane", { byUserId: "u1", now });
  assert.equal(n.patch.labNotes, "Patient name on the box: Jane");
  assert.equal(n.event.type, "note");
  assert.equal(n.event.note, "Lab notes updated");
});

test("a shipped or cancelled order only takes notes", () => {
  const done = { ...order, status: "shipped" };
  assert.throws(() => planFieldChange(done, "assign", "tech-1", { now }), isCode("INVALID"));
  assert.throws(() => planFieldChange(done, "due", "2026-12-01", { now }), isCode("INVALID"));
  assert.equal(planFieldChange(done, "notes", "Shipped UPS", { now }).patch.labNotes, "Shipped UPS");
  assert.throws(() => planFieldChange(order, "price", 5, { now }), isCode("INVALID"));
});

test("initials for the card", () => {
  assert.equal(initialsFor("Maria Lopez"), "ML");
  assert.equal(initialsFor("  cher "), "C");
  assert.equal(initialsFor("Ana Maria de la Cruz"), "AC");
  assert.equal(initialsFor(null), null);
});

test("a board card summarises the job without staff-only text", () => {
  const card = presentBoardCard(
    {
      order: { ...order, status: "in_production", rush: true, rushTier: "Expedited", isRemake: false, assigneeUserId: "tech-1", source: "rx_case", sourceId: "case-1", receivedAt: now, holdReason: "enc:v1:xyz", dueDate: "2026-10-01" },
      caseNumber: "RX-ABC", practiceName: "Lee Dental", shopOrderNumber: null, shipping: null, clientName: "Dr Lee", assigneeName: "Maria Lopez",
    },
    [
      { name: "DDSO Nylon", qty: 1, noteOnly: false },
      { name: "Wrap distal", qty: 1, noteOnly: true },
      { name: "Model fabrication", qty: 1, noteOnly: false },
      { name: "Bite block", qty: 2, noteOnly: false },
    ],
    "2026-10-07",
  );
  assert.equal(card.reference, "RX-ABC");
  assert.equal(card.practice, "Lee Dental");
  assert.equal(card.deviceSummary, "DDSO Nylon, Model fabrication +1");
  assert.equal(card.assigneeInitials, "ML");
  assert.equal(card.overdue, true);
  assert.equal(card.rush, true);
  assert.ok(!("holdReason" in card) && !("labNotes" in card));
});

test("a shop card falls back from practice to the buyer's account, then the ship-to name", () => {
  const base = { order: { ...order, source: "shop_order", sourceId: "ord-1" }, caseNumber: null, practiceName: null, shopOrderNumber: "DOL-ABC", assigneeName: null };
  assert.equal(presentBoardCard({ ...base, clientName: "Dr Lee", shipping: { name: "Front desk" } }, [], "2026-10-07").practice, "Dr Lee");
  const guest = presentBoardCard({ ...base, clientName: null, shipping: { name: "Pat Smith" } }, [{ name: "Retainer case", qty: 2, noteOnly: false }], "2026-10-07");
  assert.equal(guest.practice, "Pat Smith");
  assert.equal(guest.reference, "DOL-ABC");
  assert.equal(guest.deviceSummary, "2× Retainer case");
  assert.equal(guest.assigneeInitials, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/lab/lab-order-rules.test.js`
Expected: FAIL — `assertFresh` is not exported.

- [ ] **Step 3: Implement**

In `apps/api/src/services/lab/lab-order-rules.js`, add to the imports:

```js
import { allowedNextStatuses, reasonRequiredFor, isTerminalLabStatus, isOverdue, LAB_STATUS_LABELS } from "@my-app/shared";
```

Append:

```js
// ── Production moves ───────────────────────────────────────────────────────

/** The client must have seen the version it is changing (optimistic concurrency). */
export function assertFresh(order, expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion !== order.version) {
    throw new LabOrderError("STALE", "This order changed — reload.");
  }
}

const label = (s) => LAB_STATUS_LABELS[s] ?? s;

/** A status move → the row patch and its event. Every rule comes from the shared table. */
export function planStatusChange(order, to, { reason, byUserId = null, now }) {
  const allowed = allowedNextStatuses(order.status, { heldFrom: order.heldFrom });
  if (!allowed.includes(to)) {
    throw new LabOrderError(
      "INVALID_TRANSITION",
      `Order #${order.orderNumber} can't move from ${label(order.status)} to ${label(to)}.`,
      { allowed },
    );
  }
  const note = typeof reason === "string" ? reason.trim() : "";
  if (reasonRequiredFor(to) && !note) {
    throw new LabOrderError("REASON_REQUIRED", to === "on_hold" ? "Say why this order is on hold." : "Say why this order is cancelled.");
  }
  const patch = { status: to, version: order.version + 1, updatedAt: now };
  if (order.status === "on_hold") { patch.holdReason = null; patch.heldFrom = null; }
  if (to === "on_hold") { patch.holdReason = note; patch.heldFrom = order.status; }
  if (to === "in_production" && !order.startedAt) patch.startedAt = now;
  if (to === "shipped") patch.shippedAt = now;
  if (to === "cancelled") patch.cancelledAt = now;
  const event = {
    labOrderId: order.id, type: to === "on_hold" ? "hold" : "status",
    from: order.status, to, byUserId, note: note || null, at: now,
  };
  return { patch, event };
}

const FIELDS = {
  assign: { column: "assigneeUserId", event: "assign" },
  department: { column: "departmentId", event: "department" },
  due: { column: "dueDate", event: "due" },
  notes: { column: "labNotes", event: "note" },
};
export const LAB_FIELDS = Object.keys(FIELDS);

/**
 * One field edit → patch + event, or null when nothing changes. A shipped or
 * cancelled order only takes notes. Lab notes never copy their text into the
 * history (the note itself is the record).
 */
export function planFieldChange(order, field, rawValue, { byUserId = null, now }) {
  const spec = FIELDS[field];
  if (!spec) throw new LabOrderError("INVALID", `Unknown field: ${field}`);
  if (field !== "notes" && isTerminalLabStatus(order.status)) {
    throw new LabOrderError("INVALID", `Order #${order.orderNumber} is ${label(order.status).toLowerCase()} — only its notes can change.`);
  }
  let value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  if (value === "" || value === undefined) value = null;
  if (field === "due" && value !== null && !parseDueDate(value)) {
    throw new LabOrderError("INVALID", "Due date must be a real date (YYYY-MM-DD).");
  }
  const before = order[spec.column] ?? null;
  if (before === value) return null;
  const patch = { [spec.column]: value, version: order.version + 1, updatedAt: now };
  const event = field === "notes"
    ? { labOrderId: order.id, type: "note", from: null, to: null, byUserId, note: "Lab notes updated", at: now }
    : { labOrderId: order.id, type: spec.event, from: before, to: value, byUserId, note: null, at: now };
  return { patch, event };
}

// ── Board cards ────────────────────────────────────────────────────────────

export function initialsFor(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${parts[0][0]}${last}`.toUpperCase();
}

function summarise(lines) {
  const names = lines.filter((l) => !l.noteOnly).map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name));
  if (names.length === 0) return "—";
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

/**
 * One card on the production board. Built from an allow-list: hold reasons
 * and lab notes (encrypted on the row) never reach the list endpoint.
 */
export function presentBoardCard(row, lines = [], todayIso) {
  const o = row.order;
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    source: o.source,
    sourceId: o.sourceId,
    reference: o.source === "rx_case" ? (row.caseNumber ?? null) : (row.shopOrderNumber ?? null),
    status: o.status,
    heldFrom: o.heldFrom ?? null,
    version: o.version,
    practice: row.practiceName || row.clientName || row.shipping?.name || "—",
    deviceSummary: summarise(lines),
    dueDate: o.dueDate ?? null,
    rush: Boolean(o.rush),
    rushTier: o.rushTier ?? null,
    isRemake: Boolean(o.isRemake),
    departmentId: o.departmentId ?? null,
    assigneeUserId: o.assigneeUserId ?? null,
    assigneeInitials: initialsFor(row.assigneeName),
    overdue: isOverdue(o.dueDate, o.status, todayIso),
    receivedAt: o.receivedAt,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && pnpm vitest run src/services/lab`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/lab
git commit -m "feat(lab): production move, field edit and board card rules

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 5: Lab order and department services

**Files:**
- Create: `apps/api/src/services/lab/lab-orders.service.js`, `apps/api/src/services/lab/departments.service.js`, `apps/api/src/services/lab/lab-orders.service.test.js`
- Modify: `apps/api/src/config/env.js`

**Interfaces:**
- Consumes: Task 2 tables; Task 3/4 planners; `decryptRxPhi` (phi-crypto); `devicesForCase` (case-devices); `compileNotesMulti` (`services/rx/build-order-payload.js` — Task 12 moves it to `case-notes.js` and updates this import); `encryptField`/`decryptField` (lib/crypto); `isoDateIn`, `LAB_TIMEZONE`, `isOverdue` (shared).
- Produces (`lab-orders.service.js`):
  - Allocation and creation:
    - `allocateOrderNumber(tx) → Promise<integer>`;
    - `releaseRxCase(tx, { caseRow, lines, byUserId }) → Promise<{ labOrder: { id, orderNumber }, unknownCodes }>`, where `caseRow` is DECRYPTED. It claims the case (`status → released`) first. It throws `ALREADY_RELEASED`, or `RELEASE_BLOCKED` (rolled back by the caller's transaction);
    - `createShopLabOrder(tx, { orderId, clientUserId, quoteLines }) → Promise<{ id, orderNumber }>`.
  - Reads:
    - `listLabOrders(filters, now?) → Promise<card[]>`. `filters` is `{ status?, source?, departmentId?, assigneeUserId?, rush?, dueBefore?, q?, includeClosed? }`;
    - `getLabOrderDetail(id, now?) → Promise<null | { order, lines, events, rxCase, files, shopOrder }>`. `order` adds `departmentName`, `assigneeName`, `clientName`, `remakeOfOrderNumber` and `overdue`; `holdReason` and `labNotes` come back decrypted. Each event adds `byName` and a decrypted `note`. `rxCase` is `{ id, caseNumber, status, practiceName, patientName, formType, formData, generalComments, buildNotes, submittedAt }`;
    - `labOrdersForCases(caseIds) → Promise<Map<caseId, Array<{ id, status, orderNumber, dueDate, isRemake, createdAt }>>>`.
  - Mutations:
    - `changeStatus(id, { to, reason, expectedVersion, byUserId }) → Promise<{ order, changed }>`;
    - `changeField(id, { field, value, expectedVersion, byUserId }) → Promise<{ order, changed }>`;
    - `remakeOrder(id, { reason, expectedVersion, byUserId }) → Promise<{ labOrder: { id, orderNumber } }>`;
    - `listAssignableStaff() → Promise<Array<{ id, name, role }>>`.
- Produces (`departments.service.js`):
  - `listDepartments({ includeInactive }?)`;
  - `createDepartment({ name, position? })`;
  - `updateDepartment(id, { name?, position?, active? })`.
  - All throw `LabOrderError` `CONFLICT` (duplicate name) or `NOT_FOUND`.
- Env: `LAB_ORDER_NUMBER_START` (integer, default `100000`).

- [ ] **Step 1: Write the failing test**

There is no DB harness, so this test pins the two properties of the service that a reviewer can't see from the pure rules. The concurrency guard is in the UPDATE, and the encrypted columns are never written in plaintext. Both are source checks, the repo's established pattern.

`apps/api/src/services/lab/lab-orders.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./lab-orders.service.js", import.meta.url)), "utf8");
const mod = await import("./lab-orders.service.js");

test("the service exposes what the routes, release and checkout call", () => {
  for (const name of [
    "allocateOrderNumber", "releaseRxCase", "createShopLabOrder", "listLabOrders", "getLabOrderDetail",
    "labOrdersForCases", "changeStatus", "changeField", "remakeOrder", "listAssignableStaff",
  ]) assert.equal(typeof mod[name], "function", name);
});

test("every mutation is conditional on the version the caller saw (no lost updates)", () => {
  assert.match(source, /eq\(labOrders\.version, order\.version\)/);
  assert.match(source, /assertFresh\(/);
});

test("order numbers are allocated under a transaction-scoped advisory lock", () => {
  assert.match(source, /pg_advisory_xact_lock\(\d+\)/);
});

test("a release claims the case before inserting, so a double click can't make two jobs", () => {
  const body = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(body.indexOf('status: "released"') < body.indexOf("insertPlan("), "claim must precede the insert");
});

test("hold reasons, lab notes and event notes are sealed on write and opened on read", () => {
  assert.match(source, /SECRET_ORDER_FIELDS = \["holdReason", "labNotes"\]/);
  assert.match(source, /encryptField/);
  assert.match(source, /decryptField/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/services/lab/lab-orders.service.test.js`
Expected: FAIL — `ENOENT` reading `lab-orders.service.js`.

- [ ] **Step 3: Add the env var**

`apps/api/src/config/env.js` — after `AUTOPAY_MAX_FAILURES`:

```js
  // ── Lab orders ──
  // Lab order numbers continue the lab's paperwork numbering. Piece 5 sets
  // this to Seazona's last order number + 1 before cutover; allocation is
  // max(existing + 1, start), so raising it later never reuses a number.
  LAB_ORDER_NUMBER_START: z.coerce.number().int().positive().default(100000),
```

- [ ] **Step 4: Implement the services**

`apps/api/src/services/lab/lab-orders.service.js`:

```js
import { and, asc, desc, eq, gte, ilike, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isoDateIn, isOverdue, LAB_TIMEZONE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { env } from "../../config/env.js";
import {
  labOrders, labOrderLines, labOrderEvents, labDepartments, rxCases, rxCaseFiles, orders, users, productVariants,
} from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { encryptField, decryptField } from "../../lib/crypto.js";
import { decryptRxPhi } from "../rx/phi-crypto.js";
import { devicesForCase } from "../rx/case-devices.js";
import { compileNotesMulti } from "../rx/build-order-payload.js";
import {
  LabOrderError, nextLabOrderNumber, planRxRelease, planShopLabOrder, planRemake,
  assertFresh, planStatusChange, planFieldChange, presentBoardCard,
} from "./lab-order-rules.js";

// Serialises order-number allocation: held until the transaction ends, so two
// concurrent releases/checkouts can never read the same max.
const ORDER_NUMBER_LOCK = sql.raw("select pg_advisory_xact_lock(7300421)");

const SHIPPED_VISIBLE_DAYS = 14;
const STAFF_ROLES = ["admin", "lab"];

const client = alias(users, "client");
const assignee = alias(users, "assignee");
const actor = alias(users, "actor");

// Free text staff type can name a patient, so it is encrypted at rest like
// rx_cases' free-text fields (B4 / phi-crypto.js).
const SECRET_ORDER_FIELDS = ["holdReason", "labNotes"];

function sealOrder(values) {
  const out = { ...values };
  for (const f of SECRET_ORDER_FIELDS) if (f in out && out[f] != null) out[f] = encryptField(out[f]);
  return out;
}
function openOrder(row) {
  const out = { ...row };
  for (const f of SECRET_ORDER_FIELDS) out[f] = row[f] == null ? null : decryptField(row[f]);
  return out;
}
function sealEvent(e) {
  return { ...e, id: createId(), note: e.note == null ? null : encryptField(e.note) };
}
function openEvent(e) {
  return { ...e, note: e.note == null ? null : decryptField(e.note) };
}

export async function allocateOrderNumber(tx) {
  await tx.execute(ORDER_NUMBER_LOCK);
  const [row] = await tx.select({ max: sql`max(${labOrders.orderNumber})` }).from(labOrders);
  return nextLabOrderNumber(row?.max == null ? null : Number(row.max), env.LAB_ORDER_NUMBER_START);
}

async function variantIdsForCodes(tx, codes) {
  const unique = [...new Set(codes.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: productVariants.id, code: productVariants.code })
    .from(productVariants)
    .where(inArray(productVariants.code, unique));
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function insertPlan(tx, { labOrder, lines, events }) {
  await tx.insert(labOrders).values(sealOrder(labOrder));
  if (lines.length) await tx.insert(labOrderLines).values(lines.map((l) => ({ ...l, id: createId() })));
  if (events.length) await tx.insert(labOrderEvents).values(events.map(sealEvent));
}

/**
 * Release a reviewed Rx case to the bench, inside the caller's transaction.
 * Claims the case FIRST with a conditional status update: a second
 * concurrent release blocks on the row lock, then finds nothing to claim.
 * A planner refusal after the claim throws, and the caller's transaction
 * rolls the claim back.
 *
 * @param {object} caseRow DECRYPTED rx_cases row (id, userId, status, dueDate, formData, rush, rushTier)
 * @param {Array}  lines   the case's stored rx_case_lines, position order
 */
export async function releaseRxCase(tx, { caseRow, lines, byUserId = null }) {
  const claimed = await tx
    .update(rxCases)
    .set({ status: "released", updatedAt: new Date() })
    .where(and(eq(rxCases.id, caseRow.id), notInArray(rxCases.status, ["released", "pushed", "cancelled"])))
    .returning({ id: rxCases.id });
  if (claimed.length === 0) {
    throw new LabOrderError("ALREADY_RELEASED", "This case was already released, sent to Seazona, or cancelled.");
  }
  const variantIdByCode = await variantIdsForCodes(tx, lines.map((l) => l.seazonaCode));
  const orderNumber = await allocateOrderNumber(tx);
  const plan = planRxRelease({ caseRow, lines, variantIdByCode, orderNumber, labOrderId: createId(), byUserId, now: new Date() });
  await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
  return { labOrder: { id: plan.labOrder.id, orderNumber }, unknownCodes: plan.unknownCodes };
}

/** The lab order for a just-paid shop order, inside the checkout transaction. */
export async function createShopLabOrder(tx, { orderId, clientUserId = null, quoteLines }) {
  const orderNumber = await allocateOrderNumber(tx);
  const plan = planShopLabOrder({ orderId, clientUserId, quoteLines, orderNumber, labOrderId: createId(), now: new Date() });
  await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
  return { id: plan.labOrder.id, orderNumber };
}

function boardWhere(f, now) {
  const conds = [];
  if (f.status) {
    conds.push(eq(labOrders.status, f.status));
  } else if (!f.includeClosed) {
    const since = new Date(now.getTime() - SHIPPED_VISIBLE_DAYS * 86_400_000);
    conds.push(or(
      notInArray(labOrders.status, ["shipped", "cancelled"]),
      and(eq(labOrders.status, "shipped"), gte(labOrders.shippedAt, since)),
    ));
  }
  if (f.source) conds.push(eq(labOrders.source, f.source));
  if (f.departmentId) conds.push(eq(labOrders.departmentId, f.departmentId));
  if (f.assigneeUserId) conds.push(eq(labOrders.assigneeUserId, f.assigneeUserId));
  if (f.rush) conds.push(eq(labOrders.rush, true));
  if (f.dueBefore) conds.push(lte(labOrders.dueDate, f.dueBefore));
  if (f.q) {
    // Order number, case number, practice, client and shop order number.
    // Patient names are encrypted and deliberately not searchable here.
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(
      sql`${labOrders.orderNumber}::text like ${like}`,
      ilike(rxCases.caseNumber, like),
      ilike(rxCases.practiceName, like),
      ilike(client.name, like),
      ilike(orders.orderNumber, like),
    ));
  }
  return conds.length ? and(...conds) : undefined;
}

/** Board / Admin › Orders list. Cards never include hold reasons or lab notes. */
export async function listLabOrders(filters = {}, now = new Date()) {
  const rows = await db
    .select({
      order: labOrders,
      caseNumber: rxCases.caseNumber,
      practiceName: rxCases.practiceName,
      shopOrderNumber: orders.orderNumber,
      shipping: orders.shipping,
      clientName: client.name,
      assigneeName: assignee.name,
    })
    .from(labOrders)
    .leftJoin(rxCases, and(eq(labOrders.source, "rx_case"), eq(rxCases.id, labOrders.sourceId)))
    .leftJoin(orders, and(eq(labOrders.source, "shop_order"), eq(orders.id, labOrders.sourceId)))
    .leftJoin(client, eq(client.id, labOrders.clientUserId))
    .leftJoin(assignee, eq(assignee.id, labOrders.assigneeUserId))
    .where(boardWhere(filters, now))
    .orderBy(desc(labOrders.rush), asc(labOrders.dueDate), asc(labOrders.orderNumber))
    .limit(1000);

  const ids = rows.map((r) => r.order.id);
  const lineRows = ids.length
    ? await db
        .select({ labOrderId: labOrderLines.labOrderId, name: labOrderLines.name, qty: labOrderLines.qty, noteOnly: labOrderLines.noteOnly })
        .from(labOrderLines)
        .where(inArray(labOrderLines.labOrderId, ids))
        .orderBy(asc(labOrderLines.position))
    : [];
  const byOrder = new Map();
  for (const l of lineRows) {
    if (!byOrder.has(l.labOrderId)) byOrder.set(l.labOrderId, []);
    byOrder.get(l.labOrderId).push(l);
  }
  const today = isoDateIn(LAB_TIMEZONE, now);
  return rows.map((r) => presentBoardCard(r, byOrder.get(r.order.id) ?? [], today));
}

/**
 * Everything the order detail page and the work ticket need. Decrypts the
 * case's PHI (patient name, form answers) — callers must never log the
 * result. Throws on a decrypt failure; routes turn that into a generic 500.
 */
export async function getLabOrderDetail(id, now = new Date()) {
  const [row] = await db
    .select({
      order: labOrders,
      departmentName: labDepartments.name,
      assigneeName: assignee.name,
      clientName: client.name,
    })
    .from(labOrders)
    .leftJoin(labDepartments, eq(labDepartments.id, labOrders.departmentId))
    .leftJoin(assignee, eq(assignee.id, labOrders.assigneeUserId))
    .leftJoin(client, eq(client.id, labOrders.clientUserId))
    .where(eq(labOrders.id, id));
  if (!row) return null;

  const order = openOrder(row.order);
  const [lines, eventRows, remakeOf] = await Promise.all([
    db.select().from(labOrderLines).where(eq(labOrderLines.labOrderId, id)).orderBy(asc(labOrderLines.position)),
    db
      .select({ event: labOrderEvents, byName: actor.name })
      .from(labOrderEvents)
      .leftJoin(actor, eq(actor.id, labOrderEvents.byUserId))
      .where(eq(labOrderEvents.labOrderId, id))
      .orderBy(asc(labOrderEvents.at)),
    order.remakeOfOrderId
      ? db.select({ orderNumber: labOrders.orderNumber }).from(labOrders).where(eq(labOrders.id, order.remakeOfOrderId))
      : Promise.resolve([]),
  ]);

  let rxCase = null;
  let files = [];
  let shopOrder = null;
  if (order.source === "rx_case") {
    const [raw] = await db.select().from(rxCases).where(eq(rxCases.id, order.sourceId));
    if (raw) {
      const c = decryptRxPhi(raw);
      rxCase = {
        id: c.id,
        caseNumber: c.caseNumber,
        status: c.status,
        practiceName: c.practiceName ?? null,
        patientName: `${c.patientFirst ?? ""} ${c.patientLast ?? ""}`.trim() || null,
        formType: c.formType,
        formData: c.formData ?? {},
        generalComments: c.generalComments ?? null,
        buildNotes: compileNotesMulti(c, devicesForCase(c)) || null,
        submittedAt: c.createdAt,
      };
      files = await db
        .select({ id: rxCaseFiles.id, kind: rxCaseFiles.kind, originalName: rxCaseFiles.originalName, contentType: rxCaseFiles.contentType, size: rxCaseFiles.size })
        .from(rxCaseFiles)
        .where(eq(rxCaseFiles.caseId, c.id));
    }
  } else {
    const [s] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, email: orders.email, phone: orders.phone, shipping: orders.shipping, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.id, order.sourceId));
    shopOrder = s ?? null;
  }

  return {
    order: {
      ...order,
      departmentName: row.departmentName ?? null,
      assigneeName: row.assigneeName ?? null,
      clientName: row.clientName ?? null,
      remakeOfOrderNumber: remakeOf[0]?.orderNumber ?? null,
      overdue: isOverdue(order.dueDate, order.status, isoDateIn(LAB_TIMEZONE, now)),
    },
    lines,
    events: eventRows.map(({ event, byName }) => ({ ...openEvent(event), byName: byName ?? null })),
    rxCase,
    files,
    shopOrder,
  };
}

/** The lab orders behind each case — allow-listed columns only (doctor view, Rx case detail). */
export async function labOrdersForCases(caseIds) {
  const out = new Map();
  if (caseIds.length === 0) return out;
  const rows = await db
    .select({
      id: labOrders.id, sourceId: labOrders.sourceId, status: labOrders.status, orderNumber: labOrders.orderNumber,
      dueDate: labOrders.dueDate, isRemake: labOrders.isRemake, createdAt: labOrders.createdAt,
    })
    .from(labOrders)
    .where(and(eq(labOrders.source, "rx_case"), inArray(labOrders.sourceId, caseIds)));
  for (const { sourceId, ...lo } of rows) {
    if (!out.has(sourceId)) out.set(sourceId, []);
    out.get(sourceId).push(lo);
  }
  return out;
}

/**
 * Load → freshness check → plan → conditional update → event, in one
 * transaction. The UPDATE is conditional on the version read, so two
 * technicians racing past assertFresh still can't both win.
 */
async function mutate(id, expectedVersion, plan) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(labOrders).where(eq(labOrders.id, id));
    if (!row) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
    const order = openOrder(row);
    assertFresh(order, expectedVersion);
    const planned = await plan(order, tx);
    if (!planned) return { order, changed: false };
    const [updated] = await tx
      .update(labOrders)
      .set(sealOrder(planned.patch))
      .where(and(eq(labOrders.id, id), eq(labOrders.version, order.version)))
      .returning();
    if (!updated) throw new LabOrderError("STALE", "This order changed — reload.");
    await tx.insert(labOrderEvents).values(sealEvent(planned.event));
    return { order: openOrder(updated), changed: true };
  });
}

async function assertAssignable(tx, userId) {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), inArray(users.role, STAFF_ROLES), eq(users.status, "active")));
  if (!u) throw new LabOrderError("INVALID", "Orders can only be assigned to lab staff.");
}

async function assertActiveDepartment(tx, departmentId) {
  const [d] = await tx
    .select({ id: labDepartments.id })
    .from(labDepartments)
    .where(and(eq(labDepartments.id, departmentId), eq(labDepartments.active, true)));
  if (!d) throw new LabOrderError("INVALID", "That department doesn't exist or is inactive.");
}

export function changeStatus(id, { to, reason, expectedVersion, byUserId = null }) {
  return mutate(id, expectedVersion, (order) => planStatusChange(order, to, { reason, byUserId, now: new Date() }));
}

export function changeField(id, { field, value, expectedVersion, byUserId = null }) {
  return mutate(id, expectedVersion, async (order, tx) => {
    if (field === "assign" && value) await assertAssignable(tx, value);
    if (field === "department" && value) await assertActiveDepartment(tx, value);
    return planFieldChange(order, field, value, { byUserId, now: new Date() });
  });
}

export function remakeOrder(id, { reason, expectedVersion, byUserId = null }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(labOrders).where(eq(labOrders.id, id));
    if (!row) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
    const original = openOrder(row);
    assertFresh(original, expectedVersion);
    const originalLines = await tx
      .select()
      .from(labOrderLines)
      .where(eq(labOrderLines.labOrderId, id))
      .orderBy(asc(labOrderLines.position));
    const orderNumber = await allocateOrderNumber(tx);
    const plan = planRemake({ original, originalLines, reason, orderNumber, labOrderId: createId(), byUserId, now: new Date() });
    // Bump the original's version so a stale tab can't act on it as if nothing happened.
    const [bumped] = await tx
      .update(labOrders)
      .set({ version: original.version + 1, updatedAt: new Date() })
      .where(and(eq(labOrders.id, id), eq(labOrders.version, original.version)))
      .returning({ id: labOrders.id });
    if (!bumped) throw new LabOrderError("STALE", "This order changed — reload.");
    await insertPlan(tx, plan);
    return { labOrder: { id: plan.labOrder.id, orderNumber } };
  });
}

/** People an order can be assigned to: active admins and lab staff. */
export function listAssignableStaff() {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inArray(users.role, STAFF_ROLES), eq(users.status, "active")))
    .orderBy(asc(users.name));
}
```

`apps/api/src/services/lab/departments.service.js`:

```js
import { asc, eq } from "drizzle-orm";
import { db } from "../../config/database.js";
import { labDepartments } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { LabOrderError } from "./lab-order-rules.js";

// The lab names its own rooms. Departments are deactivated, never deleted —
// lab orders keep pointing at them (no FKs to catch a dangling id).

const UNIQUE_VIOLATION = "23505";

function conflictOr(err) {
  if (err?.code === UNIQUE_VIOLATION) return new LabOrderError("CONFLICT", "A department with that name already exists.");
  return err;
}

export function listDepartments({ includeInactive = false } = {}) {
  const q = db.select().from(labDepartments);
  return (includeInactive ? q : q.where(eq(labDepartments.active, true)))
    .orderBy(asc(labDepartments.position), asc(labDepartments.name));
}

export async function createDepartment({ name, position = 0 }) {
  try {
    const [row] = await db.insert(labDepartments).values({ id: createId(), name, position }).returning();
    return row;
  } catch (err) {
    throw conflictOr(err);
  }
}

export async function updateDepartment(id, patch) {
  try {
    const [row] = await db
      .update(labDepartments)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(labDepartments.id, id))
      .returning();
    if (!row) throw new LabOrderError("NOT_FOUND", "Department not found.");
    return row;
  } catch (err) {
    throw conflictOr(err);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && pnpm vitest run`
Expected: PASS.

- [ ] **Step 6: Smoke the queries against the local DB (read-only)**

```bash
cd apps/api && node --env-file=.env -e '
const s = await import("./src/services/lab/lab-orders.service.js");
console.log("cards", (await s.listLabOrders({ includeClosed: true })).length);
console.log("staff", (await s.listAssignableStaff()).length);
console.log("byCase", (await s.labOrdersForCases(["none"])).size);
process.exit(0);'
```
Expected: `cards 0`, `staff <n>`, `byCase 0`. There are no SQL errors, which proves the aliases, joins and `::text like` compile against Postgres.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/lab apps/api/src/config/env.js
git commit -m "feat(lab): lab order and department services with versioned mutations

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 6: Staff API — lab routes, departments, role change, Rx read access

**Files:**
- Create:
  - `packages/shared/src/schemas/lab.schema.js`, `packages/shared/src/schemas/lab.schema.test.js`;
  - `apps/api/src/lib/staff-roles.js`, `apps/api/src/lib/staff-roles.test.js`;
  - `apps/api/src/routes/lab.routes.js`, `apps/api/src/routes/__tests__/lab-routes.test.js`.
- Modify: `packages/shared/src/index.js`, `apps/api/src/index.js`, `apps/api/src/routes/admin.routes.js`, `apps/api/src/routes/admin-rx-cases.routes.js`

**Interfaces:**
- Produces (shared):
  - Bodies: `labStatusChangeSchema` `{ to, reason?, expectedVersion }`; `labFieldChangeSchema`, a discriminated union on `field` (`assign|department|due|notes`, `value`, `expectedVersion`); `labRemakeSchema` `{ reason, expectedVersion }`.
  - Departments: `labDepartmentCreateSchema` `{ name, position? }`; `labDepartmentUpdateSchema` `{ name?, position?, active? }`.
  - `labOrderListQuerySchema`: query strings in, typed filters out (`rush` and `includeClosed` become booleans).
  - `rxReleaseSchema` `{ confirmNotInSeazona? }`, default `{}`.
  - `userRoleChangeSchema` `{ role: "lab"|"user" }`.
- Produces (API):
  - `STAFF_ROLE_CHOICES`; `roleChangeRefusal({ actorId, target, role }) → string|null`;
  - `labErrorReply(err) → null | { status, body }` (exported from `routes/lab.routes.js`); `STAFF` preHandler array.
- HTTP:
  - `GET  /api/v1/lab/orders` (query above) → `{ data: { orders: card[] } }`
  - `GET  /api/v1/lab/orders/:id` → `{ data: detail }` (Task 5 shape)
  - `POST /api/v1/lab/orders/:id/status` → `{ data: { id, status, version } }`
  - `PATCH /api/v1/lab/orders/:id` → `{ data: { id, version } }`
  - `POST /api/v1/lab/orders/:id/remake` → 201 `{ data: { labOrder: { id, orderNumber } } }`
  - `GET  /api/v1/lab/departments[?includeInactive=true]` → `{ data: { departments } }`
  - `GET  /api/v1/lab/staff` → `{ data: { staff } }`
  - `POST /api/v1/admin/lab/departments`, `PATCH /api/v1/admin/lab/departments/:id` (admin) → `{ data: { department } }`
  - `PUT  /api/v1/admin/users/:id/role` (admin) → `{ data: { id, role } }`
  - Errors: 404 `NOT_FOUND`; 409 `STALE` / `ALREADY_RELEASED` / `CONFLICT`; 422 `INVALID_TRANSITION` (body carries `allowed`), `REASON_REQUIRED`, `INVALID`, `RELEASE_BLOCKED` (body carries `blocking`).
  - `GET /admin/rx-cases`, `GET /admin/rx-cases/:id` and `GET /admin/rx-cases/:id/files/:fileId` now accept `lab` as well as `admin`. Every other Rx-case route stays admin-only.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/schemas/lab.schema.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  labStatusChangeSchema, labFieldChangeSchema, labRemakeSchema, labOrderListQuerySchema,
  labDepartmentUpdateSchema, rxReleaseSchema, userRoleChangeSchema,
} from "./lab.schema.js";

test("a status change needs a known status and the version the client saw", () => {
  assert.ok(labStatusChangeSchema.safeParse({ to: "in_production", expectedVersion: 3 }).success);
  assert.equal(labStatusChangeSchema.safeParse({ to: "in_production" }).success, false);
  assert.equal(labStatusChangeSchema.safeParse({ to: "done", expectedVersion: 3 }).success, false);
  assert.equal(labStatusChangeSchema.safeParse({ to: "on_hold", reason: "x".repeat(501), expectedVersion: 1 }).success, false);
});

test("field edits are one field at a time, with a typed value", () => {
  assert.ok(labFieldChangeSchema.safeParse({ field: "due", value: "2026-10-21", expectedVersion: 1 }).success);
  assert.ok(labFieldChangeSchema.safeParse({ field: "assign", value: null, expectedVersion: 1 }).success);
  assert.equal(labFieldChangeSchema.safeParse({ field: "due", value: "10/21/2026", expectedVersion: 1 }).success, false);
  assert.equal(labFieldChangeSchema.safeParse({ field: "price", value: "1", expectedVersion: 1 }).success, false);
});

test("a remake needs a reason", () => {
  assert.equal(labRemakeSchema.safeParse({ reason: "", expectedVersion: 1 }).success, false);
  assert.ok(labRemakeSchema.safeParse({ reason: "Cracked", expectedVersion: 1 }).success);
});

test("board query strings become typed filters", () => {
  const q = labOrderListQuerySchema.parse({ rush: "true", includeClosed: "false", dueBefore: "2026-10-10", q: " RX " });
  assert.deepEqual(q, { rush: true, includeClosed: false, dueBefore: "2026-10-10", q: "RX" });
  assert.deepEqual(labOrderListQuerySchema.parse({}), { rush: false, includeClosed: false });
  assert.equal(labOrderListQuerySchema.safeParse({ status: "nope" }).success, false);
});

test("a department update must change something", () => {
  assert.equal(labDepartmentUpdateSchema.safeParse({}).success, false);
  assert.ok(labDepartmentUpdateSchema.safeParse({ active: false }).success);
});

test("release takes an optional Seazona confirmation and tolerates an empty body", () => {
  assert.deepEqual(rxReleaseSchema.parse(undefined), {});
  assert.deepEqual(rxReleaseSchema.parse({ confirmNotInSeazona: true }), { confirmNotInSeazona: true });
});

test("only lab and user can be granted here", () => {
  assert.ok(userRoleChangeSchema.safeParse({ role: "lab" }).success);
  assert.equal(userRoleChangeSchema.safeParse({ role: "admin" }).success, false);
});
```

`apps/api/src/lib/staff-roles.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { roleChangeRefusal } from "./staff-roles.js";

test("an admin can make a plain user lab staff and back", () => {
  assert.equal(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "user" }, role: "lab" }), null);
  assert.equal(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "lab" }, role: "user" }), null);
});

test("admins, doctors and yourself are out of bounds", () => {
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "a1", role: "user" }, role: "lab" }), /your own role/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "a2", role: "admin" }, role: "lab" }), /Admin and doctor/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "d1", role: "doctor" }, role: "lab" }), /Admin and doctor/);
  assert.match(roleChangeRefusal({ actorId: "a1", target: { id: "u1", role: "user" }, role: "admin" }), /Only lab staff/);
});
```

`apps/api/src/routes/__tests__/lab-routes.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { labErrorReply } from "../lab.routes.js";
import { LabOrderError } from "../../services/lab/lab-order-rules.js";

test("lab errors map to the status a technician's screen can act on", () => {
  const illegal = labErrorReply(new LabOrderError("INVALID_TRANSITION", "nope", { allowed: ["in_production"] }));
  assert.equal(illegal.status, 422);
  assert.deepEqual(illegal.body.error.allowed, ["in_production"]);
  const stale = labErrorReply(new LabOrderError("STALE", "This order changed — reload."));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "STALE");
  assert.equal(stale.body.error.message, "This order changed — reload.");
  assert.equal(labErrorReply(new LabOrderError("NOT_FOUND", "x")).status, 404);
  assert.equal(labErrorReply(new LabOrderError("ALREADY_RELEASED", "x")).status, 409);
  assert.deepEqual(labErrorReply(new LabOrderError("RELEASE_BLOCKED", "x", { blocking: ["mod:a"] })).body.error.blocking, ["mod:a"]);
  assert.equal(labErrorReply(new Error("boom")), null);
});

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const labSource = read("../lab.routes.js");
const rxSource = read("../admin-rx-cases.routes.js");

function handler(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `route not found: ${marker}`);
  const next = source.indexOf("\n  fastify.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("every /lab route is staff-only (admin or lab)", () => {
  for (const marker of [
    'fastify.get("/lab/orders",', 'fastify.get("/lab/orders/:id",', 'fastify.post("/lab/orders/:id/status",',
    'fastify.patch("/lab/orders/:id",', 'fastify.post("/lab/orders/:id/remake",', 'fastify.get("/lab/departments",',
    'fastify.get("/lab/staff",',
  ]) assert.match(handler(labSource, marker), /STAFF/, marker);
  assert.match(labSource, /export const STAFF = \[authenticate, requireRole\("admin", "lab"\)\]/);
});

test("department management is admin-only", () => {
  assert.match(handler(labSource, 'fastify.post("/admin/lab/departments",'), /requireAdmin/);
  assert.match(handler(labSource, 'fastify.patch("/admin/lab/departments/:id",'), /requireAdmin/);
});

test("lab staff can read Rx cases and their files; editing stays admin-only", () => {
  for (const marker of ['fastify.get("/admin/rx-cases",', 'fastify.get("/admin/rx-cases/:id",', 'fastify.get("/admin/rx-cases/:id/files/:fileId",']) {
    assert.match(handler(rxSource, marker), /requireRole\("admin", "lab"\)/, marker);
  }
  for (const marker of ['fastify.put("/admin/rx-cases/:id/lines/:lineId",', 'fastify.post("/admin/rx-cases/:id/lines",', 'fastify.delete("/admin/rx-cases/:id/lines/:lineId",', 'fastify.put("/admin/rx-cases/:id/status",', 'fastify.post("/admin/rx-cases/:id/re-resolve",']) {
    assert.match(handler(rxSource, marker), /requireAdmin\]/, marker);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/schemas/lab.schema.test.js; cd ../../apps/api && pnpm vitest run src/lib/staff-roles.test.js src/routes/__tests__/lab-routes.test.js`
Expected: FAIL — the modules don't exist.

- [ ] **Step 3: Implement the shared schemas**

`packages/shared/src/schemas/lab.schema.js`:

```js
import { z } from "zod";
import { LAB_ORDER_STATUSES } from "../lab/lab-order-status.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const version = z.number().int().positive();
const reason = z.string().trim().max(500);
const id = z.string().min(1).max(128);
const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");

export const labStatusChangeSchema = z.object({
  to: z.enum(LAB_ORDER_STATUSES),
  reason: reason.optional(),
  expectedVersion: version,
});

export const labFieldChangeSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("assign"), value: id.nullable(), expectedVersion: version }),
  z.object({ field: z.literal("department"), value: id.nullable(), expectedVersion: version }),
  z.object({ field: z.literal("due"), value: isoDate.nullable(), expectedVersion: version }),
  z.object({ field: z.literal("notes"), value: z.string().max(5000).nullable(), expectedVersion: version }),
]);

export const labRemakeSchema = z.object({ reason: reason.min(1), expectedVersion: version });

export const labDepartmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(1000).optional(),
});

export const labDepartmentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, "Nothing to change.");

export const labOrderListQuerySchema = z.object({
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  source: z.enum(["rx_case", "shop_order"]).optional(),
  departmentId: id.optional(),
  assigneeUserId: id.optional(),
  rush: flag,
  dueBefore: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  includeClosed: flag,
});

export const rxReleaseSchema = z.object({ confirmNotInSeazona: z.boolean().optional() }).default({});

export const userRoleChangeSchema = z.object({ role: z.enum(["lab", "user"]) });
```

`packages/shared/src/index.js` — add next to the other schema exports:

```js
export * from "./schemas/lab.schema.js";
```

- [ ] **Step 4: Implement role rules, lab routes and wiring**

`apps/api/src/lib/staff-roles.js`:

```js
/**
 * Which user roles an admin may grant from the Users page. Only lab access
 * is granted or removed here; admins are made by db/create-admin.js and
 * doctors by the approval flow — this route must never become a back door
 * into either.
 */
export const STAFF_ROLE_CHOICES = ["lab", "user"];

export function roleChangeRefusal({ actorId, target, role }) {
  if (!STAFF_ROLE_CHOICES.includes(role)) return "Only lab staff access can be granted or removed here.";
  if (target.id === actorId) return "You can't change your own role.";
  if (!STAFF_ROLE_CHOICES.includes(target.role)) return "Admin and doctor accounts can't be changed here.";
  return null;
}
```

`apps/api/src/routes/lab.routes.js`:

```js
import {
  ERROR_CODES, labOrderListQuerySchema, labStatusChangeSchema, labFieldChangeSchema, labRemakeSchema,
  labDepartmentCreateSchema, labDepartmentUpdateSchema,
} from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole, requireAdmin } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import * as labOrdersService from "../services/lab/lab-orders.service.js";
import * as departmentsService from "../services/lab/departments.service.js";
import { LabOrderError } from "../services/lab/lab-order-rules.js";
import * as auditService from "../services/audit.service.js";

const STATUS = {
  NOT_FOUND: 404,
  STALE: 409,
  ALREADY_RELEASED: 409,
  CONFLICT: 409,
  INVALID_TRANSITION: 422,
  REASON_REQUIRED: 422,
  INVALID: 422,
  RELEASE_BLOCKED: 422,
};

/** LabOrderError → HTTP reply; anything else is not ours to swallow (null). */
export function labErrorReply(err) {
  if (!(err instanceof LabOrderError)) return null;
  const status = STATUS[err.code] ?? 422;
  const error = { code: err.code, status, message: err.message };
  if (err.allowed) error.allowed = err.allowed;
  if (err.blocking) error.blocking = err.blocking;
  return { status, body: { error } };
}

/**
 * Every lab route: signed in, and lab staff or admin. Pricing, payments,
 * users and the catalog editor stay admin-only in their own modules.
 */
export const STAFF = [authenticate, requireRole("admin", "lab")];

export default async function labRoutes(fastify) {
  async function run(reply, fn, status = 200) {
    try {
      const data = await fn();
      return reply.code(status).send({ data });
    } catch (err) {
      const r = labErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }

  const audit = (request, action, targetId, metadata) =>
    auditService.logSafe({ userId: request.user.id, action, targetType: "lab_order", targetId, metadata, ipAddress: request.ip });

  fastify.get("/lab/orders", { preHandler: [...STAFF, validateQuery(labOrderListQuerySchema)] }, async (request) => ({
    data: { orders: await labOrdersService.listLabOrders(request.query) },
  }));

  fastify.get("/lab/orders/:id", { preHandler: STAFF }, async (request, reply) => {
    let detail;
    try {
      detail = await labOrdersService.getLabOrderDetail(request.params.id);
    } catch (err) {
      // Decrypt failures land here — never echo the error (it can carry PHI context).
      request.log.error({ labOrderId: request.params.id, err: err.message }, "lab order detail failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to load order." } });
    }
    if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    audit(request, "lab_order.read", detail.order.id);
    return { data: detail };
  });

  fastify.post("/lab/orders/:id/status", { preHandler: [...STAFF, validate(labStatusChangeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { order } = await labOrdersService.changeStatus(request.params.id, { ...request.body, byUserId: request.user.id });
      audit(request, "lab_order.status_changed", order.id, { to: order.status, version: order.version });
      return { id: order.id, status: order.status, version: order.version };
    }));

  fastify.patch("/lab/orders/:id", { preHandler: [...STAFF, validate(labFieldChangeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { order, changed } = await labOrdersService.changeField(request.params.id, { ...request.body, byUserId: request.user.id });
      if (changed) audit(request, "lab_order.updated", order.id, { field: request.body.field, version: order.version });
      return { id: order.id, version: order.version };
    }));

  fastify.post("/lab/orders/:id/remake", { preHandler: [...STAFF, validate(labRemakeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { labOrder } = await labOrdersService.remakeOrder(request.params.id, { ...request.body, byUserId: request.user.id });
      audit(request, "lab_order.remade", request.params.id, { remakeId: labOrder.id, orderNumber: labOrder.orderNumber });
      return { labOrder };
    }, 201));

  fastify.get("/lab/departments", { preHandler: STAFF }, async (request) => ({
    data: { departments: await departmentsService.listDepartments({ includeInactive: request.query?.includeInactive === "true" }) },
  }));

  fastify.get("/lab/staff", { preHandler: STAFF }, async () => ({
    data: { staff: await labOrdersService.listAssignableStaff() },
  }));

  fastify.post("/admin/lab/departments", { preHandler: [authenticate, requireAdmin, validate(labDepartmentCreateSchema)] }, (request, reply) =>
    run(reply, async () => ({ department: await departmentsService.createDepartment(request.body) }), 201));

  fastify.patch("/admin/lab/departments/:id", { preHandler: [authenticate, requireAdmin, validate(labDepartmentUpdateSchema)] }, (request, reply) =>
    run(reply, async () => ({ department: await departmentsService.updateDepartment(request.params.id, request.body) })));
}
```

`apps/api/src/index.js` — import and register after `adminRxCasesRoutes`:

```js
import labRoutes from "./routes/lab.routes.js";
// …
await fastify.register(labRoutes, { prefix: "/api/v1" });
```

(Register it with the same `{ prefix: "/api/v1" }` call style the other route plugins use in the registration block near line 212.)

`apps/api/src/routes/admin.routes.js`:
- Add these imports: `import { validate } from "../middleware/validate.js";`, `import * as auditService from "../services/audit.service.js";`, `import { roleChangeRefusal } from "../lib/staff-roles.js";`. Add `userRoleChangeSchema` to the `@my-app/shared` import.
- Then, after the `POST /admin/users/bulk-email` route, add:

```js
  // Grant or remove lab-staff access. Only user ↔ lab (lib/staff-roles.js).
  fastify.put("/admin/users/:id/role", {
    preHandler: [authenticate, requireAdmin, validate(userRoleChangeSchema)],
  }, async (request, reply) => {
    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, request.params.id));
    if (!target) return reply.code(404).send({ error: ERROR_CODES.USER_NOT_FOUND });
    const refusal = roleChangeRefusal({ actorId: request.user.id, target, role: request.body.role });
    if (refusal) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: refusal } });
    }
    if (target.role !== request.body.role) {
      await db.update(users).set({ role: request.body.role, updatedAt: new Date() }).where(eq(users.id, target.id));
      auditService.logSafe({
        userId: request.user.id,
        action: "user.role_changed",
        targetType: "user",
        targetId: target.id,
        metadata: { from: target.role, to: request.body.role },
        ipAddress: request.ip,
      });
    }
    return { data: { id: target.id, role: request.body.role } };
  });
```

`authenticate` reads `users.role` from the DB on every request (`middleware/authenticate.js` `resolveBearerUser`), so a role change takes effect on the user's next request without a re-login.

`apps/api/src/routes/admin-rx-cases.routes.js`:
- Change the import to `import { requireAdmin, requireRole } from "../middleware/require-role.js";`.
- In exactly three registrations, change `preHandler: [authenticate, requireAdmin],` to `preHandler: [authenticate, requireRole("admin", "lab")],`. They are `GET /admin/rx-cases`, `GET /admin/rx-cases/:id` and `GET /admin/rx-cases/:id/files/:fileId`.
- In the comment above the file route, replace "the admin role gate (requireAdmin) replaces that check, since an admin" with "the staff role gate (admin or lab) replaces that check, since staff".

- [ ] **Step 5: Run the tests**

Run: `pnpm test` (repo root)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src apps/api/src
git commit -m "feat(lab): staff API for the board, departments and lab role; lab can read Rx cases

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 7: Creation flows — Rx release (manual + auto) and checkout

**Files:**
- Create: `apps/api/src/routes/__tests__/rx-release.test.js`
- Modify:
  - `apps/api/src/routes/admin-rx-cases.routes.js` (release route; the case detail gains `labOrder`);
  - `apps/api/src/routes/rx.routes.js` (auto-release);
  - `apps/api/src/routes/payment.routes.js` (checkout lab order);
  - `apps/api/src/config/env.js` (`RX_AUTO_RELEASE`);
  - `apps/api/src/routes/__tests__/rx-form-submit.test.js`, `apps/api/src/routes/__tests__/checkout-lines.test.js`.

**Interfaces:**
- Consumes: `releaseRefusal`, `canRelease` (Task 3); `releaseRxCase`, `createShopLabOrder`, `labOrdersForCases` (Task 5); `labErrorReply` (Task 6); `rxReleaseSchema` (Task 6); `currentLabOrder` (Task 1).
- Produces:
  - `POST /api/v1/admin/rx-cases/:id/release` (admin or lab), body `{ confirmNotInSeazona? }`:
    - success → 201 `{ data: { caseId, status: "released", labOrder: { id, orderNumber }, unknownCodes } }`;
    - 409 from `releaseRefusal` or `ALREADY_RELEASED`;
    - 422 `RX_RELEASE_BLOCKED` with `blocking`.
  - `GET /admin/rx-cases/:id` data gains `labOrder: { id, orderNumber, status } | null`.
  - `shouldAutoRelease(flag) → boolean`, exported from `rx.routes.js`.
  - `checkoutLinesFromQuote` lines gain `code`.
  - Env `RX_AUTO_RELEASE` (string, optional; only exactly `"true"` enables it).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/routes/__tests__/rx-release.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const adminRx = read("../admin-rx-cases.routes.js");
const rx = read("../rx.routes.js");
const payment = read("../payment.routes.js");

function handler(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `not found: ${marker}`);
  const next = source.indexOf("\n  fastify.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

const RELEASE = 'fastify.post("/admin/rx-cases/:id/release",';

test("release is open to lab staff and checks refusals, then the line gate, then releases in a transaction", () => {
  const body = handler(adminRx, RELEASE);
  assert.match(body, /requireRole\("admin", "lab"\)/);
  assert.match(body, /validate\(rxReleaseSchema\)/);
  const refusal = body.indexOf("releaseRefusal(");
  const gate = body.indexOf("canRelease(");
  const tx = body.indexOf("db.transaction(");
  assert.ok(refusal >= 0 && gate > refusal && tx > gate, "order: releaseRefusal → canRelease → transaction");
  assert.match(body, /releaseRxCase\(tx,/);
  assert.match(body, /rx_case\.released/);
});

test("auto-release reuses the same gate and the same release, and never fails the doctor's submission", () => {
  const start = rx.indexOf("shouldAutoRelease(env.RX_AUTO_RELEASE)");
  assert.ok(start >= 0, "auto-release block missing");
  const block = rx.slice(start, rx.indexOf("sendRxSubmissionReceived(", start));
  assert.match(block, /canRelease\(lines\)\.ok/);
  assert.match(block, /db\.transaction\(\(tx\) => releaseRxCase\(tx,/);
  assert.match(block, /catch \(err\)/);
});

test("checkout records the lab order in the SAME transaction as the paid order", () => {
  const start = payment.indexOf("await db.transaction(async (tx) => {", payment.indexOf("async function recordGuestOrder"));
  const end = payment.indexOf("} catch (orderErr)", start);
  assert.ok(start >= 0 && end > start, "recordGuestOrder's transaction not found");
  const txBody = payment.slice(start, end);
  assert.match(txBody, /tx\.insert\(orders\)/);
  assert.match(txBody, /createShopLabOrder\(tx, \{ orderId, clientUserId: pricedForUserId, quoteLines: quote\.lines \}\)/);
});
```

Append to `apps/api/src/routes/__tests__/rx-form-submit.test.js`:

```js
test("auto-release is off unless RX_AUTO_RELEASE is exactly 'true'", async () => {
  const { shouldAutoRelease } = await import("../rx.routes.js");
  assert.equal(shouldAutoRelease("true"), true);
  for (const v of [undefined, "", "1", "TRUE", "yes", "false"]) assert.equal(shouldAutoRelease(v), false, String(v));
});
```

Append to `apps/api/src/routes/__tests__/checkout-lines.test.js` (it already imports `checkoutLinesFromQuote`; read the file and reuse its quote fixture shape):

```js
test("checkout lines carry the variant's lab code for the lab order", () => {
  const [line] = checkoutLinesFromQuote({
    lines: [{ variantId: "v1", code: "4410", name: "Retainer case", catalogId: null, legacySeazonaProductId: null, qty: 1, unitCents: 500, lineCents: 500, priceSource: "base", taxable: false }],
  });
  assert.equal(line.code, "4410");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/rx-release.test.js src/routes/__tests__/rx-form-submit.test.js src/routes/__tests__/checkout-lines.test.js`
Expected: FAIL — no release route, no `shouldAutoRelease`, `line.code` is undefined.

- [ ] **Step 3: Implement the release route**

`apps/api/src/routes/admin-rx-cases.routes.js`:

Imports (add):

```js
import { validate } from "../middleware/validate.js";
import { rxReleaseSchema, currentLabOrder } from "@my-app/shared";
import { releaseRxCase, labOrdersForCases } from "../services/lab/lab-orders.service.js";
import { labErrorReply } from "./lab.routes.js";
```

Also add `releaseRefusal` to the `case-gates.js` import list **and** to the re-export list below it.

In `GET /admin/rx-cases/:id`, load the case's lab orders alongside lines and files. Change the `Promise.all([...])` to also fetch `labOrdersForCases([caseRow.id])`, then return:

```js
    const [lines, files, labOrdersByCase] = await Promise.all([
      db.select().from(rxCaseLines).where(eq(rxCaseLines.caseId, caseRow.id)).orderBy(asc(rxCaseLines.position)),
      db.select().from(rxCaseFiles).where(eq(rxCaseFiles.caseId, caseRow.id)),
      labOrdersForCases([caseRow.id]),
    ]);
    // …existing audit + decrypt unchanged…
    const lo = currentLabOrder(labOrdersByCase.get(caseRow.id) ?? []);
    return {
      data: {
        case: decrypted,
        lines,
        files,
        prescription: decrypted.formData,
        labOrder: lo ? { id: lo.id, orderNumber: lo.orderNumber, status: lo.status } : null,
      },
    };
```

Add the route after `POST /admin/rx-cases/:id/re-resolve`:

```js
  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-cases/:id/release
  // Release a reviewed case to the production board. Replaces the Seazona
  // push (own-the-lab piece 2): same line gate (canRelease, formerly canPush),
  // but the "order" is our own lab order, created in the same transaction
  // that moves the case to `released`.
  //
  // Order of checks: releaseRefusal (already released / legacy pushed /
  // cancelled / an unconfirmed legacy Seazona push) → canRelease on the
  // STORED lines → transaction (claim case, allocate number, insert order,
  // lines and event). Lab staff may release; editing lines stays admin-only.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-cases/:id/release", {
    preHandler: [authenticate, requireRole("admin", "lab"), validate(rxReleaseSchema)],
  }, async (request, reply) => {
    const caseId = request.params.id;
    const [caseRowRaw] = await db.select().from(rxCases).where(eq(rxCases.id, caseId));
    if (!caseRowRaw) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });

    const refusal = releaseRefusal(caseRowRaw, { confirmNotInSeazona: request.body.confirmNotInSeazona === true });
    if (refusal) return reply.code(refusal.status).send({ error: refusal.error });

    const lines = await db
      .select()
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(asc(rxCaseLines.position));
    const gate = canRelease(lines);
    if (!gate.ok) {
      return reply.code(422).send({
        error: { code: "RX_RELEASE_BLOCKED", status: 422, message: gate.reason, blocking: gate.blocking },
      });
    }

    let caseRow;
    try {
      caseRow = decryptRxPhi(caseRowRaw);
    } catch (err) {
      request.log.error({ caseId, err: err.message }, "rx PHI decrypt failed");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." } });
    }

    let result;
    try {
      result = await db.transaction((tx) => releaseRxCase(tx, { caseRow, lines, byUserId: request.user.id }));
    } catch (err) {
      const r = labErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }

    // No PHI: ids, the order number and lab codes only.
    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.released",
      targetType: "rx_case",
      targetId: caseId,
      metadata: {
        labOrderId: result.labOrder.id,
        orderNumber: result.labOrder.orderNumber,
        unknownCodes: result.unknownCodes,
        confirmedNotInSeazona: request.body.confirmNotInSeazona === true,
      },
      ipAddress: request.ip,
    });

    return reply.code(201).send({
      data: { caseId, status: "released", labOrder: result.labOrder, unknownCodes: result.unknownCodes },
    });
  });
```

- [ ] **Step 4: Implement auto-release**

`apps/api/src/config/env.js` — add after `RX_GCS_BUCKET`, leaving the `RX_LIVE_PUSH` block alone until Task 12:

```js
  // Auto-release gate (own-the-lab piece 2). Exactly "true" enables it: a
  // cleanly-resolved incoming case (canRelease passes) is released straight
  // to the production board on submission, skipping the review queue. It
  // creates only our own lab order — nothing leaves this system — so the
  // worst case of a wrong release is a job staff cancel on the board.
  RX_AUTO_RELEASE: z.string().optional(),
```

`apps/api/src/routes/rx.routes.js`:

Imports (add):

```js
import { releaseRxCase } from "../services/lab/lab-orders.service.js";
```

(`canRelease` is already imported from case-gates after Task 3's rename.)

Below `shouldAutoPush`, add:

```js
/**
 * Whether a freshly-submitted, cleanly-resolved case is released straight to
 * the production board. Exact "true" only — any other value, or unset, is off.
 */
export function shouldAutoRelease(flag) {
  return flag === "true";
}
```

In `POST /rx/form-submissions`, insert this block directly **before** the `// ── Auto-push under RX_LIVE_PUSH` comment:

```js
    // ── Auto-release under RX_AUTO_RELEASE ────────────────────────────────
    // Same gate the queue's Release button uses (canRelease on the stored
    // lines) and the same release (releaseRxCase) — never a second copy. A
    // case that doesn't pass stays "new" for the queue. Any failure is
    // logged and leaves the case for a human; the doctor's submission has
    // already succeeded and must not fail over this.
    let finalStatus = SUBMISSION_STATUS;
    if (shouldAutoRelease(env.RX_AUTO_RELEASE) && canRelease(lines).ok) {
      try {
        const caseRow = {
          id: caseId,
          userId,
          status: SUBMISSION_STATUS,
          dueDate: data.dueDate || null,
          formData: data.formData ?? {},
          rush: false,
          rushTier: null,
        };
        const result = await db.transaction((tx) => releaseRxCase(tx, { caseRow, lines, byUserId: null }));
        finalStatus = "released";
        auditService.logSafe({
          userId: request.user.id,
          action: "rx_case.auto_released",
          targetType: "rx_case",
          targetId: caseId,
          metadata: { labOrderId: result.labOrder.id, orderNumber: result.labOrder.orderNumber, unknownCodes: result.unknownCodes },
          ipAddress: request.ip,
        });
      } catch (err) {
        request.log.error({ caseId, err: err.message }, "[LAB][RX_AUTO_RELEASE_FAILED] auto-release failed; case left for the queue");
      }
    }
```

In the existing auto-push block just below, delete its `let finalStatus = SUBMISSION_STATUS;` line (the variable is now declared above) and change its guard to `if (finalStatus === SUBMISSION_STATUS && shouldAutoPush(env.RX_LIVE_PUSH)) {`. A released case can then never also be pushed. Task 12 deletes that block entirely.

- [ ] **Step 5: Implement the checkout lab order**

`apps/api/src/routes/payment.routes.js`:

Imports (add):

```js
import { createShopLabOrder } from "../services/lab/lab-orders.service.js";
```

In `checkoutLinesFromQuote`, add `code: l.code ?? null,` after `variantId: l.variantId,`.

In `recordGuestOrder`, inside `await db.transaction(async (tx) => { … })`, directly after the `await tx.insert(orderItems).values(…);` statement:

```js
      // The job for the bench, in the same transaction as the paid order: an
      // order is never recorded without its lab order, or vice versa. Never
      // refuses what pricing accepted (planShopLabOrder) — the card is charged.
      await createShopLabOrder(tx, { orderId, clientUserId: pricedForUserId, quoteLines: quote.lines });
```

Update the `recordGuestOrder` docstring's first sentence to "Record a successful guest catalog charge LOCALLY (authoritative), with its lab order, and attempt the gated Seazona createOrder push."

- [ ] **Step 6: Run the tests**

Run: `pnpm test` (repo root)
Expected: PASS. `rx-auto-push-claim.test.js` still passes: the push block is still there, now guarded by `finalStatus === SUBMISSION_STATUS && …`. Its claim-predicate regexes are unchanged.

- [ ] **Step 7: Prove release end-to-end on the local DB (no network)**

Pick a local case with resolvable lines and release it through the service. Don't start the dev server; it would load the Seazona-backed routes.

```bash
cd apps/api && node --env-file=.env -e '
const { db } = await import("./src/config/database.js");
const { rxCases, rxCaseLines } = await import("./src/db/schema/index.js");
const { eq, asc, inArray } = await import("drizzle-orm");
const { decryptRxPhi } = await import("./src/services/rx/phi-crypto.js");
const { canRelease } = await import("./src/services/rx/case-gates.js");
const { releaseRxCase, getLabOrderDetail } = await import("./src/services/lab/lab-orders.service.js");
const cands = await db.select().from(rxCases).where(inArray(rxCases.status, ["new","in_review","failed"]));
for (const c of cands) {
  const lines = await db.select().from(rxCaseLines).where(eq(rxCaseLines.caseId, c.id)).orderBy(asc(rxCaseLines.position));
  if (!canRelease(lines).ok || c.seazonaPushStatus === "pushing") continue;
  const r = await db.transaction((tx) => releaseRxCase(tx, { caseRow: decryptRxPhi(c), lines, byUserId: null }));
  const d = await getLabOrderDetail(r.labOrder.id);
  console.log("released", c.caseNumber, "→ #" + r.labOrder.orderNumber, "lines", d.lines.length, "events", d.events.length, "unknown", r.unknownCodes);
  try { await db.transaction((tx) => releaseRxCase(tx, { caseRow: decryptRxPhi(c), lines, byUserId: null })); console.log("DOUBLE RELEASE — BUG"); }
  catch (e) { console.log("second release refused:", e.code); }
  break;
}
process.exit(0);'
```
Expected: `released RX-… → #100000 lines N events 1`, then `second release refused: ALREADY_RELEASED`. If no local case passes `canRelease`, say so in the task report rather than fabricating one.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(lab): release Rx cases and paid shop orders onto the production board

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 8: Rx form definitions → shared; grouped answers

**Files:**
- Move (`git mv`): `apps/web/src/data/forms/{digital-rx.form.js, ortho-rx.form.js, form-fields.js, rx-common.sections.js, ortho.sections.js}` → `packages/shared/src/rx/forms/`
- Create: `packages/shared/src/rx/forms/index.js`, `packages/shared/src/rx/forms/answers.js`, `packages/shared/src/rx/forms/answers.test.js`
- Modify:
  - `packages/shared/package.json`, `packages/shared/src/index.js`;
  - `apps/web/src/data/forms/index.js`;
  - `apps/web/src/data/forms/digital-rx.form.test.js`, `apps/web/src/data/forms/ortho-rx.form.test.js`;
  - `apps/api/scripts/rx-replay/translate.js`;
  - `apps/api/src/services/rx/catalog-map/resolvers/ortho.form-coverage.test.js`, `apps/api/src/services/rx/catalog-map/resolvers/guard.form-coverage.test.js`, `apps/api/src/services/rx/catalog-map/lab-services.test.js`.

**Interfaces:**
- Produces (from `@my-app/shared`): `RX_FORMS`, `RX_FORM_LIST`, `getRxForm(slug) → form|null`, `groupRxAnswers(form, answers) → Array<{ id, title, items: Array<{ key, label, value }> }>`, `formatRxAnswer(value) → string|null`.
- Deep imports: `@my-app/shared/rx/forms/<file>.js` (new `exports` entry `"./rx/*"`).
- Web keeps its names: `apps/web/src/data/forms/index.js` re-exports `FORMS`, `FORM_LIST`, `getForm`, so `RxFormPage`, `RxChooserPage` and `AdminRxMappingPage` are unchanged.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/rx/forms/answers.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { groupRxAnswers, formatRxAnswer } from "./answers.js";
import { getRxForm, RX_FORM_LIST } from "./index.js";

const form = {
  sections: [
    {
      id: "case-id", heading: "Case Identification",
      fields: [
        { type: "static", key: "noteDoctorAuto", html: "<b>Doctor</b>" },
        { type: "heading", key: "hdrCaseId", label: "Case Identification" },
        { type: "fullname", key: "patientName", label: "PATIENT:" },
        { type: "date", key: "dueDate", label: "Due Date Requested" },
      ],
    },
    {
      id: "ddso", heading: "DDSO",
      fields: [
        { type: "checkbox", key: "ddsoMods", label: "Modifications ↴" },
        { type: "fileUpload", key: "recordsUpload", label: "Upload" },
        { type: "radio", key: "ddsoEmpty", label: "Unanswered" },
      ],
    },
    { id: "unused", heading: "Not answered", fields: [{ type: "text", key: "nothing", label: "Nothing" }] },
  ],
};

test("answers are grouped by the form's sections, in form order, with clean labels", () => {
  const groups = groupRxAnswers(form, {
    patientName: { first: "Jane", last: "Doe" },
    dueDate: "2026-10-21",
    ddsoMods: ["Wrap distal", "Anterior pad"],
    recordsUpload: ["scan.stl"],
    ddsoEmpty: "",
    strayKey: true,
  });
  assert.deepEqual(groups, [
    { id: "case-id", title: "Case Identification", items: [
      { key: "patientName", label: "PATIENT", value: "Jane Doe" },
      { key: "dueDate", label: "Due Date Requested", value: "2026-10-21" },
    ] },
    { id: "ddso", title: "DDSO", items: [{ key: "ddsoMods", label: "Modifications", value: "Wrap distal, Anterior pad" }] },
    { id: "other", title: "Other answers", items: [{ key: "strayKey", label: "Stray Key", value: "Yes" }] },
  ]);
});

test("file, signature and display-only fields never print as answers", () => {
  const groups = groupRxAnswers(form, { recordsUpload: ["scan.stl"], noteDoctorAuto: "x" });
  assert.deepEqual(groups, []);
});

test("nested answers (matrices) read as words, never JSON", () => {
  assert.equal(formatRxAnswer({ upper: { clearance: "2mm" } }), "Upper: Clearance: 2mm");
  assert.equal(formatRxAnswer([]), null);
  assert.equal(formatRxAnswer(false), "No");
  assert.equal(formatRxAnswer(0), "0");
});

test("an unknown form still prints every answer, under Other", () => {
  const groups = groupRxAnswers(null, { foo: "bar" });
  assert.deepEqual(groups, [{ id: "other", title: "Other answers", items: [{ key: "foo", label: "Foo", value: "bar" }] }]);
});

test("the real forms are registered and group a real answer", () => {
  assert.deepEqual(RX_FORM_LIST.map((f) => f.slug), ["digital", "ortho"]);
  assert.equal(getRxForm("nope"), null);
  const groups = groupRxAnswers(getRxForm("digital"), { devicesToOrder: ["ddso"] });
  const select = groups.find((g) => g.id === "select-device");
  assert.equal(select.items[0].value, "ddso");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm vitest run src/rx/forms/answers.test.js`
Expected: FAIL — `./answers.js` doesn't exist.

- [ ] **Step 3: Move the definitions and add the registry and grouping**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2
mkdir -p packages/shared/src/rx/forms
for f in digital-rx.form.js ortho-rx.form.js form-fields.js rx-common.sections.js ortho.sections.js; do
  git mv "apps/web/src/data/forms/$f" "packages/shared/src/rx/forms/$f"
done
grep -n "^import" packages/shared/src/rx/forms/*.js   # only relative ./ imports — they still resolve
```

`packages/shared/src/rx/forms/index.js`:

```js
/**
 * Rx form registry — the doctor-facing forms, shared so the API can group a
 * case's answers exactly as the form does (work ticket, lab order detail).
 * `RX_FORM_LIST` preserves chooser display order.
 */
import { digitalRxForm } from "./digital-rx.form.js";
import { orthoRxForm } from "./ortho-rx.form.js";

export const RX_FORMS = { digital: digitalRxForm, ortho: orthoRxForm };
export const RX_FORM_LIST = [digitalRxForm, orthoRxForm];

export function getRxForm(slug) {
  return RX_FORMS[slug] || null;
}
```

`packages/shared/src/rx/forms/answers.js`:

```js
/**
 * A case's Rx answers, grouped and labelled as on the form. Used by the lab
 * order detail page and the work ticket so the bench reads the prescription
 * the way the doctor filled it in. Answers the form no longer defines are
 * never dropped — they print under "Other answers".
 */

// Display-only and file fields: nothing a technician reads as an answer.
const SKIP_TYPES = new Set(["heading", "static", "image", "fileUpload", "signature", "artboard", "divider"]);

export function humanizeAnswerKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanLabel(label) {
  return String(label).replace(/<[^>]*>/g, "").replace(/[\s↴:]+$/u, "").trim();
}

/** Any answer value (string, list, {first,last}, matrix object, boolean) as one line of text. */
export function formatRxAnswer(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const parts = value.map(formatRxAnswer).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    if ("first" in value || "last" in value) {
      return [value.first, value.last].filter(Boolean).join(" ") || null;
    }
    const parts = Object.entries(value)
      .map(([k, v]) => {
        const fv = formatRxAnswer(v);
        return fv ? `${humanizeAnswerKey(k)}: ${fv}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * @param {object|null} form    a form definition (getRxForm) — null for an unknown form type
 * @param {object}      answers the case's decrypted formData
 */
export function groupRxAnswers(form, answers = {}) {
  const groups = [];
  const seen = new Set();
  for (const section of form?.sections ?? []) {
    const items = [];
    for (const field of section.fields ?? []) {
      if (!field.key || seen.has(field.key)) continue;
      seen.add(field.key);
      if (SKIP_TYPES.has(field.type)) continue;
      const value = formatRxAnswer(answers?.[field.key]);
      if (value) items.push({ key: field.key, label: cleanLabel(field.label || humanizeAnswerKey(field.key)), value });
    }
    if (items.length) groups.push({ id: section.id, title: section.heading || humanizeAnswerKey(section.id), items });
  }
  const other = Object.keys(answers ?? {})
    .filter((k) => !seen.has(k))
    .map((k) => ({ key: k, label: humanizeAnswerKey(k), value: formatRxAnswer(answers[k]) }))
    .filter((i) => i.value);
  if (other.length) groups.push({ id: "other", title: "Other answers", items: other });
  return groups;
}
```

`packages/shared/package.json` — add to `"exports"`:

```json
    "./rx/*": "./src/rx/*"
```

`packages/shared/src/index.js` — extend the Rx block:

```js
export { RX_FORMS, RX_FORM_LIST, getRxForm } from "./rx/forms/index.js";
export { groupRxAnswers, formatRxAnswer, humanizeAnswerKey } from "./rx/forms/answers.js";
```

- [ ] **Step 4: Point every importer at the shared copy**

`apps/web/src/data/forms/index.js` — replace the whole file:

```js
/**
 * Form registry for the web app. The definitions live in packages/shared
 * (src/rx/forms) so the API can group answers exactly as the form does.
 */
export { RX_FORMS as FORMS, RX_FORM_LIST as FORM_LIST, getRxForm as getForm } from "@my-app/shared";
```

Rewrite these imports (only the specifier changes):

| File | Old specifier | New specifier |
|---|---|---|
| `apps/web/src/data/forms/digital-rx.form.test.js` | `./digital-rx.form.js` | `@my-app/shared/rx/forms/digital-rx.form.js` |
| `apps/web/src/data/forms/ortho-rx.form.test.js` | `./ortho-rx.form.js`, `./ortho.sections.js`, `./rx-common.sections.js`, `./digital-rx.form.js` | `@my-app/shared/rx/forms/<same file>` |
| `apps/api/scripts/rx-replay/translate.js` | `../../../web/src/data/forms/digital-rx.form.js`, `…/ortho-rx.form.js` | `@my-app/shared/rx/forms/digital-rx.form.js`, `@my-app/shared/rx/forms/ortho-rx.form.js` |
| `apps/api/src/services/rx/catalog-map/resolvers/ortho.form-coverage.test.js` | `../../../../../../web/src/data/forms/ortho.sections.js` | `@my-app/shared/rx/forms/ortho.sections.js` |
| `apps/api/src/services/rx/catalog-map/resolvers/guard.form-coverage.test.js` | `../../../../../../web/src/data/forms/digital-rx.form.js` | `@my-app/shared/rx/forms/digital-rx.form.js` |
| `apps/api/src/services/rx/catalog-map/lab-services.test.js` | `../../../../../web/src/data/forms/digital-rx.form.js` | `@my-app/shared/rx/forms/digital-rx.form.js` |

Then confirm nothing still reaches across into the web tree:

```bash
grep -rn --exclude-dir=node_modules -E "web/src/data/forms|data/forms/(digital-rx|ortho-rx|form-fields|rx-common|ortho\.sections)" apps packages
```
Expected: no output. `form-logic.js`, `form-to-case.js` and their tests stay in web and import nothing that moved; check with `grep -n "^import" apps/web/src/data/forms/*.js`.

- [ ] **Step 5: Run everything that reads a form**

Run: `pnpm test && pnpm --filter @my-app/web build`
Expected: PASS. That includes the web form tests, the API coverage tests, `translate.test.js` and the new `answers.test.js`. The web build resolves the forms through `@my-app/shared`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/shared apps/web/src/data/forms apps/api/scripts apps/api/src/services/rx/catalog-map
git commit -m "refactor(rx): Rx form definitions live in shared; group answers as on the form

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 9: Work ticket PDF (Code 128, model, renderer, route)

**Files:**
- Create:
  - `apps/api/src/lib/code128.js`, `apps/api/src/lib/code128.test.js`;
  - `apps/api/src/services/lab/ticket-model.js`, `apps/api/src/services/lab/ticket-model.test.js`;
  - `apps/api/src/services/lab/ticket-pdf.js`, `apps/api/src/services/lab/ticket-pdf.test.js`.
- Modify: `apps/api/package.json` (+ lockfile), `apps/api/src/routes/lab.routes.js`, `apps/api/src/routes/__tests__/lab-routes.test.js`

**Interfaces:**
- Consumes: the `getLabOrderDetail` shape (Task 5); `groupRxAnswers`, `getRxForm` (Task 8); `LAB_STATUS_LABELS`, `isoDateIn`, `LAB_TIMEZONE` (Task 1).
- Produces:
  - `code128Values(text) → number[]` and `code128Modules(text) → number[]`. The modules are bar/space widths, starting with a bar. Set C for even-length digit strings, else set B. Throws `RangeError` on empty or non-ASCII input. Also `CODE128_PATTERNS`.
  - `printable(text) → string`: maps characters the PDF's standard fonts can't draw to `?`.
  - `buildTicketModel(detail, { answerGroups, generatedAt }) → { title, orderNumber, barcodeText, banners[], header: [label, value][], lines: { qty, code, name, arch }[], instructions[], buildNotes, comments, shipTo, answerGroups: { title, items: [label, value][] }[], files[], footer }`.
  - `renderTicketPdf(model) → Promise<Buffer>`.
  - `GET /api/v1/lab/orders/:id/ticket.pdf` (staff) → `application/pdf`, `Cache-Control: no-store`; audit `lab_order.ticket_printed`.
- Library: **pdfkit 0.20.2** (exact pin), the project's one PDF library; piece 3's invoices reuse it. No barcode dependency: the encoder below was checked against bwip-js 4.11.4's `code128` output for every vector in the test.

- [ ] **Step 1: Add pdfkit**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2
pnpm --filter @my-app/api add pdfkit@0.20.2 --save-exact
grep '"pdfkit"' apps/api/package.json   # "pdfkit": "0.20.2"
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/lib/code128.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { code128Values, code128Modules, CODE128_PATTERNS } from "./code128.js";

test("every symbol is 11 modules wide in 6 elements; stop is 13 in 7", () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  CODE128_PATTERNS.forEach((p, i) => {
    const sum = [...p].reduce((s, d) => s + Number(d), 0);
    if (i === 106) assert.deepEqual([p.length, sum], [7, 13], "stop");
    else assert.deepEqual([p.length, sum], [6, 11], `symbol ${i}`);
  });
});

test("set B: the reference 'Wikipedia' vector, checksum 88", () => {
  assert.deepEqual(code128Values("Wikipedia"), [104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106]);
});

test("order numbers use set C (digit pairs), matching bwip-js bar for bar", () => {
  assert.deepEqual(code128Values("100245"), [105, 10, 2, 45, 48, 106]);
  assert.deepEqual(code128Modules("100245"), [
    2, 1, 1, 2, 3, 2, 2, 2, 1, 3, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 3, 1, 2, 3, 3, 1, 3, 1, 2, 1, 2, 3, 3, 1, 1, 1, 2,
  ]);
  assert.equal(code128Modules("100245").reduce((s, w) => s + w, 0), 68);
});

test("odd-length numbers fall back to set B", () => {
  assert.equal(code128Values("12345")[0], 104);
});

test("text a scanner can't carry is refused, not silently mangled", () => {
  assert.throws(() => code128Values(""), RangeError);
  assert.throws(() => code128Values("café"), RangeError);
});
```

`apps/api/src/services/lab/ticket-model.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildTicketModel, printable } from "./ticket-model.js";

const generatedAt = new Date("2026-10-07T15:00:00Z");
const rxDetail = {
  order: {
    orderNumber: 100245, status: "in_production", rush: true, rushTier: "Expedited", isRemake: true, remakeOfOrderNumber: 100200,
    dueDate: "2026-10-21", receivedAt: new Date("2026-10-07T03:00:00Z"), clientName: "Dr Amy Lee",
    departmentName: "Acrylic", assigneeName: "Maria Lopez",
  },
  lines: [
    { qty: 1, code: "2608", name: "DDSO Nylon", arch: "Upper", noteOnly: false },
    { qty: 1, code: null, name: "Wrap distal", sourceLabel: "Wrap distal of last molars", arch: null, noteOnly: true },
  ],
  rxCase: { caseNumber: "RX-ABC", practiceName: "Lee Dental", patientName: "Jane Doe", buildNotes: "[DDSO] Occlusal Contact: TRIPOD", generalComments: "Thin as possible" },
  files: [{ kind: "scan", originalName: "upper.stl" }],
  shopOrder: null,
};

// Review Focus 4 (the printed half).
test("rush and remake are banners a technician can't miss", () => {
  const m = buildTicketModel(rxDetail, { generatedAt });
  assert.deepEqual(m.banners, ["RUSH — Expedited", "REMAKE of #100200"]);
  assert.deepEqual(buildTicketModel({ ...rxDetail, order: { ...rxDetail.order, rush: true, rushTier: null, isRemake: false } }, { generatedAt }).banners, ["RUSH"]);
  assert.deepEqual(buildTicketModel({ ...rxDetail, order: { ...rxDetail.order, rush: false, isRemake: false, status: "on_hold" } }, { generatedAt }).banners, ["ON HOLD"]);
});

test("the bench gets the patient, practice, doctor, dates and the barcode text", () => {
  const m = buildTicketModel(rxDetail, { generatedAt });
  const h = Object.fromEntries(m.header);
  assert.equal(m.barcodeText, "100245");
  assert.equal(h.Patient, "Jane Doe");
  assert.equal(h.Practice, "Lee Dental");
  assert.equal(h.Doctor, "Dr Amy Lee");
  assert.equal(h.Case, "RX-ABC");
  assert.equal(h.Due, "10/21/2026");
  assert.equal(h.Received, "10/06/2026", "received is the lab's date, not UTC's");
  assert.equal(h.Status, "In production");
});

test("devices print as lines; instructions print separately; files and notes are listed", () => {
  const m = buildTicketModel(rxDetail, { generatedAt, answerGroups: [{ title: "DDSO", items: [{ label: "Modifications", value: "Wrap distal" }] }] });
  assert.deepEqual(m.lines, [{ qty: "1", code: "2608", name: "DDSO Nylon", arch: "Upper" }]);
  assert.deepEqual(m.instructions, ["Wrap distal of last molars"]);
  assert.equal(m.buildNotes, "[DDSO] Occlusal Contact: TRIPOD");
  assert.equal(m.comments, "Thin as possible");
  assert.deepEqual(m.files, ["scan: upper.stl"]);
  assert.deepEqual(m.answerGroups, [{ title: "DDSO", items: [["Modifications", "Wrap distal"]] }]);
  assert.match(m.footer, /10\/07\/2026/);
  assert.match(m.footer, /patient information/);
});

test("a shop order ticket has no patient and prints the ship-to", () => {
  const m = buildTicketModel({
    order: { orderNumber: 100246, status: "received", rush: false, isRemake: false, dueDate: null, receivedAt: generatedAt, clientName: null },
    lines: [{ qty: 3, code: null, name: "Bite registration kit", arch: null, noteOnly: false }],
    rxCase: null, files: [],
    shopOrder: { orderNumber: "DOL-ABC", shipping: { name: "Pat Smith", address1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" } },
  }, { generatedAt });
  const h = Object.fromEntries(m.header);
  assert.equal(h.Patient, "—");
  assert.equal(h["Shop order"], "DOL-ABC");
  assert.equal(h.Practice, "Pat Smith");
  assert.deepEqual(m.lines, [{ qty: "3", code: "—", name: "Bite registration kit", arch: "" }]);
  assert.deepEqual(m.shipTo, ["Pat Smith", "1 Main St", "Austin, TX 78701"]);
});

test("characters the PDF fonts can't draw become ?, everything else survives", () => {
  assert.equal(printable("Café “Bite” — 2× • ok"), "Café “Bite” — 2× • ok");
  assert.equal(printable("Tooth 😀 #8"), "Tooth ? #8");
  const m = buildTicketModel({ ...rxDetail, rxCase: { ...rxDetail.rxCase, generalComments: "Smile 😀" } }, { generatedAt });
  assert.equal(m.comments, "Smile ?");
});
```

`apps/api/src/services/lab/ticket-pdf.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { renderTicketPdf } from "./ticket-pdf.js";
import { buildTicketModel } from "./ticket-model.js";

const detail = {
  order: { orderNumber: 100245, status: "received", rush: true, rushTier: "Expedited", isRemake: false, dueDate: "2026-10-21", receivedAt: new Date(), clientName: "Dr Lee" },
  lines: [{ qty: 1, code: "2608", name: "DDSO Nylon", arch: "Upper", noteOnly: false }],
  rxCase: { caseNumber: "RX-ABC", practiceName: "Lee Dental", patientName: "Jane Doe", buildNotes: null, generalComments: null },
  files: [], shopOrder: null,
};

test("the renderer produces a non-empty PDF", async () => {
  const buf = await renderTicketPdf(buildTicketModel(detail, { generatedAt: new Date() }));
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(buf.length > 1000, `suspiciously small PDF: ${buf.length} bytes`);
});

test("a long prescription flows onto another page instead of being cut", async () => {
  const answerGroups = [{ title: "Long", items: Array.from({ length: 200 }, (_, i) => ({ label: `Question ${i}`, value: "An answer long enough to wrap onto a second line of the ticket body" })) }];
  const buf = await renderTicketPdf(buildTicketModel(detail, { generatedAt: new Date(), answerGroups }));
  const pages = Number(/\/Count (\d+)/.exec(buf.toString("latin1"))?.[1]);
  assert.ok(pages >= 2, `expected overflow onto page 2+, got ${pages}`);
});
```

Append to `apps/api/src/routes/__tests__/lab-routes.test.js`:

```js
test("the work ticket is staff-only, never cached, and audit-logged", () => {
  const body = handler(labSource, 'fastify.get("/lab/orders/:id/ticket.pdf",');
  assert.match(body, /STAFF/);
  assert.match(body, /"Cache-Control", "no-store"/);
  assert.match(body, /lab_order\.ticket_printed/);
  assert.match(body, /application\/pdf/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run src/lib/code128.test.js src/services/lab/ticket-model.test.js src/services/lab/ticket-pdf.test.js src/routes/__tests__/lab-routes.test.js`
Expected: FAIL — the modules don't exist, and the ticket route isn't registered.

- [ ] **Step 4: Implement the encoder**

`apps/api/src/lib/code128.js`:

```js
/**
 * Code 128 encoder (pure). Returns bar/space module widths — starting with a
 * bar — for a renderer to draw as rectangles. Code set C (digit pairs) for
 * even-length all-digit text (the lab's order numbers: denser, scans
 * faster); code set B (ASCII 32–126) otherwise. Checked against bwip-js
 * 4.11.4's code128 output for every vector in code128.test.js.
 */

// Symbol value → bar/space widths. 0–102 data, 103 Start A, 104 Start B,
// 105 Start C, 106 Stop (7 elements).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

export { PATTERNS as CODE128_PATTERNS };

/** Symbol values including start, checksum and stop. */
export function code128Values(text) {
  const s = String(text);
  if (s.length === 0) throw new RangeError("Code 128 needs at least one character");
  let values;
  if (/^(\d\d)+$/.test(s)) {
    values = [START_C];
    for (let i = 0; i < s.length; i += 2) values.push(Number(s.slice(i, i + 2)));
  } else {
    values = [START_B];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 32 || c > 126) throw new RangeError(`Code 128 set B can't encode ${JSON.stringify(ch)}`);
      values.push(c - 32);
    }
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  return [...values, sum % 103, STOP];
}

/** Alternating bar/space widths in modules, bar first. */
export function code128Modules(text) {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]].map(Number));
}
```

- [ ] **Step 5: Implement the model and the renderer**

`apps/api/src/services/lab/ticket-model.js`:

```js
import { LAB_STATUS_LABELS, LAB_TIMEZONE, isoDateIn } from "@my-app/shared";

/**
 * Everything printed on a work ticket, decided here so it is testable — the
 * pdfkit renderer (ticket-pdf.js) only lays it out. Input is the lab order
 * detail (lab-orders.service getLabOrderDetail) plus the Rx answers grouped
 * as on the form (groupRxAnswers). The ticket carries PHI: it is built on
 * request and never stored.
 */

// pdfkit's standard fonts draw WinAnsi only. Keep Latin-1 plus the common
// typographic marks; anything else (emoji, CJK) would print as garbage.
const UNPRINTABLE = /[^\n\x20-\x7E -ÿ–—‘’“”•…]/gu;

export function printable(text) {
  return String(text).normalize("NFC").replace(UNPRINTABLE, "?");
}

function deepPrintable(value) {
  if (typeof value === "string") return printable(value);
  if (Array.isArray(value)) return value.map(deepPrintable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepPrintable(v)]));
  return value;
}

const ARCH = { upper: "Upper", lower: "Lower", both: "Both" };
const archLabel = (a) => (a ? (ARCH[String(a).toLowerCase()] ?? String(a)) : "");

/** "YYYY-MM-DD" → "MM/DD/YYYY". */
function usDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}
/** An instant, as the lab's calendar date. */
const labDate = (instant) => (instant ? usDate(isoDateIn(LAB_TIMEZONE, new Date(instant))) : "—");
const labDateTime = (instant) => new Date(instant).toLocaleString("en-US", {
  timeZone: LAB_TIMEZONE, month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit",
});

export function buildTicketModel(detail, { answerGroups = [], generatedAt }) {
  const { order, lines, rxCase, files = [], shopOrder } = detail;
  const banners = [];
  if (order.rush) banners.push(order.rushTier ? `RUSH — ${order.rushTier}` : "RUSH");
  if (order.isRemake) banners.push(order.remakeOfOrderNumber ? `REMAKE of #${order.remakeOfOrderNumber}` : "REMAKE");
  if (order.status === "on_hold") banners.push("ON HOLD");

  const ship = shopOrder?.shipping;
  const model = {
    title: `Work ticket #${order.orderNumber}`,
    orderNumber: String(order.orderNumber),
    barcodeText: String(order.orderNumber),
    banners,
    header: [
      ["Order", `#${order.orderNumber}`],
      rxCase ? ["Case", rxCase.caseNumber ?? "—"] : ["Shop order", shopOrder?.orderNumber ?? "—"],
      ["Practice", rxCase?.practiceName || order.clientName || ship?.name || "—"],
      ["Doctor", order.clientName || "—"],
      ["Patient", rxCase?.patientName || "—"],
      ["Received", labDate(order.receivedAt)],
      ["Due", usDate(order.dueDate)],
      ["Status", LAB_STATUS_LABELS[order.status] ?? order.status],
      ["Department", order.departmentName || "—"],
      ["Assigned to", order.assigneeName || "—"],
    ],
    lines: lines.filter((l) => !l.noteOnly).map((l) => ({
      qty: String(l.qty), code: l.code || "—", name: l.name, arch: archLabel(l.arch),
    })),
    instructions: lines.filter((l) => l.noteOnly).map((l) => l.sourceLabel || l.name),
    buildNotes: rxCase?.buildNotes || null,
    comments: rxCase?.generalComments || null,
    shipTo: ship
      ? [ship.name, ship.address1, `${ship.city ?? ""}, ${ship.state ?? ""} ${ship.postalCode ?? ""}`.trim()].filter(Boolean)
      : null,
    answerGroups: answerGroups.map((g) => ({ title: g.title, items: g.items.map((i) => [i.label, i.value]) })),
    files: files.map((f) => `${f.kind}: ${f.originalName || "unnamed"}`),
    footer: `Printed ${labDateTime(generatedAt)} · Contains patient information — keep with the case and shred when done.`,
  };
  return deepPrintable(model);
}
```

`apps/api/src/services/lab/ticket-pdf.js`:

```js
import PDFDocument from "pdfkit";
import { code128Modules } from "../../lib/code128.js";

/**
 * Lay out a work ticket model (ticket-model.js) as a letter-size PDF. Thin
 * on purpose: every decision about WHAT prints lives in the model. Header,
 * barcode and banners are always on page 1; a long prescription flows onto
 * further pages rather than being cut.
 */

const MARGIN = 36;   // half an inch
const MODULE = 1.1;  // points per barcode module (~0.39 mm; scans on a laser printer)
const BAR_HEIGHT = 36;

function drawBarcode(doc, text, right, top) {
  const modules = code128Modules(text);
  const width = modules.reduce((s, w) => s + w, 0) * MODULE;
  let x = right - width;
  const left = x;
  modules.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(x, top, w * MODULE, BAR_HEIGHT).fill("#000");
    x += w * MODULE;
  });
  doc.fillColor("#000").font("Helvetica").fontSize(8).text(text, left, top + BAR_HEIGHT + 2, { width, align: "center" });
}

export function renderTicketPdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, info: { Title: model.title } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - MARGIN * 2;

    doc.font("Helvetica-Bold").fontSize(22).text(`Order #${model.orderNumber}`, MARGIN, MARGIN, { width: width / 2 });
    doc.font("Helvetica").fontSize(9).text("WORK TICKET", MARGIN, MARGIN + 26);
    drawBarcode(doc, model.barcodeText, doc.page.width - MARGIN, MARGIN);

    let y = MARGIN + BAR_HEIGHT + 22;
    for (const banner of model.banners) {
      doc.rect(MARGIN, y, width, 20).fill("#000");
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(12).text(banner, MARGIN + 8, y + 5, { width: width - 16 });
      doc.fillColor("#000");
      y += 24;
    }

    const colW = width / 2;
    doc.fontSize(9);
    model.header.forEach(([label, value], i) => {
      const x = MARGIN + (i % 2) * colW;
      const rowY = y + 4 + Math.floor(i / 2) * 14;
      doc.font("Helvetica-Bold").text(label, x, rowY, { width: 72, lineBreak: false });
      doc.font("Helvetica").text(String(value), x + 74, rowY, { width: colW - 82, lineBreak: false, ellipsis: true });
    });
    doc.x = MARGIN;
    doc.y = y + 4 + Math.ceil(model.header.length / 2) * 14 + 6;

    const section = (title) => {
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(11).text(title, MARGIN, doc.y, { width });
      doc.moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + width, doc.y + 1).lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9);
    };

    section("Devices & lines");
    if (model.lines.length === 0) doc.text("—", MARGIN, doc.y, { width });
    for (const l of model.lines) {
      doc.text(`${l.qty} ×   ${l.code}   ${l.name}${l.arch ? `   (${l.arch})` : ""}`, MARGIN, doc.y, { width });
    }
    if (model.instructions.length) {
      section("Instructions");
      for (const t of model.instructions) doc.text(`• ${t}`, MARGIN, doc.y, { width });
    }
    if (model.buildNotes) { section("Build notes"); doc.text(model.buildNotes, MARGIN, doc.y, { width }); }
    if (model.comments) { section("Doctor's comments"); doc.text(model.comments, MARGIN, doc.y, { width }); }
    if (model.shipTo) { section("Ship to"); doc.text(model.shipTo.join("\n"), MARGIN, doc.y, { width }); }
    if (model.answerGroups.length) {
      section("Prescription");
      for (const g of model.answerGroups) {
        doc.font("Helvetica-Bold").fontSize(9).text(g.title, MARGIN, doc.y, { width });
        doc.font("Helvetica").fontSize(8);
        for (const [label, value] of g.items) doc.text(`${label}: ${value}`, MARGIN + 8, doc.y, { width: width - 8 });
        doc.moveDown(0.2);
      }
    }
    if (model.files.length) { section("Files"); doc.text(model.files.join("\n"), MARGIN, doc.y, { width }); }

    doc.moveDown(1).font("Helvetica-Oblique").fontSize(7).fillColor("#444").text(model.footer, MARGIN, doc.y, { width });
    doc.end();
  });
}
```

- [ ] **Step 6: Add the route**

`apps/api/src/routes/lab.routes.js` — imports (add):

```js
import { groupRxAnswers, getRxForm } from "@my-app/shared";
import { buildTicketModel } from "../services/lab/ticket-model.js";
import { renderTicketPdf } from "../services/lab/ticket-pdf.js";
```

(`groupRxAnswers` and `getRxForm` join the existing `@my-app/shared` import.) Add after `GET /lab/orders/:id`:

```js
  // The work ticket: built on request from live data and never stored — it
  // carries the patient's name. Every print is audit-logged.
  fastify.get("/lab/orders/:id/ticket.pdf", { preHandler: STAFF }, async (request, reply) => {
    let pdf;
    let orderNumber;
    try {
      const detail = await labOrdersService.getLabOrderDetail(request.params.id);
      if (!detail) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
      const answerGroups = detail.rxCase
        ? groupRxAnswers(getRxForm(detail.rxCase.formType), detail.rxCase.formData)
        : [];
      pdf = await renderTicketPdf(buildTicketModel(detail, { answerGroups, generatedAt: new Date() }));
      orderNumber = detail.order.orderNumber;
    } catch (err) {
      request.log.error({ labOrderId: request.params.id, err: err.message }, "work ticket render failed");
      return reply.code(500).send({ error: { ...ERROR_CODES.INTERNAL_ERROR, message: "Failed to build the work ticket." } });
    }
    audit(request, "lab_order.ticket_printed", request.params.id, { orderNumber });
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="work-ticket-${orderNumber}.pdf"`)
      .header("Cache-Control", "no-store")
      .send(pdf);
  });
```

- [ ] **Step 7: Run the tests and render a real ticket locally**

```bash
pnpm test
cd apps/api && node --env-file=.env -e '
const s = await import("./src/services/lab/lab-orders.service.js");
const { groupRxAnswers, getRxForm } = await import("@my-app/shared");
const { buildTicketModel } = await import("./src/services/lab/ticket-model.js");
const { renderTicketPdf } = await import("./src/services/lab/ticket-pdf.js");
const [card] = await s.listLabOrders({ includeClosed: true });
if (!card) { console.log("no lab orders yet — Task 7 step 7 creates one"); process.exit(0); }
const d = await s.getLabOrderDetail(card.id);
const pdf = await renderTicketPdf(buildTicketModel(d, { answerGroups: d.rxCase ? groupRxAnswers(getRxForm(d.rxCase.formType), d.rxCase.formData) : [], generatedAt: new Date() }));
(await import("node:fs")).writeFileSync("/tmp/ticket-check.pdf", pdf);
console.log("wrote /tmp/ticket-check.pdf", pdf.length, "bytes");
process.exit(0);'
```
Expected: the tests pass and the file is written outside the repo. Open it in Preview and check the barcode scans (a phone barcode app reads the order number). The file contains PHI: delete it afterwards with `rm /tmp/ticket-check.pdf`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src
git commit -m "feat(lab): printable work ticket with a Code 128 order barcode

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 10: Web — production board, order detail, staff guard and nav

**Files:**
- Create:
  - `apps/web/src/guards/RequireStaff.jsx`;
  - `apps/web/src/lib/lab-board.js`, `apps/web/src/lib/__tests__/lab-board.test.js`;
  - `apps/web/src/pages/lab/LabBoardPage.jsx`, `apps/web/src/pages/lab/LabOrderDetailPage.jsx`;
  - `apps/web/src/config/routes.test.js`.
- Modify: `apps/web/src/config/routes.js`, `apps/web/src/App.jsx`, `apps/web/src/components/layout/Sidebar.jsx`, `apps/web/src/pages/app/AdminRxCaseDetailPage.jsx`

**Interfaces:**
- Consumes:
  - from shared: `LAB_BOARD_COLUMNS`, `LAB_STATUS_LABELS`, `allowedNextStatuses`, `reasonRequiredFor`, `groupRxAnswers`, `getRxForm`;
  - HTTP from Task 6 / 9: `GET /lab/orders`, `GET /lab/orders/:id`, `POST /lab/orders/:id/status`, `PATCH /lab/orders/:id`, `POST /lab/orders/:id/remake`, `GET /lab/departments`, `GET /lab/staff`, `GET /lab/orders/:id/ticket.pdf`;
  - existing: `GET /admin/rx-cases/:caseId/files/:fileId`.
- Produces:
  - `lib/lab-board.js`:
    - `groupByStatus(cards) → { [status]: card[] }`, covering every board column;
    - `quickMoves(card) → { to, label }[]`;
    - `boardParams(filters) → params`;
    - `describeEvent(event, { staffById, departmentsById }) → string`;
    - `errorText(err) → string`;
    - `isStale(err) → boolean`;
    - `openInNewTab(getUrl) → Promise<void>`.
  - `ROUTES.LAB_BOARD = "/lab"`, `ROUTES.LAB_ORDER_DETAIL = "/lab/orders/:id"`, `labOrderPath(id) → string`.
  - `roleHome({ role: "lab" }) → "/lab"`.
  - `<RequireStaff />`: lets `admin` and `lab` through.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/__tests__/lab-board.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { groupByStatus, quickMoves, boardParams, describeEvent, isStale, errorText } from "../lab-board.js";

test("every board column exists, even empty; cancelled cards are not on the board", () => {
  const g = groupByStatus([
    { id: "a", status: "received" }, { id: "b", status: "received" }, { id: "c", status: "on_hold" }, { id: "d", status: "cancelled" },
  ]);
  assert.deepEqual(Object.keys(g), ["received", "in_production", "quality_check", "ready_to_ship", "on_hold", "shipped"]);
  assert.deepEqual(g.received.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(g.in_production, []);
  assert.ok(!Object.values(g).flat().some((c) => c.id === "d"));
});

test("cards offer only the moves that need no reason, straight from the shared table", () => {
  assert.deepEqual(quickMoves({ status: "received" }), [{ to: "in_production", label: "→ In production" }]);
  assert.deepEqual(quickMoves({ status: "quality_check" }).map((m) => m.to), ["ready_to_ship", "in_production"]);
  assert.deepEqual(quickMoves({ status: "on_hold", heldFrom: "quality_check" }), [{ to: "quality_check", label: "→ Quality check" }]);
  assert.deepEqual(quickMoves({ status: "shipped" }), []);
});

test("filters become query params, dropping blanks", () => {
  assert.deepEqual(
    boardParams({ departmentId: " ", assigneeUserId: "", q: " RX-1 ", rush: true, dueBefore: "2026-10-10" }),
    { q: "RX-1", dueBefore: "2026-10-10", rush: "true" },
  );
  assert.deepEqual(boardParams({ rush: false }), {});
});

test("timeline rows read as sentences, naming people and rooms", () => {
  const ctx = { staffById: { t1: "Maria Lopez" }, departmentsById: { d1: "Acrylic" } };
  assert.equal(describeEvent({ type: "release", byName: null }, ctx), "System: released to the lab");
  assert.equal(describeEvent({ type: "status", from: "received", to: "in_production", byName: "Ana" }, ctx), "Ana: Received → In production");
  assert.equal(describeEvent({ type: "hold", note: "Waiting on bite", byName: "Ana" }, ctx), "Ana: put on hold — Waiting on bite");
  assert.equal(describeEvent({ type: "assign", to: "t1", byName: "Ana" }, ctx), "Ana: assigned to Maria Lopez");
  assert.equal(describeEvent({ type: "assign", to: null, byName: "Ana" }, ctx), "Ana: unassigned");
  assert.equal(describeEvent({ type: "department", to: "d1", byName: "Ana" }, ctx), "Ana: moved to Acrylic");
  assert.equal(describeEvent({ type: "due", to: "2026-10-21", byName: "Ana" }, ctx), "Ana: due date set to 10/21/2026");
  assert.equal(describeEvent({ type: "due", to: null, byName: "Ana" }, ctx), "Ana: due date cleared");
  assert.equal(describeEvent({ type: "note", note: "Lab notes updated", byName: "Ana" }, ctx), "Ana: Lab notes updated");
});

test("a 409 STALE is recognised so the page can reload instead of retrying", () => {
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "STALE" } } } }), true);
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "CONFLICT" } } } }), false);
  assert.equal(errorText({ response: { data: { error: { message: "Nope." } } } }), "Nope.");
  assert.equal(errorText({}), "Something went wrong.");
});
```

`apps/web/src/config/routes.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { roleHome, ROUTES, labOrderPath } from "./routes.js";

test("lab staff land on the production board", () => {
  assert.equal(roleHome({ role: "lab" }), ROUTES.LAB_BOARD);
  assert.equal(roleHome({ role: "admin" }), ROUTES.DASHBOARD);
  assert.equal(labOrderPath("abc"), "/lab/orders/abc");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/lib/__tests__/lab-board.test.js src/config/routes.test.js`
Expected: FAIL — `../lab-board.js` doesn't exist; `ROUTES.LAB_BOARD` is undefined.

- [ ] **Step 3: Implement the helpers, guard and routes**

`apps/web/src/lib/lab-board.js`:

```js
import { LAB_BOARD_COLUMNS, LAB_STATUS_LABELS, allowedNextStatuses, reasonRequiredFor } from "@my-app/shared";

const label = (s) => LAB_STATUS_LABELS[s] ?? s ?? "—";

/** Cards → one list per board column (every column present; off-board statuses dropped). */
export function groupByStatus(cards = []) {
  const out = Object.fromEntries(LAB_BOARD_COLUMNS.map((s) => [s, []]));
  for (const c of cards) if (out[c.status]) out[c.status].push(c);
  return out;
}

/**
 * The one-click moves a card offers: every allowed move that needs no
 * reason. Hold and cancel need a reason, so they live on the order page.
 */
export function quickMoves(card) {
  return allowedNextStatuses(card.status, { heldFrom: card.heldFrom ?? null })
    .filter((to) => !reasonRequiredFor(to))
    .map((to) => ({ to, label: `→ ${label(to)}` }));
}

/** Board filter state → GET /lab/orders params. */
export function boardParams(filters = {}) {
  const out = {};
  for (const k of ["departmentId", "assigneeUserId", "q", "dueBefore"]) {
    const v = typeof filters[k] === "string" ? filters[k].trim() : "";
    if (v) out[k] = v;
  }
  if (filters.rush) out.rush = "true";
  return out;
}

const usDate = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return `${m}/${d}/${y}`;
};

/** One timeline row as a sentence. */
export function describeEvent(e, { staffById = {}, departmentsById = {} } = {}) {
  const who = e.byName || "System";
  switch (e.type) {
    case "release": return `${who}: released to the lab${e.note ? ` — ${e.note}` : ""}`;
    case "status": return `${who}: ${label(e.from)} → ${label(e.to)}${e.note ? ` — ${e.note}` : ""}`;
    case "hold": return `${who}: put on hold — ${e.note ?? "no reason recorded"}`;
    case "assign": return e.to ? `${who}: assigned to ${staffById[e.to] ?? "a former staff member"}` : `${who}: unassigned`;
    case "department": return e.to ? `${who}: moved to ${departmentsById[e.to] ?? "a removed department"}` : `${who}: removed from its department`;
    case "due": return e.to ? `${who}: due date set to ${usDate(e.to)}` : `${who}: due date cleared`;
    case "note": return `${who}: ${e.note ?? "note"}`;
    default: return `${who}: ${e.type}`;
  }
}

export function errorText(err) {
  return err?.response?.data?.error?.message || err?.message || "Something went wrong.";
}

export function isStale(err) {
  return err?.response?.status === 409 && err?.response?.data?.error?.code === "STALE";
}

/**
 * Open a URL that has to be fetched first (signed file link, PDF blob) in a
 * new tab. The tab is opened synchronously inside the click so popup
 * blockers allow it, then pointed at the URL once it arrives.
 */
export async function openInNewTab(getUrl) {
  const tab = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
```

`apps/web/src/guards/RequireStaff.jsx`:

```jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner } from "../components/ui/Spinner.jsx";
import { ROUTES } from "../config/routes.js";

/** Lab staff and admins: the production board, lab orders and Rx cases. */
export function RequireStaff() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  if (user?.role !== "admin" && user?.role !== "lab") return <Navigate to={ROUTES.DASHBOARD} replace />;
  return <Outlet />;
}
```

`apps/web/src/config/routes.js`:
- Add a `// Lab` block after the Admin block:

```js
  // Lab (admin + lab staff)
  LAB_BOARD: "/lab",
  LAB_ORDER_DETAIL: "/lab/orders/:id",
```

- After the `ROUTES` object, add:

```js
export const labOrderPath = (id) => `/lab/orders/${id}`;
```

- In `roleHome`, before the final `return ROUTES.DASHBOARD;`, add:

```js
  if (user.role === "lab") return ROUTES.LAB_BOARD;
```

`apps/web/src/App.jsx`:
- Import `RequireStaff`, `LabBoardPage` and `LabOrderDetailPage`.
- Inside the `<AppShell />` route group, **move** the two Rx-case routes out of `<Route element={<RequireAdmin />}>` and add a sibling group:

```jsx
        <Route element={<RequireStaff />}>
          <Route path="/lab" element={<LabBoardPage />} />
          <Route path="/lab/orders/:id" element={<LabOrderDetailPage />} />
          <Route path="/admin/rx-cases" element={<AdminRxCasesPage />} />
          <Route path="/admin/rx-cases/:id" element={<AdminRxCaseDetailPage />} />
        </Route>
```

`apps/web/src/components/layout/Sidebar.jsx`:
- Add `LayoutGrid` to the lucide import.
- Remove the `Rx Cases` entry from `adminItems`, and add:

```js
const staffItems = [
  { label: "Production", to: ROUTES.LAB_BOARD,      icon: LayoutGrid },
  { label: "Rx Cases",   to: ROUTES.ADMIN_RX_CASES, icon: ClipboardCheck },
];
```

- In `Sidebar()` add `const isStaff = isAdmin || user?.role === "lab";`, and render this block directly **before** the `{isAdmin && (` block:

```jsx
        {isStaff && (
          <>
            <div className="px-3 pt-6 pb-2 text-[10px] font-mono uppercase tracking-widest text-gray-400">
              Lab
            </div>
            {staffItems.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </>
        )}
```

- [ ] **Step 4: Rx case pages are read-only for lab staff**

`apps/web/src/pages/app/AdminRxCaseDetailPage.jsx`. Lab staff can open cases and (Task 12) release them, but line editing, re-resolve and status changes stay admin-only on the API.

1. Add `import { useAuth } from "../../hooks/useAuth.js";`.
2. In `AdminRxCaseDetailPage`, after `const { addToast } = useToast();`, add:
   ```js
   const { user } = useAuth();
   const canEdit = user?.role === "admin";
   ```
3. Replace `const locked = caseRow.status === "pushed";` with:
   ```js
   const locked = caseRow.status === "pushed" || caseRow.status === "released";
   const readOnly = locked || !canEdit;
   ```
4. Change the **first** `{!locked && (`, which opens the "Resolve this case" card, to `{!locked && canEdit && (`.
5. Change the **second** `{!locked && (`, which opens the Re-resolve / Add line buttons in the lines header, to `{!readOnly && (`.
6. Change `{addingLine && !locked && (` to `{addingLine && !readOnly && (`.
7. Change `locked={locked}` (the `<LineRow …>` prop) to `locked={readOnly}`.

- [ ] **Step 5: Build the board page**

`apps/web/src/pages/lab/LabBoardPage.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Search, AlertTriangle, Zap, RotateCcw, AlertCircle } from "lucide-react";
import { LAB_BOARD_COLUMNS, LAB_STATUS_LABELS } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { labOrderPath } from "../../config/routes.js";
import { groupByStatus, quickMoves, boardParams, errorText, isStale } from "../../lib/lab-board.js";

const INPUT =
  "px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

function dueText(due) {
  if (!due) return "No due date";
  const [, m, d] = due.split("-");
  return `Due ${m}/${d}`;
}

function Card({ card, busy, onMove }) {
  const moves = quickMoves(card);
  return (
    <div className={`rounded-2xl border bg-white p-3 shadow-sm ${card.overdue ? "border-red-300" : "border-surface-300/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={labOrderPath(card.id)} className="font-mono text-sm font-bold text-navy hover:text-brand-600">
          #{card.orderNumber}
        </Link>
        <div className="flex flex-wrap justify-end gap-1">
          {card.rush && (
            <span title={card.rushTier || "Rush"} className="flex items-center gap-0.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
              <Zap size={10} /> Rush
            </span>
          )}
          {card.isRemake && (
            <span className="flex items-center gap-0.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">
              <RotateCcw size={10} /> Remake
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 truncate text-xs text-navy/60">{card.practice}</div>
      <div className="mt-0.5 truncate text-xs text-navy" title={card.deviceSummary}>{card.deviceSummary}</div>
      {card.reference && <div className="mt-0.5 font-mono text-[10px] text-navy/40">{card.reference}</div>}
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={card.overdue ? "flex items-center gap-1 font-semibold text-red-600" : "text-navy/50"}>
          {card.overdue && <AlertTriangle size={11} />}
          {dueText(card.dueDate)}
        </span>
        {card.assigneeInitials && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">
            {card.assigneeInitials}
          </span>
        )}
      </div>
      {moves.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {moves.map((m) => (
            <button
              key={m.to}
              type="button"
              disabled={busy}
              onClick={() => onMove(card, m.to)}
              className="rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-200 disabled:opacity-40"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LabBoardPage() {
  const { addToast } = useToast();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ departmentId: "", assigneeUserId: "", rush: false, dueBefore: "", q: "" });

  const load = useCallback(async () => {
    try {
      const res = await api.get("/lab/orders", { params: boardParams(filters) });
      setCards(res.data.data.orders);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([api.get("/lab/departments"), api.get("/lab/staff")])
      .then(([d, s]) => {
        setDepartments(d.data.data.departments);
        setStaff(s.data.data.staff);
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  const columns = useMemo(() => groupByStatus(cards), [cards]);
  const overdueCount = cards.filter((c) => c.overdue).length;

  const move = async (card, to) => {
    setBusyId(card.id);
    try {
      await api.post(`/lab/orders/${card.id}/status`, { to, expectedVersion: card.version });
      await load();
    } catch (err) {
      addToast({ message: isStale(err) ? "Someone else moved this order — the board has been refreshed." : errorText(err), type: "error" });
      if (isStale(err)) await load();
    } finally {
      setBusyId(null);
    }
  };

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Production</h1>
          <p className="mt-1 text-sm text-navy/50">
            {cards.length} open job{cards.length === 1 ? "" : "s"}
            {overdueCount > 0 && <span className="ml-2 font-semibold text-red-600">· {overdueCount} overdue</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); set({ q: query }); }}
          className="relative"
        >
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            className={`${INPUT} pl-8 w-64`}
            placeholder="Order #, case #, practice…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <select className={INPUT} value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className={INPUT} value={filters.assigneeUserId} onChange={(e) => set({ assigneeUserId: e.target.value })}>
          <option value="">Anyone</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-navy">
          <input type="checkbox" checked={filters.rush} onChange={(e) => set({ rush: e.target.checked })} /> Rush only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-navy">
          Due by
          <input type="date" className={INPUT} value={filters.dueBefore} onChange={(e) => set({ dueBefore: e.target.value })} />
        </label>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading && cards.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-navy/40">
          <Loader2 size={18} className="mr-2 animate-spin" /> Loading the board…
        </div>
      ) : (
        <div className="grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
          {LAB_BOARD_COLUMNS.map((status) => (
            <section key={status} className="flex min-h-[200px] flex-col rounded-3xl bg-surface-50 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-[11px] font-mono uppercase tracking-widest text-navy/50">
                {LAB_STATUS_LABELS[status]}
                <span className="rounded-full bg-white px-2 py-0.5 text-navy">{columns[status].length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {columns[status].map((card) => (
                  <Card key={card.id} card={card} busy={busyId === card.id} onMove={move} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build the order detail page**

`apps/web/src/pages/lab/LabOrderDetailPage.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle, Printer, FileText, RotateCcw, Zap, PauseCircle, Clock } from "lucide-react";
import { LAB_STATUS_LABELS, allowedNextStatuses, reasonRequiredFor, groupRxAnswers, getRxForm } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ROUTES, labOrderPath } from "../../config/routes.js";
import { describeEvent, errorText, isStale, openInNewTab } from "../../lib/lab-board.js";

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

function moveLabel(from, to) {
  if (to === "on_hold") return "Put on hold";
  if (to === "cancelled") return "Cancel order";
  if (from === "on_hold") return `Resume — ${LAB_STATUS_LABELS[to]}`;
  return `→ ${LAB_STATUS_LABELS[to]}`;
}

function Panel({ title, children, action }) {
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm font-bold text-navy">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LabOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/lab/orders/${id}`);
      setDetail(res.data.data);
      setNotes(res.data.data.order.labNotes ?? "");
      setDue(res.data.data.order.dueDate ?? "");
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([api.get("/lab/staff"), api.get("/lab/departments", { params: { includeInactive: "true" } })])
      .then(([s, d]) => { setStaff(s.data.data.staff); setDepartments(d.data.data.departments); })
      .catch((err) => setError(errorText(err)));
  }, []);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s.name])), [staff]);
  const departmentsById = useMemo(() => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const out = await fn();
      if (success) addToast({ message: success, type: "success" });
      await load();
      return out;
    } catch (err) {
      addToast({ message: isStale(err) ? "This order changed — reloaded." : errorText(err), type: "error" });
      if (isStale(err)) await load();
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-navy/40">
        <Loader2 size={18} className="mr-2 animate-spin" /> Loading order…
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="mx-auto max-w-5xl p-6 md:p-8">
        <Link to={ROUTES.LAB_BOARD} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
          <ArrowLeft size={12} /> Board
        </Link>
        <p className="py-20 text-center text-sm text-navy/60">{error || "Order not found."}</p>
      </div>
    );
  }

  const { order, lines, events, rxCase, files, shopOrder } = detail;
  const moves = allowedNextStatuses(order.status, { heldFrom: order.heldFrom });
  const answerGroups = rxCase ? groupRxAnswers(getRxForm(rxCase.formType), rxCase.formData) : [];
  const devices = lines.filter((l) => !l.noteOnly);
  const instructions = lines.filter((l) => l.noteOnly);
  const closed = order.status === "shipped" || order.status === "cancelled";

  const move = (to) => {
    let reason;
    if (reasonRequiredFor(to)) {
      reason = window.prompt(to === "on_hold" ? "Why is this order on hold?" : "Why is this order being cancelled?");
      if (!reason || !reason.trim()) return;
    }
    act(() => api.post(`/lab/orders/${order.id}/status`, { to, reason, expectedVersion: order.version }), `Order #${order.orderNumber}: ${LAB_STATUS_LABELS[to]}`);
  };
  const setField = (field, value) =>
    act(() => api.patch(`/lab/orders/${order.id}`, { field, value, expectedVersion: order.version }));
  const remake = async () => {
    const reason = window.prompt("Why is this order being remade?");
    if (!reason || !reason.trim()) return;
    const res = await act(() => api.post(`/lab/orders/${order.id}/remake`, { reason, expectedVersion: order.version }));
    if (res) navigate(labOrderPath(res.data.data.labOrder.id));
  };
  const printTicket = () =>
    openInNewTab(async () => {
      const res = await api.get(`/lab/orders/${order.id}/ticket.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return url;
    }).catch((err) => addToast({ message: errorText(err), type: "error" }));
  const openFile = (fileId) =>
    openInNewTab(async () => (await api.get(`/admin/rx-cases/${rxCase.id}/files/${fileId}`)).data.data.url)
      .catch((err) => addToast({ message: errorText(err), type: "error" }));

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <Link to={ROUTES.LAB_BOARD} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
        <ArrowLeft size={12} /> Board
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Order #{order.orderNumber}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-navy/60">
            <span className="rounded-full bg-navy px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">{LAB_STATUS_LABELS[order.status]}</span>
            {order.rush && <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold uppercase text-red-700"><Zap size={11} /> Rush{order.rushTier ? ` — ${order.rushTier}` : ""}</span>}
            {order.isRemake && (
              <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-bold uppercase text-violet-700">
                <RotateCcw size={11} /> Remake{order.remakeOfOrderNumber ? ` of #${order.remakeOfOrderNumber}` : ""}
              </span>
            )}
            {order.overdue && <span className="flex items-center gap-1 text-xs font-semibold text-red-600"><Clock size={11} /> Overdue</span>}
            {rxCase && <Link to={`/admin/rx-cases/${rxCase.id}`} className="font-mono text-xs text-brand-600 hover:underline">{rxCase.caseNumber}</Link>}
            {shopOrder && <span className="font-mono text-xs">{shopOrder.orderNumber}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={printTicket} className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            <Printer size={14} /> Work ticket
          </button>
          {order.status === "shipped" && (
            <button type="button" disabled={busy} onClick={remake} className="flex items-center gap-1.5 rounded-full border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy/40 disabled:opacity-40">
              <RotateCcw size={14} /> Remake
            </button>
          )}
        </div>
      </div>

      {order.status === "on_hold" && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <PauseCircle size={16} className="mt-0.5" /> On hold: {order.holdReason || "no reason recorded"}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Lines">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] font-mono uppercase tracking-widest text-navy/40">
                <tr><th className="py-1">Qty</th><th>Code</th><th>Item</th><th>Arch</th></tr>
              </thead>
              <tbody>
                {devices.map((l) => (
                  <tr key={l.id} className="border-t border-surface-300/40">
                    <td className="py-1.5">{l.qty}</td>
                    <td className="font-mono text-xs">{l.code ?? "—"}</td>
                    <td>{l.name}</td>
                    <td className="text-navy/60">{l.arch ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {instructions.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-navy/80">
                {instructions.map((l) => <li key={l.id}>{l.sourceLabel || l.name}</li>)}
              </ul>
            )}
          </Panel>

          {rxCase?.buildNotes && <Panel title="Build notes"><p className="whitespace-pre-wrap text-sm text-navy">{rxCase.buildNotes}</p></Panel>}
          {rxCase?.generalComments && <Panel title="Doctor's comments"><p className="whitespace-pre-wrap text-sm text-navy">{rxCase.generalComments}</p></Panel>}

          {answerGroups.length > 0 && (
            <Panel title="Prescription">
              <div className="space-y-4">
                {answerGroups.map((g) => (
                  <div key={g.id}>
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-navy/50">{g.title}</h3>
                    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      {g.items.map((i) => (
                        <div key={i.key} className="contents">
                          <dt className="text-navy/50">{i.label}</dt>
                          <dd className="text-navy">{i.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {shopOrder?.shipping && (
            <Panel title="Ship to">
              <p className="text-sm text-navy">
                {shopOrder.shipping.name}<br />{shopOrder.shipping.address1}<br />
                {shopOrder.shipping.city}, {shopOrder.shipping.state} {shopOrder.shipping.postalCode}
              </p>
            </Panel>
          )}

          <Panel title="Timeline">
            <ol className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-36 flex-shrink-0 text-xs text-navy/40">{new Date(e.at).toLocaleString()}</span>
                  <span className="text-navy">{describeEvent(e, { staffById, departmentsById })}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Status">
            <div className="flex flex-col gap-2">
              {moves.length === 0 && <p className="text-sm text-navy/50">This order is closed.</p>}
              {moves.map((to) => (
                <button
                  key={to}
                  type="button"
                  disabled={busy}
                  onClick={() => move(to)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                    to === "cancelled" ? "bg-red-50 text-red-700 hover:bg-red-100"
                      : to === "on_hold" ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "bg-brand-500 text-white hover:bg-brand-600"
                  }`}
                >
                  {moveLabel(order.status, to)}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Work">
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs text-navy/50">Assigned to</span>
                <select className={INPUT} disabled={busy || closed} value={order.assigneeUserId ?? ""} onChange={(e) => setField("assign", e.target.value || null)}>
                  <option value="">Nobody</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-navy/50">Department</span>
                <select className={INPUT} disabled={busy || closed} value={order.departmentId ?? ""} onChange={(e) => setField("department", e.target.value || null)}>
                  <option value="">None</option>
                  {departments.filter((d) => d.active || d.id === order.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <div>
                <span className="text-xs text-navy/50">Due date</span>
                <div className="flex gap-2">
                  <input type="date" className={INPUT} disabled={busy || closed} value={due} onChange={(e) => setDue(e.target.value)} />
                  <button type="button" disabled={busy || closed || due === (order.dueDate ?? "")} onClick={() => setField("due", due || null)} className="rounded-lg bg-surface-100 px-3 text-xs font-semibold text-navy disabled:opacity-40">Save</button>
                </div>
              </div>
              <div className="text-xs text-navy/50">
                Practice: <span className="text-navy">{rxCase?.practiceName || order.clientName || shopOrder?.shipping?.name || "—"}</span><br />
                {rxCase?.patientName && <>Patient: <span className="text-navy">{rxCase.patientName}</span></>}
              </div>
            </div>
          </Panel>

          <Panel title="Lab notes (staff only)">
            <textarea className={`${INPUT} min-h-[100px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button type="button" disabled={busy || notes === (order.labNotes ?? "")} onClick={() => setField("notes", notes)} className="mt-2 rounded-full bg-navy px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              Save notes
            </button>
          </Panel>

          {files.length > 0 && (
            <Panel title="Files">
              <ul className="space-y-1.5 text-sm">
                {files.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => openFile(f.id)} className="flex items-center gap-1.5 text-brand-600 hover:underline">
                      <FileText size={13} /> {f.originalName || f.kind}
                      <span className="text-[10px] uppercase text-navy/40">{f.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run tests and build**

Run: `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`
Expected: PASS, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(lab): production board and lab order page for lab staff

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 11: Web — admin departments, admin orders, lab role toggle; doctor My cases

**Files:**
- Create:
  - `apps/web/src/lib/staff.js`, `apps/web/src/lib/__tests__/staff.test.js`;
  - `apps/web/src/pages/app/AdminDepartmentsPage.jsx`, `apps/web/src/pages/doctor/MyCasesPage.jsx`;
  - `apps/api/src/routes/__tests__/rx-doctor-view.test.js`.
- Modify:
  - web: `apps/web/src/pages/app/AdminOrdersPage.jsx` (rewrite), `apps/web/src/pages/app/AdminUsersPage.jsx`, `apps/web/src/App.jsx`, `apps/web/src/config/routes.js`, `apps/web/src/components/layout/Sidebar.jsx`, `apps/web/src/components/layout/DoctorShell.jsx`;
  - API: `apps/api/src/routes/rx.routes.js` (doctor view).
- Delete: `apps/web/src/pages/app/AdminOrderDetailPage.jsx`

**Interfaces:**
- Consumes: `doctorCaseView` (Task 1); `labOrdersForCases` (Task 5); `PUT /admin/users/:id/role`, `/admin/lab/departments` (Task 6); `GET /lab/orders?includeClosed=true`.
- Produces:
  - `roleToggle(user, currentUserId) → { role, label } | null`;
  - `sourceLabel(source) → string`;
  - `ROUTES.ADMIN_DEPARTMENTS = "/admin/lab/departments"`, `ROUTES.DOCTOR_CASES = "/doctor/cases"`;
  - `GET /rx/cases` → `{ data: doctorCaseView[] }`;
  - `GET /rx/cases/:id` → `{ data: { ...doctorCaseView, files: [{ id, kind, originalName, size, createdAt }] } }`, with no `gcsUrl`, `manualNote`, `payloadSnapshot` or `seazona*` fields.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/__tests__/staff.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { roleToggle, sourceLabel } from "../staff.js";

test("only plain users and lab staff get the lab-access toggle, never yourself", () => {
  assert.deepEqual(roleToggle({ id: "u1", role: "user" }, "a1"), { role: "lab", label: "Make lab staff" });
  assert.deepEqual(roleToggle({ id: "u1", role: "lab" }, "a1"), { role: "user", label: "Remove lab access" });
  assert.equal(roleToggle({ id: "d1", role: "doctor" }, "a1"), null);
  assert.equal(roleToggle({ id: "a2", role: "admin" }, "a1"), null);
  assert.equal(roleToggle({ id: "a1", role: "user" }, "a1"), null);
});

test("order sources read as words", () => {
  assert.equal(sourceLabel("rx_case"), "Rx case");
  assert.equal(sourceLabel("shop_order"), "Shop order");
});
```

`apps/api/src/routes/__tests__/rx-doctor-view.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../rx.routes.js", import.meta.url)), "utf8");
function handler(marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, marker);
  const next = source.indexOf("\n  fastify.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("a doctor's case list and case page go through the allow-list view", () => {
  for (const marker of ['fastify.get("/rx/cases",', 'fastify.get("/rx/cases/:id",']) {
    const body = handler(marker);
    assert.match(body, /doctorCaseView\(/, marker);
    assert.match(body, /labOrdersForCases\(/, marker);
    assert.doesNotMatch(body, /\.\.\.decrypted/, `${marker} must not spread the decrypted row`);
  }
});

test("the case page lists files without their storage pointers", () => {
  const body = handler('fastify.get("/rx/cases/:id",');
  assert.doesNotMatch(body, /gcsUrl/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/lib/__tests__/staff.test.js; cd ../api && pnpm vitest run src/routes/__tests__/rx-doctor-view.test.js`
Expected: FAIL — `../staff.js` is missing, and the doctor routes still spread `decrypted`.

- [ ] **Step 3: Doctor API**

`apps/api/src/routes/rx.routes.js`:
- Add `doctorCaseView` to the `@my-app/shared` import.
- Add `labOrdersForCases` to the `../services/lab/lab-orders.service.js` import.

In `GET /rx/cases`, keep the per-row decrypt/redact and the audit call. Replace `return { data: cases };` with:

```js
    const labOrdersByCase = await labOrdersForCases(cases.map((c) => c.id));
    // Doctor-facing allow-list: production status in plain words, never hold
    // reasons, lab notes, Seazona internals or the operator's manual note.
    return { data: cases.map((c) => doctorCaseView(c, labOrdersByCase.get(c.id) ?? [])) };
```

In `GET /rx/cases/:id`, change the file query to select only safe columns:

```js
    const files = await db
      .select({ id: rxCaseFiles.id, kind: rxCaseFiles.kind, originalName: rxCaseFiles.originalName, size: rxCaseFiles.size, createdAt: rxCaseFiles.createdAt })
      .from(rxCaseFiles)
      .where(eq(rxCaseFiles.caseId, caseRow.id));
```

Then replace `return { data: { ...decrypted, files } };` with:

```js
    const labOrdersByCase = await labOrdersForCases([decrypted.id]);
    return { data: { ...doctorCaseView(decrypted, labOrdersByCase.get(decrypted.id) ?? []), files } };
```

- [ ] **Step 4: Web helpers, routes and nav**

`apps/web/src/lib/staff.js`:

```js
/** The lab-access toggle on Admin › Users (mirrors lib/staff-roles.js on the API). */
export function roleToggle(user, currentUserId) {
  if (user.id === currentUserId) return null;
  if (user.role === "user") return { role: "lab", label: "Make lab staff" };
  if (user.role === "lab") return { role: "user", label: "Remove lab access" };
  return null;
}

export const SOURCE_LABELS = { rx_case: "Rx case", shop_order: "Shop order" };
export const sourceLabel = (source) => SOURCE_LABELS[source] ?? source;
```

`apps/web/src/config/routes.js`:
- Add `ADMIN_DEPARTMENTS: "/admin/lab/departments",` after `ADMIN_JOBS`.
- Add `DOCTOR_CASES: "/doctor/cases",` after `DOCTOR_AUTOPAY`.

`apps/web/src/App.jsx`:
- Remove the `AdminOrderDetailPage` import and its `/admin/orders/:id` route.
- Import `AdminDepartmentsPage` and `MyCasesPage`.
- Inside `<RequireAdmin />`, add `<Route path="/admin/lab/departments" element={<AdminDepartmentsPage />} />`.
- Inside the doctor `DoctorShell` group, add `<Route path="cases" element={<MyCasesPage />} />`.

```bash
git rm apps/web/src/pages/app/AdminOrderDetailPage.jsx
```

`apps/web/src/components/layout/Sidebar.jsx`:
- Add `Building2` to the lucide import.
- Add `{ label: "Departments", to: ROUTES.ADMIN_DEPARTMENTS, icon: Building2 },` to `adminItems`, after `Orders`.

`apps/web/src/components/layout/DoctorShell.jsx`:
- Add `ClipboardList` to the lucide import.
- Insert `{ label: "My cases", to: ROUTES.DOCTOR_CASES, icon: ClipboardList },` as the third `navItems` entry, before `Rx Forms`.

- [ ] **Step 5: Admin › Users lab-role toggle**

`apps/web/src/pages/app/AdminUsersPage.jsx`:
1. Add `import { useAuth } from "../../hooks/useAuth.js";` and `import { roleToggle } from "../../lib/staff.js";`.
2. Add `lab: "bg-amber-500/10 text-amber-700",` to `ROLE_COLORS`.
3. Change the role filter list `["all", "admin", "doctor", "user"]` to `["all", "admin", "lab", "doctor", "user"]`.
4. In the component, add `const { user: me } = useAuth();` next to the other hooks, plus this handler beside the existing email-action handlers:

```js
  const changeRole = async (u, role) => {
    try {
      await api.put(`/admin/users/${u.id}/role`, { role });
      await load();
    } catch (err) {
      window.alert(err.response?.data?.error?.message || err.message || "Couldn't change the role.");
    }
  };
```

5. In the actions cell (`<div className="flex justify-end gap-1">`), add as its first child:

```jsx
                          {roleToggle(u, me?.id) && (
                            <button
                              type="button"
                              onClick={() => changeRole(u, roleToggle(u, me?.id).role)}
                              className="flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-800 hover:bg-amber-500/20"
                            >
                              {roleToggle(u, me?.id).label}
                            </button>
                          )}
```

- [ ] **Step 6: Admin › Departments page**

`apps/web/src/pages/app/AdminDepartmentsPage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import api from "../../config/api.js";
import { errorText } from "../../lib/lab-board.js";

const INPUT =
  "px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";

export function AdminDepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/lab/departments", { params: { includeInactive: "true" } });
      setDepartments(res.data.data.departments);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const call = async (fn) => {
    try { await fn(); await load(); } catch (err) { setError(errorText(err)); }
  };

  const add = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    call(async () => {
      await api.post("/admin/lab/departments", { name: trimmed, position: departments.length });
      setName("");
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Lab departments</h1>
        <p className="mt-1 text-sm text-navy/50">The rooms and benches orders move through. Deactivate a department instead of deleting it — past orders keep their history.</p>
      </div>
      {error && <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={14} /> {error}</div>}
      {loading ? <Loader2 className="animate-spin text-navy/40" /> : (
        <table className="w-full overflow-hidden rounded-xl border border-surface-300/50 text-left">
          <thead className="bg-surface-50 text-xs uppercase text-navy/50">
            <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Active</th></tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className="border-t border-surface-300/40 text-sm">
                <td className="px-3 py-2">
                  <input
                    type="number" min={0} max={1000} className={`${INPUT} w-20`} defaultValue={d.position}
                    onBlur={(e) => Number(e.target.value) !== d.position && call(() => api.patch(`/admin/lab/departments/${d.id}`, { position: Number(e.target.value) }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className={`${INPUT} w-full`} defaultValue={d.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.name && call(() => api.patch(`/admin/lab/departments/${d.id}`, { name: e.target.value.trim() }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={d.active} onChange={(e) => call(() => api.patch(`/admin/lab/departments/${d.id}`, { active: e.target.checked }))} />
                </td>
              </tr>
            ))}
            {departments.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-navy/40">No departments yet.</td></tr>}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input className={`${INPUT} flex-1`} placeholder="e.g. Acrylic, Nylon printing, QC, Shipping" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()} className="flex items-center gap-1 rounded-lg bg-navy px-4 py-2 text-sm text-white disabled:opacity-40"><Plus size={14} /> Add</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Admin › Orders lists local lab orders**

Replace the whole of `apps/web/src/pages/app/AdminOrdersPage.jsx`:

```jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { LAB_ORDER_STATUSES, LAB_STATUS_LABELS } from "@my-app/shared";
import api from "../../config/api.js";
import { labOrderPath } from "../../config/routes.js";
import { errorText } from "../../lib/lab-board.js";
import { sourceLabel } from "../../lib/staff.js";

const INPUT =
  "px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Every lab order — Rx cases and shop orders, open and closed. The board is for working them. */
export function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/lab/orders", { params: { includeClosed: "true" } });
      setOrders(res.data.data.orders);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (source && o.source !== source) return false;
      if (!q) return true;
      return [String(o.orderNumber), o.reference, o.practice, o.deviceSummary].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [orders, query, status, source]);

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Orders</h1>
          <p className="mt-1 text-sm text-navy/50">Every lab order, from Rx cases and the shop.</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input className={`${INPUT} w-72 pl-8`} placeholder="Order #, case #, practice, item…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LAB_ORDER_STATUSES.map((s) => <option key={s} value={s}>{LAB_STATUS_LABELS[s]}</option>)}
        </select>
        <select className={INPUT} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Rx cases and shop</option>
          <option value="rx_case">Rx cases</option>
          <option value="shop_order">Shop orders</option>
        </select>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={14} /> {error}</div>}

      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-navy/40"><Loader2 size={18} className="mr-2 animate-spin" /> Loading orders…</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-surface-300/50 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-50 text-[10px] font-mono uppercase tracking-widest text-navy/40">
              <tr>
                <th className="px-4 py-3">Order</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Practice</th>
                <th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Received</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-t border-surface-300/40">
                  <td className="px-4 py-3 font-mono font-bold"><Link className="text-navy hover:text-brand-600" to={labOrderPath(o.id)}>#{o.orderNumber}</Link></td>
                  <td className="px-4 py-3 text-xs">{sourceLabel(o.source)}<div className="font-mono text-navy/40">{o.reference ?? ""}</div></td>
                  <td className="px-4 py-3">{o.practice}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-navy/70" title={o.deviceSummary}>{o.deviceSummary}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-surface-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">{LAB_STATUS_LABELS[o.status]}</span>{o.rush && <span className="ml-1 text-[10px] font-bold text-red-600">RUSH</span>}</td>
                  <td className={`px-4 py-3 ${o.overdue ? "font-semibold text-red-600" : ""}`}>{formatDate(o.dueDate)}</td>
                  <td className="px-4 py-3 text-navy/60">{formatDate(o.receivedAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-navy/40">No orders match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Doctor › My cases**

`apps/web/src/pages/doctor/MyCasesPage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RotateCcw } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";

const TONES = {
  Submitted: "bg-blue-500/10 text-blue-700",
  Received: "bg-violet-500/10 text-violet-700",
  "In production": "bg-amber-500/10 text-amber-800",
  "On hold": "bg-red-500/10 text-red-700",
  Shipped: "bg-emerald-500/10 text-emerald-700",
  "Sent to lab": "bg-emerald-500/10 text-emerald-700",
  Cancelled: "bg-gray-200 text-gray-700",
};

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(String(d).length === 10 ? `${d}T12:00:00` : d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function MyCasesPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get("/rx/cases")
      .then((res) => setCases(res.data.data))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="font-heading text-2xl font-bold text-gray-900">My cases</h1>
        <Link to={ROUTES.RX_CHOOSER} className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">New Rx</Link>
      </div>
      {loading ? <Loader2 className="animate-spin text-gray-400" /> : failed ? (
        <p className="text-sm text-red-600">We couldn't load your cases. Please refresh in a moment.</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-gray-500">No cases yet. Submitted prescriptions appear here with their production status.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Device</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-mono text-xs">{c.caseNumber}</td>
                  <td className="px-4 py-3">{c.patientName ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.deviceSummary ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(c.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONES[c.status] ?? "bg-gray-100 text-gray-700"}`}>{c.status}</span>
                    {c.isRemake && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700"><RotateCcw size={10} /> Remake</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(c.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run tests and build**

Run: `pnpm test && pnpm --filter @my-app/web build`
Expected: PASS; the build succeeds.

```bash
grep -rn --exclude-dir=node_modules "AdminOrderDetailPage\|/admin/orders/" apps/web/src   # expect no output
```

- [ ] **Step 10: Commit**

```bash
git add -A apps/web/src apps/api/src/routes
git commit -m "feat(lab): departments, local orders list, lab role toggle, doctors' My cases

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 12: Retire the Seazona order path (API + web); release UI

This is the removal the spec lists under "Flows":
- `pushCaseToSeazona`, the Seazona payload builders and the send-test route;
- checkout's `pushOrderToSeazona`;
- the live Seazona `/admin/orders`;
- `mark-manual` and `clear-push-lock`.

The web pieces go with them: the Push button, `MarkManualModal`, the clear-lock banner, the send-test button and the "Sent to Seazona" copy. In their place:
- the Rx case page gets a **Release to lab** button;
- legacy `pushed` cases stay readable, labelled "Sent to Seazona (legacy)".

The `seazona*` columns stay, because data is still migrating; piece 5 drops them. `seazona.service.js` keeps `getOrders` / `getOrder` for piece 5's import.

**Files:**
- Create:
  - `apps/api/src/routes/__tests__/seazona-order-retired.test.js`;
  - `apps/api/src/services/rx/case-notes.test.js`.
- Move: `apps/api/src/services/rx/build-order-payload.js` → `apps/api/src/services/rx/case-notes.js`.
- Delete:
  - `apps/api/src/services/rx/push-case.service.js` (+ `.test.js`);
  - `apps/api/src/services/rx/build-order-payload.test.js`;
  - `apps/api/src/services/rx/order-diff.js` (+ `.test.js`);
  - `apps/api/src/config/rx-live-push-comment.test.js`;
  - `apps/api/src/routes/__tests__/rx-auto-push-claim.test.js`, `apps/api/src/routes/__tests__/rx-mapping-send-test-gate.test.js`;
  - `scripts/rx-dryrun.mjs`.
- Modify (API):
  - `routes/admin-rx-cases.routes.js`, `routes/rx.routes.js`, `routes/payment.routes.js`, `routes/admin.routes.js`, `routes/admin-rx-mapping.routes.js`;
  - `services/rx/case-gates.js`, `services/seazona.service.js`, `services/lab/lab-orders.service.js`, `services/rx/phi-crypto.js`, `services/rx/phi-crypto.test.js`, `services/email.service.js`;
  - `services/rx/catalog-map/attributes.table.js`, `services/rx/catalog-map/resolvers/ortho.js`, `services/rx/catalog-map/resolvers/ortho.review-fixes.test.js`;
  - `config/env.js`, `db/schema/orders.js`, `db/schema/rx-cases.js`;
  - `routes/__tests__/admin-rx-cases.test.js`, `routes/__tests__/rx-form-submit.test.js`.
- Modify (other): root `package.json`.
- Modify (web):
  - `pages/app/AdminRxCaseDetailPage.jsx` (+ `.test.jsx`), `pages/app/AdminRxCasesPage.jsx` (+ `.test.jsx`), `pages/app/AdminRxMappingPage.jsx`;
  - `lib/rx-case-labels.js`, `lib/__tests__/rx-case-labels.test.js`.

**Interfaces:**
- Produces:
  - `services/rx/case-notes.js` exports `compileNotes(caseLike)` and `compileNotesMulti(shared, devices)`, unchanged in behaviour.
  - `parseStatusFilter(raw) → string[]` (exported from `admin-rx-cases.routes.js`). `GET /admin/rx-cases?status=released,pushed` now works.
  - `refuseFrozenCase`, with 409 codes `CASE_RELEASED` and `CASE_ALREADY_PUSHED`.
  - Web: `caseStatusLabel(status)`, `resolutionLabel(seazonaPushStatus)`, `CASE_STATUS_LABELS` (all in `lib/rx-case-labels.js`), and `releaseBlockedReason(lines)` (exported from the case page).
- Removed:
  - routes `POST /admin/rx-cases/:id/push`, `POST /admin/rx-cases/:id/mark-manual`, `PUT /admin/rx-cases/:id/clear-push-lock`, `POST /admin/rx-mapping/send-test`, `GET /admin/orders`, `GET /admin/orders/:id`;
  - `manualResolution`, `seazonaService.createOrder`;
  - env `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID`.

- [ ] **Step 1: Write the failing guard test**

`apps/api/src/routes/__tests__/seazona-order-retired.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// own-the-lab piece 2 retired Seazona as the system of record for orders:
// nothing may send an order to Seazona, and the UI may not offer to. This
// scans source (code AND comments — a stale comment telling a reader to "use
// clear-push-lock" is its own bug) so a revert or a copy-paste from main
// can't quietly bring the path back. Seazona reads (getOrders/getOrder) stay
// in seazona.service.js for piece 5's import.

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = join(here, "../../../../../");
const ROOTS = ["apps/api/src", "apps/api/scripts", "apps/web/src", "scripts"].map((p) => join(repo, p));
const SELF = fileURLToPath(import.meta.url);

const FORBIDDEN = [
  /createOrder\(/, /pushCaseToSeazona/, /payloadFromLines/, /buildSeazonaOrderPayload/, /pushOrderToSeazona/,
  /resolveOrderPushStatus/, /shouldReleasePushLock/, /shouldAutoPush/, /\/mark-manual/, /\/clear-push-lock/,
  /\/rx-mapping\/send-test/, /RX_LIVE_PUSH/, /SEAZONA_ORDER_USER_ID/, /seazonaService\.getOrders?\(/,
  /Push to Seazona/, /MarkManualModal/, /build-order-payload/, /order-diff/, /manualResolution/,
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|jsx|mjs)$/.test(name) && p !== SELF) yield p;
  }
}

test("no code path sends an order to Seazona or offers to", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${relative(repo, file)}: ${re}`);
    }
  }
  assert.deepEqual(hits, []);
});
```

- [ ] **Step 2: Run it to see every call site**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/seazona-order-retired.test.js`
Expected: FAIL. The hit list names these files, and each one is handled in Step 3 or Step 4:

```
apps/api/src/config/env.js
apps/api/src/config/rx-live-push-comment.test.js
apps/api/src/db/schema/orders.js
apps/api/src/db/schema/rx-cases.js
apps/api/src/routes/__tests__/admin-rx-cases.test.js
apps/api/src/routes/__tests__/rx-auto-push-claim.test.js
apps/api/src/routes/__tests__/rx-form-submit.test.js
apps/api/src/routes/__tests__/rx-mapping-send-test-gate.test.js
apps/api/src/routes/admin-rx-cases.routes.js
apps/api/src/routes/admin-rx-mapping.routes.js
apps/api/src/routes/admin.routes.js
apps/api/src/routes/payment.routes.js
apps/api/src/routes/rx.routes.js
apps/api/src/services/email.service.js
apps/api/src/services/lab/lab-orders.service.js
apps/api/src/services/rx/build-order-payload.js
apps/api/src/services/rx/build-order-payload.test.js
apps/api/src/services/rx/case-gates.js
apps/api/src/services/rx/catalog-map/attributes.table.js
apps/api/src/services/rx/catalog-map/resolvers/ortho.js
apps/api/src/services/rx/catalog-map/resolvers/ortho.review-fixes.test.js
apps/api/src/services/rx/order-diff.test.js
apps/api/src/services/rx/phi-crypto.js
apps/api/src/services/rx/phi-crypto.test.js
apps/api/src/services/rx/push-case.service.js
apps/api/src/services/rx/push-case.service.test.js
apps/api/src/services/seazona.service.js
apps/web/src/pages/app/AdminRxCaseDetailPage.jsx
apps/web/src/pages/app/AdminRxMappingPage.jsx
scripts/rx-dryrun.mjs
```

If the list contains a file not named here, handle it the same way and record it in the task report.

- [ ] **Step 3: API — delete, move, rewire**

Delete and move:

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2
git rm apps/api/src/services/rx/push-case.service.js apps/api/src/services/rx/push-case.service.test.js \
  apps/api/src/services/rx/order-diff.js apps/api/src/services/rx/order-diff.test.js \
  apps/api/src/services/rx/build-order-payload.test.js \
  apps/api/src/config/rx-live-push-comment.test.js \
  apps/api/src/routes/__tests__/rx-auto-push-claim.test.js apps/api/src/routes/__tests__/rx-mapping-send-test-gate.test.js \
  scripts/rx-dryrun.mjs
git mv apps/api/src/services/rx/build-order-payload.js apps/api/src/services/rx/case-notes.js
```

Root `package.json`: delete the `"rx:dryrun": …` script line.

**`services/rx/case-notes.js`.** Delete `noDeviceLineWarning`, `buildSeazonaOrderPayload`, `normalizeArch` and `buildSeazonaOrderPayloadMulti`. Change the first import to drop `resolveLineItems` and `isDeviceLine`; the file keeps only `guardMatrixNotes` and `orthoBuildNotes`. Keep `deviceOptionLines`, `sharedNoteLines`, `compileNotes` and `compileNotesMulti` unchanged. Replace the module header with:

```js
// Design intent with no product code — occlusal contact, design preference,
// guard clearance, VDO/titration, ortho build answers, rush — rendered as
// text. Line items are never derived from these. Printed as "Build notes"
// on the lab order page and the work ticket; the Rx mapping preview shows
// the same text. (Formerly the Seazona order-notes builder.)
```

Also remove the two doc sentences that mention "Seazona notes are limited to 2000 characters". Keep the `.slice(0, 2000)` cap; a work ticket doesn't need more.

`apps/api/src/services/rx/case-notes.test.js` (the two notes tests from the deleted file, now calling `compileNotes` directly):

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { compileNotes, compileNotesMulti } from "./case-notes.js";

const baseCase = {
  deviceKey: "ddso",
  deviceOptions: { baseMaterial: "Nylon", occlusalContact: "Posterior", designPreference: "Buccal-Free" },
  generalComments: "cover 1st molar to 1st molar",
  rush: false,
};

test("structured options + comments compile into notes", () => {
  const notes = compileNotes(baseCase);
  assert.match(notes, /Occlusal Contact: Posterior/);
  assert.match(notes, /Design Preference: Buccal-Free/);
  assert.match(notes, /cover 1st molar to 1st molar/);
});

test("material and modifications are NOT in notes (they are line items)", () => {
  const notes = compileNotes({ ...baseCase, deviceOptions: { baseMaterial: "Nylon", modifications: ["Labial bow"], occlusalContact: "Posterior" } });
  assert.doesNotMatch(notes, /Material:/);
  assert.doesNotMatch(notes, /Modifications:/);
  assert.doesNotMatch(notes, /Labial bow/);
  assert.match(notes, /Occlusal Contact: Posterior/);
});

test("multi-device notes name each device and the rush once", () => {
  const notes = compileNotesMulti({ rush: true, rushTier: "nylon" }, [
    { label: "DDSO", deviceOptions: { occlusalContact: "TRIPOD Occlusion" } },
    { label: "Nightguard", deviceOptions: {} },
  ]);
  assert.equal(notes, "[DDSO] Occlusal Contact: TRIPOD Occlusion | [Nightguard] | RUSH (nylon)");
});
```

Update the importers of the moved file:
- `services/lab/lab-orders.service.js`: change the specifier to `../rx/case-notes.js`.
- `routes/admin-rx-mapping.routes.js`: change the import to `import { compileNotesMulti } from "../services/rx/case-notes.js";`.
- `services/rx/catalog-map/resolvers/ortho.review-fixes.test.js`: change to `import { compileNotes } from "../../case-notes.js";`. In the test "the order builder does not count ortho bands / add-ons as a device line", delete the `const { ok, warnings } = buildSeazonaOrderPayload(…)` statement and its two asserts, and keep the `isDeviceLine` loops.
- `services/rx/phi-crypto.test.js`: change the import to `const { compileNotes } = await import("./case-notes.js");`. Replace the `it("build-order-payload receives PLAINTEXT …")` case with:
  ```js
  it("case notes receive PLAINTEXT after decrypting an encrypted row", () => {
    const decrypted = decryptRxPhi(encryptRxPhi(plaintextRow));
    const notes = compileNotes(decrypted);
    assert.match(notes, /Occlusal Contact: Posterior/); // plaintext deviceOptions
    assert.match(notes, /cover 1st molar to 1st molar/); // plaintext generalComments
  });
  ```
  Then remove the now-unused `DEVICE_ROWS` import.
- Comment-only references:
  - `services/rx/phi-crypto.js` line 12: replace `(build-order-payload, order-diff)` with `(case-notes, the lab order detail, the work ticket)`.
  - `services/rx/catalog-map/attributes.table.js` line 11 and `resolvers/ortho.js` line 538: replace `build-order-payload.js` with `case-notes.js`.
  - `db/schema/rx-cases.js` line 45: replace `on POST .../mark-manual` with `via the retired mark-manual action (legacy data)`.

**`services/rx/case-gates.js`.**
- Delete `manualResolution` and its docstring.
- In the `CASE_STATUSES` docstring, drop any sentence that still says a manual resolution "lands on `pushed`".
- In the `canRelease` docstring, replace the sentence about "never send Seazona a partial order" with "never release a partial job to the bench".

**`services/seazona.service.js`.** Delete `createOrder` and its docstring. `getOrders` / `getOrder` stay, with this line added above them: `// Read-only; kept for own-the-lab piece 5's historical order import.`

**`routes/admin-rx-cases.routes.js`.**
- Remove these imports: `pushCaseToSeazona, shouldReleasePushLock`, `* as seazonaService`, `encryptJson, encryptField`, `env`. Remove `manualResolution` from the case-gates import and from the re-export list. Reduce the drizzle import to `import { and, asc, desc, eq, inArray } from "drizzle-orm";`.
- Replace `pushedCaseRefusal`, `pushInFlightRefusal` and `refusePushedCase` with:

```js
/** The 409 every write to a frozen case's lines sends. */
function frozenCaseRefusal(status) {
  return status === "released"
    ? { error: { code: "CASE_RELEASED", status: 409, message: "This case is on the production board. Change the lab order instead." } }
    : { error: { code: "CASE_ALREADY_PUSHED", status: 409, message: "This case was sent to Seazona before the lab moved to the portal. Correct it in Seazona." } };
}

/**
 * Write guard for the routes that change a case's lines (add, edit, delete,
 * re-resolve): a released or legacy-pushed case is frozen (isFrozen). Sends
 * the refusal and returns true when the caller must stop; returns false —
 * sending nothing — for an editable case AND for a missing one (each route
 * reports its own 404). No push can be in flight any more (piece 2 retired
 * the Seazona push), so there is no in-flight check.
 */
async function refuseFrozenCase(caseId, reply) {
  const [caseRow] = await db.select({ status: rxCases.status }).from(rxCases).where(eq(rxCases.id, caseId));
  if (!caseRow) return false;
  if (isFrozen(caseRow.status)) {
    reply.code(409).send(frozenCaseRefusal(caseRow.status));
    return true;
  }
  return false;
}

/** ?status=a,b or ?status=a&status=b → statuses; none → the open queue. */
export function parseStatusFilter(raw) {
  if (raw == null || raw === "") return DEFAULT_QUEUE_STATUSES;
  return [...new Set([].concat(raw).flatMap((s) => String(s).split(",")).map((s) => s.trim()).filter(Boolean))];
}
```

- In the three line routes, replace `refusePushedCase(` with `refuseFrozenCase(`.
- In `re-resolve`, replace the two inline checks (isFrozen + `"pushing"`) with:
  ```js
  if (isFrozen(caseRowRaw.status)) return reply.code(409).send(frozenCaseRefusal(caseRowRaw.status));
  ```
- In `GET /admin/rx-cases`, replace the `const statuses = q.status ? … : DEFAULT_QUEUE_STATUSES;` expression with `const statuses = parseStatusFilter(q.status);`.
- In the list's response mapping, keep `seazonaPushStatus`; the queue still tags legacy rows.
- Delete the whole `POST /admin/rx-cases/:id/push`, `POST /admin/rx-cases/:id/mark-manual` and `PUT /admin/rx-cases/:id/clear-push-lock` registrations, including their comment banners.

**`routes/__tests__/admin-rx-cases.test.js`.**
- Remove `manualResolution` from the import.
- Delete every test that references `PUSH_ROUTE_MARKER`, `MARK_MANUAL_ROUTE_MARKER`, `clear-push-lock`, `pushInFlightRefusal`, `CASE_PUSH_IN_FLIGHT`, `refusePushedCase checks seazonaPushStatus`, `manualResolution` or `shouldReleasePushLock`, plus the `PUSH_ROUTE_MARKER` / `MARK_MANUAL_ROUTE_MARKER` constants and their comment banners.
- In the remaining wiring tests, change `/refusePushedCase\(|isFrozen\(/` to `/refuseFrozenCase\(|isFrozen\(/`.
- Delete the four "…is wired to the in-flight guard" tests; their guard no longer exists.
- Then append:

```js
import { parseStatusFilter } from "../admin-rx-cases.routes.js";

test("the queue reads comma-separated status filters (Resolved = released + legacy pushed)", () => {
  assert.deepEqual(parseStatusFilter("released,pushed"), ["released", "pushed"]);
  assert.deepEqual(parseStatusFilter(["new", "failed,new"]), ["new", "failed"]);
  assert.deepEqual(parseStatusFilter(undefined), DEFAULT_QUEUE_STATUSES);
});

test("a released case's lines refuse edits with their own code", () => {
  const start = routesSource.indexOf("function frozenCaseRefusal(status) {");
  assert.ok(start >= 0);
  const body = routesSource.slice(start, routesSource.indexOf("\n}\n", start));
  assert.match(body, /CASE_RELEASED/);
  assert.match(body, /CASE_ALREADY_PUSHED/);
});

test("the Seazona push, mark-manual and clear-lock routes are gone", () => {
  for (const r of ["/admin/rx-cases/:id/push\"", "/admin/rx-cases/:id/mark-manual", "/admin/rx-cases/:id/clear-push-lock"]) {
    assert.ok(!routesSource.includes(r), r);
  }
});
```

Then confirm: `grep -n "refusePushedCase\|pushInFlight\|manualResolution" apps/api/src/routes/__tests__/admin-rx-cases.test.js` prints nothing.

**`routes/rx.routes.js`.**
- Delete `shouldAutoPush` and its docstring.
- Delete the whole `// ── Auto-push under RX_LIVE_PUSH` block, from its comment through the closing brace of `if (finalStatus === SUBMISSION_STATUS && shouldAutoPush(...)) { … }`.
- Remove these imports: `* as seazonaService`, `pushCaseToSeazona, shouldReleasePushLock`, `encryptJson`. Reduce the drizzle import to `import { eq, desc, and, asc } from "drizzle-orm";`.
- In the `sendRxSubmissionReceived` comment, replace "Fires for EVERY successful submission, not just under RX_LIVE_PUSH — a case that auto-pushed above just left the admin queue entirely" with "Fires for EVERY successful submission — a case auto-released above skipped the review queue entirely".
- In the `/rx/form-submissions` header comment, the line "INTAKE-ONLY: this endpoint NEVER calls Seazona" stays true.

**`routes/__tests__/rx-form-submit.test.js`.** Remove `import { shouldAutoPush } from "../rx.routes.js";` and the test "auto-push is off unless RX_LIVE_PUSH is exactly 'true'". The Task 7 `shouldAutoRelease` test stays.

**`routes/payment.routes.js`.**
- Delete `resolveOrderPushStatus` and `pushOrderToSeazona`, with their docstrings.
- In `recordGuestOrder`, delete the `const seazonaClientId = null; …` comment block, the `const pushStatus = …` line, the two insert properties `seazonaClientId,` and `seazonaPushStatus: pushStatus,`, and the whole `if (pushStatus === "pending") { … } else { … }` block. Replace them with:
  ```js
  log.info({ orderNumber }, "catalog order recorded with its lab order");
  ```
- Its docstring becomes: "Record a successful guest catalog charge LOCALLY (authoritative), with its lab order, in one transaction. SOFT-FAIL only — this never throws into checkout, because the card is already charged and failing the response would invite a double-charge on retry. Returns `{ orderRecordFailed }` so the handler can detect the idempotency-degraded case."
- In the checkout handler, change the comment "Record the order LOCALLY (authoritative) + attempt the gated Seazona push. Never throws" to "Record the order and its lab order LOCALLY (authoritative). Never throws".
- `seazonaService` stays imported (refunds still write Seazona payments).

**`db/schema/orders.js`.**
- In the header comment, replace the paragraph starting "Seazona push columns capture the outcome…" and its status list with:
  ```
  The seazona* columns are legacy: the Seazona createOrder push that wrote
  them was retired in own-the-lab piece 2 and they are no longer written
  (piece 5 drops them). The job for the bench is the lab order
  (lab_orders.source = "shop_order", sourceId = orders.id).
  ```
- Replace the comment above `seazonaPushStatus` (the one naming `resolveOrderPushStatus()`) with `// Legacy — see header.`
- No column changes.

**`routes/admin.routes.js`.** Delete the `// ORDERS` banner and both `GET /admin/orders` and `GET /admin/orders/:id` registrations. Delete `import * as seazonaService from "../services/seazona.service.js";`; nothing else in the file uses it.

**`routes/admin-rx-mapping.routes.js`.**
- Delete `TEST_ORDER_CLIENT_ID`, `TEST_ORDER_USER_ID` and their comment.
- Delete `buildIncompleteTestOrderResponse` and its docstring.
- Delete the whole `POST /admin/rx-mapping/send-test` registration and its banner.
- `getCatalog` (Seazona product *reads* for the mapping search) stays.

**`config/env.js`.**
- Delete the `SEAZONA_ORDER_USER_ID` field and its four-line comment.
- Delete the whole RX_LIVE_PUSH block (from `// Digital Rx live Seazona push gate.` through `RX_LIVE_PUSH: z.string().optional(),`).
- In the AutoPay comment, replace "Same gated-dark pattern as RX_LIVE_PUSH." with "Gated dark, like RX_AUTO_RELEASE."

**`services/email.service.js`** (~line 374, the `sendRxSubmissionReceived` docstring). Replace the sentence about RX_LIVE_PUSH and auto-push with: "Sent for every submission — a case that auto-released (RX_AUTO_RELEASE) never appears in the review queue, so this may be the only signal staff get that it exists."

- [ ] **Step 4: Web — release replaces push; legacy labels**

`apps/web/src/lib/rx-case-labels.js` — replace the file:

```js
/**
 * Rx case labels, shared by the case queue and the case page so a status
 * reads the same everywhere. `released` = on the production board (own-the-
 * lab piece 2). `pushed` and the `seazonaPushStatus` tags are legacy: cases
 * sent to Seazona before the lab moved to the portal.
 */
export const CASE_STATUS_LABELS = {
  new: "New",
  in_review: "In review",
  awaiting_doctor: "Awaiting doctor",
  released: "Released to lab",
  pushed: "Sent to Seazona (legacy)",
  failed: "Push failed (legacy)",
  cancelled: "Cancelled",
};

export function caseStatusLabel(s) {
  return CASE_STATUS_LABELS[s] || s;
}

/** How a legacy case reached Seazona: pushed by us, or typed in by hand. */
export function resolutionLabel(seazonaPushStatus) {
  if (seazonaPushStatus === "pushed") return "Sent to Seazona (legacy)";
  if (seazonaPushStatus === "manual") return "Added to Seazona by hand (legacy)";
  return null;
}
```

`apps/web/src/lib/__tests__/rx-case-labels.test.js` — replace the file:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { caseStatusLabel, resolutionLabel } from "../rx-case-labels.js";

test("every case status has a human label, and legacy ones say so", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled"]) {
    assert.notEqual(caseStatusLabel(s), s, s);
  }
  assert.equal(caseStatusLabel("released"), "Released to lab");
  assert.equal(caseStatusLabel("pushed"), "Sent to Seazona (legacy)");
});

test("legacy resolution tags stay readable", () => {
  assert.equal(resolutionLabel("pushed"), "Sent to Seazona (legacy)");
  assert.equal(resolutionLabel("manual"), "Added to Seazona by hand (legacy)");
  assert.equal(resolutionLabel(null), null);
  assert.equal(resolutionLabel("pushing"), null);
});
```

**`apps/web/src/pages/app/AdminRxCasesPage.jsx`:**
1. Delete the local `statusLabel` function and its docstring. Import `{ caseStatusLabel, resolutionLabel }` from `../../lib/rx-case-labels.js`, and replace every `statusLabel(` call with `caseStatusLabel(`.
2. Add `released: "bg-emerald-500/10 text-emerald-700",` to `STATUS_COLORS`.
3. Replace `const RESOLVED_STATUS = "pushed";` and its comment with:
   ```js
   // Resolved work: released to the lab, or sent to Seazona before the cutover (legacy).
   const RESOLVED_FILTER = "resolved";
   const RESOLVED_STATUSES = ["released", "pushed"];
   ```
4. In `loadResolved`, change the params to `{ limit: 200, status: RESOLVED_STATUSES.join(",") }`.
5. In `filtered`, replace `} else if (c.status !== statusFilter) {` with:
   ```js
   } else if (statusFilter === RESOLVED_FILTER ? !RESOLVED_STATUSES.includes(c.status) : c.status !== statusFilter) {
   ```
6. In the Resolved pill:
   - `setStatusFilter(RESOLVED_STATUS)` becomes `setStatusFilter(RESOLVED_FILTER)`;
   - `statusFilter === RESOLVED_STATUS` becomes `statusFilter === RESOLVED_FILTER`;
   - `statusColor(RESOLVED_STATUS)` becomes `statusColor("released")`;
   - the count becomes `RESOLVED_STATUSES.reduce((n, s) => n + (statusCounts[s] || 0), 0)`.

`apps/web/src/pages/app/AdminRxCasesPage.test.jsx`: import `caseStatusLabel` from `../../lib/rx-case-labels.js` instead of `statusLabel` from the page. The first test becomes `for (const s of [...7 statuses]) assert.ok(caseStatusLabel(s))`.

**`apps/web/src/pages/app/AdminRxCaseDetailPage.jsx`:**
1. Imports:
   - remove `Unlock`, `ClipboardEdit` from lucide;
   - add `import { LAB_STATUS_LABELS } from "@my-app/shared";`;
   - add `import { labOrderPath } from "../../config/routes.js";` (merge with the existing `ROUTES` import);
   - change the labels import to `import { caseStatusLabel, resolutionLabel } from "../../lib/rx-case-labels.js";`.
2. Rename `pushBlockedReason` to `releaseBlockedReason`. Change its first message to `"This case has no lines to release."` and its comments to say "Mirrors the server's canRelease gate (case-gates.js)". The rule body is unchanged.
3. Delete the local `statusLabel` function and replace every `statusLabel(` call with `caseStatusLabel(`. Add `released: "bg-emerald-500/10 text-emerald-700",` to `STATUS_COLORS`.
4. Delete the whole `function MarkManualModal(...) { … }` and its render block (`{markManualOpen && ( <MarkManualModal … /> )}`) at the bottom of the page.
5. State:
   - delete `markManualOpen`, `pushing`, `pushError` and `clearingLock`;
   - add `const [releasing, setReleasing] = useState(false);`, `const [releaseError, setReleaseError] = useState(null);` and `const [labOrder, setLabOrder] = useState(null);`;
   - in `load`, also destructure `labOrder: lo` from `res.data.data` and call `setLabOrder(lo || null)`.
6. Replace `const isPushing = …` and `const blockedReason = pushBlockedReason(lines);` with:
   ```js
   const legacyPushUnconfirmed = caseRow.seazonaPushStatus === "pushing";
   const blockedReason = releaseBlockedReason(lines);
   ```
7. Delete `doPush` and `doClearLock` and add:

```js
  const doRelease = async () => {
    let confirmNotInSeazona = false;
    if (legacyPushUnconfirmed) {
      confirmNotInSeazona = window.confirm(
        "A Seazona push for this case started and was never confirmed. Only continue if you checked Seazona and there is NO order for this case — otherwise the lab will build it twice. Continue?"
      );
      if (!confirmNotInSeazona) return;
    }
    setReleasing(true);
    setReleaseError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${id}/release`, { confirmNotInSeazona });
      const { labOrder: lo, unknownCodes } = res.data.data;
      addToast({
        message: `Released as order #${lo.orderNumber}.${unknownCodes.length ? ` Not in the catalog yet: ${unknownCodes.join(", ")}.` : ""}`,
        type: "success",
      });
      await load();
    } catch (err) {
      setReleaseError(errMsg(err));
    } finally {
      setReleasing(false);
    }
  };
```

8. In the Order tab, delete the `{isPushing && ( <Banner tone="warning" …> … </Banner> )}` block. Replace the whole "Resolve this case" card (`{!locked && canEdit && ( … )}` from Task 10) with:

```jsx
          {!locked && (
            <div className="bg-white rounded-2xl border border-surface-300/50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading font-bold text-sm text-navy mb-1">Release to the lab</h2>
                  <p className="text-xs text-navy/50 max-w-md">
                    Puts this case on the production board as a lab order, with its lines exactly as they are now.
                    {legacyPushUnconfirmed && " A Seazona push for this case was started and never confirmed — check Seazona for an order before releasing."}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <button
                    type="button"
                    disabled={releasing || !!blockedReason}
                    onClick={doRelease}
                    title={blockedReason || undefined}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-bold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={14} /> {releasing ? "Releasing…" : "Release to lab"}
                  </button>
                  {blockedReason && <span className="text-[11px] text-red-600 max-w-xs text-right">{blockedReason}</span>}
                </div>
              </div>
              {releaseError && (
                <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>{releaseError}</span>
                </div>
              )}
            </div>
          )}
```

9. Replace the `{locked && ( <Banner tone="success" …> … </Banner> )}` block with:

```jsx
          {locked && (
            <Banner tone="success" icon={CheckCircle2}>
              {caseRow.status === "released" ? (
                <>
                  On the production board
                  {labOrder && (
                    <>
                      {" "}as{" "}
                      <Link to={labOrderPath(labOrder.id)} className="font-mono font-semibold underline">order #{labOrder.orderNumber}</Link>
                      {" "}({LAB_STATUS_LABELS[labOrder.status]})
                    </>
                  )}
                  . Its lines are locked — change the lab order instead.
                </>
              ) : (
                <>
                  {resolution || "Sent to Seazona (legacy)"} — sent before the lab moved to the portal. Its lines are locked; correct it in Seazona.
                  {caseRow.seazonaOrderId && <span className="block mt-1 font-mono text-xs">Seazona order #{caseRow.seazonaOrderId}</span>}
                </>
              )}
            </Banner>
          )}
```

10. Change the failed-push banner text to `Legacy Seazona push failed: {caseRow.seazonaPushError}. Releasing to the lab replaces that push.`
11. In the History tab, rename the label "Push error" to "Legacy push error" and "Seazona order #" to "Seazona order # (legacy)".

`apps/web/src/pages/app/AdminRxCaseDetailPage.test.jsx`:
- Import `releaseBlockedReason` from the page and `caseStatusLabel` from `../../lib/rx-case-labels.js`.
- Rename `pushBlockedReason` → `releaseBlockedReason` throughout, and change `/no lines to send/` to `/no lines to release/`.
- Change the test title "the push button explains why…" to "the release button explains why it is disabled, rather than just being grey".
- In the last test, use `caseStatusLabel` and include `"released"` in the list.

**`apps/web/src/pages/app/AdminRxMappingPage.jsx`** (`PreviewModal`):
- Delete the `sending`, `sendResult` and `sendError` state.
- Delete `handleSendTest`.
- In `runPreview`, delete `setSendResult(null); setSendError(null);` and the two comments about the send button.
- Delete the JSX blocks rendering `sendResult` and `sendError` (the "Test order created in Seazona…" banners, ~lines 300–340).
- Delete the footer's send `<button>…Send test order to Seazona (Matt Rago)…</button>`, and change the footer container's `justify-between` to `justify-end`.
- Change the `buildBody` docstring to "Build the preview request body."

- [ ] **Step 5: Run the guard and the full suite**

```bash
pnpm test
pnpm --filter @my-app/web build
grep -rn --exclude-dir=node_modules -E "createOrder\(|pushCaseToSeazona|mark-manual\"|clear-push-lock|send-test|RX_LIVE_PUSH|SEAZONA_ORDER_USER_ID" apps scripts
```
Expected: every test passes, including `seazona-order-retired.test.js`. The build succeeds. The grep prints only this task's guard test.

- [ ] **Step 6: Commit**

```bash
git add -A apps scripts package.json
git commit -m "feat(lab)!: retire the Seazona order push — release to our own board instead

Removes pushCaseToSeazona, the Seazona payload builders, the mapping
send-test, checkout's pushOrderToSeazona, the live Seazona /admin/orders,
mark-manual and clear-push-lock (API and UI). Legacy pushed cases stay
readable. RX_LIVE_PUSH and SEAZONA_ORDER_USER_ID are gone; RX_AUTO_RELEASE
replaces the auto-push.

Co-Authored-By: Claude <implementer model> <noreply@anthropic.com>"
```

---

### Task 13: Whole-piece verification and PR

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-2
pnpm test
(cd apps/api && pnpm db:generate)        # expect "No schema changes"
pnpm --filter @my-app/web build
grep -c "'lab'" apps/api/src/db/migrations/*.sql | grep -v ":0"   # exactly one file, count 1 (0027)
git status --short                        # clean
```

Then run the Rx replay harness if a cases file exists (see Sequencing). If it runs, the releasable count must equal the pre-piece pushable count.

- [ ] **Step 2: Review the PHI boundaries once more, by reading**

- `grep -n "request.log" apps/api/src/routes/lab.routes.js`: no log line includes `detail`, a patient name or form data.
- `grep -n "metadata" apps/api/src/routes/lab.routes.js apps/api/src/routes/admin-rx-cases.routes.js`: audit metadata holds ids, statuses, order numbers and codes only.
- `GET /lab/orders` responses come from `presentBoardCard`, which has no `holdReason` or `labNotes`. `GET /rx/cases*` comes from `doctorCaseView`.

- [ ] **Step 3: File count (CodeRabbit silently skips PRs over 150 files)**

The PR stacks on piece 1, so count against piece 1's branch:

```bash
git fetch origin
git diff --name-only origin/feat/own-the-lab-1-catalog...HEAD | wc -l
```
Expected: about 90 files, well under 150. If the count is near or over 150, stop and report. Don't open the PR. Propose splitting at Task 12 (the removal), which is the natural seam.

- [ ] **Step 4: Check CodeRabbit capacity, then push and open the PR**

Look at the repo's PRs from the last hour for a "Review paused — included plan limit reached" notice, and count CodeRabbit reviews in that hour (2 included per hour). If no slot is free, stop and report; don't push into a paused window. Never tick "Run this review for free".

```bash
git push origin feat/own-the-lab-2-orders
gh pr create --base feat/own-the-lab-1-catalog --head feat/own-the-lab-2-orders \
  --title "Own the lab · piece 2: lab orders & production board" \
  --body "$(cat <<'EOF'
Piece 2 of retiring Seazona (spec: docs/superpowers/specs/2026-10-07-lab-orders-and-production-design.md; plan: docs/superpowers/plans/2026-10-07-lab-orders-and-production.md).

- Lab orders: every released Rx case and every paid shop order becomes one lab order (lab_orders / lines / events / departments), numbered from LAB_ORDER_NUMBER_START.
- Production board (/lab), order detail with assign / department / due / hold / cancel / remake, timeline, and a printable work ticket (pdfkit, Code 128 barcode).
- New `lab` role for technicians (granted on Admin › Users); lab can read and release Rx cases, not edit pricing/payments/users/catalog.
- Rx release replaces the Seazona push (same canRelease gate); RX_AUTO_RELEASE replaces RX_LIVE_PUSH.
- Doctors get "My cases" with plain-word production status; hold reasons and lab notes stay staff-only.
- Removed: pushCaseToSeazona, Seazona payload builders, mapping send-test, checkout's pushOrderToSeazona, live Seazona /admin/orders, mark-manual, clear-push-lock. Legacy pushed cases stay readable.

Stacked on piece 1 (#46): base is feat/own-the-lab-1-catalog; retarget to feat/own-the-lab once #46 merges. No Seazona calls; no prod deploy from this branch.

Cutover notes: set LAB_ORDER_NUMBER_START to Seazona's last order number + 1; drop RX_LIVE_PUSH and SEAZONA_ORDER_USER_ID from the Cloud Run env. Staging scrub (if S3 lands): add lab_orders.hold_reason, lab_orders.lab_notes, lab_order_events.note.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Confirm the review actually ran**

After CodeRabbit posts, check for real inline findings, not just the walkthrough. Address its notes locally and push **once** per review round. When #46 merges, run `gh pr edit <n> --base feat/own-the-lab`.

---

## Self-review (done while writing; kept for the reviewer)

**Spec coverage:**

| Spec item | Where |
|---|---|
| `lab_orders` / lines / events / departments | Task 2 |
| Order number continues from `LAB_ORDER_NUMBER_START` | Tasks 3, 5 |
| Status table in shared | Task 1 |
| Hold / cancel need a reason | Tasks 1, 4 |
| Remakes | Tasks 3, 5, 6, 10 |
| Rx release replaces the push, same gates, one transaction, release event | Tasks 3, 5, 7 |
| `released` status | Task 3 |
| Legacy `pushed` readable and labelled | Task 12 |
| Auto-release | Task 7 |
| Checkout creates the lab order in the same transaction | Task 7 |
| Seazona order code removed, with every call site grep-verified | Task 12 |
| `seazona*` columns kept | Task 12 (comments only) |
| `lab` role and `requireRole("admin","lab")` | Tasks 2, 6 |
| Doctors' My cases, staff-only fields hidden | Tasks 1, 11 |
| Work ticket: contents, pdfkit, Code 128, audit, never stored | Task 9 |
| Board with columns, filters, buttons (not drag-and-drop), overdue | Task 10 |
| Order detail | Task 10 |
| Admin › Departments | Task 11 |
| Admin › Orders lists local lab orders | Task 11 |
| 422 with allowed moves; 409 on a concurrent edit; mutation + event in one transaction | Tasks 4, 5, 6 |
| PHI encrypted, referenced not copied, audit-logged | Tasks 2, 5, 6, 9 |

**Testing as the spec asks:**
- transition table, every pair (Task 1);
- release planner (Task 3);
- order-number allocation (Task 3);
- doctor mapping hides staff fields (Task 1);
- `buildTicketModel`, plus a PDF smoke test (Task 9).

**Names used across tasks:** `canRelease`, `releaseRefusal`, `LabOrderError`, `planRxRelease`, `planShopLabOrder`, `planRemake`, `planStatusChange`, `planFieldChange`, `assertFresh`, `presentBoardCard`, `releaseRxCase`, `createShopLabOrder`, `labOrdersForCases`, `getLabOrderDetail`, `labErrorReply`, `STAFF`, `groupRxAnswers`, `getRxForm`, `buildTicketModel`, `renderTicketPdf`, `code128Modules`, `doctorCaseView`, `quickMoves`, `describeEvent`, `openInNewTab`, `labOrderPath`, `caseStatusLabel`, `releaseBlockedReason`. Each is defined in the task that produces it, with the same signature where it is consumed.
