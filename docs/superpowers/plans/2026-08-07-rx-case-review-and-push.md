# Lab-facing Rx Case Review + Manual Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give lab staff a searchable queue of submitted prescriptions, an editable order derived from each one, and a button that pushes it to Seazona — with `RX_LIVE_PUSH` left as a switch that makes the push automatic later.

**Architecture:** Order lines are materialised into a new `rx_case_lines` table at submit time and become the editable working document; the doctor's prescription is never rewritten. Push builds its payload from those stored lines, so staff edits survive. Two admin pages follow the existing `AdminOrdersPage` / `AdminOrderDetailPage` pattern.

**Tech Stack:** Fastify v5, Drizzle ORM (PostgreSQL), Vitest, React + Vite, Tailwind, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-07-rx-case-review-and-push-design.md`

## Global Constraints

- Test runner is **Vitest**. `pnpm --filter api test`, `pnpm --filter web test`. Import style: `import { test } from "vitest"; import assert from "node:assert/strict";`
- Branch is `feat/rx-case-review` (off `main`). Do not commit to `main` or to `feat/autopay-and-admin-parity`.
- **Stage files explicitly with `git add <paths>` — never `git add -A`.**
- Admin routes use `preHandler: [authenticate, requireAdmin]`, importing `requireAdmin` from `../middleware/require-role.js`.
- Roles are `user | doctor | admin`. "Lab staff" means `admin`.
- **PHI is encrypted at rest.** `patientFirst`, `patientLast`, `dob`, `contactPhone`, `shipTo`, `formData`, `deviceOptions`, `payloadSnapshot` all pass through `apps/api/src/services/rx/phi-crypto.js`. Any new read of those columns must decrypt; any new write must encrypt. Never log decrypted PHI.
- **Never emit a guessed product code.** A line with `status: "open"` and `noteOnly: false` blocks the push.
- Case states: `new` · `in_review` · `awaiting_doctor` · `pushed` · `failed` · `cancelled`.
- Migrations: `cd apps/api && pnpm db:generate` then `pnpm db:migrate`. Latest existing migration is `0015_furry_mockingbird.sql`.
- `@my-app/shared` is already an `apps/api` dependency and is imported as `@my-app/shared`.

---

### Task 1: Extract `buildDigitalDevices` into the shared package

**Files:**
- Create: `packages/shared/src/rx/form-devices.js`
- Modify: `packages/shared/src/index.js`
- Modify: `apps/web/src/data/forms/form-to-case.js`
- Test: `packages/shared/src/rx/form-devices.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildDigitalDevices(answers) => Array<{deviceKey, label, deviceOptions}>` and `DEVICE_LABELS`, both exported from `@my-app/shared`.

**Why:** `POST /rx/form-submissions` stores `deviceKey: null` because this logic runs only in the browser. Everything downstream needs it server-side. Moving it (rather than copying) is what stops the two drifting.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/rx/form-devices.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildDigitalDevices } from "./form-devices.js";

test("a DDSO selection becomes one device with its options", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["ddso"],
    ddsoMaterial: "NYLON",
    ddsoOcclusalContact: "Anterior Contact",
    ddsoModifications: ["Tongue Positioners"],
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "ddso");
  assert.equal(devices[0].deviceOptions.baseMaterial, "NYLON");
  assert.deepEqual(devices[0].deviceOptions.modifications, ["Tongue Positioners"]);
});

test("selecting nothing yields no devices — never invents one", () => {
  assert.deepEqual(buildDigitalDevices({}), []);
  assert.deepEqual(buildDigitalDevices({ devicesToOrder: [] }), []);
});

test("a nightguard carries its standardGuards matrix through", () => {
  const matrix = { "Essix Tray": { "UPPER ARCH": true } };
  const devices = buildDigitalDevices({ devicesToOrder: ["nightguards"], standardGuards: matrix });
  assert.deepEqual(devices[0].deviceOptions.standardGuards, matrix);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @my-app/shared test 2>/dev/null || npx vitest run packages/shared/src/rx/form-devices.test.js`
Expected: FAIL — cannot resolve `./form-devices.js`.

If `@my-app/shared` has no `test` script, add `"test": "vitest run"` to `packages/shared/package.json` and add `vitest` to its devDependencies, matching how `apps/api/package.json` does it.

- [ ] **Step 3: Move the code**

Cut `answered`, `DEVICE_LABELS`, `cleanOptions`, `makeDevice` and `buildDigitalDevices` out of `apps/web/src/data/forms/form-to-case.js` verbatim into `packages/shared/src/rx/form-devices.js`, and export `buildDigitalDevices` plus `DEVICE_LABELS`.

Do not change any behaviour, key name, or option string — downstream Seazona mapping keys on the exact literals.

Re-export from `packages/shared/src/index.js`:

```js
export { buildDigitalDevices, DEVICE_LABELS } from "./rx/form-devices.js";
```

- [ ] **Step 4: Point the web adapter at the shared copy**

In `apps/web/src/data/forms/form-to-case.js`, delete the moved functions and import instead:

```js
import { buildDigitalDevices } from "@my-app/shared";
```

Leave `formAnswersToCaseInput` where it is — it also does patient-name and due-date lookup that only the browser needs.

- [ ] **Step 5: Run both suites**

Run: `pnpm --filter web test && pnpm --filter api test`
Expected: PASS. `form-to-case.test.js` must still pass unchanged — if it does not, the move altered behaviour.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/rx/form-devices.js packages/shared/src/rx/form-devices.test.js packages/shared/src/index.js packages/shared/package.json apps/web/src/data/forms/form-to-case.js
git commit -m "refactor(rx): move buildDigitalDevices into the shared package

