# Admin Rx Mapping Tester — Design Spec

**Date:** 2026-06-16
**Status:** Design (approved — proceeding without gates per user)
**Goal:** An admin-only screen to test how a filled Rx form maps to a Seazona order, preview it in a modal (no order created), and **confirm/save** the correct Seazona product code for any unmapped/placeholder line. Builds on the dry-run pipeline (`buildSeazonaOrderPayload` / `resolveLineItems` / `device-seazona-map.js`).

## Why
The device→Seazona code map has 9/60 slots confirmed; 51 are placeholders. This tool lets the lab/admin fill each device form, see exactly which Seazona line items result, and assign the correct code per gap — those confirmations persist and immediately feed the real payload builder. No Seazona writes; overrides save only to our DB.

## Core idea — override layer
- New table **`rx_code_overrides`**: `{ id, mapKey (unique), seazonaCode, seazonaProductId, seazonaName, note, confirmedBy, createdAt, updatedAt }`.
- **`mapKey`** is the stable id for a mapping slot:
  - primary line → `primary:<deviceKey>:<material|"default">`
  - modification → `mod:<modificationLabel>`
  - lab service → `lab:<serviceKey>`
- `resolveLineItems` is refactored to (a) attach a `mapKey` to every returned item AND every `unmapped` entry, and (b) accept an optional `overrides` map (`mapKey → {code,name}`). **Resolution order: DB override > file map default.** An override turns a previously-unmapped line into a resolved line.
- `buildSeazonaOrderPayload` gains an optional `overrides` arg, passed through to `resolveLineItems`. Both stay pure (overrides injected by the caller). Backward-compatible (default `{}`).

## API — `/api/v1/admin/rx-mapping/*` (preHandler: authenticate + requireAdmin)
All read-only against Seazona (only `listProducts`); override writes touch only our DB.
- `GET /devices` → `[{ deviceKey, name, category, coverage:{mapped,total} }]` (coverage from a representative resolution incl. overrides).
- `POST /preview` body `{ deviceKey, deviceOptions }` → `{ lines:[{ mapKey, code, name, seazonaProductId|null, arch, source, status }], notes, warnings, coverage }` where `status ∈ confirmed|placeholder|unmapped` (`confirmed` = override exists OR file code resolves to a real catalog id; `placeholder` = file code present but not a real catalog id; `unmapped` = no code at all).
- `GET /catalog?q=` → typeahead search over the live 392-product catalog `[{code,name,price}]` (cached in-process ~5 min).
- `GET /overrides` → all current overrides.
- `PUT /override` body `{ mapKey, seazonaCode, note? }` → look up code→{id,name} in the catalog (422 if code not found), upsert row, return it.
- `DELETE /override/:mapKey` → remove (revert to file default).

## Frontend — `apps/web/src/pages/app/AdminRxMappingPage.jsx` (admin-guarded route, e.g. `/app/admin/rx-mapping`)
- Device list with coverage badges (`DDSO — 1/1`).
- Select device → render the existing `DeviceOptionsPanel` for that device's schema; admin fills options.
- **Preview** button → `POST /preview` → modal: status-colored line-item table (green confirmed / amber placeholder / red unmapped), the compiled `notes` block, coverage summary.
- Each placeholder/unmapped row: an "Assign code" typeahead (`GET /catalog?q=`) → pick → Save (`PUT /override`) → row flips to confirmed live; optional note. A "Clear" reverts (`DELETE`).

## Data flow
admin fills device form → `POST /preview` (builds payload via resolveLineItems+overrides+catalog) → modal → admin assigns codes for gaps → `PUT /override` (DB) → re-preview reflects it. The same overrides now feed `buildSeazonaOrderPayload` everywhere (dry-run, future approve).

## Out of scope / constraints
- No order creation, no Seazona writes (overrides are local DB only).
- Admin-only.
- Does not change the dry-run gate or the live-push gate.

## Testing
- `node --test`: override-wins resolution + mapKey scheme in `resolveLineItems`; `buildSeazonaOrderPayload` honors overrides; route admin-guard (401/403) and preview/override shape.
- Web build green.

## Files
- `apps/api/src/db/schema/rx-code-overrides.js` (+ index export, migration 0008)
- `apps/api/src/services/rx/device-seazona-map.js` (mapKey + overrides arg) + test
- `apps/api/src/services/rx/build-order-payload.js` (overrides passthrough) + test
- `apps/api/src/routes/admin-rx-mapping.routes.js` (+ register in index.js)
- `apps/web/src/pages/app/AdminRxMappingPage.jsx`, `apps/web/src/config/routes.js`, `App.jsx` (admin-guarded route)
