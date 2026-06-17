# Admin Rx Mapping Tester — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Admin-only screen to preview how a filled Rx form maps to a Seazona order and confirm/save the correct product code per gap. No Seazona writes; overrides persist to our DB and feed the existing pure payload builder.

**Tech:** Fastify + Drizzle (Postgres), React/Vite admin page, `node --test`. Branch `digital-rx-seazona-pipeline` (continues PR #4).

## File structure
- Create `apps/api/src/db/schema/rx-code-overrides.js` (+ export in `schema/index.js`, migration 0008).
- Modify `apps/api/src/services/rx/device-seazona-map.js` — attach `mapKey` to items + unmapped; accept `overrides`.
- Modify `apps/api/src/services/rx/build-order-payload.js` — pass `overrides` through.
- Create `apps/api/src/routes/admin-rx-mapping.routes.js` (+ register in `index.js`).
- Create `apps/web/src/pages/app/AdminRxMappingPage.jsx`; modify `routes.js` + `App.jsx`.

---

## Task 1: `rx_code_overrides` schema + migration

**Files:** Create `apps/api/src/db/schema/rx-code-overrides.js`; modify `schema/index.js`.

- [ ] **Step 1** — write schema:
```js
import { pgTable, varchar, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
// Admin-confirmed Seazona product code for a mapping slot. DB override wins over
// the file defaults in device-seazona-map.js. mapKey identifies the slot:
//   primary:<deviceKey>:<material|"default"> | mod:<label> | lab:<serviceKey>
export const rxCodeOverrides = pgTable("rx_code_overrides", {
  id: varchar("id", { length: 128 }).primaryKey(),
  mapKey: varchar("map_key", { length: 200 }).notNull(),
  seazonaCode: varchar("seazona_code", { length: 60 }).notNull(),
  seazonaProductId: varchar("seazona_product_id", { length: 128 }),
  seazonaName: varchar("seazona_name", { length: 255 }),
  note: text("note"),
  confirmedBy: varchar("confirmed_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("rx_code_overrides_map_key_idx").on(t.mapKey)]);
```
- [ ] **Step 2** — `export { rxCodeOverrides } from "./rx-code-overrides.js";` in `schema/index.js`.
- [ ] **Step 3** — `cd apps/api && pnpm db:generate && pnpm db:migrate`; verify `\d rx_code_overrides`. (No FK — matches the codebase no-FK convention.)
- [ ] **Step 4** — commit `feat(rx): rx_code_overrides table + migration`.

## Task 2: mapKey + overrides in `resolveLineItems`

**Files:** Modify `device-seazona-map.js`; extend `device-seazona-map.test.js`.

- [ ] **Step 1 — failing tests:**
```js
test("resolveLineItems attaches a mapKey to each item", () => {
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.equal(items[0].mapKey, "primary:ddso:Nylon");
});
test("unmapped entries are mapKey strings", () => {
  const { unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } });
  assert.ok(unmapped.includes("mod:__nope__"));
});
test("an override resolves a previously-unmapped line (override wins)", () => {
  const overrides = { "mod:__nope__": { code: "9999", name: "Custom Mod" } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } },
    { overrides });
  assert.ok(items.some((i) => i.code === "9999" && i.mapKey === "mod:__nope__"));
  assert.ok(!unmapped.includes("mod:__nope__"));
});
test("override replaces a file-default primary code", () => {
  const overrides = { "primary:ddso:Nylon": { code: "1234", name: "Override DDSO" } };
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } }, { overrides });
  assert.equal(items.find((i) => i.mapKey === "primary:ddso:Nylon").code, "1234");
});
```
- [ ] **Step 2** — run, verify FAIL.
- [ ] **Step 3 — implement:** signature `resolveLineItems({ deviceKey, deviceOptions = {} } = {}, { overrides = {} } = {})`.
  - Define `mapKey` per line: primary → `primary:${deviceKey}:${material||"default"}`; modification → `mod:${mod}`. (Use the SAME strings for the `unmapped` entries — i.e. unmapped pushes the mapKey, e.g. `mod:__nope__`, `primary:ddso:?`… keep `device:<key>` for unknown device.)
  - Resolution per line: `const ov = overrides[mapKey]; const chosen = ov || fileDefault;` if `chosen` → push item `{ code: chosen.code, name: chosen.name, arch, source, mapKey }`; else push `mapKey` to `unmapped`.
  - Apply overrides to BOTH primary and modification slots. (Keep existing arch behavior incl. `deviceOptions.arch` fallback.)
  - NOTE: changing the `unmapped` format from `modifications:x` to `mod:x` — update any consumer (the dry-run harness reads unmapped only for display, fine; build-order-payload maps unmapped→warnings, still fine).
- [ ] **Step 4** — run all `device-seazona-map.test.js` + the existing rx tests; PASS. Commit `feat(rx): mapKey + override-aware resolveLineItems`.

## Task 3: overrides passthrough in `buildSeazonaOrderPayload`

**Files:** Modify `build-order-payload.js`; extend its test.

- [ ] **Step 1 — failing test:**
```js
test("buildSeazonaOrderPayload applies overrides", () => {
  const c = { seazonaClientId:"x", patientFirst:"A", patientLast:"B", deviceKey:"ddso", deviceOptions:{ baseMaterial:"Nylon", modifications:["__nope__"] } };
  const overrides = { "mod:__nope__": { code:"9999", name:"Custom" } };
  const codeToId = { "9999":"id-9999" };
  const { payload, warnings } = buildSeazonaOrderPayload(c, { codeToId, userId:"u", overrides });
  assert.ok(payload.items.some((i) => i.id === "id-9999"));
  assert.ok(!warnings.some((w) => w.includes("__nope__")));
});
```
- [ ] **Step 2** — FAIL → implement: signature `buildSeazonaOrderPayload(rxCase, { codeToId = {}, userId, overrides = {} } = {})`; pass `{ overrides }` into `resolveLineItems`. → PASS. Commit `feat(rx): buildSeazonaOrderPayload honors overrides`.

## Task 4: admin API routes

**Files:** Create `apps/api/src/routes/admin-rx-mapping.routes.js`; modify `index.js`.

Helpers in the route module:
- `loadOverrides()` → read all `rx_code_overrides`, return `{ [mapKey]: { code, name, seazonaProductId } }`.
- `getCatalog()` → `seazonaService.listProducts()` cached in-process (~5 min TTL via a module timestamp); returns array + a `byCode` map.
- `statusFor(line, catalogByCode, overrides)` → `confirmed` if overrides[mapKey] OR catalog has line.code; else `placeholder` if line.code present; else (unmapped list) `unmapped`.

Routes (all `preHandler: [authenticate, requireAdmin]`):
- [ ] `GET /admin/rx-mapping/devices` — import `RX_DEVICES` shape from a shared source. **Frontend `rx-devices.js` lives in apps/web**, so the API cannot import it. Instead, derive the device list + per-line coverage from `DEVICE_MAP`/`MODIFICATION_MAP` keys in `device-seazona-map.js` (which the API owns) + a static device label map, OR accept that the FRONTEND supplies deviceKey/options on preview and `GET /devices` returns the keys present in `DEVICE_MAP` with names from a small label constant. Implement: return `Object.keys(DEVICE_MAP)` with a human name (maintain a `DEVICE_LABELS` const in device-seazona-map.js) + coverage = (# primary materials with a resolvable code incl overrides)/(total).
- [ ] `POST /admin/rx-mapping/preview` `{ deviceKey, deviceOptions }` → `resolveLineItems(..., { overrides })` + build per-line `{ mapKey, code, name, seazonaProductId: catalogByCode[code]?.id || overrides[mapKey]?.seazonaProductId || null, arch, source, status }`, plus `notes` (reuse the compileNotes logic — export it from build-order-payload.js or recompute via buildSeazonaOrderPayload and read payload.notes), `warnings`, and `coverage {confirmed,placeholder,unmapped,total}`. Read-only.
- [ ] `GET /admin/rx-mapping/catalog?q=` → filtered catalog (name/code contains q, cap 50).
- [ ] `GET /admin/rx-mapping/overrides` → all rows.
- [ ] `PUT /admin/rx-mapping/override` `{ mapKey, seazonaCode, note? }` → find code in catalog (422 if absent), upsert by mapKey (`onConflictDoUpdate` on the unique map_key), set `confirmedBy = request.user.id`, return row.
- [ ] `DELETE /admin/rx-mapping/override/:mapKey` → delete, return `{ ok: true }`.
- [ ] Register `rxMappingRoutes` in `index.js` under `/api/v1`.
- [ ] **Verify:** boot API (fallback port), `GET /api/v1/admin/rx-mapping/devices` unauth → 401. `node --check`. Commit `feat(rx): admin rx-mapping preview + override API`.

## Task 5: admin frontend page

**Files:** Create `apps/web/src/pages/app/AdminRxMappingPage.jsx`; modify `routes.js`, `App.jsx`.

- [ ] **Step 1** — add route `ADMIN_RX_MAPPING: "/app/admin/rx-mapping"` to `routes.js`; register in `App.jsx` under the existing admin guard (find how AdminInvoicesPage/admin routes are guarded — reuse that wrapper).
- [ ] **Step 2** — `AdminRxMappingPage.jsx`:
  - On mount, `GET /admin/rx-mapping/devices` → device list with coverage badges.
  - Select a device → fetch its option schema. **Problem:** the schema lives in `apps/web/src/data/rx-devices.js` (frontend) — import `RX_DEVICES` directly here and find the selected device's `.options`; render `<DeviceOptionsPanel schema={device.options} values={opts} onChange={...} />`.
  - "Preview mapping" → `POST /admin/rx-mapping/preview { deviceKey, deviceOptions: opts }` → open a modal.
  - Modal: line-item table — each row colored by `status` (confirmed=green, placeholder=amber, unmapped=red) showing mapKey, name, code, resolved id, arch. Below: the `notes` block + coverage summary.
  - For placeholder/unmapped rows: an "Assign code" typeahead calling `GET /admin/rx-mapping/catalog?q=`; on pick → `PUT /override { mapKey, seazonaCode }` → on success, re-run preview (or patch the row to confirmed). Optional note field. "Clear" → `DELETE /override/:mapKey` → re-preview.
  - Reuse existing UI primitives/styling from AdminInvoicesPage (INPUT, modal pattern, status chips).
- [ ] **Step 3** — `pnpm --filter @my-app/web build` green; `node --test apps/web/src/data/*.test.js` no regression. Commit `feat(rx): admin Rx Mapping Tester page`.

## Self-review notes
- Override layer is the spine: Task 2/3 make the pure functions override-aware; Task 4 wires DB↔catalog; Task 5 is the UI. No Seazona writes anywhere; overrides are local DB only. Admin-guarded. mapKey scheme is consistent across resolve/unmapped/override.