The server needs it to populate deviceKey on a form submission. Moving
rather than copying is what stops the browser and server drifting."
```

---

### Task 2: Populate `deviceKey` / `deviceOptions` on submission

**Files:**
- Modify: `apps/api/src/routes/rx.routes.js` (the `POST /rx/form-submissions` insert, currently `deviceKey: null`)
- Test: `apps/api/src/routes/__tests__/rx-form-submit.test.js`

**Interfaces:**
- Consumes: `buildDigitalDevices` from `@my-app/shared`.
- Produces: a submitted case row whose `deviceKey`, `deviceCategory` and `deviceOptions` reflect the first selected device, with the full device list preserved.

**Design note:** `rx_cases` holds a single `deviceKey`, but one prescription can order several devices. Store the **first** device on the case row for display and single-device compatibility, and keep the complete list inside `deviceOptions` under a `devices` key so nothing is lost. Task 4 seeds lines from all of them.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/__tests__/rx-form-submit.test.js`:

```js
import { buildDigitalDevices } from "@my-app/shared";

test("a form submission resolves its devices instead of storing null", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["ddso"],
    ddsoMaterial: "NYLON",
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "ddso");
});

test("a multi-device submission keeps every device, not just the first", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["ddso", "snorehook"],
    ddsoMaterial: "NYLON",
  });
  assert.deepEqual(devices.map((d) => d.deviceKey).sort(), ["ddso", "snorehook"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- rx-form-submit`
Expected: FAIL — `@my-app/shared` does not export `buildDigitalDevices` until Task 1 lands. If Task 1 is already merged, this test passes immediately; that is fine, it is a guard for Step 3.

- [ ] **Step 3: Populate the columns**

In `apps/api/src/routes/rx.routes.js`, import at the top of the file:

```js
import { buildDigitalDevices } from "@my-app/shared";
```

Then replace the three null/empty fields in the `POST /rx/form-submissions` insert:

```js
          deviceKey: null,
          deviceCategory: null,
          deviceOptions: {},
```

with:

```js
          deviceKey: devices[0]?.deviceKey ?? null,
          deviceCategory: null,
          deviceOptions: { devices },
```

and compute `devices` just before the transaction:

```js
    // Resolve the doctor's selections into devices so the case is reviewable.
    // rx_cases carries one deviceKey for display; the full list lives in
    // deviceOptions.devices so a multi-device prescription loses nothing.
    const devices = buildDigitalDevices(data.formData ?? {});
```

`deviceOptions` is PHI-encrypted on write by the existing `encryptRxPhi` wrapper — do not add a second encryption.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/rx.routes.js apps/api/src/routes/__tests__/rx-form-submit.test.js
git commit -m "fix(rx): a form submission resolves its devices instead of storing null

Every submission stored deviceKey: null, so nothing downstream could
build an order from it."
```

---

### Task 3: `rx_case_lines` schema and migration

**Files:**
- Create: `apps/api/src/db/schema/rx-case-lines.js`
- Modify: `apps/api/src/db/schema/index.js`
- Create: migration via `pnpm db:generate`
- Test: `apps/api/src/db/schema/rx-case-lines.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `rxCaseLines` table export.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/schema/rx-case-lines.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { rxCaseLines } from "./rx-case-lines.js";

test("the table exposes the columns the review flow depends on", () => {
  const cols = Object.keys(rxCaseLines);
  for (const c of [
    "id", "caseId", "position", "seazonaCode", "seazonaProductId",
    "name", "arch", "mapKey", "status", "origin", "noteOnly",
  ]) {
    assert.ok(cols.includes(c), `missing column: ${c}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- rx-case-lines`
Expected: FAIL — cannot resolve `./rx-case-lines.js`.

- [ ] **Step 3: Create the schema**

```js
import { pgTable, varchar, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

// The editable order derived from a submitted prescription.
//
// Line items used to be computed on the fly at push time and thrown away. Staff
// can now correct them before pushing, so they have to persist.
//
// `origin: "manual"` marks a line a human added or edited. Re-resolving from the
// prescription recomputes "auto" lines and leaves "manual" ones alone — without
// that flag a re-resolve would silently discard someone's correction.
//
// `noteOnly` marks a doctor selection the lab has ruled is a build instruction
// rather than a charged product. It travels in the order notes, not as a line,
// and does not block the push.
export const rxCaseLines = pgTable("rx_case_lines", {
  id: varchar("id", { length: 128 }).primaryKey(),
  caseId: varchar("case_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  seazonaCode: varchar("seazona_code", { length: 60 }),
  seazonaProductId: varchar("seazona_product_id", { length: 128 }),
  name: varchar("name", { length: 255 }),
  arch: varchar("arch", { length: 20 }),
  // Which mapping slot produced this line; also the rx_code_overrides key.
  mapKey: varchar("map_key", { length: 200 }),
  // confirmed | proposed | open
  status: varchar("status", { length: 20 }).notNull().default("open"),
  // auto | manual
  origin: varchar("origin", { length: 20 }).notNull().default("auto"),
  noteOnly: boolean("note_only").notNull().default(false),
  // The doctor's literal selection, kept so an unresolved line can say what it was.
  sourceLabel: text("source_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rx_case_lines_case_id_idx").on(t.caseId)]);
```

Export it from `apps/api/src/db/schema/index.js` alongside the existing rx exports:

```js
export { rxCaseLines } from "./rx-case-lines.js";
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd apps/api && pnpm db:generate && pnpm db:migrate
```

Expected: a new `0016_*.sql` creating `rx_case_lines`. Read the generated SQL before applying — confirm it only CREATEs the new table and does not alter or drop anything else.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter api test -- rx-case-lines`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema/rx-case-lines.js apps/api/src/db/schema/rx-case-lines.test.js apps/api/src/db/schema/index.js apps/api/src/db/migrations/
git commit -m "feat(rx): rx_case_lines — the editable order behind a case"
```

---

### Task 4: Case-lines service — seed and re-resolve

**Files:**
- Create: `apps/api/src/services/rx/case-lines.service.js`
- Test: `apps/api/src/services/rx/case-lines.service.test.js`

**Interfaces:**
- Consumes: `resolveLineItems` from `../catalog-map/index.js` (signature `({deviceKey, deviceOptions}, {overrides}) => {items, unmapped}`); `rxCaseLines`.
- Produces:
  - `linesForDevices(devices, { overrides }) => Array<lineDraft>` — pure, no DB
  - `seedLines(caseId, devices, { overrides, tx }) => Promise<void>`
  - `reResolveLines(caseId, devices, { overrides, tx }) => Promise<{replaced, kept}>`

**Design note:** keep the pure part (`linesForDevices`) separate from the DB part so the interesting logic is testable without a database.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/rx/case-lines.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { linesForDevices } from "./case-lines.service.js";

test("a resolvable device produces coded lines", () => {
  const lines = linesForDevices([
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } },
  ]);
  const ddso = lines.find((l) => l.seazonaCode === "2608");
  assert.ok(ddso, "expected DDSO Nylon 2608");
  assert.equal(ddso.status, "confirmed");
  assert.equal(ddso.origin, "auto");
  assert.equal(ddso.noteOnly, false);
});

test("an unmapped selection becomes an open line, never a guessed code", () => {
  const lines = linesForDevices([
    { deviceKey: "olmos-night", deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" } },
  ]);
  const open = lines.filter((l) => l.status === "open");
  assert.ok(open.length > 0, "expected an open line");
  for (const l of open) {
    assert.equal(l.seazonaCode, null);
    assert.ok(l.mapKey, "an open line still needs its mapKey so it can be overridden");
  }
});

test("lines from several devices are positioned in order", () => {
  const lines = linesForDevices([
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } },
    { deviceKey: "snorehook", deviceOptions: {} },
  ]);
  assert.deepEqual(lines.map((l) => l.position), lines.map((_, i) => i));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- case-lines`
Expected: FAIL — cannot resolve `./case-lines.service.js`.

- [ ] **Step 3: Implement**

```js
import { eq, and } from "drizzle-orm";
import { db } from "../../config/database.js";
import { rxCaseLines } from "../../db/schema/index.js";
import { resolveLineItems } from "./catalog-map/index.js";
import { createId } from "../../lib/id.js";

/**
 * Pure: devices -> line drafts. No database, so the interesting part is
 * testable on its own.
 *
 * An unmapped selection becomes a line with status "open" and a null code —
 * never a guess. It keeps its mapKey so staff can resolve it, and so an
 * "always" resolution can be written to rx_code_overrides under that key.
 */
export function linesForDevices(devices = [], { overrides = {} } = {}) {
  const out = [];
  for (const d of devices) {
    const { items, unmapped } = resolveLineItems(
      { deviceKey: d.deviceKey, deviceOptions: d.deviceOptions || {} },
      { overrides }
    );
    for (const it of items) {
      out.push({
        seazonaCode: it.code,
        seazonaProductId: null,
        name: it.name,
        arch: it.arch ?? null,
        mapKey: it.mapKey ?? null,
        status: it.status ?? "confirmed",
        origin: "auto",
        noteOnly: false,
        sourceLabel: null,
      });
    }
    for (const key of unmapped) {
      out.push({
        seazonaCode: null,
        seazonaProductId: null,
        name: null,
        arch: null,
        mapKey: key,
        status: "open",
        origin: "auto",
        noteOnly: false,
        sourceLabel: key,
      });
    }
  }
  return out.map((l, i) => ({ ...l, position: i }));
}

/** Insert the seeded lines for a case. Call inside the submit transaction. */
export async function seedLines(caseId, devices, { overrides = {}, tx = db } = {}) {
  const drafts = linesForDevices(devices, { overrides });
  if (drafts.length === 0) return;
  await tx.insert(rxCaseLines).values(
    drafts.map((l) => ({ ...l, id: createId(), caseId }))
  );
}

/**
 * Recompute the "auto" lines, leaving "manual" ones untouched.
 *
 * Explicit, never automatic: a case someone has already corrected must not
 * change under them because a mapping was answered elsewhere.
 */
export async function reResolveLines(caseId, devices, { overrides = {}, tx = db } = {}) {
  const existing = await tx.select().from(rxCaseLines).where(eq(rxCaseLines.caseId, caseId));
  const kept = existing.filter((l) => l.origin === "manual");

  await tx.delete(rxCaseLines).where(
    and(eq(rxCaseLines.caseId, caseId), eq(rxCaseLines.origin, "auto"))
  );

  const drafts = linesForDevices(devices, { overrides });
  if (drafts.length > 0) {
    await tx.insert(rxCaseLines).values(
      drafts.map((l, i) => ({ ...l, id: createId(), caseId, position: kept.length + i }))
    );
  }
  return { replaced: drafts.length, kept: kept.length };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- case-lines`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/rx/case-lines.service.js apps/api/src/services/rx/case-lines.service.test.js
git commit -m "feat(rx): seed and re-resolve a case's order lines

linesForDevices is pure so the interesting logic tests without a DB.
Re-resolve keeps manual lines — otherwise answering a mapping question
elsewhere would silently discard a staff correction."
```

---

### Task 5: Seed lines when a prescription is submitted

**Files:**
- Modify: `apps/api/src/routes/rx.routes.js` (the `POST /rx/form-submissions` transaction)
- Test: `apps/api/src/routes/__tests__/rx-form-submit.test.js`

**Interfaces:**
- Consumes: `seedLines` from `../services/rx/case-lines.service.js`; `loadOverrides` — read how `admin-rx-mapping.routes.js` loads overrides and reuse that, do not write a second loader.
- Produces: every newly submitted case has its `rx_case_lines` rows.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/__tests__/rx-form-submit.test.js`:

```js
import { linesForDevices } from "../../services/rx/case-lines.service.js";

test("a submitted DDSO prescription yields a coded order line", () => {
  const devices = buildDigitalDevices({ devicesToOrder: ["ddso"], ddsoMaterial: "NYLON" });
  const lines = linesForDevices(devices);
  assert.ok(lines.some((l) => l.seazonaCode === "2608"));
});

test("a prescription with an unmappable selection still yields a line, flagged open", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["olmos"],
    onDesign: "DEPROGRAMMER (ON-D) - Anterior Occlusion",
  });
  const lines = linesForDevices(devices);
  assert.ok(lines.some((l) => l.status === "open"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- rx-form-submit`
Expected: FAIL until Task 4's service exists.

- [ ] **Step 3: Seed inside the transaction**

In `POST /rx/form-submissions`, after the `rxCaseFiles` insert and still inside the same `tx`, add:

```js
        // Materialise the order now so the queue can show "4 lines · 1 unmapped"
        // without recomputing, and so staff have something to edit.
        await seedLines(caseId, devices, { overrides, tx });
```

Load `overrides` once before the transaction using the same helper
`admin-rx-mapping.routes.js` uses. Import `seedLines` at the top of the file.

If seeding throws, the whole transaction rolls back — a case must never exist
without its lines.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/rx.routes.js apps/api/src/routes/__tests__/rx-form-submit.test.js
git commit -m "feat(rx): seed order lines when a prescription is submitted"
```

---

### Task 6: Admin queue endpoint

**Files:**
- Create: `apps/api/src/routes/admin-rx-cases.routes.js`
- Modify: `apps/api/src/index.js`
- Test: `apps/api/src/routes/__tests__/admin-rx-cases.test.js`

**Interfaces:**
- Consumes: `rxCases`, `rxCaseLines`, `requireAdmin`, `decryptRxPhi` from `../services/rx/phi-crypto.js`.
- Produces: `GET /api/v1/admin/rx-cases` returning `{ data: [{ id, caseNumber, patientName, practiceName, deviceKey, status, lineCount, unmappedCount, createdAt }], meta: { total } }`. Query params: `status` (repeatable), `q` (case number / patient / practice), `limit`, `offset`.

**Design note:** the queue defaults to everything needing attention — `new`, `in_review`, `awaiting_doctor`, `failed` — when no `status` is supplied.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/__tests__/admin-rx-cases.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_QUEUE_STATUSES, summariseLines } from "../admin-rx-cases.routes.js";

test("the queue defaults to everything needing attention", () => {
  assert.deepEqual(
    [...DEFAULT_QUEUE_STATUSES].sort(),
    ["awaiting_doctor", "failed", "in_review", "new"]
  );
  assert.ok(!DEFAULT_QUEUE_STATUSES.includes("pushed"));
  assert.ok(!DEFAULT_QUEUE_STATUSES.includes("cancelled"));
});

test("a noteOnly line is not counted as unmapped — it does not block a push", () => {
  const s = summariseLines([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: true },
  ]);
  assert.equal(s.lineCount, 2);
  assert.equal(s.unmappedCount, 0);
});

test("an open line that is not noteOnly counts as unmapped", () => {
  const s = summariseLines([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: false },
  ]);
  assert.equal(s.unmappedCount, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- admin-rx-cases`
Expected: FAIL — cannot resolve `../admin-rx-cases.routes.js`.

- [ ] **Step 3: Implement the route module**

Create `apps/api/src/routes/admin-rx-cases.routes.js`. Export the two pure helpers so they are testable without booting Fastify:

```js
/** Statuses the queue shows when the caller does not ask for specific ones. */
export const DEFAULT_QUEUE_STATUSES = ["new", "in_review", "awaiting_doctor", "failed"];

/**
 * Count lines and, separately, the ones blocking a push.
 * A noteOnly line is deliberately NOT unmapped: the lab has ruled it is a build
 * instruction rather than a product, so it travels in the notes and blocks nothing.
 */
export function summariseLines(lines = []) {
  return {
    lineCount: lines.length,
    unmappedCount: lines.filter((l) => l.status === "open" && !l.noteOnly).length,
  };
}
```

Then the route itself, following `admin-rx-mapping.routes.js`'s shape:

```js
  fastify.get("/admin/rx-cases", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const q = request.query || {};
    const statuses = q.status
      ? (Array.isArray(q.status) ? q.status : [q.status])
      : DEFAULT_QUEUE_STATUSES;
    // …select from rxCases where status inArray(statuses), join line counts,
    // decrypt patientFirst/patientLast for display, apply `q` as a filter.
  });
```

Decrypt PHI for display via the existing `decryptRxPhi` helper. Never log a
decrypted patient name.

Register in `apps/api/src/index.js` alongside the existing registrations:

```js
import adminRxCasesRoutes from "./routes/admin-rx-cases.routes.js";
await fastify.register(adminRxCasesRoutes, { prefix: "/api/v1" });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- admin-rx-cases`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-rx-cases.routes.js apps/api/src/routes/__tests__/admin-rx-cases.test.js apps/api/src/index.js
git commit -m "feat(rx): admin queue endpoint for submitted prescriptions"
```

---

### Task 7: Case detail endpoint

**Files:**
- Modify: `apps/api/src/routes/admin-rx-cases.routes.js`
- Test: `apps/api/src/routes/__tests__/admin-rx-cases.test.js`

**Interfaces:**
- Consumes: Task 6's module.
- Produces: `GET /api/v1/admin/rx-cases/:id` returning `{ data: { case, lines, files, prescription } }` where `prescription` is the decrypted `formData` and `files` come from `rx_case_files`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/__tests__/admin-rx-cases.test.js`:

```js
import { canPush } from "../admin-rx-cases.routes.js";

test("a case with an unresolved line cannot be pushed", () => {
  assert.equal(canPush([{ status: "open", noteOnly: false }]).ok, false);
});

test("a case whose only open line is noteOnly can be pushed", () => {
  assert.equal(canPush([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: true },
  ]).ok, true);
});

test("a case with no lines at all cannot be pushed", () => {
  const r = canPush([]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no lines/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- admin-rx-cases`
Expected: FAIL — `canPush` is not exported.

- [ ] **Step 3: Implement**

Add to `admin-rx-cases.routes.js`:

```js
/**
 * Whether a case may be pushed. Exported and pure so the gate is testable
 * without a database or a live Seazona client.
 *
 * The invariant this protects: never send Seazona a partial order. An empty
 * case is refused too — an order with no lines is not a lesser order, it is a
 * wrong one.
 */
export function canPush(lines = []) {
  const emitting = lines.filter((l) => !l.noteOnly);
  if (emitting.length === 0) return { ok: false, reason: "This case has no lines to send." };
  const blocking = emitting.filter((l) => l.status === "open");
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `${blocking.length} selection(s) still need a product code.`,
      blocking: blocking.map((l) => l.mapKey || l.sourceLabel),
    };
  }
  return { ok: true };
}
```

Then the detail route, returning the case, its lines ordered by `position`, its
files, and the decrypted `formData` as `prescription`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- admin-rx-cases`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-rx-cases.routes.js apps/api/src/routes/__tests__/admin-rx-cases.test.js
git commit -m "feat(rx): case detail endpoint + the push gate as a pure function"
```

---

### Task 8: Line editing endpoints

**Files:**
- Modify: `apps/api/src/routes/admin-rx-cases.routes.js`
- Test: `apps/api/src/routes/__tests__/admin-rx-cases.test.js`

**Interfaces:**
- Consumes: `rxCaseLines`, `rxCodeOverrides`, `logSafe` from `../services/audit.service.js`.
- Produces:
  - `PUT /admin/rx-cases/:id/lines/:lineId` — body `{ seazonaCode, name, arch, noteOnly, scope }` where `scope` is `"once" | "always"`
  - `POST /admin/rx-cases/:id/lines` — add a line
  - `DELETE /admin/rx-cases/:id/lines/:lineId`

**Behaviour:** any edit sets `origin: "manual"`. `scope: "always"` additionally upserts an `rx_code_overrides` row keyed on the line's `mapKey`, so every future order with that selection resolves automatically. `noteOnly: true` with `scope: "always"` records the lab's "instruction, not a charge" ruling the same way.

- [ ] **Step 1: Write the failing test**

```js
import { overrideRowFor } from "../admin-rx-cases.routes.js";

test("an 'always' code assignment becomes an override row", () => {
  const row = overrideRowFor({
    mapKey: "mod:anterior-pad",
    seazonaCode: "2181",
    seazonaName: "Acrylic Palatal Pads",
    noteOnly: false,
    confirmedBy: "u1",
  });
  assert.equal(row.mapKey, "mod:anterior-pad");
  assert.equal(row.seazonaCode, "2181");
});

test("an 'always' note-only ruling is recorded without inventing a code", () => {
  const row = overrideRowFor({
    mapKey: "mod:wrap-distal",
    seazonaCode: null,
    noteOnly: true,
    confirmedBy: "u1",
  });
  assert.equal(row.seazonaCode, null);
  assert.match(row.note, /note only/i);
});

test("an override cannot be written without a mapKey to key it on", () => {
  assert.throws(() => overrideRowFor({ mapKey: null, seazonaCode: "2181" }), /mapKey/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- admin-rx-cases`
Expected: FAIL — `overrideRowFor` is not exported.

- [ ] **Step 3: Implement**

```js
/**
 * Build the rx_code_overrides row for an "always" resolution.
 *
 * mapKey is the override table's unique key — an unmapped line carries the same
 * mapKey the resolver would have used, which is what makes this possible. A
 * line with no mapKey cannot be resolved permanently, only for this order.
 */
export function overrideRowFor({ mapKey, seazonaCode, seazonaName, noteOnly, confirmedBy }) {
  if (!mapKey) throw new Error("cannot write an override without a mapKey");
  return {
    mapKey,
    seazonaCode: seazonaCode ?? null,
    seazonaName: seazonaName ?? null,
    note: noteOnly ? "note only — instruction, not a charged product" : null,
    confirmedBy: confirmedBy ?? null,
  };
}
```

Wire the three routes. Every mutation calls `logSafe` with `action: "rx_case_line.updated"`, the case id as `targetId`, and a metadata object recording the before and after code — **never** the patient's name.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-rx-cases.routes.js apps/api/src/routes/__tests__/admin-rx-cases.test.js
git commit -m "feat(rx): edit order lines, with 'once' or 'always' resolution

'always' writes an rx_code_overrides row, so the lab's open mapping
questions answer themselves through real work."
```

---

### Task 9: Status transitions and re-resolve

**Files:**
- Modify: `apps/api/src/routes/admin-rx-cases.routes.js`
- Test: `apps/api/src/routes/__tests__/admin-rx-cases.test.js`

**Interfaces:**
- Produces:
  - `PUT /admin/rx-cases/:id/status` — body `{ status }`
  - `POST /admin/rx-cases/:id/re-resolve`
  - exported `CASE_STATUSES` and `canTransition(from, to)`

- [ ] **Step 1: Write the failing test**

```js
import { CASE_STATUSES, canTransition } from "../admin-rx-cases.routes.js";

test("the six agreed states exist and nothing else", () => {
  assert.deepEqual([...CASE_STATUSES].sort(), [
    "awaiting_doctor", "cancelled", "failed", "in_review", "new", "pushed",
  ]);
});

test("a pushed case cannot be moved back — the Seazona order already exists", () => {
  assert.equal(canTransition("pushed", "in_review"), false);
  assert.equal(canTransition("pushed", "cancelled"), false);
});

test("a failed push can be retried or cancelled", () => {
  assert.equal(canTransition("failed", "in_review"), true);
  assert.equal(canTransition("failed", "cancelled"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- admin-rx-cases`
Expected: FAIL — neither export exists.

- [ ] **Step 3: Implement**

```js
export const CASE_STATUSES = [
  "new", "in_review", "awaiting_doctor", "pushed", "failed", "cancelled",
];

/**
 * `pushed` is terminal. The Seazona order exists; moving the case back would
 * make the portal disagree with the lab's own system about what was ordered.
 * A mistake after a push is corrected in Seazona, not here.
 */
export function canTransition(from, to) {
  if (!CASE_STATUSES.includes(to)) return false;
  if (from === "pushed") return false;
  return true;
}
```

The re-resolve route reads the case's `deviceOptions.devices`, calls
`reResolveLines`, and returns the new lines with a `{ replaced, kept }` summary
so the UI can say "3 lines recomputed, 1 of your edits kept".

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-rx-cases.routes.js apps/api/src/routes/__tests__/admin-rx-cases.test.js
git commit -m "feat(rx): case status transitions + explicit re-resolve"
```

---

### Task 10: Push to Seazona

**Files:**
- Modify: `apps/api/src/routes/admin-rx-cases.routes.js`
- Create: `apps/api/src/services/rx/push-case.service.js`
- Test: `apps/api/src/services/rx/push-case.service.test.js`

**Interfaces:**
- Consumes: `canPush`; `seazonaService.createOrder`; `compileNotesMulti` from `./build-order-payload.js`.
- Produces:
  - `payloadFromLines(caseRow, lines, { codeToId, userId }) => { payload, ok, warnings }`
  - `POST /admin/rx-cases/:id/push`

**Design note — the load-bearing detail:** the payload is built from the **stored lines**, not by re-running `resolveLineItems`. Re-resolving here would silently discard every staff edit at the exact moment it mattered.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { payloadFromLines } from "./push-case.service.js";

const caseRow = { seazonaClientId: "c1", patientFirst: "A", patientLast: "B", dueDate: null };

test("the payload is built from the stored lines, not re-resolved", () => {
  const { payload, ok } = payloadFromLines(
    caseRow,
    [{ seazonaCode: "9999", name: "Staff-chosen product", arch: "upper", status: "confirmed", noteOnly: false }],
    { codeToId: { 9999: "id-9999" }, userId: "u1" }
  );
  assert.equal(ok, true);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, "id-9999");
});

test("a noteOnly line travels in the notes, not as an item", () => {
  const { payload } = payloadFromLines(
    caseRow,
    [
      { seazonaCode: "2608", name: "DDSO Nylon", status: "confirmed", noteOnly: false },
      { seazonaCode: null, sourceLabel: "Wrap distal of last molars", status: "open", noteOnly: true },
    ],
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.equal(payload.items.length, 1);
  assert.match(payload.notes, /Wrap distal of last molars/);
});

test("a line whose code has no catalog id fails loudly rather than vanishing", () => {
  const { ok, warnings } = payloadFromLines(
    caseRow,
    [{ seazonaCode: "2608", name: "DDSO Nylon", status: "confirmed", noteOnly: false }],
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.ok(warnings.some((w) => /2608/.test(w)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- push-case`
Expected: FAIL — cannot resolve `./push-case.service.js`.

- [ ] **Step 3: Implement the service**

```js
/**
 * Build a Seazona order payload from the case's STORED lines.
 *
 * Deliberately does not call resolveLineItems: by this point staff may have
 * corrected the lines, and re-resolving would discard those corrections at the
 * one moment they matter.
 */
export function payloadFromLines(caseRow, lines = [], { codeToId = {}, userId } = {}) {
  const items = [];
  const warnings = [];
  const noteLines = [];

  for (const l of lines) {
    if (l.noteOnly) {
      if (l.sourceLabel || l.name) noteLines.push(l.sourceLabel || l.name);
      continue;
    }
    if (!l.seazonaCode) {
      warnings.push(`line has no product code (${l.mapKey || l.sourceLabel || "unknown"})`);
      continue;
    }
    const id = codeToId[l.seazonaCode];
    if (!id) {
      warnings.push(`no catalog id for code ${l.seazonaCode} (${l.name || ""})`);
      continue;
    }
    items.push({ id, arch: normalizeArch(l.arch) });
  }

  const ok = warnings.length === 0 && items.length > 0;
  const notes = [caseRow.generalComments, ...noteLines].filter(Boolean).join(" | ").slice(0, 2000);

  return {
    ok,
    warnings,
    payload: {
      clientId: caseRow.seazonaClientId,
      patientName: `${caseRow.patientFirst ?? ""} ${caseRow.patientLast ?? ""}`.trim(),
      due: caseRow.dueDate || null,
      items,
      notes,
      userId,
    },
  };
}

/** "Upper" -> 1, "Lower" -> 2, anything else -> null. Mirrors build-order-payload.js. */
function normalizeArch(arch) {
  if (arch === 1 || arch === 2) return arch;
  if (typeof arch === "string") {
    const a = arch.toLowerCase();
    if (a === "upper") return 1;
    if (a === "lower") return 2;
  }
  return null;
}
```

- [ ] **Step 4: Implement the route, guarded against a double push**

```js
    // Guard at the database, not the button. Seazona has no idempotency key, so
    // a double-click or a retry after an ambiguous timeout could create two
    // orders. Same conditional-update pattern as /rx/cases/:id/approve.
    //
    // The claim is taken on seazonaPushStatus, NOT on status: `status` must only
    // ever hold one of CASE_STATUSES, so a crash between claim and outcome can
    // never strand a case in a value the queue and the UI do not understand.
    const claimed = await db.update(rxCases)
      .set({ seazonaPushStatus: "pushing", updatedAt: new Date() })
      .where(and(
        eq(rxCases.id, id),
        ne(rxCases.status, "pushed"),
        or(isNull(rxCases.seazonaPushStatus), ne(rxCases.seazonaPushStatus, "pushing")),
      ))
      .returning({ id: rxCases.id });
    if (claimed.length === 0) {
      return reply.code(409).send({
        error: { code: "PUSH_IN_FLIGHT_OR_DONE", status: 409, message: "This case has already been sent, or a push is already running." },
      });
    }
```

On success: `status: "pushed"`, `seazonaPushStatus: "pushed"`, store `seazonaOrderId`, and the payload in `payloadSnapshot` (PHI-encrypted). On failure: `status: "failed"`, `seazonaPushStatus: "failed"`, `seazonaPushError` set, lines untouched.

**Recovery from a crashed push.** If the process dies between the claim and the
outcome, `seazonaPushStatus` is left at `"pushing"` and the case cannot be
retried. Add a `PUT /admin/rx-cases/:id/clear-push-lock` (admin-only) that resets
it to `null`, and surface it in the UI as "a push was interrupted — check Seazona
before retrying". Do not clear the lock automatically on a timer: an interrupted
push may well have reached Seazona, and a human must check before a second
attempt.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/rx/push-case.service.js apps/api/src/services/rx/push-case.service.test.js apps/api/src/routes/admin-rx-cases.routes.js
git commit -m "feat(rx): push a reviewed case to Seazona

Payload is built from the stored lines, never re-resolved — re-resolving
here would discard staff edits at the moment they matter. Double push is
guarded by a conditional update, not a disabled button."
```

---

### Task 11: The queue page

**Files:**
- Create: `apps/web/src/pages/app/AdminRxCasesPage.jsx`
- Modify: `apps/web/src/config/routes.js`, `apps/web/src/App.jsx`, `apps/web/src/components/layout/Sidebar.jsx`
- Test: `apps/web/src/pages/app/AdminRxCasesPage.test.jsx`

**Interfaces:**
- Consumes: `GET /admin/rx-cases`.
- Produces: route `ADMIN_RX_CASES: "/admin/rx-cases"`.

**Follow `AdminOrdersPage.jsx` (245 lines)** for structure, filter pills, and table styling. Use the semantic colour tokens (`text-primary`, `text-secondary`, `text-muted`) — not raw `text-navy/NN` opacities.

- [ ] **Step 1: Write the failing test**

```jsx
import { test } from "vitest";
import assert from "node:assert/strict";
import { statusLabel, queueBadge } from "./AdminRxCasesPage.jsx";

test("every case status has a human label", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "pushed", "failed", "cancelled"]) {
    assert.ok(statusLabel(s), `no label for ${s}`);
    assert.notEqual(statusLabel(s), s);
  }
});

test("the lines badge tells staff at a glance whether a case is blocked", () => {
  assert.match(queueBadge({ lineCount: 4, unmappedCount: 1 }), /1 unmapped/);
  assert.match(queueBadge({ lineCount: 4, unmappedCount: 0 }), /4 lines/);
  assert.doesNotMatch(queueBadge({ lineCount: 4, unmappedCount: 0 }), /unmapped/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- AdminRxCasesPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Export the two pure helpers so the test above works:

```jsx
export function statusLabel(s) {
  return {
    new: "New",
    in_review: "In review",
    awaiting_doctor: "Awaiting doctor",
    pushed: "Pushed",
    failed: "Failed",
    cancelled: "Cancelled",
  }[s] || s;
}

export function queueBadge({ lineCount = 0, unmappedCount = 0 }) {
  return unmappedCount > 0
    ? `${lineCount} lines · ${unmappedCount} unmapped`
    : `${lineCount} lines`;
}
```

Add the route constant, the `<Route>` inside the existing admin guard block in
`App.jsx`, and a Sidebar entry after "Rx Mapping" using a lucide icon
(`ClipboardCheck` fits the existing set).

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/AdminRxCasesPage.jsx apps/web/src/pages/app/AdminRxCasesPage.test.jsx apps/web/src/config/routes.js apps/web/src/App.jsx apps/web/src/components/layout/Sidebar.jsx
git commit -m "feat(rx): admin queue page for submitted prescriptions"
```

---

### Task 12: The case detail page

**Files:**
- Create: `apps/web/src/pages/app/AdminRxCaseDetailPage.jsx`
- Modify: `apps/web/src/config/routes.js`, `apps/web/src/App.jsx`
- Test: `apps/web/src/pages/app/AdminRxCaseDetailPage.test.jsx`

**Interfaces:**
- Consumes: `GET/PUT/POST/DELETE /admin/rx-cases/:id...` from Tasks 7–10.

**Follow `AdminOrderDetailPage.jsx` (229 lines).** Tabs: `Order` (default) · `Prescription` · `Files` · `History`.

- [ ] **Step 1: Write the failing test**

```jsx
import { test } from "vitest";
import assert from "node:assert/strict";
import { pushBlockedReason } from "./AdminRxCaseDetailPage.jsx";

test("the push button explains why it is disabled, rather than just being grey", () => {
  const reason = pushBlockedReason([{ status: "open", noteOnly: false, sourceLabel: "Anterior Pad" }]);
  assert.match(reason, /Anterior Pad/);
});

test("nothing blocking means no reason", () => {
  assert.equal(pushBlockedReason([{ status: "confirmed", noteOnly: false }]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- AdminRxCaseDetailPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
/**
 * Why the push button is disabled, in words. A greyed-out button with no
 * explanation is the thing staff will complain about; naming the selection
 * that blocks it turns a dead end into a next action.
 */
export function pushBlockedReason(lines = []) {
  const blocking = lines.filter((l) => l.status === "open" && !l.noteOnly);
  if (blocking.length === 0) return null;
  const names = blocking.map((l) => l.sourceLabel || l.mapKey).filter(Boolean);
  return `Needs a product code for: ${names.join(", ")}`;
}
```

The order tab renders each line with its code, name, arch, and an `edited` badge
when `origin === "manual"`. An `open` line renders inline catalog search (reuse
`GET /admin/rx-mapping/catalog`) with `once` / `always` radios, an **Assign**
button, and a **Not a line item — send as a note** button.

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/AdminRxCaseDetailPage.jsx apps/web/src/pages/app/AdminRxCaseDetailPage.test.jsx apps/web/src/config/routes.js apps/web/src/App.jsx
git commit -m "feat(rx): case detail page — editable order, prescription, files, history"
```

---

### Task 13: Auto-push under `RX_LIVE_PUSH`, and the arrival email

**Files:**
- Modify: `apps/api/src/routes/rx.routes.js`
- Modify: `apps/api/src/services/email.service.js`
- Test: `apps/api/src/routes/__tests__/rx-form-submit.test.js`

**Interfaces:**
- Consumes: `payloadFromLines`, `canPush`, `sendRxSubmissionReceived`.
- Produces: when `RX_LIVE_PUSH === "true"`, a submission attempts its own push; on any failure the case lands in the queue.

- [ ] **Step 1: Write the failing test**

```js
import { shouldAutoPush } from "../rx.routes.js";

test("auto-push is off unless RX_LIVE_PUSH is exactly 'true'", () => {
  assert.equal(shouldAutoPush(undefined), false);
  assert.equal(shouldAutoPush("false"), false);
  assert.equal(shouldAutoPush("1"), false);
  assert.equal(shouldAutoPush("true"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- rx-form-submit`
Expected: FAIL — `shouldAutoPush` is not exported.

- [ ] **Step 3: Implement**

```js
/** Auto-push only on an exact "true" — a truthy string must never enable it. */
export function shouldAutoPush(flag) {
  return flag === "true";
}
```

After a successful submit, when `shouldAutoPush(env.RX_LIVE_PUSH)`:

```js
      // Auto-push must never fail silently. Anything other than a clean push
      // leaves the case in the queue a human already watches.
      const gate = canPush(lines);
      if (!gate.ok) {
        // status stays "new" — it is waiting for a person, not broken
      } else {
        try { /* push; on success status "pushed" */ }
        catch (err) { /* status "failed", seazonaPushError set */ }
      }
```

Add `sendRxSubmissionReceived({ caseNumber, practiceName, deviceSummary, unmappedCount })` to
`email.service.js`, following the shape of the existing `sendAdminApprovalRequest`. It must
never throw into the submit path — wrap it the way the other non-critical sends are wrapped.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/rx.routes.js apps/api/src/services/email.service.js apps/api/src/routes/__tests__/rx-form-submit.test.js
git commit -m "feat(rx): auto-push behind RX_LIVE_PUSH + notify the lab on arrival

Auto-push failure lands in the review queue rather than vanishing, which
is what makes flipping the flag safe."
```

---

### Task 14: Full verification

- [ ] **Step 1: Both suites**

Run: `pnpm test`
Expected: PASS across api, web, shared.

- [ ] **Step 2: Production build**

Run: `pnpm --filter web build`
Expected: succeeds.

- [ ] **Step 3: Confirm the push gate cannot be bypassed**

Run:

```bash
cd apps/api && node --input-type=module -e '
const { canPush } = await import("./src/routes/admin-rx-cases.routes.js");
const cases = [
  [[], false, "empty"],
  [[{status:"open",noteOnly:false}], false, "one unresolved"],
  [[{status:"confirmed",noteOnly:false},{status:"open",noteOnly:true}], true, "noteOnly does not block"],
  [[{status:"confirmed",noteOnly:false}], true, "clean"],
];
let bad = 0;
for (const [lines, want, label] of cases) {
  const got = canPush(lines).ok;
  if (got !== want) { console.log("WRONG:", label, "expected", want, "got", got); bad++; }
}
console.log(bad ? `${bad} FAILED` : "push gate correct on all 4 cases");
process.exit(bad ? 1 : 0);'
```

Expected: `push gate correct on all 4 cases`.

- [ ] **Step 4: Confirm no decrypted PHI is logged**

Run: `grep -rnE "log.*(patientFirst|patientLast|patientName)" apps/api/src/routes/admin-rx-cases.routes.js apps/api/src/services/rx/push-case.service.js`
Expected: no output.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/rx-case-review
```

---

## Deferred — not in this plan

- **Editing the doctor's submitted answers.** The prescription is a clinical record; the order derived from it is the lab's document.
- **A separate lab-staff role.** `admin` covers it today.
- **Doctor-facing review status.** Whether a doctor should see "in review" / "awaiting you" is a product decision of its own.
- **Bulk actions** (push several cases at once). Worth revisiting once the queue has real volume.
