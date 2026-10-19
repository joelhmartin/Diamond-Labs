# Shipping Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab staff buy and print UPS and FedEx labels from the order screen (or record a manual shipment), tracking lands on the order, the doctor sees it on My cases and gets one shipped email, and every carrier sits behind one adapter interface. No label, reference, log line or email carries patient data.

**Architecture:**
- **Generic layer** (knows nothing about lab orders): `packages/shared/src/shipping/` (vocabulary, statuses, presets, tracking URLs, request schemas) and `apps/api/src/services/shipping/` (errors, one HTTP helper, one OAuth token cache, carrier config, the adapter registry, three adapters, pure shipment rules, the shipments service, the tracking sync).
- **Lab glue** (`apps/api/src/services/lab/lab-shipping*.js`): which orders may ship together, the ship-to, linking orders to a shipment, the shipping-charge policy on the draft invoice, mark shipped, void, the shipped email.
- **Orders move through the existing status path.** `lab-orders.service.js` gains `mutateIn(tx, …)` (the body of `mutate`, so several orders change in one transaction) and every ship goes through `planStatusChange` + `billingFollowUp("shipped")`, so invoices are issued exactly as today.
- **Purchases are idempotent and never silently retried:** `withIdempotency` around Buy; a purchase that may have succeeded (timeout, network, 5xx, unreadable success) is `PURCHASE_UNCERTAIN` with `gatewayOutcomePending`, which keeps the key locked. A label whose DB write fails is voided at the carrier, or logged `[SHIP][LABEL_ORPHANED]`.
- **Polling, not webhooks:** job `shipping-tracking-sync` (Cloud Scheduler, ~2h) plus a per-shipment "Refresh tracking".

**Tech Stack:** Node 22 ESM (global `fetch`, `AbortSignal.timeout`), Fastify 5, Drizzle ORM 0.36 / drizzle-kit 0.30.6 (Postgres 15), Zod 3.23 (`@my-app/shared`), Vitest (+ `node:assert/strict`), React + Vite + React Router + Tailwind, axios (`apps/web/src/config/api.js`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-19-shipping-labels-design.md` (carrier facts: `docs/superpowers/specs/2026-10-19-carrier-api-research.md`; builds on `docs/superpowers/plans/2026-10-07-lab-orders-and-production.md` and `docs/superpowers/plans/2026-10-15-invoicing-and-ar.md`).

**Estimated size:** about **120 changed files** against `feat/own-the-lab`, counting the spec, the research note and this plan:
- **API + shared + docs** (Tasks 1–13 and 16): about 101 files.
- **Web** (Tasks 14–15): about 19 files.

That is under CodeRabbit's 150-file cap, so the user's batching rule applies: **one PR**. If the real count crosses ~140 (unplanned files), split along the seam above: PR A = Tasks 1–13 (+ docs), PR B = Tasks 14–15 stacked on A. Don't add unplanned files.

## Spec corrections

Each item is a load-bearing claim in the spec that is wrong or incomplete against the real code or the carrier facts. The plan builds the corrected version.

1. **The lab's name is hard-coded in more than two places.** Besides `invoice-model.js:64` and `statement-model.js:105` it appears in nine subjects and footers in `services/email.service.js`, the shop's Authorize.net description (`routes/checkout.routes.js:243`), the hosted-form `merchantName` (`services/authorizenet.service.js:325`) and the admin seed scripts. This piece adds `config/lab-identity.js`, switches the two PDF models (as the spec says) and makes the **new** shipped email read it. Switching the existing emails and payment descriptions is a one-line follow-up for the PR body, not this piece (scope guard).
2. **Nothing marks which invoice line a shipment added**, so "remove the shipping line it added" (Void, step 4) can't be done reliably by description. The plan adds `invoice_lines.shipment_id` (nullable) and a price source `shipment` (`PRICE_SOURCES`, label "Shipping label").
3. **A labelled order that leaves `ready_to_ship` strands its shipment.** Void needs every linked order at `ready_to_ship`, but today staff can put a labelled order on hold, cancel it, or send it back to QC. The plan adds one rule: **a labelled order can only move to `shipped`**; anything else is refused with "void the label first". It lives in `planStatusChange` (API) and in the shared `allowedNextStatuses(status, { labelled })` (board and order page), so the UI never offers a move the API refuses.
4. **"Mark shipped" acts on the shipment, not one order.** One box carries every order on the shipment, `shipments.shippedAt` is per shipment, and the spec wants **one** email listing all its order numbers. So Mark shipped on any labelled order moves every order on that shipment to `shipped` in one transaction and sends one email after commit.
5. **The existing status route would bypass all of that.** `POST /lab/orders/:id/status { to: "shipped" }` (the board's "→ Shipped" quick move) would ship one order, skip `shippedAt` and the email. The plan routes `to: "shipped"` through `markOrderShipped`, which falls back to the plain `changeStatus` for an unlabelled order (pick-up, hand delivery) and ships the whole box for a labelled one.
6. **"One transaction" across several orders needs a multi-order mutate.** `mutate(id, …)` opens its own transaction per order. The plan extracts its body into `mutateIn(tx, id, expectedVersion, plan)`; `mutate` becomes a one-line wrapper. `expectedVersion === null` means a system move (the conditional `UPDATE … WHERE version = <read version>` still prevents lost updates). Routes can never send `null`: the Zod schemas require a positive integer.
7. **Which draft gets the shipping line.** "The lowest-numbered order" can be a remake (a free draft) or a shop order (its invoice was issued and paid at checkout, shipping included). The plan puts the line on the **lowest-numbered non-remake Rx order**; shop orders and remakes never carry it. Only when that draft is no longer a draft does a lab order note record why nothing was added.
8. **A manual shipment has nowhere to keep the carrier name staff type.** It goes in `serviceName` (`serviceCode = "manual"`). Its tracking number is optional (a hand delivery has none), and the shipped email is sent only when a tracking number exists. A manual shipment moves to `in_transit` when staff mark it shipped (staff event); the tracking sync never polls it.
9. **Purchase uncertainty is wider than timeouts.** A network error, a 5xx, or a 2xx whose body can't be parsed may also mean the label exists. All of them are `PURCHASE_UNCERTAIN`. A 4xx is a definite refusal and the key is released for a corrected retry.
10. **The fixtures can't be "recorded" yet.** No sandbox credentials exist. UPS fixtures are built from UPS's official OpenAPI specs (`Shipping.yaml`, `Rating.yaml`, `Tracking.yaml`); FedEx fixtures follow the research note's field names, several marked `[MEM]`. The sandbox smoke script is what proves them. Go-live step 3 replaces any fixture the sandbox contradicts, and fixes the parser in the same commit.
11. **Adapters are built from a config object, not handed `env` per call.** `createUpsAdapter({ config, fetchImpl, tokenCache })` returns the spec's interface, and `configured()` takes no argument. Tests inject config and a fake `fetch`; `carrierRegistry()` builds the real ones once from `env`. `registry.status()` is the spec's `enabledCarriers(env)`.
12. **The smoke script lives in `apps/api/scripts/carrier-sandbox-smoke.js`**, not the root `scripts/`. It imports the API's adapters and needs `apps/api/.env` (`pnpm --filter @my-app/api carriers:smoke`).
13. **Staging must never buy a real label.** `config/app-env.js` gains `effectiveCarrierEnv(env)`: always `sandbox` under `APP_ENV=staging`. This is the same pattern as `effectiveGatewayMode` for Authorize.net.
14. **"Admin › Shipments" must be reachable by lab staff.** Lab users buy, void and print, and the uncertain-purchase message tells them to check that page. It is `/admin/shipments` under `RequireStaff` (the precedent is `/admin/rx-cases`), listed in the sidebar's **Lab** section. The API is `/lab/shipments*` behind `STAFF`.
15. **FedEx needs a recipient phone** (a required Ship input [MEM]). Doctor profiles and shop orders can lack one. The FedEx request falls back to the lab's `LAB_PHONE`. UPS gets the phone only when present.
16. **Doctors see tracking only once the order is shipped.** A label bought on Monday can still be voided on Tuesday. `doctorCaseView` shows `tracking` only for a `shipped` lab order with a non-voided shipment.
17. **Ship-to for Rx orders reuses `loadClient`** (`services/billing/statements.service.js`), the existing "doctor plus profile" loader. It gains `phone`, `deliveryMethod` and `deliveryNotes`, and no second loader is written.

## Global Constraints

- All work happens in the worktree `/Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-3` on branch `feat/own-the-lab-4-shipping`. Never `cd` to the main checkout; other agents work there.
- Push only with `git push origin feat/own-the-lab-4-shipping`, never a bare `git push` (`push.default=matching` would push local `main`).
- **No Seazona API calls** from code, tests, scripts or a dev server. Nothing in this piece touches `seazona.service.js`; `services/seazona-access.test.js` and both `seazona-*-retired` route tests must keep passing.
- **No real carrier calls from tests.** Every adapter test uses fixtures (`apps/api/test-fixtures/carriers/`) and an injected `fetchImpl`. The only code that reaches a carrier is `apps/api/scripts/carrier-sandbox-smoke.js`. It is run by hand, refuses to run unless the effective carrier environment is `sandbox`, and is never in CI (it isn't a `*.test.js`).
- **No PHI anywhere in shipping.**
  - Labels, carrier `reference` fields, invoice line descriptions, lab order event notes, shipment events, audit metadata, log lines and the shipped email carry **order numbers, carrier, service and tracking number only**. They never carry a patient name, device, Rx text or case notes.
  - Logs name ids, carrier, codes and HTTP status. They never contain request or response bodies, addresses or credentials.
- **Money is integer cents** (`@my-app/shared` money: `toCents`, `formatCents`, `assertCents`). A carrier's dollars become cents once, in its `*-responses.js` parser.
- **No native `alert()` / `confirm()` / `prompt()`.**
  - Void and "Mark all labelled shipped" use the existing two-click `components/ui/ConfirmButton.jsx`.
  - The Ship form is a `components/ui/Modal.jsx`; feedback goes through `useToast`.
  - `window.print()` on the label page is the browser's print dialog, which is the point of that page, not a confirm.
- **No DB foreign keys** (repo convention). Ids are cuid2 via `createId()` from `apps/api/src/lib/id.js`, `varchar(128)`.
- **Migrations come only from `cd apps/api && pnpm db:generate`.** Expect exactly one: `0031_<random>.sql` (plus `meta/0031_snapshot.json` and `_journal.json`). Never hand-number or edit a generated migration.
- **Staging scrub:** every new column is classified in `apps/api/src/db/scrub/plan.js` and `COLUMNS.md`; `plan.test.js` fails otherwise.
- **New env vars are documented in `.env.example`** in the same task that adds them to `config/env.js`.
- **Source files stay under 1,000 lines; functions under 150; a React component under 300 including its markup** (excluding blanks, comments and tests). Split along a real seam (a handler, a sub-component, a step).
  - Every function in this plan's code blocks was checked against this limit. The largest are `ShipModal` (~150, a component), `ShipmentsPage` (~140, a component), `buyForOrders` + `persistShipment` (~25 and ~25), and `syncTracking` (~55).
  - `LabOrderDetailPage` is already ~345 lines, which is over the component limit before this piece. This piece adds only ~8 lines to it, and the Shipping panel is its own component. Splitting the page (Status/Work/Notes panels into components) is a follow-up for the PR body.
- **One implementation per job.** Reuse, never copy:
  - `withIdempotency` / `ChargeInProgressError` (`lib/payment-helpers.js`) and the web's `useAttemptKey` / `createAttemptKey`;
  - `mutate` → `mutateIn`, `planStatusChange`, `billingFollowUp`, `assertFresh`, `labErrorReply`, and `STAFF` (`routes/lab.routes.js`);
  - `loadClient`, `auditService.log` / `logSafe`, `deliver` / `esc` / `headerSafe` (email), `handlerSource` (route tests), `fakeTx` / `fakeDb` (`src/test/fake-tx.js`);
  - `formatCents` / `toCents`, `formatUsDate` / `formatLabDate`, `ConfirmButton`, `Modal`, `useToast`, and `errorText` / `blobErrorText` / `isStale` (`lib/requests.js`).
  New shared things get an obvious home and a general name: one OAuth token cache for both carriers, one carrier HTTP helper, one tracking-URL builder.
- **Tests:** Vitest. New files import `{ test } from "vitest"` and `assert from "node:assert/strict"`. Existing `describe/it/expect` files keep their style. There is no DB harness:
  - rules live in pure helpers and are tested there;
  - services are tested against `fakeTx` / `fakeDb` and injected fakes (registry, fetch);
  - route wiring is pinned by source inspection (`handlerSource`).
- **Roles:**
  - `lab` and `admin` (`STAFF_ROLES`) can rate, buy, print, void, mark shipped, refresh tracking and see the Shipments page and its carrier status. They see a shipment's `chargeCents` in the form and the list, never invoice totals.
  - Billing routes stay admin-only.
  - Doctors see only `tracking` on My cases.
- **Verification bar for every task:**
  - `pnpm test` at the repo root passes.
  - `pnpm --filter @my-app/web build` succeeds.
  - After the schema task, `cd apps/api && pnpm db:generate` prints "No schema changes".
- **Commits:** messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, or with the model that actually did the work. Subagents run on Sonnet at minimum, never Haiku.

## Sequencing

- **Base.** `feat/own-the-lab-4-shipping` was cut from `origin/feat/own-the-lab` with pieces 1–3 merged. The spec commit (`38ec8eb`) is already on it.
- **PR.** One PR into `feat/own-the-lab` (see Estimated size). Merging there deploys **staging only** (`deploy-staging-on-own-the-lab`). Nothing ships to production from this branch.
- **Mid-branch states.** The branch is never deployed between tasks. From Task 3 the new columns exist but nothing writes them until Task 11. The routes appear in Task 12 and the web in Tasks 14–15. Tests pass at every task.
- **The one business decision** (`SHIPPING_CHARGE_POLICY`) ships as `none`. Put the three options in the PR body for the lab to choose from.

## Review Focus

These are the five input classes most likely to bite a real user, each pinned to a test in the task that owns it:

1. **A labelled order moved anywhere but `shipped`** (hold, cancel, back to QC, from the board or the order page). It must be refused with "void the label first", and the board must offer only "→ Shipped". Pinned by the shared `allowedNextStatuses({ labelled })` test and the `planStatusChange` label-guard test in **Task 9**, and the web `quickMoves` labelled test in **Task 14**.
2. **Buy clicked twice, retried, or timing out at the carrier.** At most one label is bought. A possibly-bought label keeps its idempotency key locked and tells staff to check Shipments before retrying; a definite 4xx releases it. Pinned by:
   - the `carrierRequest` uncertain test (timeout, network, 5xx, purchase-only) in **Task 4**;
   - the `buyLabel` PURCHASE_UNCERTAIN/`gatewayOutcomePending` test in **Task 7**;
   - the Buy route source test (key required, `withIdempotency`) in **Task 12**;
   - the `buySignature` same-box-same-key test in **Task 14**.
3. **Two people labelling the same order, or an order changing between the check and the save.** The save fails, the just-bought label is voided at the carrier, and a failed void logs `[SHIP][LABEL_ORPHANED]` with ids only. Pinned by the `purchaseAndPersist` tests in **Task 7**, the `planShipmentLink` conflict test in **Task 9**, and the `buyForOrders` conflict test in **Task 11**.
4. **Real-world addresses.** This covers a doctor with no profile address, a guest shop order, ZIP+4, a lowercase state, a missing phone (FedEx falls back to the lab phone), and lines longer than the carriers' 35 characters. Pinned by the schema tests in **Task 1**, the UPS/FedEx request-builder tests in **Tasks 5–6**, and the `shipToFromClient` / `shipToFromShopOrder` tests in **Task 11**.
5. **Tracking oddities.** These are an unknown carrier code, one number erroring inside a batch, a stale "in transit" arriving after "delivered" (terminal never regresses), and a moving shipment whose orders never got marked shipped (the next sync heals it). Pinned by the `planTrackingUpdate` tests in **Task 7** and the `syncTracking` tests in **Task 13**.

---

## File Structure

**Shared (`packages/shared/src`)**
- New:
  - `shipping/shipping.js` (+ `shipping.test.js`): carriers, statuses, movement/terminal sets, label formats, parcel presets, `weightLbFromOz`, `trackingUrl`, `carrierName`.
  - `schemas/shipping.schema.js` (+ test): address, parcel, rates/buy bodies, list query.
- Modified:
  - `index.js`.
  - `lab/lab-order-status.js` (+ test): `allowedNextStatuses({ labelled })`, `doctorTracking`, `doctorCaseView.tracking`.
  - `billing/billing.js`: price source `shipment`.

**API (`apps/api/src`)**
- New:
  - `config/lab-identity.js` (+ test), `config/env.shipping.test.js`.
  - `db/schema/shipments.js` (+ `shipments.test.js`).
  - `services/shipping/` (the generic layer):
    - `shipping-errors.js`, `carrier-http.js` (+ test), `oauth-token-cache.js` (+ test), `carrier-config.js`, `carrier-registry.js` (+ test);
    - `shipment-rules.js` (+ test), `shipments.service.js` (+ test), `tracking-sync.service.js` (+ test).
  - `services/shipping/carriers/`:
    - `manual.adapter.js`, `adapter-contract.test.js`, `carrier-status.js` (+ test);
    - `ups-requests.js`, `ups-responses.js`, `ups.adapter.js` (each + test);
    - `fedex-requests.js`, `fedex-responses.js`, `fedex.adapter.js` (each + test).
  - `services/lab/`: `lab-shipping-rules.js` (+ test), `lab-shipping-queries.js`, `lab-shipping.service.js` (+ test).
  - `routes/shipping.routes.js`, `routes/__tests__/shipping-routes.test.js`.
  - `jobs/definitions/shipping-tracking-sync.job.js`.
  - `services/email-shipping.test.js`, `test/carrier-config.js` (a test helper).
- Modified:
  - `config/env.js`, `config/app-env.js` (+ test).
  - `db/schema/lab-orders.js`, `db/schema/invoices.js`, `db/schema/index.js`.
  - `db/scrub/plan.js`, `plan.test.js`, `COLUMNS.md`.
  - `services/billing/invoice-rules.js` (+ test), `invoices.service.js` (+ test), `invoice-actions.service.js`, `invoice-model.js` (+ test), `statement-model.js`, `statements.service.js` (+ test).
  - `services/lab/lab-order-rules.js` (+ test), `lab-orders.service.js` (+ test).
  - `services/email.service.js`.
  - `routes/lab.routes.js`, `routes/__tests__/lab-routes.test.js`, `index.js`.
  - `jobs/definitions/index.js`.
- Generated: `db/migrations/0031_*.sql`, `meta/0031_snapshot.json`, `meta/_journal.json`.
- Fixtures (new): `apps/api/test-fixtures/carriers/ups/{rate,ship,void,track,error}.json` and `apps/api/test-fixtures/carriers/fedex/{rate,ship,cancel,track,error}.json`.
- Script (new): `apps/api/scripts/carrier-sandbox-smoke.js`; `apps/api/package.json` gains `carriers:smoke`.

**Web (`apps/web/src`)**
- New:
  - `lib/shipping.js` (+ `lib/__tests__/shipping.test.js`).
  - `components/lab/ShippingPanel.jsx`, `ShipModal.jsx`, `ShipToFields.jsx`, `ParcelFields.jsx`, `RateChooser.jsx`, `CarriersPanel.jsx`.
  - `pages/lab/ShipmentLabelPrintPage.jsx`, `pages/lab/ShipmentsPage.jsx`.
- Modified:
  - `lib/lab-board.js` (+ test).
  - `pages/lab/LabOrderDetailPage.jsx`, `pages/lab/LabBoardPage.jsx`, `pages/doctor/MyCasesPage.jsx`.
  - `config/routes.js` (+ test), `App.jsx`, `components/layout/Sidebar.jsx`.

**Root:** `.env.example`, `docs/shipping-operations.md` (new; the go-live runbook), this plan.

## Task order

| # | Task |
|---|---|
| 1 | Shared shipping vocabulary, presets, tracking URLs and request schemas |
| 2 | Lab identity, shipping env vars, staging carrier guard; PDF models read the lab name |
| 3 | Schema: `shipments`, `shipment_events`, `lab_orders.shipment_id`, `invoice_lines.shipment_id`; migration 0031; scrub |
| 4 | Carrier core: errors, HTTP helper, OAuth token cache, config, registry, manual adapter, contract test |
| 5 | UPS adapter: requests, responses, status table, fixtures |
| 6 | FedEx adapter: requests, responses, status table, fixtures |
| 7 | Generic shipments service: rate-all, buy (uncertain), purchase-and-persist (orphan void), void, stamp shipped, tracking rules |
| 8 | Invoice shipment lines: add/remove a shipping line on a draft |
| 9 | Lab orders know about labels: `mutateIn`, label guard on status moves, link/unlink plans, board flag, detail block |
| 10 | Shipped email; doctor tracking on My cases |
| 11 | Lab shipping glue: shippable checks, ship-to, charge policy, buy, void, mark shipped, ship context, list |
| 12 | Routes: `/lab/shipments*`, ship context, carriers; status route ships the whole box |
| 13 | Tracking sync job and per-shipment refresh |
| 14 | Web: Ship form, Shipping panel, board label badge, timeline |
| 15 | Web: label print page, Shipments page, carriers panel, My cases tracking, nav |
| 16 | Sandbox smoke script, go-live runbook, whole-piece verification and PR |

---
### Task 1: Shared shipping vocabulary, presets, tracking URLs and request schemas

**Files:**
- Create: `packages/shared/src/shipping/shipping.js`, `packages/shared/src/shipping/shipping.test.js`, `packages/shared/src/schemas/shipping.schema.js`, `packages/shared/src/schemas/shipping.schema.test.js`
- Modify: `packages/shared/src/index.js`

**Interfaces:**
- Produces (from `@my-app/shared`):
  - `CARRIERS` (`["ups","fedex","manual"]`) and `CARRIER_LABELS`.
  - Statuses: `SHIPMENT_STATUSES`, `SHIPMENT_STATUS_LABELS`, `TERMINAL_SHIPMENT_STATUSES`, `isTerminalShipmentStatus(s)`, `MOVEMENT_STATUSES`, `isShipmentMovement(s)`.
  - Labels: `LABEL_FORMATS`, `LABEL_CONTENT_TYPES`, `isImageLabel(f)`.
  - Parcels: `PARCEL_PRESETS` (`{ key, label, lengthIn, widthIn, heightIn, weightOz }`), `PARCEL_PRESET_KEYS`, `parcelPreset(key)`.
  - Helpers: `weightLbFromOz(oz) → number`, `trackingUrl(carrier, trackingNumber) → string|null`, `carrierName({ carrier, serviceName }) → string`.
  - Schemas: `shippingAddressSchema`, `parcelSchema`, `shipmentRatesSchema` (`{ shipTo, parcel }`), `shipmentBuySchema` (`{ orderIds, shipTo, parcel, carrier, serviceCode?, manual? }`), `shipmentListQuerySchema` (`{ status?, carrier?, from?, to? }`), `MAX_ORDERS_PER_SHIPMENT` (20).
- An **Address** is `{ name, company?, phone?, address1, address2?, city, state, postalCode, country: "US", residential? }`. A **Parcel** is `{ preset?, weightOz, lengthIn, widthIn, heightIn }`. Every later task uses these two shapes.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/shipping/shipping.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CARRIERS, CARRIER_LABELS, SHIPMENT_STATUSES, TERMINAL_SHIPMENT_STATUSES, isTerminalShipmentStatus, isShipmentMovement,
  PARCEL_PRESETS, PARCEL_PRESET_KEYS, parcelPreset, weightLbFromOz, trackingUrl, carrierName, LABEL_CONTENT_TYPES, isImageLabel,
} from "./shipping.js";

test("three carriers, each with a label; manual is always one of them", () => {
  assert.deepEqual(CARRIERS, ["ups", "fedex", "manual"]);
  for (const c of CARRIERS) assert.equal(typeof CARRIER_LABELS[c], "string");
});

test("terminal statuses stop polling; movement means the carrier has the box", () => {
  assert.deepEqual(TERMINAL_SHIPMENT_STATUSES, ["delivered", "returned", "voided"]);
  assert.ok(TERMINAL_SHIPMENT_STATUSES.every((s) => SHIPMENT_STATUSES.includes(s)));
  assert.equal(isTerminalShipmentStatus("in_transit"), false);
  for (const s of ["in_transit", "out_for_delivery", "delivered"]) assert.equal(isShipmentMovement(s), true, s);
  for (const s of ["label_created", "exception", "returned", "voided"]) assert.equal(isShipmentMovement(s), false, s);
});

test("weights round UP to a tenth of a pound and never go below 0.1 lb", () => {
  assert.equal(weightLbFromOz(1), 0.1);
  assert.equal(weightLbFromOz(16), 1);
  assert.equal(weightLbFromOz(17), 1.1);
  assert.equal(weightLbFromOz(40), 2.5);
  assert.throws(() => weightLbFromOz(0), RangeError);
  assert.throws(() => weightLbFromOz(1.5), RangeError);
});

test("presets have unique keys; every non-custom preset has real dimensions and a weight", () => {
  assert.equal(new Set(PARCEL_PRESET_KEYS).size, PARCEL_PRESETS.length);
  assert.ok(PARCEL_PRESET_KEYS.includes("custom"));
  for (const p of PARCEL_PRESETS.filter((x) => x.key !== "custom")) {
    for (const k of ["lengthIn", "widthIn", "heightIn", "weightOz"]) assert.ok(p[k] > 0, `${p.key}.${k}`);
  }
  assert.equal(parcelPreset("nope"), null);
});

test("tracking links exist for UPS and FedEx only, and only for a plausible number", () => {
  assert.equal(trackingUrl("ups", "1Z999AA10123456784"), "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784");
  assert.equal(trackingUrl("fedex", "794644790138"), "https://www.fedex.com/fedextrack/?trknbr=794644790138");
  assert.equal(trackingUrl("manual", "ABC123456"), null);
  assert.equal(trackingUrl("ups", "<script>"), null);
  assert.equal(trackingUrl("ups", null), null);
});

test("a manual shipment is named by what staff typed", () => {
  assert.equal(carrierName({ carrier: "ups" }), "UPS");
  assert.equal(carrierName({ carrier: "manual", serviceName: "Lone Star Courier" }), "Lone Star Courier");
  assert.equal(carrierName({ carrier: "manual" }), "Manual");
});

test("label formats map to a content type; GIF and PNG are images, ZPL is a printer file", () => {
  assert.equal(LABEL_CONTENT_TYPES.gif, "image/gif");
  assert.equal(LABEL_CONTENT_TYPES.png, "image/png");
  assert.equal(isImageLabel("zpl"), false);
  assert.equal(isImageLabel("png"), true);
});
```

`packages/shared/src/schemas/shipping.schema.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  shippingAddressSchema, parcelSchema, shipmentRatesSchema, shipmentBuySchema, shipmentListQuerySchema,
} from "./shipping.schema.js";

const addr = {
  name: "Dr. Ada Smile", company: "Smile Dental", phone: "(210) 555-0100",
  address1: "100 Main St", city: "San Antonio", state: "tx", postalCode: "78205-1234",
};
const parcel = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };

test("an address normalises the state, accepts ZIP+4 and defaults to the US", () => {
  const a = shippingAddressSchema.parse(addr);
  assert.equal(a.state, "TX");
  assert.equal(a.postalCode, "78205-1234");
  assert.equal(a.country, "US");
});

test("addresses a carrier would reject are refused here first", () => {
  for (const bad of [
    { postalCode: "7820" }, { state: "Texas" }, { address1: "" }, { address1: "x".repeat(36) },
    { city: "" }, { name: "   " }, { phone: "call me" },
  ]) {
    assert.equal(shippingAddressSchema.safeParse({ ...addr, ...bad }).success, false, JSON.stringify(bad));
  }
});

test("blank optional lines become null, so the request builders can drop them", () => {
  const a = shippingAddressSchema.parse({ ...addr, company: "", address2: "  ", phone: "" });
  assert.equal(a.company, null);
  assert.equal(a.address2, null);
  assert.equal(a.phone, null);
});

test("a parcel needs whole ounces within the carriers' limits and real dimensions", () => {
  assert.equal(parcelSchema.safeParse(parcel).success, true);
  for (const bad of [{ weightOz: 0 }, { weightOz: 2401 }, { weightOz: 1.5 }, { lengthIn: 0 }, { heightIn: 109 }, { preset: "crate" }]) {
    assert.equal(parcelSchema.safeParse({ ...parcel, ...bad }).success, false, JSON.stringify(bad));
  }
});

test("rates need only the ship-to and the parcel", () => {
  assert.equal(shipmentRatesSchema.safeParse({ shipTo: addr, parcel }).success, true);
});

test("buy: a carrier label needs a service; a manual one needs the carrier's name", () => {
  const base = { orderIds: ["lo1"], shipTo: addr, parcel };
  assert.equal(shipmentBuySchema.safeParse({ ...base, carrier: "ups", serviceCode: "03" }).success, true);
  assert.equal(shipmentBuySchema.safeParse({ ...base, carrier: "ups" }).success, false);
  assert.equal(shipmentBuySchema.safeParse({ ...base, carrier: "manual" }).success, false);
  const manual = shipmentBuySchema.parse({ ...base, carrier: "manual", manual: { carrierName: "Courier" } });
  assert.equal(manual.manual.trackingNumber, null, "a hand delivery has no tracking number");
});

test("buy: one to twenty distinct orders", () => {
  const base = { shipTo: addr, parcel, carrier: "ups", serviceCode: "03" };
  assert.equal(shipmentBuySchema.safeParse({ ...base, orderIds: [] }).success, false);
  assert.equal(shipmentBuySchema.safeParse({ ...base, orderIds: ["a", "a"] }).success, false);
  assert.equal(shipmentBuySchema.safeParse({ ...base, orderIds: Array.from({ length: 21 }, (_, i) => `o${i}`) }).success, false);
});

test("the shipments list filters by status, carrier and date range", () => {
  assert.deepEqual(shipmentListQuerySchema.parse({ status: "in_transit", carrier: "fedex", from: "2026-10-01" }), {
    status: "in_transit", carrier: "fedex", from: "2026-10-01",
  });
  assert.equal(shipmentListQuerySchema.safeParse({ status: "lost" }).success, false);
  assert.equal(shipmentListQuerySchema.safeParse({ from: "10/01/2026" }).success, false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/shipping/shipping.test.js src/schemas/shipping.schema.test.js`
Expected: FAIL with "Failed to load url ./shipping.js" / "./shipping.schema.js".

- [ ] **Step 3: Write the vocabulary**

`packages/shared/src/shipping/shipping.js`:

```js
/**
 * Shipping vocabulary shared by the API and the web: carriers, the normalised
 * shipment statuses, label formats, parcel presets and the tracking-URL
 * builder. Nothing here knows about lab orders, so another site can reuse it.
 * Carrier code tables (a UPS/FedEx code → one of these statuses) live in the
 * API: apps/api/src/services/shipping/carriers/carrier-status.js.
 */
export const CARRIERS = ["ups", "fedex", "manual"];
export const CARRIER_LABELS = { ups: "UPS", fedex: "FedEx", manual: "Manual" };

export const SHIPMENT_STATUSES = [
  "label_created", "in_transit", "out_for_delivery", "delivered", "exception", "returned", "voided",
];
export const SHIPMENT_STATUS_LABELS = {
  label_created: "Label created",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Exception",
  returned: "Returned",
  voided: "Voided",
};

/** No further carrier change is possible: the tracking sync stops polling these. */
export const TERMINAL_SHIPMENT_STATUSES = ["delivered", "returned", "voided"];
export const isTerminalShipmentStatus = (s) => TERMINAL_SHIPMENT_STATUSES.includes(s);

/** The carrier has the box. The first of these marks the shipment's orders shipped. */
export const MOVEMENT_STATUSES = ["in_transit", "out_for_delivery", "delivered"];
export const isShipmentMovement = (s) => MOVEMENT_STATUSES.includes(s);

export const LABEL_FORMATS = ["gif", "png", "zpl"];
export const LABEL_CONTENT_TYPES = { gif: "image/gif", png: "image/png", zpl: "application/octet-stream" };
export const isImageLabel = (f) => f === "gif" || f === "png";

/**
 * The boxes the lab packs into. Placeholder sizes until the lab confirms its
 * stock; changing them is a one-line edit here (the web form and the API read
 * the same list).
 */
export const PARCEL_PRESETS = [
  { key: "mailer", label: "Padded mailer (10 × 7 × 2 in)", lengthIn: 10, widthIn: 7, heightIn: 2, weightOz: 8 },
  { key: "small_box", label: "Small box (8 × 6 × 4 in)", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 16 },
  { key: "medium_box", label: "Medium box (12 × 10 × 6 in)", lengthIn: 12, widthIn: 10, heightIn: 6, weightOz: 32 },
  { key: "custom", label: "Custom size", lengthIn: null, widthIn: null, heightIn: null, weightOz: null },
];
export const PARCEL_PRESET_KEYS = PARCEL_PRESETS.map((p) => p.key);
export const parcelPreset = (key) => PARCEL_PRESETS.find((p) => p.key === key) ?? null;

/** Whole ounces → pounds for a carrier request: rounded UP to 0.1 lb, never below 0.1 lb. */
export function weightLbFromOz(oz) {
  if (!Number.isInteger(oz) || oz < 1) throw new RangeError(`weightOz must be a positive whole number, got ${oz}`);
  return Math.max(1, Math.ceil((oz * 10) / 16)) / 10;
}

const TRACKING_PAGES = {
  ups: (n) => `https://www.ups.com/track?loc=en_US&tracknum=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
};

/** The carrier's public tracking page, or null (manual carriers, a missing or implausible number). */
export function trackingUrl(carrier, trackingNumber) {
  const n = String(trackingNumber ?? "").trim();
  const page = TRACKING_PAGES[carrier];
  if (!page || !/^[A-Za-z0-9]{6,40}$/.test(n)) return null;
  return page(n);
}

/** What a person calls the carrier: "UPS", "FedEx", or what staff typed for a manual shipment. */
export function carrierName({ carrier, serviceName } = {}) {
  if (carrier === "manual") return serviceName || CARRIER_LABELS.manual;
  return CARRIER_LABELS[carrier] ?? carrier ?? "—";
}
```

- [ ] **Step 4: Write the schemas**

`packages/shared/src/schemas/shipping.schema.js`:

```js
import { z } from "zod";
import { CARRIERS, SHIPMENT_STATUSES, PARCEL_PRESET_KEYS } from "../shipping/shipping.js";

/**
 * Shipping request bodies. Address limits are the carriers' own (UPS and
 * FedEx both cap a street line and a name at 35 characters, UPS a city at 30),
 * so a bad address is refused here with a message staff can act on, before
 * any carrier is called.
 */
export const MAX_ORDERS_PER_SHIPMENT = 20;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const id = z.string().min(1).max(128);
const required = (max, message) => z.string().trim().min(1, message).max(max, `Keep it to ${max} characters.`);
/** "" or whitespace → null; otherwise trimmed and capped. */
const optional = (max) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max, `Keep it to ${max} characters.`).nullable().optional(),
  );

export const shippingAddressSchema = z.object({
  name: required(35, "A name is required."),
  company: optional(35),
  phone: optional(20).refine((v) => v == null || /^[0-9()+\-.\s]{7,20}$/.test(v), "Use a phone number."),
  address1: required(35, "A street address is required."),
  address2: optional(35),
  city: required(30, "A city is required."),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter state code."),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP (or ZIP+4)."),
  country: z.literal("US").default("US"),
  residential: z.boolean().optional(),
});

const inches = z.number().positive("Must be more than 0.").max(108, "UPS and FedEx take at most 108 in.");

export const parcelSchema = z.object({
  preset: z.enum(PARCEL_PRESET_KEYS).optional(),
  weightOz: z.number().int("Use whole ounces.").min(1, "Weigh the box.").max(2400, "150 lb is the carriers' limit."),
  lengthIn: inches,
  widthIn: inches,
  heightIn: inches,
});

export const shipmentRatesSchema = z.object({ shipTo: shippingAddressSchema, parcel: parcelSchema });

export const shipmentBuySchema = z
  .object({
    orderIds: z.array(id).min(1, "Pick at least one order.").max(MAX_ORDERS_PER_SHIPMENT, `At most ${MAX_ORDERS_PER_SHIPMENT} orders per box.`),
    shipTo: shippingAddressSchema,
    parcel: parcelSchema,
    carrier: z.enum(CARRIERS),
    serviceCode: z.string().trim().min(1).max(40).optional(),
    manual: z
      .object({
        carrierName: required(40, "Type the carrier's name."),
        trackingNumber: optional(40).transform((v) => v ?? null),
      })
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (new Set(b.orderIds).size !== b.orderIds.length) ctx.addIssue({ code: "custom", path: ["orderIds"], message: "An order appears twice." });
    if (b.carrier === "manual" && !b.manual) ctx.addIssue({ code: "custom", path: ["manual"], message: "Type the carrier's name." });
    if (b.carrier !== "manual" && !b.serviceCode) ctx.addIssue({ code: "custom", path: ["serviceCode"], message: "Pick a service." });
  });

export const shipmentListQuerySchema = z.object({
  status: z.enum(SHIPMENT_STATUSES).optional(),
  carrier: z.enum(CARRIERS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
```

In `packages/shared/src/index.js`, append after the Billing block:

```js

// Shipping
export * from "./shipping/shipping.js";
export * from "./schemas/shipping.schema.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/shared && pnpm vitest run src/shipping/shipping.test.js src/schemas/shipping.schema.test.js`
Expected: PASS (15 tests).

Run: `pnpm test` (repo root)
Expected: PASS. Nothing else imports the new names yet.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/shipping packages/shared/src/schemas/shipping.schema.js packages/shared/src/schemas/shipping.schema.test.js packages/shared/src/index.js
git commit -m "feat(shared): shipping vocabulary, parcel presets, tracking URLs and request schemas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lab identity, shipping env vars, staging carrier guard; PDF models read the lab name

**Files:**
- Create: `apps/api/src/config/lab-identity.js`, `apps/api/src/config/lab-identity.test.js`, `apps/api/src/config/env.shipping.test.js`
- Modify: `apps/api/src/config/env.js` (after the `INVOICE_TERMS_DAYS` line), `apps/api/src/config/app-env.js` (after `effectiveGatewayMode`), `apps/api/src/config/app-env.test.js:5`, `apps/api/src/services/billing/invoice-model.js:32,64`, `apps/api/src/services/billing/invoice-model.test.js`, `apps/api/src/services/billing/statement-model.js:68,105`, `.env.example`

**Interfaces:**
- Produces:
  - `labIdentity(source = env) → { name, phone, address: Address|null, missing: string[] }` (`config/lab-identity.js`), and `DEFAULT_LAB_NAME`.
  - `effectiveCarrierEnv(env) → "sandbox"|"production"` (`config/app-env.js`).
  - `env.*`:
    - `LAB_NAME` (optional; blank falls back to the default name), `LAB_PHONE`, `LAB_ADDRESS_LINE1`, `LAB_ADDRESS_LINE2`, `LAB_CITY`, `LAB_STATE`, `LAB_ZIP`;
    - `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, `FEDEX_ACCOUNT_NUMBER`;
    - `CARRIER_ENV` (`sandbox` default), `LABEL_FORMAT` (`image` default);
    - `SHIPPING_CHARGE_POLICY` (`none` default), `SHIPPING_FLAT_CENTS` (0), `SHIPPED_EMAIL_ENABLED` (boolean, default `true`).
  - `buildInvoiceModel(…, { generatedAt, labName })` and `buildStatementModel(…, { generatedAt, labName })`. `labName` defaults to `labIdentity().name`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/config/lab-identity.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { labIdentity, DEFAULT_LAB_NAME } from "./lab-identity.js";

const FULL = {
  LAB_NAME: "Diamond Orthotic Laboratory", LAB_PHONE: "210-555-0199", LAB_ADDRESS_LINE1: "1 Lab Way", LAB_ADDRESS_LINE2: "",
  LAB_CITY: "San Antonio", LAB_STATE: "tx", LAB_ZIP: "78205",
};

test("the lab's name has one default and one override", () => {
  assert.equal(labIdentity({}).name, DEFAULT_LAB_NAME);
  assert.equal(DEFAULT_LAB_NAME, "Diamond Orthotic Laboratory");
  assert.equal(labIdentity({ LAB_NAME: "  Acme Lab " }).name, "Acme Lab");
});

test("the ship-from exists only when every required LAB_* value is set, and says which are missing", () => {
  const partial = labIdentity({ ...FULL, LAB_CITY: " ", LAB_PHONE: undefined });
  assert.equal(partial.address, null);
  assert.deepEqual(partial.missing, ["LAB_CITY", "LAB_PHONE"]);
  const full = labIdentity(FULL);
  assert.deepEqual(full.missing, []);
  assert.deepEqual(full.address, {
    name: "Diamond Orthotic Laboratory", company: "Diamond Orthotic Laboratory", phone: "210-555-0199",
    address1: "1 Lab Way", address2: null, city: "San Antonio", state: "TX", postalCode: "78205", country: "US",
  });
});
```

`apps/api/src/config/env.shipping.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

test("carriers default to the sandbox and image labels", () => {
  assert.equal(env.CARRIER_ENV, "sandbox");
  assert.equal(env.LABEL_FORMAT, "image");
});

test("shipping is not billed until the lab decides (the one business decision)", () => {
  assert.equal(env.SHIPPING_CHARGE_POLICY, "none");
  assert.equal(env.SHIPPING_FLAT_CENTS, 0);
});

test("the shipped email is on by default", () => {
  assert.equal(env.SHIPPED_EMAIL_ENABLED, true);
});
```

In `apps/api/src/config/app-env.test.js`, change the import on line 5 to add `effectiveCarrierEnv`:

```js
import { assertSafeConfig, assertScrubMarker, stagingRewrite, isStaging, registerStagingHeaders, effectiveGatewayMode, testModeError, effectiveCarrierEnv } from "./app-env.js";
```

and append:

```js
test("staging never buys a real label: carriers are sandbox-only there, whatever CARRIER_ENV says", () => {
  assert.equal(effectiveCarrierEnv({ APP_ENV: "staging", CARRIER_ENV: "production" }), "sandbox");
  assert.equal(effectiveCarrierEnv({ APP_ENV: "production", CARRIER_ENV: "production" }), "production");
  assert.equal(effectiveCarrierEnv({ APP_ENV: "production" }), "sandbox");
  assert.equal(effectiveCarrierEnv({ APP_ENV: "development", CARRIER_ENV: "sandbox" }), "sandbox");
});
```

In `apps/api/src/services/billing/invoice-model.test.js`, append:

```js
test("the footer names the lab from one place (config/lab-identity.js)", () => {
  assert.match(buildInvoiceModel(invoice, lines, null, null, { generatedAt }).footer, /Diamond Orthotic Laboratory/);
  const custom = buildInvoiceModel(invoice, lines, null, null, { generatedAt, labName: "Acme Lab" }).footer;
  assert.match(custom, /Acme Lab/);
  assert.doesNotMatch(custom, /Diamond/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/config/lab-identity.test.js src/config/env.shipping.test.js src/config/app-env.test.js src/services/billing/invoice-model.test.js`
Expected: FAIL. `lab-identity.js` doesn't exist, the env keys are undefined, `effectiveCarrierEnv` is not exported, and the footer ignores `labName`.

- [ ] **Step 3: Implement**

`apps/api/src/config/lab-identity.js`:

```js
import { env } from "./env.js";

export const DEFAULT_LAB_NAME = "Diamond Orthotic Laboratory";

// Every value a carrier needs for the ship-from. LAB_ADDRESS_LINE2 is optional.
const REQUIRED_ADDRESS_KEYS = ["LAB_ADDRESS_LINE1", "LAB_CITY", "LAB_STATE", "LAB_ZIP", "LAB_PHONE"];

const clean = (v) => String(v ?? "").trim();

/**
 * Who the lab is: THE one place its name and street address live. The name
 * is printed on invoices, statements and the shipped email. The address is
 * the ship-from on every label, and is null until every required LAB_* value
 * is set; UPS and FedEx stay disabled until then (carrier-config.js).
 *
 * `source` defaults to the parsed env; tests pass a plain object.
 */
export function labIdentity(source = env) {
  const name = clean(source.LAB_NAME) || DEFAULT_LAB_NAME;
  const missing = REQUIRED_ADDRESS_KEYS.filter((k) => !clean(source[k]));
  const address = missing.length
    ? null
    : {
        name,
        company: name,
        phone: clean(source.LAB_PHONE),
        address1: clean(source.LAB_ADDRESS_LINE1),
        address2: clean(source.LAB_ADDRESS_LINE2) || null,
        city: clean(source.LAB_CITY),
        state: clean(source.LAB_STATE).toUpperCase(),
        postalCode: clean(source.LAB_ZIP),
        country: "US",
      };
  return { name, phone: clean(source.LAB_PHONE) || null, address, missing };
}
```

In `apps/api/src/config/env.js`, insert after the `INVOICE_TERMS_DAYS` line:

```js
  // ── Shipping (own-the-lab piece 4) ──
  // The lab's identity: config/lab-identity.js is the only reader. The street
  // address is the ship-from on every label; UPS/FedEx stay disabled until
  // LAB_ADDRESS_LINE1, LAB_CITY, LAB_STATE, LAB_ZIP and LAB_PHONE are all set.
  // Unset or blank = "Diamond Orthotic Laboratory" (lab-identity.js DEFAULT_LAB_NAME).
  LAB_NAME: z.string().optional(),
  LAB_PHONE: z.string().optional(),
  LAB_ADDRESS_LINE1: z.string().optional(),
  LAB_ADDRESS_LINE2: z.string().optional(),
  LAB_CITY: z.string().optional(),
  LAB_STATE: z.string().optional(),
  LAB_ZIP: z.string().optional(),
  // Carrier credentials (Secret Manager in prod). A carrier with any of its
  // values unset is simply disabled; nothing fails at boot.
  UPS_CLIENT_ID: z.string().optional(),
  UPS_CLIENT_SECRET: z.string().optional(),
  UPS_ACCOUNT_NUMBER: z.string().optional(),
  FEDEX_API_KEY: z.string().optional(),
  FEDEX_SECRET_KEY: z.string().optional(),
  FEDEX_ACCOUNT_NUMBER: z.string().optional(),
  // sandbox | production. Under APP_ENV=staging it is always sandbox
  // (config/app-env.js effectiveCarrierEnv).
  CARRIER_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  // image = UPS GIF / FedEx PNG printed through the browser; zpl = raw Zebra files.
  LABEL_FORMAT: z.enum(["image", "zpl"]).default("image"),
  // What a shipment adds to the draft invoice: none | carrier_cost | flat.
  // Stays "none" until the lab decides how it bills shipping.
  SHIPPING_CHARGE_POLICY: z.enum(["none", "carrier_cost", "flat"]).default("none"),
  SHIPPING_FLAT_CENTS: z.coerce.number().int().min(0).max(100000).default(0),
  SHIPPED_EMAIL_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
```

In `apps/api/src/config/app-env.js`, insert after `effectiveGatewayMode`:

```js
/**
 * The carrier environment actually used. Under APP_ENV=staging this is ALWAYS
 * "sandbox", so staging can never buy a real label (same rule as
 * effectiveGatewayMode for Authorize.net). Otherwise "production" only when
 * CARRIER_ENV is exactly "production".
 */
export function effectiveCarrierEnv(env) {
  if (isStaging(env)) return "sandbox";
  return env?.CARRIER_ENV === "production" ? "production" : "sandbox";
}
```

In `apps/api/src/services/billing/invoice-model.js`:
- add `import { labIdentity } from "../../config/lab-identity.js";` under the existing imports;
- change the signature on line 32 to `export function buildInvoiceModel(invoice, lines, client, order, { generatedAt, labName = labIdentity().name }) {`;
- change the footer on line 64 to:

```js
    footer: `Generated ${labDate(generatedAt)} · ${labName} · Pay online in the doctor portal. Contains patient information — keep confidential.`,
```

In `apps/api/src/services/billing/statement-model.js`:
- add `import { labIdentity } from "../../config/lab-identity.js";`;
- change line 68 to `export function buildStatementModel(client, activity, period, { generatedAt, labName = labIdentity().name }) {`;
- change the footer on line 105 to:

```js
    footer: `Generated ${formatUsDate(todayIso)} · Aging as of ${formatUsDate(asOfIso)} · ${labName} · Pay online in the doctor portal.`,
```

In `.env.example`, insert after the `── Lab orders ──` block:

```bash
# ── Shipping (piece 4) ──
# The lab's identity. The address is the ship-from on every label; UPS and
# FedEx stay disabled until LINE1, CITY, STATE, ZIP and PHONE are all set.
LAB_NAME=Diamond Orthotic Laboratory
LAB_PHONE=
LAB_ADDRESS_LINE1=
LAB_ADDRESS_LINE2=
LAB_CITY=
LAB_STATE=
LAB_ZIP=
# Carrier credentials (Secret Manager in prod). Any value unset = that carrier is disabled.
UPS_CLIENT_ID=
UPS_CLIENT_SECRET=
UPS_ACCOUNT_NUMBER=
FEDEX_API_KEY=
FEDEX_SECRET_KEY=
FEDEX_ACCOUNT_NUMBER=
# sandbox | production (staging is always sandbox)
CARRIER_ENV=sandbox
# image (UPS GIF / FedEx PNG via the browser) | zpl (Zebra thermal files)
LABEL_FORMAT=image
# none | carrier_cost | flat — what a shipment adds to the draft invoice
SHIPPING_CHARGE_POLICY=none
SHIPPING_FLAT_CENTS=0
SHIPPED_EMAIL_ENABLED=true
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/config src/services/billing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config apps/api/src/services/billing/invoice-model.js apps/api/src/services/billing/invoice-model.test.js apps/api/src/services/billing/statement-model.js .env.example
git commit -m "feat(api): lab identity in one place, shipping env, staging carriers are sandbox-only

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Schema: `shipments`, `shipment_events`, `lab_orders.shipment_id`, `invoice_lines.shipment_id`; migration 0031; scrub

**Files:**
- Create: `apps/api/src/db/schema/shipments.js`, `apps/api/src/db/schema/shipments.test.js`
- Modify: `apps/api/src/db/schema/lab-orders.js`, `apps/api/src/db/schema/invoices.js`, `apps/api/src/db/schema/index.js`, `apps/api/src/db/scrub/plan.js`, `apps/api/src/db/scrub/plan.test.js`, `apps/api/src/db/scrub/COLUMNS.md`
- Generated: `apps/api/src/db/migrations/0031_*.sql`, `meta/0031_snapshot.json`, `meta/_journal.json`

**Interfaces:**
- Produces (from `db/schema/index.js`):
  - `shipments`: `id, carrier, serviceCode, serviceName, carrierShipmentId, trackingNumber, status, chargeCents, currency, parcel, shipTo, shipFrom, labelFormat, labelData, createdByUserId, purchasedAt, shippedAt, deliveredAt, voidedAt, lastTrackedAt, trackingError, createdAt, updatedAt`.
  - `shipmentEvents`: `id, shipmentId, status, description, location, occurredAt, source, createdAt`.
  - `labOrders.shipmentId` and `invoiceLines.shipmentId` (both nullable `varchar(128)`, indexed).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/db/schema/shipments.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { shipments, shipmentEvents, labOrders, invoiceLines } from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migration = (prefix) => {
  const f = readdirSync(migrationsDir).find((n) => n.startsWith(prefix) && n.endsWith(".sql"));
  assert.ok(f, `no ${prefix}* migration`);
  return readFileSync(join(migrationsDir, f), "utf8");
};

test("a shipment carries the carrier, money in cents, snapshots and the label", () => {
  has(shipments, [
    "id", "carrier", "serviceCode", "serviceName", "carrierShipmentId", "trackingNumber", "status", "chargeCents", "currency",
    "parcel", "shipTo", "shipFrom", "labelFormat", "labelData", "createdByUserId", "purchasedAt", "shippedAt", "deliveredAt",
    "voidedAt", "lastTrackedAt", "trackingError", "createdAt", "updatedAt",
  ]);
  assert.equal(shipments.chargeCents.columnType, "PgInteger");
  assert.equal(shipments.status.default, "label_created");
  assert.equal(shipments.labelData.notNull, false, "a manual shipment has no label");
  assert.equal(shipments.trackingNumber.notNull, false, "a hand delivery has no tracking number");
});

test("shipment events are the append-only timeline", () => {
  has(shipmentEvents, ["id", "shipmentId", "status", "description", "location", "occurredAt", "source", "createdAt"]);
  assert.equal(shipmentEvents.shipmentId.notNull, true);
});

test("an order points at its current shipment; an invoice line remembers which shipment added it", () => {
  assert.equal(labOrders.shipmentId.notNull, false);
  assert.equal(invoiceLines.shipmentId.notNull, false);
});

test("0031 creates both tables and indexes the two new pointers", () => {
  const sql = migration("0031_");
  assert.match(sql, /CREATE TABLE "shipments"/);
  assert.match(sql, /CREATE TABLE "shipment_events"/);
  assert.match(sql, /ALTER TABLE "lab_orders" ADD COLUMN "shipment_id" varchar\(128\);/);
  assert.match(sql, /ALTER TABLE "invoice_lines" ADD COLUMN "shipment_id" varchar\(128\);/);
  assert.match(sql, /CREATE INDEX "lab_orders_shipment_idx"/);
  assert.match(sql, /CREATE INDEX "invoice_lines_shipment_idx"/);
  assert.match(sql, /CREATE INDEX "shipments_status_idx"/);
});
```

In `apps/api/src/db/scrub/plan.test.js`, add to `MUST_SCRUB`:

```js
  shipments: ["service_name", "ship_to", "label_data", "tracking_error"],
  shipment_events: ["location"],
```

and append:

```js
test("shipments keep carrier facts but lose every address, label image and typed carrier name", () => {
  const sql = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "shipments").sql;
  assert.match(sql, /"label_data" = NULL/);
  assert.match(sql, /"ship_to" = '\{"name":"Scrubbed Recipient"/);
  assert.ok(sql.includes(`"service_name" = CASE WHEN "shipments"."carrier" = 'manual' THEN 'Manual' ELSE "shipments"."service_name" END`), sql);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/db/schema/shipments.test.js src/db/scrub/plan.test.js`
Expected: FAIL. `shipments` is undefined, there is no `0031_` migration, and the plan has no `shipments` table.

- [ ] **Step 3: Write the schema**

`apps/api/src/db/schema/shipments.js`:

```js
import { pgTable, varchar, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// Shipments (own-the-lab piece 4): one bought label (UPS / FedEx) or one
// staff-recorded hand-off (manual). GENERIC: nothing here knows a lab order.
// lab_orders.shipment_id points here (one shipment can carry several orders);
// invoice_lines.shipment_id marks the shipping line a shipment added.
//
// `status` is the normalised vocabulary in packages/shared shipping.js; the
// carrier code tables live in services/shipping/carriers/carrier-status.js.
// Money is integer cents (what the carrier billed us).
//
// shipTo / labelData hold a practice or customer address, never a patient:
// labels carry order numbers only. No DB foreign keys (repo convention).

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const shipments = pgTable("shipments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // ups | fedex | manual
  carrier: varchar("carrier", { length: 20 }).notNull(),
  serviceCode: varchar("service_code", { length: 40 }),
  // "UPS Ground", "FedEx 2Day", or the carrier name staff typed (manual).
  serviceName: varchar("service_name", { length: 80 }),
  // What void needs: UPS ShipmentIdentificationNumber / FedEx master tracking number.
  carrierShipmentId: varchar("carrier_shipment_id", { length: 80 }),
  trackingNumber: varchar("tracking_number", { length: 60 }),
  status: varchar("status", { length: 20 }).notNull().default("label_created"),
  chargeCents: integer("charge_cents").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  // { preset, weightOz, lengthIn, widthIn, heightIn }
  parcel: jsonb("parcel").notNull(),
  // Address snapshots (packages/shared shipping.schema.js shippingAddressSchema).
  shipTo: jsonb("ship_to").notNull(),
  shipFrom: jsonb("ship_from"),
  // gif | png | zpl; null for a manual shipment.
  labelFormat: varchar("label_format", { length: 8 }),
  // Base64, exactly as the carrier returned it.
  labelData: text("label_data"),
  createdByUserId: varchar("created_by_user_id", { length: 128 }),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  // Set once, when the box left (Mark shipped or the first carrier movement).
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  lastTrackedAt: timestamp("last_tracked_at", { withTimezone: true }),
  // The carrier's last tracking error text (retried on the next sync).
  trackingError: text("tracking_error"),
  ...stamps,
}, (t) => [
  index("shipments_status_idx").on(t.status),
  index("shipments_tracking_idx").on(t.trackingNumber),
  index("shipments_purchased_idx").on(t.purchasedAt),
]);

/** Append-only; drives the shipment timeline. source: carrier | staff */
export const shipmentEvents = pgTable("shipment_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  shipmentId: varchar("shipment_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 120 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source: varchar("source", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("shipment_events_shipment_idx").on(t.shipmentId, t.occurredAt)]);
```

In `apps/api/src/db/schema/lab-orders.js`, in `labOrders`, add after `labNotes`:

```js
  // The current shipment (piece 4). One shipment can carry several orders
  // ("ship together"); voiding clears it. History lives in lab_order_events (type "shipment").
  shipmentId: varchar("shipment_id", { length: 128 }),
```

and add `index("lab_orders_shipment_idx").on(t.shipmentId),` to its index list. Extend the event-type comment above `labOrderEvents` to read `type: status | assign | department | due | note | hold | release | shipment`.

In `apps/api/src/db/schema/invoices.js`, in `invoiceLines`, add after `labOrderLineId`:

```js
  // The shipment that added this shipping line (piece 4), so voiding the label removes exactly it.
  shipmentId: varchar("shipment_id", { length: 128 }),
```

and change its table callback to:

```js
}, (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId), index("invoice_lines_shipment_idx").on(t.shipmentId)]);
```

Extend the `priceSource` comment to `// client | base | manual | remake | unpriced | shipment`.

In `apps/api/src/db/schema/index.js`, append:

```js
export { shipments, shipmentEvents } from "./shipments.js";
```

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate`
Expected: one new file `src/db/migrations/0031_<random_name>.sql` plus `meta/0031_snapshot.json`, and `_journal.json` updated. Read the SQL: it must contain only the two `CREATE TABLE`s, the two `ADD COLUMN`s and the indexes. Do not edit it.

- [ ] **Step 5: Classify every new column for the staging scrub**

In `apps/api/src/db/scrub/plan.js`, add near `SHIPPING_PLACEHOLDER`:

```js
const SHIP_TO_PLACEHOLDER = `'{"name":"Scrubbed Recipient","address1":"1 Test Street","city":"Testville","state":"TX","postalCode":"00000","country":"US"}'::jsonb`;
```

In `lab_orders.columns` add `shipment_id: K,`; in `invoice_lines.columns` add `shipment_id: K,`. After `invoice_lines`, add:

```js
  // Shipments (own-the-lab piece 4). Practice and customer addresses, label images
  // (which print the address) and carrier error text (which can echo it) go;
  // carrier, service, tracking numbers, cents and dates stay.
  shipments: {
    mode: "update",
    columns: {
      id: K, carrier: K, service_code: K,
      service_name: pii(`CASE WHEN "shipments"."carrier" = 'manual' THEN 'Manual' ELSE "shipments"."service_name" END`), // manual = staff-typed
      carrier_shipment_id: K, tracking_number: K, status: K, charge_cents: K, currency: K, parcel: K,
      ship_to: pii(SHIP_TO_PLACEHOLDER),
      ship_from: K, // the lab's own address
      label_format: K,
      label_data: pii("NULL"),
      created_by_user_id: K, purchased_at: K, shipped_at: K, delivered_at: K, voided_at: K, last_tracked_at: K,
      tracking_error: pii("NULL"),
      created_at: K, updated_at: K,
    },
  },
  shipment_events: {
    mode: "update",
    columns: {
      id: K, shipment_id: K, status: K,
      description: K, // carrier scan text ("Departed facility") or our own fixed staff strings
      location: pii("NULL"), // a recipient's city
      occurred_at: K, source: K, created_at: K,
    },
  },
```

In `apps/api/src/db/scrub/COLUMNS.md`, add to the scrubbed-columns table (after the `invoice_payments.note` row):

```markdown
| shipments.ship_to | pii | a fixed placeholder address (practice or guest customer address snapshot) |
| shipments.label_data | pii | NULL (the label image prints the recipient's address) |
| shipments.service_name | pii | `Manual` for manual shipments (staff-typed carrier name); carrier service names kept |
| shipments.tracking_error | pii | NULL (carrier error text can echo the address) |
| shipment_events.location | pii | NULL (a recipient's city) |
```

and extend the "Kept" bullet that starts "invoices and invoice_lines apart from…" with: `shipments apart from the columns above (carrier, service, tracking numbers, status, cents, parcel, the lab's own ship-from, dates); shipment_events status, description and dates; lab_orders.shipment_id and invoice_lines.shipment_id.`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/db`
Expected: PASS. The coverage tests see every new column classified.

Run: `cd apps/api && pnpm db:generate`
Expected: "No schema changes, nothing to migrate".

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db
git commit -m "feat(db): shipments and shipment events; orders and invoice lines point at their shipment (0031)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Carrier core: errors, HTTP helper, OAuth token cache, config, registry, manual adapter, contract test

**Files:**
- Create:
  - `apps/api/src/services/shipping/shipping-errors.js`, `carrier-http.js`, `carrier-http.test.js`, `oauth-token-cache.js`, `oauth-token-cache.test.js`, `carrier-config.js`, `carrier-registry.js`, `carrier-registry.test.js` (all in `apps/api/src/services/shipping/`);
  - `apps/api/src/services/shipping/carriers/manual.adapter.js`, `apps/api/src/services/shipping/carriers/adapter-contract.test.js`;
  - `apps/api/src/test/carrier-config.js`.

**Interfaces:**
- Consumes: `labIdentity`, `effectiveCarrierEnv` (Task 2); `CARRIER_LABELS` (Task 1).
- Produces:
  - `ShippingError(code, message, extra)`. Codes: `NOT_FOUND | INVALID | NOT_SHIPPABLE | CARRIER_DISABLED | PURCHASE_UNCERTAIN | IN_PROGRESS | VOID_REFUSED | LABEL_NOT_SAVED`.
  - `CarrierError(carrier, code, message, { httpStatus, timedOut, uncertain })`, `carrierProblem(err) → { carrier, code, message }`, and `shippingErrorReply(err) → { status, body } | null`.
  - `carrierRequest({ carrier, fetchImpl, url, method?, headers?, json?, form?, timeoutMs, purchase?, parseError }) → parsed JSON` (throws `CarrierError`), and `TIMEOUTS = { token, rate, purchase, void, track }` (ms).
  - `createTokenCache({ now? }) → { get(key, fetchToken), clear(key?) }` and `sharedTokenCache`. `fetchToken` resolves `{ accessToken, expiresInSec }`.
  - `carrierConfig(env?) → { carrierEnv, labelFormat, shipFrom, shipFromMissing, ups: {...}, fedex: {...} }` and `missingConfigReason(label, credsByEnvName, shipFrom) → string|null`.
  - `createRegistry({ config, fetchImpl?, tokenCache? }) → { get(id), all(), enabled(), status() }`, plus `carrierRegistry()` (the app's, built once from `env`), `CARRIER_IDS` and `LABEL_RESULT_KEYS`.
- **The adapter interface** (each `carriers/*.adapter.js` exports a `create<Name>Adapter({ config, fetchImpl, tokenCache })` returning this):
  ```
  { id, label, tracks,
    configured() → { ok, reason? },
    rate({ shipFrom, shipTo, parcel }) → RateQuote[]            // { carrier, serviceCode, serviceName, amountCents, estimatedDelivery|null }
    createLabel({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat?, manual? })
        → { trackingNumber, carrierShipmentId, labelFormat, labelData, chargeCents, currency, serviceCode, serviceName }
    voidLabel({ carrierShipmentId, trackingNumber }) → { ok, reason? }     // never throws a CarrierError
    track(trackingNumbers[]) → TrackResult[] }                              // never throws a CarrierError
  ```
  where `TrackResult = { trackingNumber, status|null, carrierCode|null, description|null, location|null, occurredAt: Date|null, deliveredAt: Date|null, events[], error?: { carrier, code, message } }`.
- Test helpers (`src/test/carrier-config.js`): `testCarrierConfig(over)`, `TEST_SHIP_FROM`, `fakeFetch(responses)` (records `.calls`), `timeoutError()`, `fixture(carrier, name)`.

- [ ] **Step 1: Write the test helper**

`apps/api/src/test/carrier-config.js`:

```js
import { readFileSync } from "node:fs";

/**
 * Carrier test doubles. Nothing here is a real credential, and nothing here
 * reaches a carrier: adapters are given `fakeFetch`, which answers from a
 * queue and records every call.
 */
export const TEST_SHIP_FROM = {
  name: "Test Lab", company: "Test Lab", phone: "2105550199", address1: "1 Lab Way", address2: null,
  city: "San Antonio", state: "TX", postalCode: "78205", country: "US",
};

export function testCarrierConfig(over = {}) {
  return {
    carrierEnv: "sandbox",
    labelFormat: "image",
    shipFrom: TEST_SHIP_FROM,
    shipFromMissing: [],
    ups: { clientId: "ups-test-id", clientSecret: "ups-test-secret", accountNumber: "A1B2C3", host: "https://ups.test" },
    fedex: { apiKey: "fx-test-key", secretKey: "fx-test-secret", accountNumber: "740561073", host: "https://fedex.test" },
    ...over,
  };
}

/** A fetch double: each call takes the next queued answer ({ status, body } or an Error to throw). */
export function fakeFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    if (next instanceof Error) throw next;
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

/** What fetch throws when AbortSignal.timeout fires. */
export const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/** A recorded/constructed carrier body from apps/api/test-fixtures/carriers/<carrier>/<name>.json. */
export const fixture = (carrier, name) =>
  JSON.parse(readFileSync(new URL(`../../test-fixtures/carriers/${carrier}/${name}.json`, import.meta.url), "utf8"));
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/services/shipping/carrier-http.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { carrierRequest } from "./carrier-http.js";
import { CarrierError, shippingErrorReply, ShippingError } from "./shipping-errors.js";
import { fakeFetch, timeoutError } from "../../test/carrier-config.js";

const parseError = (b) => ({ code: b?.err?.code, message: b?.err?.message });
const call = (fetchImpl, extra = {}) =>
  carrierRequest({ carrier: "ups", fetchImpl, url: "https://ups.test/x", json: { a: 1 }, timeoutMs: 30_000, parseError, ...extra });

test("JSON goes out with its content type and a timeout signal; JSON comes back parsed", async () => {
  const f = fakeFetch([{ status: 200, body: { ok: 1 } }]);
  assert.deepEqual(await call(f), { ok: 1 });
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(f.calls[0].body, '{"a":1}');
  assert.ok(f.calls[0].init.signal, "every carrier call is bounded by a timeout");
});

test("a form body is url-encoded (OAuth token calls)", async () => {
  const f = fakeFetch([{ status: 200, body: { access_token: "t" } }]);
  await carrierRequest({ carrier: "fedex", fetchImpl: f, url: "u", form: { grant_type: "client_credentials", client_id: "k" }, timeoutMs: 1000, parseError });
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(f.calls[0].body, "grant_type=client_credentials&client_id=k");
});

test("a 4xx is a definite refusal carrying the carrier's own code and words", async () => {
  const f = fakeFetch([{ status: 400, body: { err: { code: "120802", message: "Address Validation Error on ShipTo address" } } }]);
  await assert.rejects(call(f, { purchase: true }), (e) =>
    e instanceof CarrierError && e.code === "120802" && e.httpStatus === 400 && e.uncertain === false && /ShipTo/.test(e.message));
});

test("a purchase that times out, can't connect, gets a 5xx or an unreadable 2xx is UNCERTAIN", async () => {
  for (const answer of [timeoutError(), new TypeError("fetch failed"), { status: 503, body: "busy" }, { status: 200, body: "<html>" }]) {
    await assert.rejects(call(fakeFetch([answer]), { purchase: true }), (e) => e instanceof CarrierError && e.uncertain === true, String(answer.status ?? answer.name));
  }
});

test("the same failures outside a purchase are ordinary errors", async () => {
  for (const answer of [timeoutError(), { status: 503, body: "busy" }]) {
    await assert.rejects(call(fakeFetch([answer])), (e) => e instanceof CarrierError && e.uncertain === false);
  }
});

test("a timeout says so in words staff understand", async () => {
  await assert.rejects(call(fakeFetch([timeoutError()])), (e) => e.code === "TIMEOUT" && e.timedOut && /UPS did not answer within 30s/.test(e.message));
});

test("replies: a carrier error is a 502 with the carrier's words; an uncertain purchase is a 504", () => {
  const carrier = shippingErrorReply(new CarrierError("fedex", "SERVICE.UNAVAILABLE", "Try later."));
  assert.equal(carrier.status, 502);
  assert.equal(carrier.body.error.message, "FedEx: Try later.");
  assert.deepEqual(carrier.body.error.carrier, { carrier: "fedex", code: "SERVICE.UNAVAILABLE", message: "Try later." });
  assert.equal(shippingErrorReply(new ShippingError("PURCHASE_UNCERTAIN", "x")).status, 504);
  assert.equal(shippingErrorReply(new ShippingError("NOT_SHIPPABLE", "x", { problems: ["a", "b"] })).body.error.problems.length, 2);
  assert.equal(shippingErrorReply(new Error("boom")), null);
});
```

`apps/api/src/services/shipping/oauth-token-cache.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { createTokenCache } from "./oauth-token-cache.js";

const counter = (expiresInSec = 3600) => {
  const f = async () => { f.calls += 1; return { accessToken: `tok${f.calls}`, expiresInSec }; };
  f.calls = 0;
  return f;
};

test("a token is fetched once and reused until 60 seconds before it expires", async () => {
  let t = 0;
  const cache = createTokenCache({ now: () => t });
  const f = counter(3600);
  assert.equal(await cache.get("ups:sandbox", f), "tok1");
  t = 3_600_000 - 60_001;
  assert.equal(await cache.get("ups:sandbox", f), "tok1");
  t = 3_600_000 - 60_000;
  assert.equal(await cache.get("ups:sandbox", f), "tok2");
  assert.equal(f.calls, 2);
});

test("expires_in is honoured, never assumed: a short token refreshes at half its life", async () => {
  let t = 0;
  const cache = createTokenCache({ now: () => t });
  const f = counter(60);
  await cache.get("k", f);
  t = 29_999;
  await cache.get("k", f);
  assert.equal(f.calls, 1);
  t = 30_000;
  await cache.get("k", f);
  assert.equal(f.calls, 2);
});

test("concurrent callers share ONE token request (FedEx locks its token endpoint above ~1 rps)", async () => {
  let release;
  let calls = 0;
  const slow = () => { calls += 1; return new Promise((r) => { release = () => r({ accessToken: "t", expiresInSec: 3600 }); }); };
  const cache = createTokenCache();
  const all = Promise.all([cache.get("k", slow), cache.get("k", slow), cache.get("k", slow)]);
  release();
  assert.deepEqual(await all, ["t", "t", "t"]);
  assert.equal(calls, 1);
});

test("keys never share a token: UPS vs FedEx, sandbox vs production", async () => {
  const cache = createTokenCache();
  const f = counter();
  await cache.get("ups:sandbox", f);
  await cache.get("fedex:sandbox", f);
  await cache.get("ups:production", f);
  assert.equal(f.calls, 3);
});

test("a failed token request is not cached, and clear(key) forces a fresh token (after a 401)", async () => {
  const cache = createTokenCache();
  let fail = true;
  const f = async () => { if (fail) throw new Error("401"); return { accessToken: "ok", expiresInSec: 3600 }; };
  await assert.rejects(cache.get("k", f));
  fail = false;
  assert.equal(await cache.get("k", f), "ok");
  const g = counter();
  await cache.get("j", g);
  cache.clear("j");
  await cache.get("j", g);
  assert.equal(g.calls, 2);
});

test("a token response without a token or lifetime is refused, not cached", async () => {
  const cache = createTokenCache();
  await assert.rejects(cache.get("k", async () => ({ accessToken: "", expiresInSec: 3600 })), TypeError);
  await assert.rejects(cache.get("k", async () => ({ accessToken: "t", expiresInSec: NaN })), TypeError);
});
```

`apps/api/src/services/shipping/carrier-registry.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { createRegistry, CARRIER_IDS } from "./carrier-registry.js";
import { missingConfigReason } from "./carrier-config.js";
import { ShippingError } from "./shipping-errors.js";
import { testCarrierConfig, TEST_SHIP_FROM } from "../../test/carrier-config.js";

test("a missing credential disables the carrier with a reason naming the variable, never its value", () => {
  const reason = missingConfigReason("UPS", { UPS_CLIENT_ID: "id-123", UPS_CLIENT_SECRET: " ", UPS_ACCOUNT_NUMBER: undefined }, TEST_SHIP_FROM);
  assert.equal(reason, "UPS: credentials not set (UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER)");
  assert.doesNotMatch(reason, /id-123/);
});

test("credentials present but no ship-from: disabled until the lab address is configured", () => {
  assert.match(missingConfigReason("FedEx", { FEDEX_API_KEY: "k" }, null), /^FedEx: ship-from address not configured/);
  assert.equal(missingConfigReason("FedEx", { FEDEX_API_KEY: "k" }, TEST_SHIP_FROM), null);
});

test("manual is always registered and always enabled", () => {
  assert.ok(CARRIER_IDS.includes("manual"));
  const r = createRegistry({ config: testCarrierConfig({ shipFrom: null }) });
  assert.ok(r.enabled().some((a) => a.id === "manual"));
  assert.deepEqual(r.status().find((s) => s.id === "manual"), { id: "manual", label: "Manual", tracks: false, ok: true });
});

test("an unknown carrier is refused, not silently ignored", () => {
  const r = createRegistry({ config: testCarrierConfig() });
  assert.throws(() => r.get("dhl"), (e) => e instanceof ShippingError && e.code === "INVALID");
});
```

`apps/api/src/services/shipping/carriers/adapter-contract.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { createRegistry, CARRIER_IDS, LABEL_RESULT_KEYS } from "../carrier-registry.js";
import { createTokenCache } from "../oauth-token-cache.js";
import { testCarrierConfig } from "../../../test/carrier-config.js";

// THE contract: every registered adapter exports the same interface, so adding
// a carrier means writing one adapter. Nothing here reaches a carrier.
const noNetwork = async () => { throw new Error("tests never reach a carrier"); };
const build = (over) => createRegistry({ config: testCarrierConfig(over), fetchImpl: noNetwork, tokenCache: createTokenCache() });

for (const id of CARRIER_IDS) {
  test(`${id}: exports the carrier adapter interface`, () => {
    const a = build().get(id);
    assert.equal(a.id, id);
    assert.equal(typeof a.label, "string");
    assert.equal(typeof a.tracks, "boolean");
    for (const fn of ["configured", "rate", "createLabel", "voidLabel", "track"]) assert.equal(typeof a[fn], "function", fn);
    const c = a.configured();
    assert.equal(c.ok, true, "fully configured in the test config");
  });

  test(`${id}: with no ship-from only manual stays enabled, and a disabled carrier says why`, () => {
    const c = build({ shipFrom: null, shipFromMissing: ["LAB_ADDRESS_LINE1"] }).get(id).configured();
    assert.equal(c.ok, id === "manual");
    if (!c.ok) assert.equal(typeof c.reason, "string");
  });
}

test("manual: createLabel returns the shape every adapter returns, built from what staff typed", async () => {
  const label = await build().get("manual").createLabel({ manual: { carrierName: " Lone Star Courier ", trackingNumber: " LS-1234567 " } });
  assert.deepEqual(Object.keys(label).sort(), [...LABEL_RESULT_KEYS].sort());
  assert.deepEqual(label, {
    trackingNumber: "LS-1234567", carrierShipmentId: null, labelFormat: null, labelData: null,
    chargeCents: 0, currency: "USD", serviceCode: "manual", serviceName: "Lone Star Courier",
  });
});

test("manual: no carrier name is refused; no tracking number is fine (a hand delivery)", async () => {
  const manual = build().get("manual");
  await assert.rejects(manual.createLabel({ manual: { carrierName: "  " } }), /carrier's name/);
  assert.equal((await manual.createLabel({ manual: { carrierName: "Hand delivery" } })).trackingNumber, null);
  assert.deepEqual(await manual.rate(), []);
  assert.deepEqual(await manual.track(["x"]), []);
  assert.deepEqual(await manual.voidLabel({}), { ok: true });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/shipping`
Expected: FAIL. The modules don't exist.

- [ ] **Step 4: Write the errors and the HTTP helper**

`apps/api/src/services/shipping/shipping-errors.js`:

```js
import { CARRIER_LABELS } from "@my-app/shared";

/** A shipping rule said no. `message` is safe to show staff. */
export class ShippingError extends Error {
  /**
   * @param {"NOT_FOUND"|"INVALID"|"NOT_SHIPPABLE"|"CARRIER_DISABLED"|"PURCHASE_UNCERTAIN"|"IN_PROGRESS"|"VOID_REFUSED"|"LABEL_NOT_SAVED"} code
   * @param {string} message
   * @param {object} [extra]  e.g. { problems: string[] }, { gatewayOutcomePending: true }, { cause }
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ShippingError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * A carrier said no, or didn't answer. `message` is the carrier's own text
 * (shown to staff verbatim) or ours; it never contains a credential, and
 * request/response bodies are never attached. `uncertain` = a purchase whose
 * label may exist anyway (carrier-http.js decides).
 */
export class CarrierError extends Error {
  constructor(carrier, code, message, { httpStatus = null, timedOut = false, uncertain = false } = {}) {
    super(message);
    this.name = "CarrierError";
    this.carrier = carrier;
    this.code = code;
    this.httpStatus = httpStatus;
    this.timedOut = timedOut;
    this.uncertain = uncertain;
  }
}

/** The normalised { carrier, code, message } staff see. */
export const carrierProblem = (err) => ({ carrier: err.carrier, code: err.code, message: err.message });

const STATUS = {
  NOT_FOUND: 404, INVALID: 422, NOT_SHIPPABLE: 422, CARRIER_DISABLED: 422, VOID_REFUSED: 422,
  IN_PROGRESS: 409, PURCHASE_UNCERTAIN: 504, LABEL_NOT_SAVED: 500,
};

/** ShippingError / CarrierError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function shippingErrorReply(err) {
  if (err instanceof CarrierError) {
    const label = CARRIER_LABELS[err.carrier] ?? err.carrier;
    return { status: 502, body: { error: { code: "CARRIER_ERROR", status: 502, message: `${label}: ${err.message}`, carrier: carrierProblem(err) } } };
  }
  if (!(err instanceof ShippingError)) return null;
  const status = STATUS[err.code] ?? 422;
  const error = { code: err.code, status, message: err.message };
  if (err.problems) error.problems = err.problems;
  return { status, body: { error } };
}
```

`apps/api/src/services/shipping/carrier-http.js`:

```js
import { CARRIER_LABELS } from "@my-app/shared";
import { CarrierError } from "./shipping-errors.js";

/** Per-call budgets (ms). Rating 10s per carrier and purchase 30s come from the spec. */
export const TIMEOUTS = { token: 10_000, rate: 10_000, purchase: 30_000, void: 15_000, track: 15_000 };

const MAX_MESSAGE = 300;

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * THE one HTTP call to a carrier: JSON (or a form body, for OAuth) out, JSON
 * in, bounded by AbortSignal.timeout. Every failure becomes a CarrierError
 * carrying the carrier's own code and text (`parseError(body) → { code, message }`).
 * Bodies are never logged or attached.
 *
 * `purchase: true` marks failures after which the label may nonetheless exist
 * as `uncertain`: a timeout, a network error, a 5xx, or a 2xx we can't read.
 * A 4xx is a definite refusal.
 */
export async function carrierRequest({
  carrier, fetchImpl, url, method = "POST", headers = {}, json, form, timeoutMs, purchase = false, parseError = () => ({}),
}) {
  const label = CARRIER_LABELS[carrier] ?? carrier;
  const init = { method, headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (form) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  let res;
  let text;
  try {
    res = await fetchImpl(url, init);
    text = await res.text();
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new CarrierError(
      carrier,
      timedOut ? "TIMEOUT" : "NETWORK",
      timedOut ? `${label} did not answer within ${Math.round(timeoutMs / 1000)}s.` : `${label} could not be reached.`,
      { timedOut, uncertain: purchase },
    );
  }

  const data = parseJson(text);
  if (!res.ok) {
    const e = (data && parseError(data)) || {};
    throw new CarrierError(
      carrier,
      String(e.code || `HTTP_${res.status}`).slice(0, 60),
      String(e.message || `${label} returned HTTP ${res.status}.`).slice(0, MAX_MESSAGE),
      { httpStatus: res.status, uncertain: purchase && res.status >= 500 },
    );
  }
  if (data === null) {
    throw new CarrierError(carrier, "BAD_RESPONSE", `${label} sent a response we couldn't read.`, { httpStatus: res.status, uncertain: purchase });
  }
  return data;
}
```

- [ ] **Step 5: Write the token cache and the config**

`apps/api/src/services/shipping/oauth-token-cache.js`:

```js
/**
 * OAuth client-credentials tokens for every carrier: ONE implementation.
 * Cached per key (`<carrier>:<environment>`), refreshed 60 seconds before
 * `expires_in` (or at half its life, if shorter), and fetched single-flight:
 * concurrent callers share one token request. FedEx locks its token endpoint
 * for 10 minutes above ~1 request/second, so a token is never fetched per call.
 */
export const REFRESH_EARLY_MS = 60_000;

export function createTokenCache({ now = () => Date.now() } = {}) {
  const tokens = new Map(); // key → { accessToken, refreshAt }
  const inflight = new Map(); // key → Promise<string>

  async function get(key, fetchToken) {
    const hit = tokens.get(key);
    if (hit && now() < hit.refreshAt) return hit.accessToken;
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      try {
        const { accessToken, expiresInSec } = await fetchToken();
        const lifeMs = Number(expiresInSec) * 1000;
        if (!accessToken || !Number.isFinite(lifeMs) || lifeMs <= 0) throw new TypeError("token response had no access token or lifetime");
        tokens.set(key, { accessToken, refreshAt: now() + lifeMs - Math.min(REFRESH_EARLY_MS, lifeMs / 2) });
        return accessToken;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    return pending;
  }

  function clear(key) {
    if (key) tokens.delete(key);
    else tokens.clear();
  }

  return { get, clear };
}

/** The process-wide cache the app's adapters share. */
export const sharedTokenCache = createTokenCache();
```

`apps/api/src/services/shipping/carrier-config.js`:

```js
import { env as appEnv } from "../../config/env.js";
import { effectiveCarrierEnv } from "../../config/app-env.js";
import { labIdentity } from "../../config/lab-identity.js";

const HOSTS = {
  ups: { sandbox: "https://wwwcie.ups.com", production: "https://onlinetools.ups.com" },
  fedex: { sandbox: "https://apis-sandbox.fedex.com", production: "https://apis.fedex.com" },
};

/**
 * Everything the adapters need, read once from the environment. It holds
 * credentials: never log it, never return it from a route.
 */
export function carrierConfig(env = appEnv) {
  const carrierEnv = effectiveCarrierEnv(env);
  const lab = labIdentity(env);
  return {
    carrierEnv,
    labelFormat: env.LABEL_FORMAT === "zpl" ? "zpl" : "image",
    shipFrom: lab.address,
    shipFromMissing: lab.missing,
    ups: { clientId: env.UPS_CLIENT_ID, clientSecret: env.UPS_CLIENT_SECRET, accountNumber: env.UPS_ACCOUNT_NUMBER, host: HOSTS.ups[carrierEnv] },
    fedex: { apiKey: env.FEDEX_API_KEY, secretKey: env.FEDEX_SECRET_KEY, accountNumber: env.FEDEX_ACCOUNT_NUMBER, host: HOSTS.fedex[carrierEnv] },
  };
}

/**
 * Why a carrier can't be used, or null. `creds` is keyed by ENV VARIABLE NAME,
 * so the reason names what to set and never echoes a value.
 */
export function missingConfigReason(label, creds, shipFrom) {
  const unset = Object.entries(creds).filter(([, v]) => !String(v ?? "").trim()).map(([k]) => k);
  if (unset.length) return `${label}: credentials not set (${unset.join(", ")})`;
  if (!shipFrom) return `${label}: ship-from address not configured (set LAB_ADDRESS_LINE1, LAB_CITY, LAB_STATE, LAB_ZIP and LAB_PHONE)`;
  return null;
}
```

- [ ] **Step 6: Write the manual adapter and the registry**

`apps/api/src/services/shipping/carriers/manual.adapter.js`:

```js
import { ShippingError } from "../shipping-errors.js";

/**
 * Staff-recorded shipments: a courier, a hand delivery, or a carrier used
 * outside the system. No API, so it is always configured, and it is what makes
 * the whole flow usable before the UPS and FedEx accounts exist. It never
 * rates and never tracks; staff move it (Mark shipped).
 */
export function createManualAdapter() {
  return {
    id: "manual",
    label: "Manual",
    tracks: false,
    configured: () => ({ ok: true }),
    async rate() {
      return [];
    },
    async createLabel({ manual } = {}) {
      const carrierName = String(manual?.carrierName ?? "").trim();
      if (!carrierName) throw new ShippingError("INVALID", "Type the carrier's name.");
      return {
        trackingNumber: String(manual?.trackingNumber ?? "").trim() || null,
        carrierShipmentId: null,
        labelFormat: null,
        labelData: null,
        chargeCents: 0,
        currency: "USD",
        serviceCode: "manual",
        serviceName: carrierName.slice(0, 80),
      };
    },
    async voidLabel() {
      return { ok: true };
    },
    async track() {
      return [];
    },
  };
}
```

`apps/api/src/services/shipping/carrier-registry.js`:

```js
import { env } from "../../config/env.js";
import { carrierConfig } from "./carrier-config.js";
import { sharedTokenCache } from "./oauth-token-cache.js";
import { ShippingError } from "./shipping-errors.js";
import { createManualAdapter } from "./carriers/manual.adapter.js";

/**
 * Every carrier the system can use. Adding or swapping a carrier means one
 * adapter (carriers/*.adapter.js, the interface in adapter-contract.test.js)
 * and one line here. A carrier with missing configuration is simply disabled;
 * it never fails at boot.
 */
const FACTORIES = {
  manual: createManualAdapter,
};

export const CARRIER_IDS = Object.keys(FACTORIES);

/** The keys every createLabel result has (adapter-contract.test.js). */
export const LABEL_RESULT_KEYS = [
  "trackingNumber", "carrierShipmentId", "labelFormat", "labelData", "chargeCents", "currency", "serviceCode", "serviceName",
];

export function createRegistry({ config, fetchImpl = globalThis.fetch, tokenCache = sharedTokenCache }) {
  const adapters = new Map(CARRIER_IDS.map((id) => [id, FACTORIES[id]({ config, fetchImpl, tokenCache })]));
  return {
    get(id) {
      const adapter = adapters.get(id);
      if (!adapter) throw new ShippingError("INVALID", `Unknown carrier: ${id}`);
      return adapter;
    },
    all: () => [...adapters.values()],
    enabled: () => [...adapters.values()].filter((a) => a.configured().ok),
    /** For the Carriers panel: each carrier's state and, when disabled, why. */
    status: () => [...adapters.values()].map((a) => ({ id: a.id, label: a.label, tracks: a.tracks, ...a.configured() })),
  };
}

let shared = null;

/** The app's registry, built once from env. */
export function carrierRegistry() {
  shared ??= createRegistry({ config: carrierConfig(env) });
  return shared;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/shipping`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/shipping apps/api/src/test/carrier-config.js
git commit -m "feat(shipping): carrier adapter interface, registry, one HTTP helper and one OAuth token cache

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: UPS adapter: requests, responses, status table, fixtures

**Files:**
- Create:
  - `apps/api/src/services/shipping/carriers/carrier-status.js` (+ `carrier-status.test.js`);
  - `ups-requests.js`, `ups-responses.js` and `ups.adapter.js` in the same folder, each with a `.test.js`;
  - fixtures `apps/api/test-fixtures/carriers/ups/rate.json`, `ship.json`, `void.json`, `track.json`, `error.json`.
- Modify: `apps/api/src/services/shipping/carrier-registry.js` (one factory line)

**Interfaces:**
- Consumes: `carrierRequest`, `TIMEOUTS`, `CarrierError`, `carrierProblem`, `sharedTokenCache`, `missingConfigReason` (Task 4); `weightLbFromOz`, `toCents` (shared).
- Produces:
  - `createUpsAdapter({ config, fetchImpl, tokenCache })`, implementing the Task 4 interface.
  - `normalizeCarrierStatus(carrier, code, description?) → status|null` (`carriers/carrier-status.js`, used by both carriers).
  - Pure builders and parsers: `upsRateRequest`, `upsShipRequest`, `upsPaths`, `UPS_SERVICE_NAMES`, `parseUpsError`, `parseUpsToken`, `parseUpsRates`, `parseUpsLabel`, `parseUpsVoid`, `parseUpsTrack`.

UPS facts used here (research note §1–8, from UPS's OpenAPI specs):
- OAuth: Basic `client_id:secret`, form `grant_type=client_credentials`, `x-merchant-id` = account number.
- `POST /api/rating/v2409/Shop`, `POST /api/shipments/v2409/ship` (GIF or ZPL, 4×6 stock), `DELETE /api/shipments/v2409/void/cancel/{id}`, `GET /api/track/v1/details/{n}`.
- `Shipper.ShipperNumber` is required, and negotiated rates are returned when asked for.
- **Quirk:** UPS returns an object, not an array, when there is exactly one item (`RatedShipment`, `PackageResults`), so the parsers accept both.

- [ ] **Step 1: Write the fixtures**

`apps/api/test-fixtures/carriers/ups/rate.json`:

```json
{
  "RateResponse": {
    "Response": { "ResponseStatus": { "Code": "1", "Description": "Success" } },
    "RatedShipment": [
      {
        "Service": { "Code": "03", "Description": "" },
        "TotalCharges": { "CurrencyCode": "USD", "MonetaryValue": "14.86" },
        "NegotiatedRateCharges": { "TotalCharge": { "CurrencyCode": "USD", "MonetaryValue": "11.42" } },
        "GuaranteedDelivery": { "BusinessDaysInTransit": "3" }
      },
      {
        "Service": { "Code": "02", "Description": "" },
        "TotalCharges": { "CurrencyCode": "USD", "MonetaryValue": "32.10" },
        "GuaranteedDelivery": { "BusinessDaysInTransit": "2" }
      },
      {
        "Service": { "Code": "01", "Description": "" },
        "TotalCharges": { "CurrencyCode": "USD", "MonetaryValue": "61.05" },
        "GuaranteedDelivery": { "BusinessDaysInTransit": "1" }
      }
    ]
  }
}
```

`apps/api/test-fixtures/carriers/ups/ship.json`:

```json
{
  "ShipmentResponse": {
    "Response": { "ResponseStatus": { "Code": "1", "Description": "Success" } },
    "ShipmentResults": {
      "ShipmentCharges": { "TotalCharges": { "CurrencyCode": "USD", "MonetaryValue": "14.86" } },
      "NegotiatedRateCharges": { "TotalCharge": { "CurrencyCode": "USD", "MonetaryValue": "11.42" } },
      "ShipmentIdentificationNumber": "1Z999AA10123456784",
      "PackageResults": {
        "TrackingNumber": "1Z999AA10123456784",
        "ShippingLabel": {
          "ImageFormat": { "Code": "GIF" },
          "GraphicImage": "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
          "HTMLImage": "PGh0bWw+PC9odG1sPg=="
        }
      }
    }
  }
}
```

`apps/api/test-fixtures/carriers/ups/void.json`:

```json
{
  "VoidShipmentResponse": {
    "Response": { "ResponseStatus": { "Code": "1", "Description": "Success" } },
    "SummaryResult": { "Status": { "Code": "1", "Description": "Voided" } }
  }
}
```

`apps/api/test-fixtures/carriers/ups/track.json`:

```json
{
  "trackResponse": {
    "shipment": [
      {
        "inquiryNumber": "1Z999AA10123456784",
        "package": [
          {
            "trackingNumber": "1Z999AA10123456784",
            "currentStatus": { "code": "011", "description": "Delivered" },
            "activity": [
              { "location": { "address": { "city": "SAN ANTONIO", "stateProvince": "TX", "countryCode": "US" } }, "status": { "type": "P", "description": "Pickup Scan", "code": "PU" }, "date": "20261020", "time": "171000" },
              { "location": { "address": { "city": "AUSTIN", "stateProvince": "TX", "countryCode": "US" } }, "status": { "type": "D", "description": "DELIVERED", "code": "KB" }, "date": "20261022", "time": "142100" },
              { "location": { "address": { "city": "AUSTIN", "stateProvince": "TX", "countryCode": "US" } }, "status": { "type": "I", "description": "Out For Delivery Today", "code": "OT" }, "date": "20261022", "time": "081500" },
              { "location": { "address": { "countryCode": "US" } }, "status": { "type": "M", "description": "Shipper created a label, UPS has not received the package yet.", "code": "MP" }, "date": "20261020", "time": "101500" }
            ]
          }
        ]
      }
    ]
  }
}
```

`apps/api/test-fixtures/carriers/ups/error.json`:

```json
{ "response": { "errors": [{ "code": "120802", "message": "Address Validation Error on ShipTo address" }] } }
```

(The track activity is deliberately out of order: the parser sorts by date and time and doesn't trust the order UPS sends.)

- [ ] **Step 2: Write the failing tests**

`apps/api/src/services/shipping/carriers/carrier-status.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { SHIPMENT_STATUSES } from "@my-app/shared";
import { normalizeCarrierStatus, UPS_STATUS_TYPES, FEDEX_STATUS_CODES } from "./carrier-status.js";

test("every mapped code lands on a real status", () => {
  for (const s of [...Object.values(UPS_STATUS_TYPES), ...Object.values(FEDEX_STATUS_CODES)]) {
    assert.ok(SHIPMENT_STATUSES.includes(s), s);
  }
});

test("UPS status types → our statuses; 'out for delivery' is recognised from the words", () => {
  assert.equal(normalizeCarrierStatus("ups", "M"), "label_created");
  assert.equal(normalizeCarrierStatus("ups", "P"), "in_transit");
  assert.equal(normalizeCarrierStatus("ups", "I", "Out For Delivery Today"), "out_for_delivery");
  assert.equal(normalizeCarrierStatus("ups", "d"), "delivered");
  assert.equal(normalizeCarrierStatus("ups", "RS"), "returned");
  assert.equal(normalizeCarrierStatus("ups", "X"), "exception");
});

test("an unknown code or carrier is null (the sync keeps the current status and logs the code)", () => {
  assert.equal(normalizeCarrierStatus("ups", "ZZ"), null);
  assert.equal(normalizeCarrierStatus("dhl", "D"), null);
  assert.equal(normalizeCarrierStatus("fedex", null), null);
});
```

`apps/api/src/services/shipping/carriers/ups-requests.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { upsRateRequest, upsShipRequest, upsPaths } from "./ups-requests.js";
import { TEST_SHIP_FROM } from "../../../test/carrier-config.js";

const shipTo = {
  name: "Dr. Ada Smile", company: "Smile Dental Group of Greater San Antonio", phone: "(210) 555-0100",
  address1: "100 Main St", address2: null, city: "Austin", state: "TX", postalCode: "78701", country: "US",
};
const parcel = { preset: "small_box", weightOz: 17, lengthIn: 8, widthIn: 6.2, heightIn: 4 };

test("rating shops every UPS service for the lane, as the lab's account (negotiated rates)", () => {
  const { RateRequest: r } = upsRateRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, accountNumber: "A1B2C3" });
  assert.equal(r.Request.RequestOption, "Shop");
  assert.equal(r.Shipment.Shipper.ShipperNumber, "A1B2C3");
  assert.deepEqual(r.Shipment.ShipmentRatingOptions, { NegotiatedRatesIndicator: "Y" });
  assert.deepEqual(r.Shipment.Package.PackagingType, { Code: "02" });
  assert.deepEqual(r.Shipment.Package.PackageWeight, { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.1" });
  assert.equal(r.Shipment.Package.Dimensions.Width, "7", "dimensions round up to whole inches");
});

test("an address becomes UPS's shape: company as Name, the person as AttentionName, digits-only phone, 35-char lines", () => {
  const { ShipmentRequest: s } = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 100245", labelFormat: "image", accountNumber: "A1B2C3" });
  const to = s.Shipment.ShipTo;
  assert.equal(to.Name, "Smile Dental Group of Greater San A");
  assert.equal(to.Name.length, 35);
  assert.equal(to.AttentionName, "Dr. Ada Smile");
  assert.deepEqual(to.Phone, { Number: "2105550100" });
  assert.deepEqual(to.Address, { AddressLine: ["100 Main St"], City: "Austin", StateProvinceCode: "TX", PostalCode: "78701", CountryCode: "US" });
});

test("no phone on the ship-to: the Phone block is left out, not sent empty", () => {
  const { ShipmentRequest: s } = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo: { ...shipTo, phone: null }, parcel, serviceCode: "03", reference: "Order 1", labelFormat: "image", accountNumber: "A" });
  assert.equal("Phone" in s.Shipment.ShipTo, false);
});

test("the label request: GIF or ZPL on 4×6 stock, billed to the shipper, the service picked, order numbers as the only reference", () => {
  const gif = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 100245, 100246", labelFormat: "image", accountNumber: "A1B2C3" }).ShipmentRequest;
  assert.deepEqual(gif.LabelSpecification, { LabelImageFormat: { Code: "GIF" }, LabelStockSize: { Height: "6", Width: "4" } });
  assert.deepEqual(gif.Shipment.PaymentInformation, { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: "A1B2C3" } }] });
  assert.deepEqual(gif.Shipment.Service, { Code: "03" });
  assert.deepEqual(gif.Shipment.Package[0].ReferenceNumber, [{ Value: "Order 100245, 100246" }]);
  assert.equal(JSON.stringify(gif).includes("Description"), false, "no free-text description travels to UPS");
  const zpl = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1", labelFormat: "zpl", accountNumber: "A" }).ShipmentRequest;
  assert.equal(zpl.LabelSpecification.LabelImageFormat.Code, "ZPL");
});

test("paths carry the API version and encode ids", () => {
  assert.equal(upsPaths.ship, "/api/shipments/v2409/ship");
  assert.equal(upsPaths.void("1Z 9"), "/api/shipments/v2409/void/cancel/1Z%209");
  assert.match(upsPaths.track("1Z999"), /^\/api\/track\/v1\/details\/1Z999\?locale=en_US/);
});
```

`apps/api/src/services/shipping/carriers/ups-responses.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseUpsRates, parseUpsLabel, parseUpsVoid, parseUpsTrack, parseUpsError, parseUpsToken } from "./ups-responses.js";
import { fixture } from "../../../test/carrier-config.js";

test("rates: negotiated price when present, published otherwise, dollars → cents once", () => {
  const quotes = parseUpsRates(fixture("ups", "rate"));
  assert.deepEqual(quotes[0], { carrier: "ups", serviceCode: "03", serviceName: "UPS Ground", amountCents: 1142, estimatedDelivery: "3 business days" });
  assert.equal(quotes[1].amountCents, 3210);
  assert.equal(quotes[2].estimatedDelivery, "1 business day");
});

test("rates: one rated service arrives as an object, not an array", () => {
  const one = { RateResponse: { RatedShipment: { Service: { Code: "03" }, TotalCharges: { MonetaryValue: "9.99" } } } };
  assert.equal(parseUpsRates(one).length, 1);
  assert.deepEqual(parseUpsRates({}), []);
});

test("label: tracking number, void id, the GIF, the negotiated charge in cents", () => {
  const label = parseUpsLabel(fixture("ups", "ship"), { serviceCode: "03", labelFormat: "image" });
  assert.deepEqual(label, {
    trackingNumber: "1Z999AA10123456784", carrierShipmentId: "1Z999AA10123456784", labelFormat: "gif",
    labelData: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", chargeCents: 1142, currency: "USD",
    serviceCode: "03", serviceName: "UPS Ground",
  });
  assert.equal(parseUpsLabel(fixture("ups", "ship"), { serviceCode: "03", labelFormat: "zpl" }).labelFormat, "zpl");
  assert.equal(parseUpsLabel({ ShipmentResponse: {} }, { serviceCode: "03" }), null, "an unreadable success is null (the adapter calls it uncertain)");
});

test("void: success code 1; anything else carries UPS's words", () => {
  assert.deepEqual(parseUpsVoid(fixture("ups", "void")), { ok: true });
  assert.deepEqual(parseUpsVoid({ VoidShipmentResponse: { Response: { ResponseStatus: { Code: "0", Description: "Failed" } } } }), { ok: false, reason: "Failed" });
});

test("track: the newest scan wins whatever order UPS sends; delivered stamps the delivery time", () => {
  const t = parseUpsTrack(fixture("ups", "track"), "1Z999AA10123456784");
  assert.equal(t.status, "delivered");
  assert.equal(t.carrierCode, "D");
  assert.equal(t.description, "DELIVERED");
  assert.equal(t.location, "AUSTIN, TX");
  assert.equal(t.occurredAt.toISOString(), "2026-10-22T14:21:00.000Z");
  assert.equal(t.deliveredAt.toISOString(), "2026-10-22T14:21:00.000Z");
  assert.deepEqual(t.events.map((e) => e.status), ["delivered", "out_for_delivery", "in_transit", "label_created"]);
});

test("track: no package in the answer is an empty result, not a crash", () => {
  assert.deepEqual(parseUpsTrack({}, "1Z1"), {
    trackingNumber: "1Z1", status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [],
  });
});

test("errors and tokens", () => {
  assert.deepEqual(parseUpsError(fixture("ups", "error")), { code: "120802", message: "Address Validation Error on ShipTo address" });
  assert.deepEqual(parseUpsToken({ access_token: "abc", expires_in: "3599" }), { accessToken: "abc", expiresInSec: 3599 });
});
```

`apps/api/src/services/shipping/carriers/ups.adapter.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { createUpsAdapter } from "./ups.adapter.js";
import { createTokenCache } from "../oauth-token-cache.js";
import { CarrierError } from "../shipping-errors.js";
import { testCarrierConfig, TEST_SHIP_FROM, fakeFetch, timeoutError, fixture } from "../../../test/carrier-config.js";

const TOKEN = { status: 200, body: { access_token: "tok", expires_in: "3600" } };
const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const make = (answers, over) => {
  const fetchImpl = fakeFetch(answers);
  return { fetchImpl, ups: createUpsAdapter({ config: testCarrierConfig(over), fetchImpl, tokenCache: createTokenCache() }) };
};

test("one token serves many calls; the token call is Basic-authenticated, API calls are Bearer", async () => {
  const { ups, fetchImpl } = make([TOKEN, { status: 200, body: fixture("ups", "rate") }, { status: 200, body: fixture("ups", "rate") }]);
  await ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  await ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls.length, 3, "one token call, two rate calls");
  const [tokenCall, rateCall] = fetchImpl.calls;
  assert.equal(tokenCall.url, "https://ups.test/security/v1/oauth/token");
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from("ups-test-id:ups-test-secret").toString("base64")}`);
  assert.equal(tokenCall.body, "grant_type=client_credentials");
  assert.equal(rateCall.init.headers.Authorization, "Bearer tok");
  assert.ok(rateCall.init.headers.transId.length <= 32);
});

test("a purchase that times out is uncertain; a token failure before it is not", async () => {
  const timedOut = make([TOKEN, timeoutError()]);
  await assert.rejects(
    timedOut.ups.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1" }),
    (e) => e instanceof CarrierError && e.uncertain === true,
  );
  const badCreds = make([{ status: 401, body: { response: { errors: [{ code: "250003", message: "Invalid Access License number" }] } } }]);
  await assert.rejects(
    badCreds.ups.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1" }),
    (e) => e instanceof CarrierError && e.uncertain === false && e.code === "250003",
  );
});

test("a label UPS accepted but we can't read is uncertain (it may exist)", async () => {
  const { ups } = make([TOKEN, { status: 200, body: { ShipmentResponse: {} } }]);
  await assert.rejects(ups.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1" }), (e) => e.uncertain === true);
});

test("a 401 on an API call drops the cached token, so the next call signs in again", async () => {
  const { ups, fetchImpl } = make([TOKEN, { status: 401, body: {} }, TOKEN, { status: 200, body: fixture("ups", "rate") }]);
  await assert.rejects(ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel }));
  await ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith("/oauth/token")).length, 2);
});

test("void never throws a carrier error: it reports ok or UPS's reason", async () => {
  const ok = make([TOKEN, { status: 200, body: fixture("ups", "void") }]);
  assert.deepEqual(await ok.ups.voidLabel({ carrierShipmentId: "1Z999AA10123456784" }), { ok: true });
  assert.equal(ok.fetchImpl.calls[1].init.method, "DELETE");
  const refused = make([TOKEN, { status: 400, body: { response: { errors: [{ code: "190117", message: "Shipment already picked up" }] } } }]);
  assert.deepEqual(await refused.ups.voidLabel({ carrierShipmentId: "1Z1" }), { ok: false, reason: "Shipment already picked up" });
});

test("track: one number per request; one failing number doesn't hide the others", async () => {
  const { ups } = make([TOKEN, { status: 200, body: fixture("ups", "track") }, { status: 404, body: { response: { errors: [{ code: "151044", message: "No tracking information available" }] } } }]);
  const out = await ups.track(["1Z999AA10123456784", "1ZNOPE"]);
  assert.equal(out[0].status, "delivered");
  assert.deepEqual(out[1].error, { carrier: "ups", code: "151044", message: "No tracking information available" });
  assert.equal(out[1].status, null);
});

test("configured: names the missing UPS variable, never a value", () => {
  const { ups } = make([], { ups: { ...testCarrierConfig().ups, accountNumber: "" } });
  assert.deepEqual(ups.configured(), { ok: false, reason: "UPS: credentials not set (UPS_ACCOUNT_NUMBER)" });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/shipping/carriers`
Expected: FAIL. The UPS modules and `carrier-status.js` don't exist.

- [ ] **Step 4: Write the status table**

`apps/api/src/services/shipping/carriers/carrier-status.js`:

```js
/**
 * THE carrier code → normalised status tables (statuses: packages/shared
 * shipping.js). Pure. UPS codes are Tracking.yaml `status.type`; FedEx codes
 * are `latestStatusDetail.code` / `derivedStatusCode` from the research note's
 * field names [MEM]. The sandbox smoke script prints each carrier's raw code,
 * so a missing code is added here, not guessed at runtime.
 */
export const UPS_STATUS_TYPES = {
  M: "label_created", // billing information received: label made, package not yet with UPS
  P: "in_transit", // pickup scan
  I: "in_transit",
  W: "in_transit", // warehousing
  DO: "in_transit", // delivered to origin CFS
  DD: "in_transit", // delivered to destination CFS
  O: "out_for_delivery",
  X: "exception",
  D: "delivered",
  RS: "returned",
};

export const FEDEX_STATUS_CODES = {
  OC: "label_created", // order created / label printed
  PU: "in_transit",
  PX: "in_transit",
  IT: "in_transit",
  AR: "in_transit",
  AF: "in_transit",
  DP: "in_transit",
  FD: "in_transit",
  HL: "in_transit", // held at a FedEx location for pickup
  OD: "out_for_delivery",
  DE: "exception",
  SE: "exception",
  CD: "exception",
  DL: "delivered",
  RS: "returned",
};

const TABLES = { ups: UPS_STATUS_TYPES, fedex: FEDEX_STATUS_CODES };

/** A carrier's code → our status, or null when unknown (the caller keeps the current status and logs the code). */
export function normalizeCarrierStatus(carrier, code, description = "") {
  const table = TABLES[carrier];
  if (!table || !code) return null;
  const status = table[String(code).toUpperCase()] ?? null;
  if (status === "in_transit" && /out for delivery/i.test(description ?? "")) return "out_for_delivery";
  return status;
}
```

- [ ] **Step 5: Write the UPS request builders and parsers**

`apps/api/src/services/shipping/carriers/ups-requests.js`:

```js
import { weightLbFromOz } from "@my-app/shared";

/**
 * Pure UPS request builders (UPS OpenAPI specs: Shipping.yaml, Rating.yaml,
 * Tracking.yaml). Addresses in, UPS JSON out. The `reference` is order
 * numbers only (lab-shipping-rules.js shipmentReference), so no patient data
 * can reach a label.
 */
export const UPS_API_VERSION = "v2409";

export const UPS_SERVICE_NAMES = {
  "01": "Next Day Air", "02": "2nd Day Air", "03": "Ground", "12": "3 Day Select",
  "13": "Next Day Air Saver", "14": "Next Day Air Early", "59": "2nd Day Air A.M.",
};
export const upsServiceName = (code) => `UPS ${UPS_SERVICE_NAMES[code] ?? `service ${code}`}`;

export const upsPaths = {
  token: "/security/v1/oauth/token",
  rate: `/api/rating/${UPS_API_VERSION}/Shop`,
  ship: `/api/shipments/${UPS_API_VERSION}/ship`,
  void: (id) => `/api/shipments/${UPS_API_VERSION}/void/cancel/${encodeURIComponent(id)}`,
  track: (n) => `/api/track/v1/details/${encodeURIComponent(n)}?locale=en_US&returnMilestones=false`,
};

const cut = (s, n) => (s == null ? undefined : String(s).trim().slice(0, n) || undefined);
const digits = (s) => String(s ?? "").replace(/\D/g, "").slice(0, 15) || undefined;

function upsAddress(a) {
  return {
    AddressLine: [a.address1, a.address2].filter(Boolean).map((l) => cut(l, 35)),
    City: cut(a.city, 30),
    StateProvinceCode: a.state,
    PostalCode: a.postalCode,
    CountryCode: a.country || "US",
    ...(a.residential ? { ResidentialAddressIndicator: "" } : {}),
  };
}

/** Shipper / ShipTo / ShipFrom: the company is the Name UPS prints, the person is the attention line. */
function party(a, extra = {}) {
  const phone = digits(a.phone);
  return {
    Name: cut(a.company || a.name, 35),
    AttentionName: cut(a.name, 35),
    ...(phone ? { Phone: { Number: phone } } : {}),
    Address: upsAddress(a),
    ...extra,
  };
}

function upsPackage(parcel, packagingKey) {
  const inches = (n) => String(Math.ceil(n));
  return {
    [packagingKey]: { Code: "02" }, // customer-supplied package
    Dimensions: {
      UnitOfMeasurement: { Code: "IN" },
      Length: inches(parcel.lengthIn), Width: inches(parcel.widthIn), Height: inches(parcel.heightIn),
    },
    PackageWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: String(weightLbFromOz(parcel.weightOz)) },
  };
}

export const upsTokenForm = () => ({ grant_type: "client_credentials" });

/** Shop: every UPS service for the lane, negotiated (account) rates where eligible. */
export function upsRateRequest({ shipFrom, shipTo, parcel, accountNumber }) {
  return {
    RateRequest: {
      Request: { RequestOption: "Shop" },
      Shipment: {
        Shipper: party(shipFrom, { ShipperNumber: accountNumber }),
        ShipTo: party(shipTo),
        ShipFrom: party(shipFrom),
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "Y" },
        Package: upsPackage(parcel, "PackagingType"),
      },
    },
  };
}

export function upsShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber }) {
  return {
    ShipmentRequest: {
      Request: { RequestOption: "nonvalidate" },
      Shipment: {
        Shipper: party(shipFrom, { ShipperNumber: accountNumber }),
        ShipTo: party(shipTo),
        ShipFrom: party(shipFrom),
        PaymentInformation: { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: accountNumber } }] },
        Service: { Code: serviceCode },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "X" },
        Package: [{ ...upsPackage(parcel, "Packaging"), ReferenceNumber: [{ Value: cut(reference, 35) }] }],
      },
      LabelSpecification: {
        LabelImageFormat: { Code: labelFormat === "zpl" ? "ZPL" : "GIF" },
        LabelStockSize: { Height: "6", Width: "4" },
      },
    },
  };
}
```

`apps/api/src/services/shipping/carriers/ups-responses.js`:

```js
import { toCents } from "@my-app/shared";
import { upsServiceName } from "./ups-requests.js";
import { normalizeCarrierStatus } from "./carrier-status.js";

/**
 * Pure UPS response parsers. Dollars become cents HERE, once. UPS returns an
 * object instead of a one-item array (RatedShipment, PackageResults,
 * activity), so every list goes through `list`.
 */
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const cents = (v) => {
  try {
    return toCents(v);
  } catch {
    return null;
  }
};

export function parseUpsError(body) {
  const e = list(body?.response?.errors)[0];
  return e ? { code: e.code, message: e.message } : {};
}

export const parseUpsToken = (body) => ({ accessToken: body?.access_token, expiresInSec: Number(body?.expires_in) });

export function parseUpsRates(body) {
  return list(body?.RateResponse?.RatedShipment)
    .map((r) => {
      const code = r?.Service?.Code;
      const days = Number(r?.GuaranteedDelivery?.BusinessDaysInTransit);
      return {
        carrier: "ups",
        serviceCode: code,
        serviceName: upsServiceName(code),
        amountCents: cents(r?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? r?.TotalCharges?.MonetaryValue),
        estimatedDelivery: Number.isInteger(days) && days > 0 ? `${days} business day${days === 1 ? "" : "s"}` : null,
      };
    })
    .filter((q) => q.serviceCode && Number.isSafeInteger(q.amountCents));
}

/** The bought label, or null when the success body can't be read (the adapter treats that as uncertain). */
export function parseUpsLabel(body, { serviceCode, labelFormat }) {
  const r = body?.ShipmentResponse?.ShipmentResults;
  const pkg = list(r?.PackageResults)[0];
  const image = pkg?.ShippingLabel?.GraphicImage;
  const trackingNumber = pkg?.TrackingNumber ?? r?.ShipmentIdentificationNumber;
  if (!r?.ShipmentIdentificationNumber || !trackingNumber || !image) return null;
  return {
    trackingNumber,
    carrierShipmentId: r.ShipmentIdentificationNumber,
    labelFormat: labelFormat === "zpl" ? "zpl" : "gif",
    labelData: image,
    chargeCents: cents(r?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? r?.ShipmentCharges?.TotalCharges?.MonetaryValue) ?? 0,
    currency: r?.ShipmentCharges?.TotalCharges?.CurrencyCode ?? "USD",
    serviceCode,
    serviceName: upsServiceName(serviceCode),
  };
}

export function parseUpsVoid(body) {
  const status = body?.VoidShipmentResponse?.Response?.ResponseStatus;
  return status?.Code === "1" ? { ok: true } : { ok: false, reason: status?.Description || "UPS did not confirm the void." };
}

// UPS gives a date (YYYYMMDD) and time (HHMMSS) in the scan's local time with
// no zone; read as UTC, which is close enough for a timeline.
function scanTime(a) {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(a?.date ?? "");
  if (!d) return null;
  const t = /^(\d{2})(\d{2})(\d{2})$/.exec(a?.time ?? "") ?? [null, "00", "00", "00"];
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]));
}
const place = (addr) => [addr?.city, addr?.stateProvince].filter(Boolean).join(", ") || null;

export function parseUpsTrack(body, inquiry) {
  const pkg = list(list(body?.trackResponse?.shipment)[0]?.package)[0];
  const events = list(pkg?.activity)
    .map((a) => ({
      status: normalizeCarrierStatus("ups", a?.status?.type, a?.status?.description),
      carrierCode: a?.status?.type ?? null,
      description: a?.status?.description ?? null,
      location: place(a?.location?.address),
      occurredAt: scanTime(a),
    }))
    .sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));
  const latest = events[0];
  if (!latest) {
    return { trackingNumber: pkg?.trackingNumber ?? inquiry, status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [] };
  }
  return {
    trackingNumber: pkg.trackingNumber ?? inquiry,
    status: latest.status,
    carrierCode: latest.carrierCode,
    description: latest.description,
    location: latest.location,
    occurredAt: latest.occurredAt,
    deliveredAt: latest.status === "delivered" ? latest.occurredAt : null,
    events,
  };
}
```

`apps/api/src/services/shipping/carriers/ups.adapter.js`:

```js
import { createId } from "../../../lib/id.js";
import { carrierRequest, TIMEOUTS } from "../carrier-http.js";
import { CarrierError, carrierProblem } from "../shipping-errors.js";
import { sharedTokenCache } from "../oauth-token-cache.js";
import { missingConfigReason } from "../carrier-config.js";
import { upsPaths, upsTokenForm, upsRateRequest, upsShipRequest } from "./ups-requests.js";
import { parseUpsError, parseUpsToken, parseUpsRates, parseUpsLabel, parseUpsVoid, parseUpsTrack } from "./ups-responses.js";

/** UPS behind the carrier adapter interface (carrier-registry.js). Plain fetch; no UPS SDK exists worth using. */
export function createUpsAdapter({ config, fetchImpl = globalThis.fetch, tokenCache = sharedTokenCache }) {
  const cfg = config.ups;
  const tokenKey = `ups:${config.carrierEnv}`;
  const url = (path) => `${cfg.host}${path}`;
  const request = (opts) => carrierRequest({ carrier: "ups", fetchImpl, parseError: parseUpsError, ...opts });

  const token = () =>
    tokenCache.get(tokenKey, async () =>
      parseUpsToken(await request({
        url: url(upsPaths.token),
        form: upsTokenForm(),
        timeoutMs: TIMEOUTS.token,
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
          "x-merchant-id": cfg.accountNumber,
        },
      })));

  async function authed(opts) {
    const headers = { Authorization: `Bearer ${await token()}`, transId: createId().slice(0, 32), transactionSrc: "diamond-labs" };
    try {
      return await request({ ...opts, headers });
    } catch (err) {
      if (err instanceof CarrierError && err.httpStatus === 401) tokenCache.clear(tokenKey);
      throw err;
    }
  }

  return {
    id: "ups",
    label: "UPS",
    tracks: true,
    configured() {
      const reason = missingConfigReason(
        "UPS",
        { UPS_CLIENT_ID: cfg.clientId, UPS_CLIENT_SECRET: cfg.clientSecret, UPS_ACCOUNT_NUMBER: cfg.accountNumber },
        config.shipFrom,
      );
      return reason ? { ok: false, reason } : { ok: true };
    },
    async rate({ shipFrom, shipTo, parcel }) {
      const body = await authed({ url: url(upsPaths.rate), json: upsRateRequest({ shipFrom, shipTo, parcel, accountNumber: cfg.accountNumber }), timeoutMs: TIMEOUTS.rate });
      return parseUpsRates(body);
    },
    async createLabel({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat = config.labelFormat }) {
      const body = await authed({
        url: url(upsPaths.ship),
        json: upsShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber: cfg.accountNumber }),
        timeoutMs: TIMEOUTS.purchase,
        purchase: true,
      });
      const label = parseUpsLabel(body, { serviceCode, labelFormat });
      if (!label) throw new CarrierError("ups", "BAD_RESPONSE", "UPS accepted the shipment but its label couldn't be read.", { uncertain: true });
      return label;
    },
    async voidLabel({ carrierShipmentId }) {
      try {
        return parseUpsVoid(await authed({ method: "DELETE", url: url(upsPaths.void(carrierShipmentId)), timeoutMs: TIMEOUTS.void }));
      } catch (err) {
        if (err instanceof CarrierError) return { ok: false, reason: err.message };
        throw err;
      }
    },
    async track(trackingNumbers) {
      const out = [];
      // UPS tracks one inquiry number per request.
      for (const n of trackingNumbers) {
        try {
          out.push(parseUpsTrack(await authed({ method: "GET", url: url(upsPaths.track(n)), timeoutMs: TIMEOUTS.track }), n));
        } catch (err) {
          if (!(err instanceof CarrierError)) throw err;
          out.push({ trackingNumber: n, status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [], error: carrierProblem(err) });
        }
      }
      return out;
    },
  };
}
```

In `apps/api/src/services/shipping/carrier-registry.js`, import the factory and register it first:

```js
import { createUpsAdapter } from "./carriers/ups.adapter.js";
```

```js
const FACTORIES = {
  ups: createUpsAdapter,
  manual: createManualAdapter,
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/shipping`
Expected: PASS, including `adapter-contract.test.js`, which now also runs for `ups`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/shipping apps/api/test-fixtures/carriers/ups
git commit -m "feat(shipping): UPS adapter (rate, label, void, track) with fixtures

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: FedEx adapter: requests, responses, status table, fixtures

**Files:**
- Create:
  - `fedex-requests.js`, `fedex-responses.js` and `fedex.adapter.js` in `apps/api/src/services/shipping/carriers/`, each with a `.test.js`;
  - fixtures `apps/api/test-fixtures/carriers/fedex/rate.json`, `ship.json`, `cancel.json`, `track.json`, `error.json`.
- Modify: `apps/api/src/services/shipping/carrier-registry.js` (one factory line), `apps/api/src/services/shipping/carriers/adapter-contract.test.js` (one test)

**Interfaces:**
- Consumes: as Task 5, plus `normalizeCarrierStatus` (Task 5) and `formatUsDate` (shared).
- Produces: `createFedexAdapter({ config, fetchImpl, tokenCache })`, plus pure `fedexRateRequest`, `fedexShipRequest`, `fedexCancelRequest`, `fedexTrackRequest`, `fedexPaths`, `FEDEX_CANCEL_METHOD`, `FEDEX_TRACK_BATCH`, `parseFedexError`, `parseFedexToken`, `parseFedexRates`, `parseFedexLabel`, `parseFedexCancel`, `parseFedexTrack`.

FedEx facts used here, from the research note:
- **[V] Verified:**
  - OAuth: form `grant_type=client_credentials&client_id&client_secret`, 1-hour tokens, and a 10-minute lockout above ~1 request/second.
  - Label `imageType` PDF/PNG/ZPLII/EPL2 and stock `PAPER_4X6` / `STOCK_4X6`.
  - Track takes at most 30 numbers per request.
  - Only an untendered shipment can be cancelled.
- **[3P/MEM] To be confirmed by the smoke script:**
  - the paths and JSON field names;
  - the cancel method/path (**isolated in two constants**).

- [ ] **Step 1: Write the fixtures**

`apps/api/test-fixtures/carriers/fedex/rate.json`:

```json
{
  "transactionId": "fixture-rate",
  "output": {
    "rateReplyDetails": [
      {
        "serviceType": "FEDEX_GROUND",
        "serviceName": "FedEx Ground®",
        "packagingType": "YOUR_PACKAGING",
        "ratedShipmentDetails": [
          { "rateType": "ACCOUNT", "totalNetCharge": 12.38 },
          { "rateType": "LIST", "totalNetCharge": 15.9 }
        ],
        "commit": { "dateDetail": { "dayFormat": "2026-10-23T23:59:00" } }
      },
      {
        "serviceType": "FEDEX_2_DAY",
        "serviceName": "FedEx 2Day®",
        "packagingType": "YOUR_PACKAGING",
        "ratedShipmentDetails": [{ "rateType": "LIST", "totalNetCharge": 31.07 }],
        "commit": { "dateDetail": { "dayFormat": "2026-10-22T16:30:00" } }
      }
    ]
  }
}
```

`apps/api/test-fixtures/carriers/fedex/ship.json`:

```json
{
  "transactionId": "fixture-ship",
  "output": {
    "transactionShipments": [
      {
        "masterTrackingNumber": "794644790138",
        "serviceType": "FEDEX_GROUND",
        "serviceName": "FedEx Ground®",
        "shipDatestamp": "2026-10-20",
        "pieceResponses": [
          {
            "trackingNumber": "794644790138",
            "packageDocuments": [
              { "contentType": "LABEL", "docType": "PNG", "encodedLabel": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }
            ]
          }
        ],
        "completedShipmentDetail": {
          "shipmentRating": {
            "shipmentRateDetails": [
              { "rateType": "PAYOR_ACCOUNT_PACKAGE", "totalNetCharge": 12.38 },
              { "rateType": "PAYOR_LIST_PACKAGE", "totalNetCharge": 15.9 }
            ]
          }
        }
      }
    ]
  }
}
```

`apps/api/test-fixtures/carriers/fedex/cancel.json`:

```json
{ "transactionId": "fixture-cancel", "output": { "cancelledShipment": true, "message": "Shipment is successfully cancelled" } }
```

`apps/api/test-fixtures/carriers/fedex/track.json`:

```json
{
  "transactionId": "fixture-track",
  "output": {
    "completeTrackResults": [
      {
        "trackingNumber": "794644790138",
        "trackResults": [
          {
            "latestStatusDetail": { "code": "IT", "derivedCode": "IT", "description": "In transit", "scanLocation": { "city": "SAN ANTONIO", "stateOrProvinceCode": "TX" } },
            "dateAndTimes": [{ "type": "ACTUAL_PICKUP", "dateTime": "2026-10-20T17:10:00-05:00" }],
            "scanEvents": [
              { "date": "2026-10-20T17:10:00-05:00", "eventType": "PU", "eventDescription": "Picked up", "derivedStatusCode": "PU", "scanLocation": { "city": "SAN ANTONIO", "stateOrProvinceCode": "TX" } },
              { "date": "2026-10-21T03:12:00-05:00", "eventType": "DP", "eventDescription": "Departed FedEx location", "derivedStatusCode": "IT", "scanLocation": { "city": "SAN ANTONIO", "stateOrProvinceCode": "TX" } }
            ]
          }
        ]
      },
      {
        "trackingNumber": "794644790199",
        "trackResults": [
          {
            "latestStatusDetail": { "code": "DL", "derivedCode": "DL", "description": "Delivered", "scanLocation": { "city": "AUSTIN", "stateOrProvinceCode": "TX" } },
            "dateAndTimes": [{ "type": "ACTUAL_DELIVERY", "dateTime": "2026-10-22T14:21:00-05:00" }],
            "scanEvents": []
          }
        ]
      },
      {
        "trackingNumber": "000000000000",
        "trackResults": [
          { "error": { "code": "TRACKING.TRACKINGNUMBER.NOTFOUND", "message": "Tracking number cannot be found. Please correct the tracking number and try again." } }
        ]
      }
    ]
  }
}
```

`apps/api/test-fixtures/carriers/fedex/error.json`:

```json
{ "transactionId": "fixture-error", "errors": [{ "code": "SERVICE.PACKAGECOMBINATION.INVALID", "message": "Invalid service and packaging combination." }] }
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/services/shipping/carriers/fedex-requests.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { fedexRateRequest, fedexShipRequest, fedexCancelRequest, fedexTrackRequest, fedexPaths, FEDEX_TRACK_BATCH } from "./fedex-requests.js";
import { TEST_SHIP_FROM } from "../../../test/carrier-config.js";

const shipTo = { name: "Dr. Ada Smile", company: "Smile Dental", phone: null, address1: "100 Main St", address2: "Suite 4", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 40, lengthIn: 8.5, widthIn: 6, heightIn: 4 };

test("rating asks for account and list rates for every service on the lab's account", () => {
  const r = fedexRateRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, accountNumber: "740561073" });
  assert.deepEqual(r.accountNumber, { value: "740561073" });
  assert.deepEqual(r.requestedShipment.rateRequestType, ["ACCOUNT", "LIST"]);
  assert.equal("serviceType" in r.requestedShipment, false, "no service = every service is rated");
  assert.deepEqual(r.requestedShipment.requestedPackageLineItems[0].weight, { units: "LB", value: 2.5 });
  assert.deepEqual(r.requestedShipment.recipient.address.streetLines, ["100 Main St", "Suite 4"]);
});

test("a recipient with no phone gets the lab's phone (FedEx requires one)", () => {
  const s = fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 100245", labelFormat: "image", accountNumber: "740561073" });
  assert.equal(s.requestedShipment.recipients[0].contact.phoneNumber, "2105550199");
  assert.equal(s.requestedShipment.recipients[0].contact.companyName, "Smile Dental");
  assert.equal(fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo: { ...shipTo, phone: "512-555-0123" }, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1", labelFormat: "image", accountNumber: "A" })
    .requestedShipment.recipients[0].contact.phoneNumber, "5125550123");
});

test("the label request: PNG on paper or ZPLII on thermal 4×6, sender pays, order numbers as the only reference", () => {
  const png = fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 100245", labelFormat: "image", accountNumber: "740561073" });
  assert.equal(png.labelResponseOptions, "LABEL");
  assert.deepEqual(png.requestedShipment.labelSpecification, { imageType: "PNG", labelStockType: "PAPER_4X6" });
  assert.deepEqual(png.requestedShipment.shippingChargesPayment, { paymentType: "SENDER" });
  assert.equal(png.requestedShipment.serviceType, "FEDEX_GROUND");
  assert.deepEqual(png.requestedShipment.requestedPackageLineItems[0].customerReferences, [{ customerReferenceType: "CUSTOMER_REFERENCE", value: "Order 100245" }]);
  assert.deepEqual(png.requestedShipment.requestedPackageLineItems[0].dimensions, { length: 9, width: 6, height: 4, units: "IN" });
  const zpl = fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1", labelFormat: "zpl", accountNumber: "A" });
  assert.deepEqual(zpl.requestedShipment.labelSpecification, { imageType: "ZPLII", labelStockType: "STOCK_4X6" });
});

test("cancel and track bodies; track batches stay within FedEx's 30-number limit", () => {
  assert.deepEqual(fedexCancelRequest({ trackingNumber: "794644790138", accountNumber: "A" }), {
    accountNumber: { value: "A" }, trackingNumber: "794644790138", deletionControl: "DELETE_ALL_PACKAGES", emailShipment: false, senderCountryCode: "US",
  });
  assert.equal(FEDEX_TRACK_BATCH, 30);
  assert.deepEqual(fedexTrackRequest(["1", "2"]).trackingInfo, [{ trackingNumberInfo: { trackingNumber: "1" } }, { trackingNumberInfo: { trackingNumber: "2" } }]);
  assert.equal(fedexPaths.ship, "/ship/v1/shipments");
});
```

`apps/api/src/services/shipping/carriers/fedex-responses.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseFedexRates, parseFedexLabel, parseFedexCancel, parseFedexTrack, parseFedexError, parseFedexToken } from "./fedex-responses.js";
import { fixture } from "../../../test/carrier-config.js";

test("rates: the account rate when present, list otherwise; cents; tidy names; an arrival date", () => {
  const [ground, twoDay] = parseFedexRates(fixture("fedex", "rate"));
  assert.deepEqual(ground, { carrier: "fedex", serviceCode: "FEDEX_GROUND", serviceName: "FedEx Ground", amountCents: 1238, estimatedDelivery: "by 10/23/2026" });
  assert.equal(twoDay.amountCents, 3107);
  assert.deepEqual(parseFedexRates({}), []);
});

test("label: tracking number, the PNG, the account charge in cents", () => {
  assert.deepEqual(parseFedexLabel(fixture("fedex", "ship"), { serviceCode: "FEDEX_GROUND", labelFormat: "image" }), {
    trackingNumber: "794644790138", carrierShipmentId: "794644790138", labelFormat: "png",
    labelData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    chargeCents: 1238, currency: "USD", serviceCode: "FEDEX_GROUND", serviceName: "FedEx Ground",
  });
  assert.equal(parseFedexLabel({ output: {} }, { serviceCode: "FEDEX_GROUND" }), null);
});

test("cancel: confirmed or FedEx's reason", () => {
  assert.deepEqual(parseFedexCancel(fixture("fedex", "cancel")), { ok: true });
  assert.deepEqual(parseFedexCancel({ output: { cancelledShipment: false, message: "Already tendered" } }), { ok: false, reason: "Already tendered" });
});

test("track: one result per number; a per-number error stays with its number; delivered carries the delivery time", () => {
  const [moving, delivered, missing] = parseFedexTrack(fixture("fedex", "track"));
  assert.equal(moving.status, "in_transit");
  assert.equal(moving.location, "SAN ANTONIO, TX");
  assert.equal(moving.occurredAt.toISOString(), "2026-10-21T08:12:00.000Z", "newest scan, whatever the order");
  assert.equal(moving.deliveredAt, null);
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.deliveredAt.toISOString(), "2026-10-22T19:21:00.000Z");
  assert.equal(missing.status, null);
  assert.equal(missing.error.code, "TRACKING.TRACKINGNUMBER.NOTFOUND");
});

test("errors and tokens", () => {
  assert.deepEqual(parseFedexError(fixture("fedex", "error")), { code: "SERVICE.PACKAGECOMBINATION.INVALID", message: "Invalid service and packaging combination." });
  assert.deepEqual(parseFedexToken({ access_token: "t", expires_in: 3599 }), { accessToken: "t", expiresInSec: 3599 });
});
```

`apps/api/src/services/shipping/carriers/fedex.adapter.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { createFedexAdapter } from "./fedex.adapter.js";
import { FEDEX_CANCEL_METHOD } from "./fedex-requests.js";
import { createTokenCache } from "../oauth-token-cache.js";
import { CarrierError } from "../shipping-errors.js";
import { testCarrierConfig, TEST_SHIP_FROM, fakeFetch, fixture } from "../../../test/carrier-config.js";

const TOKEN = { status: 200, body: { access_token: "fx-tok", expires_in: 3599 } };
const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const make = (answers, over) => {
  const fetchImpl = fakeFetch(answers);
  return { fetchImpl, fedex: createFedexAdapter({ config: testCarrierConfig(over), fetchImpl, tokenCache: createTokenCache() }) };
};

test("the token call sends the API key and secret as a form; API calls are Bearer", async () => {
  const { fedex, fetchImpl } = make([TOKEN, { status: 200, body: fixture("fedex", "rate") }]);
  await fedex.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls[0].url, "https://fedex.test/oauth/token");
  assert.equal(fetchImpl.calls[0].body, "grant_type=client_credentials&client_id=fx-test-key&client_secret=fx-test-secret");
  assert.equal(fetchImpl.calls[1].url, "https://fedex.test/rate/v1/rates/quotes");
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, "Bearer fx-tok");
});

test("a purchase answered with a 5xx is uncertain; a 4xx is a definite refusal", async () => {
  const fivexx = make([TOKEN, { status: 503, body: {} }]);
  await assert.rejects(fivexx.fedex.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1" }), (e) => e.uncertain === true);
  const fourxx = make([TOKEN, { status: 422, body: fixture("fedex", "error") }]);
  await assert.rejects(fourxx.fedex.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1" }),
    (e) => e instanceof CarrierError && e.uncertain === false && e.code === "SERVICE.PACKAGECOMBINATION.INVALID");
});

test("void cancels by tracking number with the configured (sandbox-verified) method", async () => {
  const { fedex, fetchImpl } = make([TOKEN, { status: 200, body: fixture("fedex", "cancel") }]);
  assert.deepEqual(await fedex.voidLabel({ trackingNumber: "794644790138", carrierShipmentId: "794644790138" }), { ok: true });
  assert.equal(fetchImpl.calls[1].init.method, FEDEX_CANCEL_METHOD);
});

test("track: batches of 30; a failed batch marks only its own numbers", async () => {
  const numbers = Array.from({ length: 31 }, (_, i) => `79464479${String(i).padStart(4, "0")}`);
  const last = { trackingNumber: numbers[30], trackResults: [{ latestStatusDetail: { code: "IT", description: "In transit" }, scanEvents: [] }] };
  const { fedex, fetchImpl } = make([TOKEN, { status: 500, body: {} }, { status: 200, body: { output: { completeTrackResults: [last] } } }]);
  const out = await fedex.track(numbers);
  assert.equal(fetchImpl.calls.length, 3, "token + two batches");
  assert.equal(JSON.parse(fetchImpl.calls[1].body).trackingInfo.length, 30);
  assert.equal(JSON.parse(fetchImpl.calls[2].body).trackingInfo.length, 1);
  assert.equal(out.length, 31);
  assert.equal(out.filter((r) => r.error).length, 30, "only the failed batch's numbers carry the error");
  assert.equal(out[30].status, "in_transit");
});

test("track: a number FedEx leaves out of its answer still gets a result (with a reason)", async () => {
  const { fedex } = make([TOKEN, { status: 200, body: { output: { completeTrackResults: [] } } }]);
  const [r] = await fedex.track(["794644790138"]);
  assert.equal(r.status, null);
  assert.equal(r.error.code, "NO_RESULT");
});

test("configured: names the missing FedEx variables", () => {
  const { fedex } = make([], { fedex: { ...testCarrierConfig().fedex, apiKey: "", secretKey: "" } });
  assert.deepEqual(fedex.configured(), { ok: false, reason: "FedEx: credentials not set (FEDEX_API_KEY, FEDEX_SECRET_KEY)" });
});
```

Append to `adapter-contract.test.js`:

```js
test("UPS, FedEx and manual are all registered", () => {
  assert.deepEqual([...CARRIER_IDS].sort(), ["fedex", "manual", "ups"]);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/shipping/carriers`
Expected: FAIL. The FedEx modules don't exist.

- [ ] **Step 4: Write the FedEx builders, parsers and adapter**

`apps/api/src/services/shipping/carriers/fedex-requests.js`:

```js
import { weightLbFromOz } from "@my-app/shared";

/**
 * Pure FedEx request builders. Field names follow the research note
 * (2026-10-19-carrier-api-research.md); those marked [MEM] there are proven by
 * the sandbox smoke script before go-live.
 */
export const fedexPaths = {
  token: "/oauth/token",
  rate: "/rate/v1/rates/quotes",
  ship: "/ship/v1/shipments",
  // [UNVERIFIED] FedEx's cancel is documented two ways: PUT /ship/v1/shipments/cancel
  // (FedEx community) vs DELETE /ship/v1/shipments/{trackingNumber} (third party).
  // The smoke script confirms which before go-live; change only these two constants.
  cancel: "/ship/v1/shipments/cancel",
  track: "/track/v1/trackingnumbers",
};
export const FEDEX_CANCEL_METHOD = "PUT";
/** FedEx tracks at most 30 numbers per request. */
export const FEDEX_TRACK_BATCH = 30;

const cut = (s, n) => (s == null ? undefined : String(s).trim().slice(0, n) || undefined);
const digits = (s) => String(s ?? "").replace(/\D/g, "").slice(0, 15) || undefined;

function fedexAddress(a) {
  return {
    streetLines: [a.address1, a.address2].filter(Boolean).map((l) => cut(l, 35)),
    city: cut(a.city, 35),
    stateOrProvinceCode: a.state,
    postalCode: a.postalCode,
    countryCode: a.country || "US",
    ...(a.residential ? { residential: true } : {}),
  };
}

/** FedEx requires a phone on every party; a recipient without one gets `fallbackPhone` (the lab's). */
function contact(a, fallbackPhone) {
  return {
    personName: cut(a.name, 35),
    ...(a.company ? { companyName: cut(a.company, 35) } : {}),
    phoneNumber: digits(a.phone) ?? digits(fallbackPhone),
  };
}

function lineItem(parcel, reference) {
  return {
    weight: { units: "LB", value: weightLbFromOz(parcel.weightOz) },
    // FedEx truncates decimal dimensions for rating; round up instead so the box is never under-declared.
    dimensions: { length: Math.ceil(parcel.lengthIn), width: Math.ceil(parcel.widthIn), height: Math.ceil(parcel.heightIn), units: "IN" },
    ...(reference ? { customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: cut(reference, 30) }] } : {}),
  };
}

export const fedexTokenForm = ({ apiKey, secretKey }) => ({ grant_type: "client_credentials", client_id: apiKey, client_secret: secretKey });

export function fedexRateRequest({ shipFrom, shipTo, parcel, accountNumber }) {
  return {
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipper: { address: fedexAddress(shipFrom) },
      recipient: { address: fedexAddress(shipTo) },
      pickupType: "USE_SCHEDULED_PICKUP",
      rateRequestType: ["ACCOUNT", "LIST"],
      requestedPackageLineItems: [lineItem(parcel)],
    },
  };
}

export function fedexShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber }) {
  const zpl = labelFormat === "zpl";
  return {
    labelResponseOptions: "LABEL",
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipper: { contact: contact(shipFrom), address: fedexAddress(shipFrom) },
      recipients: [{ contact: contact(shipTo, shipFrom.phone), address: fedexAddress(shipTo) }],
      pickupType: "USE_SCHEDULED_PICKUP",
      serviceType: serviceCode,
      packagingType: "YOUR_PACKAGING",
      shippingChargesPayment: { paymentType: "SENDER" },
      labelSpecification: { imageType: zpl ? "ZPLII" : "PNG", labelStockType: zpl ? "STOCK_4X6" : "PAPER_4X6" },
      requestedPackageLineItems: [lineItem(parcel, reference)],
    },
  };
}

export const fedexCancelRequest = ({ trackingNumber, accountNumber }) => ({
  accountNumber: { value: accountNumber }, trackingNumber, deletionControl: "DELETE_ALL_PACKAGES", emailShipment: false, senderCountryCode: "US",
});

export const fedexTrackRequest = (numbers) => ({
  includeDetailedScans: true,
  trackingInfo: numbers.map((n) => ({ trackingNumberInfo: { trackingNumber: n } })),
});
```

`apps/api/src/services/shipping/carriers/fedex-responses.js`:

```js
import { toCents, formatUsDate } from "@my-app/shared";
import { normalizeCarrierStatus } from "./carrier-status.js";

/** Pure FedEx response parsers. Dollars (JSON numbers) become cents HERE, once. */
const cents = (v) => {
  try {
    return toCents(v);
  } catch {
    return null;
  }
};
const tidy = (name) => (name ? String(name).replace(/[®™]/g, "").trim() : null);
/** The account (negotiated) rate when FedEx sent one, else the first. */
const accountCharge = (details = []) => (details.find((d) => /ACCOUNT/.test(d?.rateType ?? "")) ?? details[0])?.totalNetCharge;
const place = (loc) => [loc?.city, loc?.stateOrProvinceCode].filter(Boolean).join(", ") || null;
const when = (s) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export function parseFedexError(body) {
  const e = body?.errors?.[0];
  return e ? { code: e.code, message: e.message } : {};
}

export const parseFedexToken = (body) => ({ accessToken: body?.access_token, expiresInSec: Number(body?.expires_in) });

export function parseFedexRates(body) {
  return (body?.output?.rateReplyDetails ?? [])
    .map((r) => {
      const by = formatUsDate(r?.commit?.dateDetail?.dayFormat ?? "");
      return {
        carrier: "fedex",
        serviceCode: r?.serviceType,
        serviceName: tidy(r?.serviceName) || `FedEx ${r?.serviceType}`,
        amountCents: cents(accountCharge(r?.ratedShipmentDetails)),
        estimatedDelivery: by ? `by ${by}` : null,
      };
    })
    .filter((q) => q.serviceCode && Number.isSafeInteger(q.amountCents));
}

/** The bought label, or null when the success body can't be read (the adapter treats that as uncertain). */
export function parseFedexLabel(body, { serviceCode, labelFormat }) {
  const s = body?.output?.transactionShipments?.[0];
  const piece = s?.pieceResponses?.[0];
  const doc = (piece?.packageDocuments ?? []).find((d) => d?.encodedLabel);
  const trackingNumber = piece?.trackingNumber ?? s?.masterTrackingNumber;
  if (!trackingNumber || !doc) return null;
  return {
    trackingNumber,
    carrierShipmentId: s.masterTrackingNumber ?? trackingNumber,
    labelFormat: labelFormat === "zpl" ? "zpl" : "png",
    labelData: doc.encodedLabel,
    chargeCents: cents(accountCharge(s?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails)) ?? 0,
    currency: "USD",
    serviceCode,
    serviceName: tidy(s.serviceName) || `FedEx ${serviceCode}`,
  };
}

export function parseFedexCancel(body) {
  return body?.output?.cancelledShipment === true
    ? { ok: true }
    : { ok: false, reason: body?.output?.message || "FedEx did not confirm the cancellation." };
}

function trackResult(c) {
  const r = c?.trackResults?.[0] ?? {};
  const empty = { trackingNumber: c?.trackingNumber, status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [] };
  if (r.error) return { ...empty, error: { carrier: "fedex", code: r.error.code, message: r.error.message } };
  const latest = r.latestStatusDetail ?? {};
  const status = normalizeCarrierStatus("fedex", latest.code, latest.description);
  const events = (r.scanEvents ?? [])
    .map((e) => ({
      status: normalizeCarrierStatus("fedex", e.derivedStatusCode || e.eventType, e.eventDescription),
      carrierCode: e.derivedStatusCode || e.eventType || null,
      description: e.eventDescription ?? null,
      location: place(e.scanLocation),
      occurredAt: when(e.date),
    }))
    .sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));
  const delivered = when((r.dateAndTimes ?? []).find((d) => d.type === "ACTUAL_DELIVERY")?.dateTime);
  return {
    ...empty,
    status,
    carrierCode: latest.code ?? null,
    description: latest.description ?? null,
    location: place(latest.scanLocation),
    occurredAt: events[0]?.occurredAt ?? delivered,
    deliveredAt: status === "delivered" ? delivered : null,
    events,
  };
}

export const parseFedexTrack = (body) => (body?.output?.completeTrackResults ?? []).map(trackResult);
```

`apps/api/src/services/shipping/carriers/fedex.adapter.js`:

```js
import { carrierRequest, TIMEOUTS } from "../carrier-http.js";
import { CarrierError, carrierProblem } from "../shipping-errors.js";
import { sharedTokenCache } from "../oauth-token-cache.js";
import { missingConfigReason } from "../carrier-config.js";
import {
  fedexPaths, FEDEX_CANCEL_METHOD, FEDEX_TRACK_BATCH, fedexTokenForm, fedexRateRequest, fedexShipRequest, fedexCancelRequest, fedexTrackRequest,
} from "./fedex-requests.js";
import { parseFedexError, parseFedexToken, parseFedexRates, parseFedexLabel, parseFedexCancel, parseFedexTrack } from "./fedex-responses.js";

const blank = (n, error) => ({ trackingNumber: n, status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [], ...(error ? { error } : {}) });

/** FedEx behind the carrier adapter interface (carrier-registry.js). Plain fetch; FedEx has no official Node client. */
export function createFedexAdapter({ config, fetchImpl = globalThis.fetch, tokenCache = sharedTokenCache }) {
  const cfg = config.fedex;
  const tokenKey = `fedex:${config.carrierEnv}`;
  const url = (path) => `${cfg.host}${path}`;
  const request = (opts) => carrierRequest({ carrier: "fedex", fetchImpl, parseError: parseFedexError, ...opts });

  // FedEx locks this endpoint for 10 minutes above ~1 rps: only ever reached through the cache.
  const token = () =>
    tokenCache.get(tokenKey, async () =>
      parseFedexToken(await request({ url: url(fedexPaths.token), form: fedexTokenForm(cfg), timeoutMs: TIMEOUTS.token })));

  async function authed(opts) {
    try {
      return await request({ ...opts, headers: { Authorization: `Bearer ${await token()}`, "X-locale": "en_US" } });
    } catch (err) {
      if (err instanceof CarrierError && err.httpStatus === 401) tokenCache.clear(tokenKey);
      throw err;
    }
  }

  async function trackBatch(numbers) {
    try {
      const byNumber = new Map(parseFedexTrack(await authed({ url: url(fedexPaths.track), json: fedexTrackRequest(numbers), timeoutMs: TIMEOUTS.track }))
        .map((r) => [r.trackingNumber, r]));
      return numbers.map((n) => byNumber.get(n) ?? blank(n, { carrier: "fedex", code: "NO_RESULT", message: "FedEx returned no result for this number." }));
    } catch (err) {
      if (!(err instanceof CarrierError)) throw err;
      return numbers.map((n) => blank(n, carrierProblem(err)));
    }
  }

  return {
    id: "fedex",
    label: "FedEx",
    tracks: true,
    configured() {
      const reason = missingConfigReason(
        "FedEx",
        { FEDEX_API_KEY: cfg.apiKey, FEDEX_SECRET_KEY: cfg.secretKey, FEDEX_ACCOUNT_NUMBER: cfg.accountNumber },
        config.shipFrom,
      );
      return reason ? { ok: false, reason } : { ok: true };
    },
    async rate({ shipFrom, shipTo, parcel }) {
      return parseFedexRates(await authed({ url: url(fedexPaths.rate), json: fedexRateRequest({ shipFrom, shipTo, parcel, accountNumber: cfg.accountNumber }), timeoutMs: TIMEOUTS.rate }));
    },
    async createLabel({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat = config.labelFormat }) {
      const body = await authed({
        url: url(fedexPaths.ship),
        json: fedexShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber: cfg.accountNumber }),
        timeoutMs: TIMEOUTS.purchase,
        purchase: true,
      });
      const label = parseFedexLabel(body, { serviceCode, labelFormat });
      if (!label) throw new CarrierError("fedex", "BAD_RESPONSE", "FedEx accepted the shipment but its label couldn't be read.", { uncertain: true });
      return label;
    },
    async voidLabel({ trackingNumber }) {
      try {
        return parseFedexCancel(await authed({
          method: FEDEX_CANCEL_METHOD, url: url(fedexPaths.cancel),
          json: fedexCancelRequest({ trackingNumber, accountNumber: cfg.accountNumber }), timeoutMs: TIMEOUTS.void,
        }));
      } catch (err) {
        if (err instanceof CarrierError) return { ok: false, reason: err.message };
        throw err;
      }
    },
    async track(trackingNumbers) {
      const out = [];
      for (let i = 0; i < trackingNumbers.length; i += FEDEX_TRACK_BATCH) out.push(...(await trackBatch(trackingNumbers.slice(i, i + FEDEX_TRACK_BATCH))));
      return out;
    },
  };
}
```

In `apps/api/src/services/shipping/carrier-registry.js`:

```js
import { createFedexAdapter } from "./carriers/fedex.adapter.js";
```

```js
const FACTORIES = {
  ups: createUpsAdapter,
  fedex: createFedexAdapter,
  manual: createManualAdapter,
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/shipping`
Expected: PASS. The contract test now covers ups, fedex and manual.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/shipping apps/api/test-fixtures/carriers/fedex
git commit -m "feat(shipping): FedEx adapter (rate, label, cancel, batched track) with fixtures

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Generic shipments service: rate-all, buy (uncertain), purchase-and-persist (orphan void), void, stamp shipped, tracking rules

**Files:**
- Create: `apps/api/src/services/shipping/shipment-rules.js`, `apps/api/src/services/shipping/shipment-rules.test.js`, `apps/api/src/services/shipping/shipments.service.js`, `apps/api/src/services/shipping/shipments.service.test.js`
- Modify: `apps/api/src/test/carrier-config.js` (add `fakeRegistry`, `fakeAdapter`, `TEST_LABEL`)

**Interfaces:**
- Consumes: the registry and adapter interface, `ShippingError`, `CarrierError`, `carrierProblem` (Task 4); `shipments`, `shipmentEvents` (Task 3).
- Produces (`shipment-rules.js`, pure):
  - `planNewShipment({ id, label, parcel, shipTo, shipFrom, createdByUserId, now }) → { shipment, event }`, where `label` is a `createLabel` result plus `carrier`.
  - `assertVoidable(shipment)` (throws `VOID_REFUSED`) and `planVoided(shipment, { now }) → { patch, event }`.
  - `planTrackingUpdate(shipment, trackResult|undefined, now) → { patch|null, event|null, moved: boolean, unknownCode: string|null }`.
- Produces (`shipments.service.js`):
  - Carrier calls:
    - `rateAll({ shipFrom, shipTo, parcel }, { registry? }) → { quotes: RateQuote[], errors: CarrierProblem[], disabled: Status[] }`;
    - `buyLabel(request, { registry?, log? }) → label & { carrier }`, which throws `PURCHASE_UNCERTAIN` with `gatewayOutcomePending: true`;
    - `purchaseAndPersist(request, persist(label) → Promise<T>, { registry?, log? }) → T`, which throws `LABEL_NOT_SAVED` with `cause`;
    - `voidAtCarrier(shipment, { registry? })`.
  - Writes in the caller's `tx`: `insertShipment(tx, { shipment, event })`, `markVoided(tx, shipment, { now })`, `stampShipped(tx, shipment, { now }) → boolean` (the claim) and `applyTrackingPlan(tx, shipment, plan) → boolean`.
  - Reads:
    - `getShipment(id, database?) → row without labelData | null` and `shipmentSummaries(ids, database?) → Map<id, summary>`;
    - `listShipments(filters, database?) → rows`, `SHIPMENT_LIST_LIMIT`, and `unshippedShipmentIds(database?) → string[]`;
    - `getLabel(id, database?) → { carrier, labelFormat, trackingNumber, bytes: Buffer } | null`.

- [ ] **Step 1: Extend the test helper**

Append to `apps/api/src/test/carrier-config.js`:

```js
/** What a successful UPS createLabel returns (Task 5's parser output for the ship fixture). */
export const TEST_LABEL = {
  trackingNumber: "1Z999AA10123456784", carrierShipmentId: "1Z999AA10123456784", labelFormat: "gif",
  labelData: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", chargeCents: 1142, currency: "USD",
  serviceCode: "03", serviceName: "UPS Ground",
};

/** An adapter double: every method can be overridden; calls are recorded on `.calls`. */
export function fakeAdapter(id, over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...args) => { calls.push([name, ...args]); return fn(...args); };
  return {
    id, label: id.toUpperCase(), tracks: id !== "manual", calls,
    configured: over.configured ?? (() => ({ ok: true })),
    rate: rec("rate", over.rate ?? (async () => [])),
    createLabel: rec("createLabel", over.createLabel ?? (async () => ({ ...TEST_LABEL }))),
    voidLabel: rec("voidLabel", over.voidLabel ?? (async () => ({ ok: true }))),
    track: rec("track", over.track ?? (async () => [])),
  };
}

/** A registry double over the given adapters (the same surface as carrier-registry.js createRegistry). */
export function fakeRegistry(adapters) {
  return {
    get: (id) => {
      const a = adapters.find((x) => x.id === id);
      if (!a) throw new Error(`no adapter ${id}`);
      return a;
    },
    all: () => adapters,
    enabled: () => adapters.filter((a) => a.configured().ok),
    status: () => adapters.map((a) => ({ id: a.id, label: a.label, tracks: a.tracks, ...a.configured() })),
  };
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/services/shipping/shipment-rules.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { planNewShipment, assertVoidable, planVoided, planTrackingUpdate } from "./shipment-rules.js";
import { ShippingError } from "./shipping-errors.js";
import { TEST_LABEL } from "../../test/carrier-config.js";

const now = new Date("2026-10-20T16:00:00Z");
const parcel = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const base = { id: "sh1", status: "label_created", shippedAt: null };
const isRefused = (e) => e instanceof ShippingError && e.code === "VOID_REFUSED";

test("a bought label becomes a label_created shipment and its first event", () => {
  const { shipment, event } = planNewShipment({ id: "sh1", label: { ...TEST_LABEL, carrier: "ups" }, parcel, shipTo, shipFrom: null, createdByUserId: "u1", now });
  assert.equal(shipment.status, "label_created");
  assert.equal(shipment.carrier, "ups");
  assert.equal(shipment.chargeCents, 1142);
  assert.equal(shipment.trackingNumber, "1Z999AA10123456784");
  assert.equal(shipment.purchasedAt, now);
  assert.deepEqual(event, { shipmentId: "sh1", status: "label_created", description: "Label created", location: null, occurredAt: now, source: "carrier" });
});

test("a manual shipment's first event is the staff's", () => {
  const { event } = planNewShipment({ id: "sh2", label: { trackingNumber: null, serviceName: "Courier", serviceCode: "manual", chargeCents: 0, carrier: "manual" }, parcel, shipTo, now });
  assert.equal(event.source, "staff");
  assert.equal(event.description, "Recorded by staff");
});

test("void: only an unused label; a voided or departed one is refused with a reason", () => {
  assert.doesNotThrow(() => assertVoidable(base));
  assert.throws(() => assertVoidable({ ...base, status: "voided" }), isRefused);
  assert.throws(() => assertVoidable({ ...base, status: "in_transit" }), isRefused);
  assert.throws(() => assertVoidable({ ...base, shippedAt: now }), isRefused);
  const { patch, event } = planVoided(base, { now });
  assert.deepEqual(patch, { status: "voided", voidedAt: now, updatedAt: now });
  assert.equal(event.source, "staff");
});

test("tracking: a new status writes one event; the first movement asks for the orders to ship", () => {
  const plan = planTrackingUpdate(base, { status: "in_transit", description: "Pickup Scan", location: "SAN ANTONIO, TX", occurredAt: now }, now);
  assert.equal(plan.patch.status, "in_transit");
  assert.equal(plan.patch.trackingError, null);
  assert.deepEqual(plan.event, { shipmentId: "sh1", status: "in_transit", description: "Pickup Scan", location: "SAN ANTONIO, TX", occurredAt: now, source: "carrier" });
  assert.equal(plan.moved, true);
});

test("tracking: delivered stamps deliveredAt from the carrier", () => {
  const at = new Date("2026-10-22T19:21:00Z");
  const plan = planTrackingUpdate({ ...base, status: "in_transit", shippedAt: now }, { status: "delivered", deliveredAt: at, occurredAt: at }, now);
  assert.equal(plan.patch.deliveredAt, at);
  assert.equal(plan.moved, false, "already shipped");
});

test("tracking: a terminal shipment never changes (a stale 'in transit' after 'delivered' is ignored)", () => {
  for (const status of ["delivered", "returned", "voided"]) {
    assert.deepEqual(planTrackingUpdate({ ...base, status }, { status: "in_transit" }, now), { patch: null, event: null, moved: false, unknownCode: null });
  }
});

test("tracking: an unknown carrier code changes nothing but lastTrackedAt, and reports the code", () => {
  const plan = planTrackingUpdate(base, { status: null, carrierCode: "ZZ" }, now);
  assert.deepEqual(plan.patch, { lastTrackedAt: now, trackingError: null, updatedAt: now });
  assert.equal(plan.event, null);
  assert.equal(plan.unknownCode, "ZZ");
});

test("tracking: a carrier error (or no answer) is stored for staff and retried next run", () => {
  const err = planTrackingUpdate(base, { error: { carrier: "ups", code: "151044", message: "No tracking information available" } }, now);
  assert.deepEqual(err.patch, { lastTrackedAt: now, trackingError: "No tracking information available", updatedAt: now });
  assert.equal(planTrackingUpdate(base, undefined, now).patch.trackingError, "No tracking result returned.");
});

test("tracking: a moving shipment whose orders never shipped is healed on the next run", () => {
  const plan = planTrackingUpdate({ ...base, status: "in_transit", shippedAt: null }, { status: "in_transit" }, now);
  assert.equal(plan.event, null, "no duplicate event");
  assert.equal(plan.moved, true);
});

test("tracking: an exception is not movement, and a carrier can never void our shipment", () => {
  assert.equal(planTrackingUpdate(base, { status: "exception" }, now).moved, false);
  assert.equal(planTrackingUpdate(base, { status: "voided" }, now).event, null);
});
```

`apps/api/src/services/shipping/shipments.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const svc = await import("./shipments.service.js");
const { ShippingError, CarrierError } = await import("./shipping-errors.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { fakeAdapter, fakeRegistry, TEST_LABEL } = await import("../../test/carrier-config.js");
const source = readFileSync(fileURLToPath(new URL("./shipments.service.js", import.meta.url)), "utf8");

const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const request = { carrier: "ups", serviceCode: "03", shipFrom: null, shipTo, parcel, reference: "Order 100245" };
const logger = () => { const lines = []; return { lines, error: (m) => lines.push(m) }; };

test("rates: every enabled carrier in parallel, cheapest first; one failing carrier doesn't hide the others", async () => {
  const ups = fakeAdapter("ups", { rate: async () => [{ carrier: "ups", serviceCode: "03", serviceName: "UPS Ground", amountCents: 1142 }] });
  const fedex = fakeAdapter("fedex", { rate: async () => { throw new CarrierError("fedex", "SYSTEM.UNAVAILABLE", "Try later."); } });
  const manual = fakeAdapter("manual");
  const off = fakeAdapter("dhl", { configured: () => ({ ok: false, reason: "DHL: credentials not set" }) });
  const out = await svc.rateAll({ shipFrom: null, shipTo, parcel }, { registry: fakeRegistry([ups, fedex, manual, off]) });
  assert.deepEqual(out.quotes.map((q) => q.amountCents), [1142]);
  assert.deepEqual(out.errors, [{ carrier: "fedex", code: "SYSTEM.UNAVAILABLE", message: "Try later." }]);
  assert.deepEqual(out.disabled.map((d) => d.reason), ["DHL: credentials not set"]);
  assert.equal(manual.calls.length, 0, "manual has no rates");
});

test("rates: a bug inside an adapter shows a plain message, never the stack", async () => {
  const ups = fakeAdapter("ups", { rate: async () => { throw new TypeError("cannot read x of undefined"); } });
  const out = await svc.rateAll({ shipTo, parcel }, { registry: fakeRegistry([ups]) });
  assert.deepEqual(out.errors, [{ carrier: "ups", code: "ERROR", message: "UPS rating failed." }]);
});

test("buy: a disabled carrier is refused before any call", async () => {
  const ups = fakeAdapter("ups", { configured: () => ({ ok: false, reason: "UPS: credentials not set (UPS_CLIENT_ID)" }) });
  await assert.rejects(svc.buyLabel(request, { registry: fakeRegistry([ups]) }), (e) => e instanceof ShippingError && e.code === "CARRIER_DISABLED");
  assert.equal(ups.calls.length, 0);
});

test("buy: an uncertain purchase keeps its idempotency key locked and tells staff to check before retrying", async () => {
  const ups = fakeAdapter("ups", { createLabel: async () => { throw new CarrierError("ups", "TIMEOUT", "UPS did not answer within 30s.", { uncertain: true, timedOut: true }); } });
  const log = logger();
  await assert.rejects(svc.buyLabel(request, { registry: fakeRegistry([ups]), log }), (e) =>
    e instanceof ShippingError && e.code === "PURCHASE_UNCERTAIN" && e.gatewayOutcomePending === true && /check Admin › Shipments before retrying/.test(e.message));
  assert.deepEqual(log.lines, ["[SHIP][PURCHASE_UNCERTAIN] carrier=ups code=TIMEOUT"]);
});

test("buy: a definite refusal passes through with the carrier's words, and the key is released", async () => {
  const refusal = new CarrierError("ups", "120802", "Address Validation Error on ShipTo address", { httpStatus: 400 });
  const ups = fakeAdapter("ups", { createLabel: async () => { throw refusal; } });
  await assert.rejects(svc.buyLabel(request, { registry: fakeRegistry([ups]) }), (e) => e === refusal && !e.gatewayOutcomePending);
});

test("persist failure: the label is voided at the carrier and staff are told to try again", async () => {
  const ups = fakeAdapter("ups");
  const cause = new Error("db down");
  await assert.rejects(
    svc.purchaseAndPersist(request, async () => { throw cause; }, { registry: fakeRegistry([ups]), log: logger() }),
    (e) => e instanceof ShippingError && e.code === "LABEL_NOT_SAVED" && e.cause === cause && /voided/.test(e.message),
  );
  const voidCall = ups.calls.find(([name]) => name === "voidLabel");
  assert.equal(voidCall[1].carrierShipmentId, TEST_LABEL.carrierShipmentId);
});

test("persist AND void failing: [SHIP][LABEL_ORPHANED] with ids only, and the tracking number for staff", async () => {
  const ups = fakeAdapter("ups", { voidLabel: async () => ({ ok: false, reason: "Already picked up" }) });
  const log = logger();
  await assert.rejects(svc.purchaseAndPersist(request, async () => { throw new Error("db down"); }, { registry: fakeRegistry([ups]), log }),
    (e) => e.code === "LABEL_NOT_SAVED" && e.message.includes("1Z999AA10123456784"));
  assert.deepEqual(log.lines, ["[SHIP][LABEL_ORPHANED] carrier=ups tracking=1Z999AA10123456784"]);
  assert.ok(!log.lines.join(" ").includes("Austin"), "no address in logs");
});

test("persist success returns what persist returned, and nothing is voided", async () => {
  const ups = fakeAdapter("ups");
  const out = await svc.purchaseAndPersist(request, async (label) => ({ saved: label.trackingNumber, carrier: label.carrier }), { registry: fakeRegistry([ups]) });
  assert.deepEqual(out, { saved: "1Z999AA10123456784", carrier: "ups" });
  assert.equal(ups.calls.filter(([n]) => n === "voidLabel").length, 0);
});

test("insertShipment writes the row and its first event in the caller's transaction", async () => {
  const tx = fakeTx();
  await svc.insertShipment(tx, { shipment: { id: "sh1", status: "label_created" }, event: { shipmentId: "sh1", status: "label_created" } });
  const inserts = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  assert.equal(inserts[0].id, "sh1");
  assert.equal(inserts[1].shipmentId, "sh1");
  assert.ok(inserts[1].id, "events get their own id");
});

test("stampShipped is a claim: it only wins once, and never on a voided shipment", async () => {
  assert.match(source, /isNull\(shipments\.shippedAt\)/);
  assert.match(source, /ne\(shipments\.status, "voided"\)/);
  const won = fakeTx({ updates: [[{ id: "sh1" }]] });
  assert.equal(await svc.stampShipped(won, { id: "sh1", carrier: "ups", status: "label_created" }, { now: new Date() }), true);
  assert.equal(await svc.stampShipped(fakeTx({ updates: [[]] }), { id: "sh1", carrier: "ups", status: "label_created" }, { now: new Date() }), false);
});

test("a manual shipment handed off moves to in_transit with a staff event", async () => {
  const tx = fakeTx({ updates: [[{ id: "sh2" }]] });
  await svc.stampShipped(tx, { id: "sh2", carrier: "manual", status: "label_created" }, { now: new Date() });
  assert.equal(tx.log.find((l) => l.op === "set").values.status, "in_transit");
  assert.equal(tx.log.filter((l) => l.op === "insert").at(-1).values.source, "staff");
});

test("a tracking write only lands if the status is still the one we read (a void mid-sync wins)", async () => {
  assert.match(source, /eq\(shipments\.status, shipment\.status\)/);
  const lost = fakeTx({ updates: [[]] });
  const wrote = await svc.applyTrackingPlan(lost, { id: "sh1", status: "label_created" }, { patch: { status: "in_transit" }, event: { status: "in_transit" } });
  assert.equal(wrote, false);
  assert.equal(lost.log.filter((l) => l.op === "insert").length, 0);
});

test("summaries and lists never carry the label image", () => {
  const listBody = source.slice(source.indexOf("const SUMMARY"), source.indexOf("export async function getLabel"));
  assert.doesNotMatch(listBody, /labelData: shipments\.labelData/);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/shipping/shipment-rules.test.js src/services/shipping/shipments.service.test.js`
Expected: FAIL. The modules don't exist.

- [ ] **Step 4: Write the rules**

`apps/api/src/services/shipping/shipment-rules.js`:

```js
import { SHIPMENT_STATUSES, isTerminalShipmentStatus, isShipmentMovement } from "@my-app/shared";
import { ShippingError } from "./shipping-errors.js";

/**
 * Pure shipment rules: the new row, void, and what a tracking answer changes.
 * No DB and no clock (callers pass ids and `now`). Generic: nothing here
 * knows a lab order (lab rules live in services/lab/lab-shipping-rules.js).
 */

/** A bought label (createLabel's result plus `carrier`) → the shipments row and its first event. */
export function planNewShipment({ id, label, parcel, shipTo, shipFrom = null, createdByUserId = null, now }) {
  const manual = label.carrier === "manual";
  const shipment = {
    id,
    carrier: label.carrier,
    serviceCode: label.serviceCode ?? null,
    serviceName: label.serviceName ?? null,
    carrierShipmentId: label.carrierShipmentId ?? null,
    trackingNumber: label.trackingNumber ?? null,
    status: "label_created",
    chargeCents: label.chargeCents ?? 0,
    currency: label.currency ?? "USD",
    parcel,
    shipTo,
    shipFrom,
    labelFormat: label.labelFormat ?? null,
    labelData: label.labelData ?? null,
    createdByUserId,
    purchasedAt: now,
    shippedAt: null,
    deliveredAt: null,
    voidedAt: null,
    lastTrackedAt: null,
    trackingError: null,
    createdAt: now,
    updatedAt: now,
  };
  const event = {
    shipmentId: id, status: "label_created", description: manual ? "Recorded by staff" : "Label created",
    location: null, occurredAt: now, source: manual ? "staff" : "carrier",
  };
  return { shipment, event };
}

/** A label can be voided while it is unused: not voided, not moving, not marked shipped. */
export function assertVoidable(shipment) {
  if (shipment.status === "voided") throw new ShippingError("VOID_REFUSED", "This label is already void.");
  if (shipment.status !== "label_created" || shipment.shippedAt) {
    throw new ShippingError("VOID_REFUSED", "This shipment has already left, so its label can't be voided. Correct the invoice with a credit instead.");
  }
}

export function planVoided(shipment, { now }) {
  return {
    patch: { status: "voided", voidedAt: now, updatedAt: now },
    event: { shipmentId: shipment.id, status: "voided", description: "Label voided", location: null, occurredAt: now, source: "staff" },
  };
}

const NOTHING = { patch: null, event: null, moved: false, unknownCode: null };

/**
 * One carrier answer → what to write.
 * - A terminal shipment never changes (a stale scan after "delivered" is ignored).
 * - An error, or no answer, is stored as trackingError and retried next run.
 * - An unknown code changes only lastTrackedAt; the code comes back for the log.
 * - A new status writes ONE event; delivered stamps deliveredAt.
 * - `moved` = the shipment is (now) moving and its orders were never marked
 *   shipped: the caller ships them. Re-reported until it succeeds.
 */
export function planTrackingUpdate(shipment, result, now) {
  if (isTerminalShipmentStatus(shipment.status)) return NOTHING;
  if (!result || result.error) {
    const message = String(result?.error?.message ?? "No tracking result returned.").slice(0, 300);
    return { ...NOTHING, patch: { lastTrackedAt: now, trackingError: message, updatedAt: now } };
  }
  const base = { lastTrackedAt: now, trackingError: null, updatedAt: now };
  const next = result.status;
  const known = Boolean(next) && SHIPMENT_STATUSES.includes(next) && next !== "voided";
  if (!known || next === shipment.status) {
    return {
      patch: base,
      event: null,
      moved: isShipmentMovement(shipment.status) && !shipment.shippedAt,
      unknownCode: next ? null : (result.carrierCode ?? null),
    };
  }
  const patch = { ...base, status: next };
  if (next === "delivered") patch.deliveredAt = result.deliveredAt ?? result.occurredAt ?? now;
  const event = {
    shipmentId: shipment.id, status: next, description: result.description ?? null,
    location: result.location ?? null, occurredAt: result.occurredAt ?? now, source: "carrier",
  };
  return { patch, event, moved: isShipmentMovement(next) && !shipment.shippedAt, unknownCode: null };
}
```

- [ ] **Step 5: Write the service**

`apps/api/src/services/shipping/shipments.service.js`:

```js
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { CARRIER_LABELS } from "@my-app/shared";
import { db } from "../../config/database.js";
import { shipments, shipmentEvents } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { carrierRegistry } from "./carrier-registry.js";
import { ShippingError, CarrierError, carrierProblem } from "./shipping-errors.js";
import { planVoided } from "./shipment-rules.js";

/**
 * Generic shipments: carrier calls and shipments-table reads/writes. Knows
 * nothing about lab orders; services/lab/lab-shipping.service.js is the glue.
 * Log lines carry carrier, ids and codes only, never bodies or addresses.
 */

// ── Carrier calls ──────────────────────────────────────────────────────────

/** Every enabled carrier's quotes, in parallel (10s each, carrier-http TIMEOUTS.rate), cheapest first. */
export async function rateAll({ shipFrom, shipTo, parcel }, { registry = carrierRegistry() } = {}) {
  const carriers = registry.enabled().filter((a) => a.id !== "manual");
  const settled = await Promise.allSettled(carriers.map((a) => a.rate({ shipFrom, shipTo, parcel })));
  const quotes = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") quotes.push(...s.value);
    else if (s.reason instanceof CarrierError) errors.push(carrierProblem(s.reason));
    else {
      console.error(`[SHIP][RATE_FAILED] carrier=${carriers[i].id}: ${String(s.reason?.message || s.reason).slice(0, 200)}`);
      errors.push({ carrier: carriers[i].id, code: "ERROR", message: `${carriers[i].label} rating failed.` });
    }
  });
  quotes.sort((a, b) => a.amountCents - b.amountCents);
  return { quotes, errors, disabled: registry.status().filter((s) => !s.ok) };
}

/**
 * Buy one label. A failure after which the label may exist anyway becomes
 * PURCHASE_UNCERTAIN, flagged gatewayOutcomePending so withIdempotency
 * (lib/payment-helpers.js) keeps this attempt's key locked: a retry can't buy
 * a second label. A definite refusal passes through and releases the key.
 */
export async function buyLabel(request, { registry = carrierRegistry(), log = console } = {}) {
  const adapter = registry.get(request.carrier);
  const ready = adapter.configured();
  if (!ready.ok) throw new ShippingError("CARRIER_DISABLED", ready.reason);
  try {
    return { ...(await adapter.createLabel(request)), carrier: request.carrier };
  } catch (err) {
    if (err instanceof CarrierError && err.uncertain) {
      log.error(`[SHIP][PURCHASE_UNCERTAIN] carrier=${request.carrier} code=${err.code}`);
      throw new ShippingError(
        "PURCHASE_UNCERTAIN",
        `${CARRIER_LABELS[request.carrier]} didn't confirm the label. It may have been bought — check Admin › Shipments before retrying.`,
        { gatewayOutcomePending: true, carrier: request.carrier },
      );
    }
    throw err;
  }
}

/**
 * Buy, then persist. If persisting fails, the label is voided at the carrier
 * (best effort); if that fails too, [SHIP][LABEL_ORPHANED] is logged with ids
 * only and staff get the tracking number to void it by hand.
 */
export async function purchaseAndPersist(request, persist, { registry = carrierRegistry(), log = console } = {}) {
  const label = await buyLabel(request, { registry, log });
  try {
    return await persist(label);
  } catch (err) {
    const voided = await registry.get(label.carrier).voidLabel(label).catch(() => ({ ok: false }));
    if (!voided.ok) log.error(`[SHIP][LABEL_ORPHANED] carrier=${label.carrier} tracking=${label.trackingNumber ?? "none"}`);
    const message = voided.ok
      ? "The label was bought but couldn't be saved, so it was voided. Try again."
      : `The label was bought but couldn't be saved or voided. Tell an admin: ${CARRIER_LABELS[label.carrier]} ${label.trackingNumber ?? ""}`.trim();
    throw new ShippingError("LABEL_NOT_SAVED", message, { cause: err });
  }
}

/** Void at the carrier; a refusal (already picked up, …) is shown to staff in the carrier's words. */
export async function voidAtCarrier(shipment, { registry = carrierRegistry() } = {}) {
  const out = await registry.get(shipment.carrier).voidLabel({ carrierShipmentId: shipment.carrierShipmentId, trackingNumber: shipment.trackingNumber });
  if (!out.ok) throw new ShippingError("VOID_REFUSED", `${CARRIER_LABELS[shipment.carrier]} refused the void: ${out.reason ?? "no reason given"}`);
}

// ── Writes (caller's transaction) ──────────────────────────────────────────

export async function insertShipment(tx, { shipment, event }) {
  await tx.insert(shipments).values(shipment);
  await tx.insert(shipmentEvents).values({ ...event, id: createId() });
}

export async function markVoided(tx, shipment, { now }) {
  const { patch, event } = planVoided(shipment, { now });
  await tx.update(shipments).set(patch).where(eq(shipments.id, shipment.id));
  await tx.insert(shipmentEvents).values({ ...event, id: createId() });
}

/**
 * Claim "the box left": sets shippedAt once. Returns true only for the caller
 * that set it (so exactly one shipped email goes out). A manual shipment also
 * moves to in_transit with a staff event: nothing else ever moves it.
 */
export async function stampShipped(tx, shipment, { now }) {
  const manualHandOff = shipment.carrier === "manual" && shipment.status === "label_created";
  const [claimed] = await tx
    .update(shipments)
    .set({ shippedAt: now, updatedAt: now, ...(manualHandOff ? { status: "in_transit" } : {}) })
    .where(and(eq(shipments.id, shipment.id), isNull(shipments.shippedAt), ne(shipments.status, "voided")))
    .returning({ id: shipments.id });
  if (claimed && manualHandOff) {
    await tx.insert(shipmentEvents).values({
      id: createId(), shipmentId: shipment.id, status: "in_transit", description: "Handed off (recorded by staff)", location: null, occurredAt: now, source: "staff",
    });
  }
  return Boolean(claimed);
}

/** Write a planTrackingUpdate plan, only if the status is still the one read (a void mid-sync wins). */
export async function applyTrackingPlan(tx, shipment, { patch, event }) {
  const [hit] = await tx
    .update(shipments)
    .set(patch)
    .where(and(eq(shipments.id, shipment.id), eq(shipments.status, shipment.status)))
    .returning({ id: shipments.id });
  if (hit && event) await tx.insert(shipmentEvents).values({ ...event, id: createId() });
  return Boolean(hit);
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Every column except the label image (lists, details, the doctor view's source). */
const SUMMARY = {
  id: shipments.id, carrier: shipments.carrier, serviceCode: shipments.serviceCode, serviceName: shipments.serviceName,
  carrierShipmentId: shipments.carrierShipmentId, trackingNumber: shipments.trackingNumber, status: shipments.status,
  chargeCents: shipments.chargeCents, currency: shipments.currency, parcel: shipments.parcel, shipTo: shipments.shipTo,
  labelFormat: shipments.labelFormat, hasLabel: sql`${shipments.labelData} is not null`.mapWith(Boolean),
  createdByUserId: shipments.createdByUserId, purchasedAt: shipments.purchasedAt, shippedAt: shipments.shippedAt,
  deliveredAt: shipments.deliveredAt, voidedAt: shipments.voidedAt, lastTrackedAt: shipments.lastTrackedAt,
  trackingError: shipments.trackingError,
};

export async function getShipment(id, database = db) {
  const [row] = await database.select(SUMMARY).from(shipments).where(eq(shipments.id, id));
  return row ?? null;
}

export async function shipmentSummaries(ids, database = db) {
  if (!ids.length) return new Map();
  const rows = await database.select(SUMMARY).from(shipments).where(inArray(shipments.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export const SHIPMENT_LIST_LIMIT = 500;

/** Admin › Shipments: newest first; filters by status, carrier and lab-local purchase date range. */
export function listShipments({ status, carrier, from, to } = {}, database = db) {
  const conds = [];
  if (status) conds.push(eq(shipments.status, status));
  if (carrier) conds.push(eq(shipments.carrier, carrier));
  if (from) conds.push(gte(shipments.purchasedAt, sql`(${from}::date)::timestamp at time zone 'America/Chicago'`));
  if (to) conds.push(lt(shipments.purchasedAt, sql`((${to}::date + 1)::timestamp) at time zone 'America/Chicago'`));
  return database
    .select(SUMMARY)
    .from(shipments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(shipments.purchasedAt))
    .limit(SHIPMENT_LIST_LIMIT);
}

/** Labelled boxes still waiting for the hand-off ("Mark all labelled shipped"). */
export async function unshippedShipmentIds(database = db) {
  const rows = await database
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(isNull(shipments.shippedAt), eq(shipments.status, "label_created")));
  return rows.map((r) => r.id);
}

/** The stored label as bytes, or null (no such shipment, or a manual one with no label). */
export async function getLabel(id, database = db) {
  const [row] = await database
    .select({ carrier: shipments.carrier, labelFormat: shipments.labelFormat, trackingNumber: shipments.trackingNumber, labelData: shipments.labelData })
    .from(shipments)
    .where(eq(shipments.id, id));
  if (!row?.labelData || !row.labelFormat) return null;
  return { carrier: row.carrier, labelFormat: row.labelFormat, trackingNumber: row.trackingNumber, bytes: Buffer.from(row.labelData, "base64") };
}
```

(`'America/Chicago'` here is the lab's day, the same `LAB_TIMEZONE` as `@my-app/shared`. It's inlined because it is a SQL literal; the comment on `listShipments` says so. Don't add a second constant.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/shipping`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/shipping apps/api/src/test/carrier-config.js
git commit -m "feat(shipping): shipments service — parallel rating, uncertain purchases, orphan void, tracking rules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Invoice shipment lines: add/remove a shipping line on a draft

**Files:**
- Modify:
  - `packages/shared/src/billing/billing.js` (price source `shipment`);
  - `apps/api/src/services/billing/invoice-rules.js` (`lineRow` keeps `shipmentId`, plus two planners) and its test;
  - `apps/api/src/services/billing/invoices.service.js` (`applyLinePlan`, `addShipmentLine`, `removeShipmentLine`) and its test;
  - `apps/api/src/services/billing/invoice-actions.service.js` (`editDraft` uses `applyLinePlan`).

**Interfaces:**
- Consumes: `invoice_lines.shipment_id` (Task 3).
- Produces:
  - `planShipmentLine(invoice, lines, { shipmentId, description, unitCents, now, taxRateBps }) → { op: { insert }, patch, audit }`.
  - `planShipmentLineRemoval(invoice, lines, shipmentId, { now, taxRateBps }) → plan | null`.
  - `applyLinePlan(tx, invoice, plan, byUserId) → updated invoice` (the ONE tail for every line edit).
  - `addShipmentLine(tx, { labOrderId, shipmentId, description, unitCents, byUserId }) → { added: true, invoiceNumber } | { added: false, reason: "no_invoice"|"not_draft", invoiceNumber? }`.
  - `removeShipmentLine(tx, { shipmentId, byUserId }) → { removed: true, invoiceNumber } | { removed: false, reason: "no_line"|"not_draft", invoiceNumber? }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/billing/invoice-rules.test.js` (add `planShipmentLine, planShipmentLineRemoval` to its import from `./invoice-rules.js`):

```js
const shipDraft = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 4, subtotalCents: 40500, taxCents: 0, shippingCents: 0, totalCents: 40500 };
const shipLines = [{ id: "l1", position: 0, kind: "item", qty: 1, unitCents: 40500, lineCents: 40500, taxable: false, priceSource: "client", shipmentId: null }];
const NOW = new Date("2026-10-20T16:00:00Z");

test("a shipment's line: shipping kind, never taxed, priced from the shipment, remembering which shipment", () => {
  const plan = planShipmentLine(shipDraft, shipLines, { shipmentId: "sh1", description: "Shipping — UPS Ground 1Z999", unitCents: 1142, now: NOW, taxRateBps: 825 });
  const ins = plan.op.insert;
  assert.deepEqual([ins.kind, ins.taxable, ins.priceSource, ins.shipmentId, ins.position, ins.lineCents], ["shipping", false, "shipment", "sh1", 1, 1142]);
  assert.deepEqual([plan.patch.shippingCents, plan.patch.taxCents, plan.patch.totalCents, plan.patch.version], [1142, 0, 41642, 5]);
  assert.deepEqual(plan.audit, { op: "add", kind: "shipping", unitCents: 1142, shipmentId: "sh1" });
});

test("a shipment's line is refused on a non-draft, at $0, or twice", () => {
  assert.throws(() => planShipmentLine({ ...shipDraft, status: "issued" }, shipLines, { shipmentId: "sh1", description: "S", unitCents: 100, now: NOW, taxRateBps: 0 }), isCode("INVALID_TRANSITION"));
  assert.throws(() => planShipmentLine(shipDraft, shipLines, { shipmentId: "sh1", description: "S", unitCents: 0, now: NOW, taxRateBps: 0 }), isCode("INVALID"));
  const twice = [...shipLines, { id: "l2", position: 1, kind: "shipping", qty: 1, unitCents: 100, lineCents: 100, taxable: false, priceSource: "shipment", shipmentId: "sh1" }];
  assert.throws(() => planShipmentLine(shipDraft, twice, { shipmentId: "sh1", description: "S", unitCents: 100, now: NOW, taxRateBps: 0 }), isCode("INVALID"));
});

test("removing a voided shipment's line takes exactly that line and recomputes totals", () => {
  const withLine = [...shipLines, { id: "l2", position: 1, kind: "shipping", qty: 1, unitCents: 1142, lineCents: 1142, taxable: false, priceSource: "shipment", shipmentId: "sh1" }];
  const plan = planShipmentLineRemoval({ ...shipDraft, shippingCents: 1142, totalCents: 41642 }, withLine, "sh1", { now: NOW, taxRateBps: 0 });
  assert.deepEqual(plan.op, { delete: "l2" });
  assert.deepEqual([plan.patch.shippingCents, plan.patch.totalCents], [0, 40500]);
  assert.equal(planShipmentLineRemoval(shipDraft, shipLines, "sh1", { now: NOW, taxRateBps: 0 }), null, "no line, nothing to do");
});

test("ordinary lines carry no shipment", () => {
  const { lines } = planDraftInvoice({
    invoiceId: "inv9", invoiceNumber: 500009, labOrder: { id: "lo9", clientUserId: "d" },
    pricedLines: [{ description: "X", qty: 1, unitCents: 100, taxable: false, priceSource: "base" }], now: NOW, taxRateBps: 0,
  });
  assert.equal(lines[0].shipmentId, null);
});
```

(`isCode` and `planDraftInvoice` are already defined/imported at the top of that file. If `isCode` is named differently there, use the file's existing helper.)

Append to `apps/api/src/services/billing/invoices.service.test.js`:

```js
const draftRow = {
  id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, clientUserId: "doc1", labOrderId: "lo1",
  subtotalCents: 40500, taxCents: 0, shippingCents: 0, totalCents: 40500, notes: null, voidReason: null,
};
const itemLine = { id: "l1", invoiceId: "inv1", position: 0, kind: "item", qty: 1, unitCents: 40500, lineCents: 40500, taxable: false, priceSource: "client", priceNote: null, shipmentId: null };

test("a shipment's shipping line lands on its order's draft, totals recomputed, version-checked and audited", async () => {
  const tx = fakeTx({ selects: [[draftRow], [itemLine]], updates: [[{ ...draftRow, version: 3, shippingCents: 1142, totalCents: 41642 }]] });
  const out = await mod.addShipmentLine(tx, { labOrderId: "lo1", shipmentId: "sh1", description: "Shipping — UPS Ground 1Z999", unitCents: 1142, byUserId: "u1" });
  assert.deepEqual(out, { added: true, invoiceNumber: 500001 });
  const [line, audit] = inserts(tx);
  assert.deepEqual([line.kind, line.shipmentId, line.unitCents, line.priceSource], ["shipping", "sh1", 1142, "shipment"]);
  assert.equal(audit.action, "invoice.edited");
  assert.equal(tx.log.find((l) => l.op === "set").values.totalCents, 41642);
});

test("no draft: nothing is added and the caller is told why", async () => {
  const issued = fakeTx({ selects: [[{ ...draftRow, status: "issued" }]] });
  assert.deepEqual(await mod.addShipmentLine(issued, { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: 100 }), { added: false, reason: "not_draft", invoiceNumber: 500001 });
  assert.equal(inserts(issued).length, 0);
  assert.deepEqual(await mod.addShipmentLine(fakeTx({ selects: [[]] }), { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: 100 }), { added: false, reason: "no_invoice" });
});

test("voiding removes the shipment's line from a draft; an issued invoice is left alone", async () => {
  const shipLine = { ...itemLine, id: "l2", position: 1, kind: "shipping", unitCents: 1142, lineCents: 1142, priceSource: "shipment", shipmentId: "sh1" };
  const tx = fakeTx({ selects: [[{ invoiceId: "inv1" }], [draftRow], [itemLine, shipLine]], updates: [[{ ...draftRow, version: 3 }]] });
  assert.deepEqual(await mod.removeShipmentLine(tx, { shipmentId: "sh1", byUserId: "u1" }), { removed: true, invoiceNumber: 500001 });
  assert.equal(tx.log.filter((l) => l.op === "delete").length, 1);
  const issued = fakeTx({ selects: [[{ invoiceId: "inv1" }], [{ ...draftRow, status: "issued" }]] });
  assert.deepEqual(await mod.removeShipmentLine(issued, { shipmentId: "sh1" }), { removed: false, reason: "not_draft", invoiceNumber: 500001 });
  assert.deepEqual(await mod.removeShipmentLine(fakeTx({ selects: [[]] }), { shipmentId: "sh1" }), { removed: false, reason: "no_line" });
});

test("a draft edited by staff meanwhile is a 409, not a lost update", async () => {
  const tx = fakeTx({ selects: [[draftRow], [itemLine]], updates: [[]] });
  await assert.rejects(mod.addShipmentLine(tx, { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: 100 }), (e) => e.code === "STALE");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/billing`
Expected: FAIL. The planners and service functions don't exist, and `lineRow` drops `shipmentId`.

- [ ] **Step 3: Implement**

In `packages/shared/src/billing/billing.js`:

```js
export const PRICE_SOURCES = ["client", "base", "manual", "remake", "unpriced", "shipment"];
```

and add `shipment: "Shipping label",` to `PRICE_SOURCE_LABELS`.

In `apps/api/src/services/billing/invoice-rules.js`, make `lineRow` keep the shipment (add the last property):

```js
    priceSource: l.priceSource, priceNote: null, labOrderLineId: l.labOrderLineId ?? null, shipmentId: l.shipmentId ?? null,
```

and append after `planLineEdit`:

```js
/**
 * A shipment's shipping line on a draft (lab-shipping.service, SHIPPING_CHARGE_POLICY).
 * Kind "shipping" (never taxed), price source "shipment", and it remembers its
 * shipment so voiding the label removes exactly this line. One per shipment.
 */
export function planShipmentLine(invoice, lines, { shipmentId, description, unitCents, now, taxRateBps }) {
  assertDraft(invoice);
  assertCents(unitCents, "unitCents");
  if (unitCents <= 0) throw new InvoiceError("INVALID", "A shipping line must be more than $0.00.");
  if (lines.some((l) => l.shipmentId === shipmentId)) throw new InvoiceError("INVALID", "This shipment's line is already on the invoice.");
  const position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const line = lineRow(invoice.id, position, { kind: "shipping", description, qty: 1, unitCents, taxable: false, priceSource: "shipment", shipmentId });
  return {
    op: { insert: line },
    patch: { ...computeTotals([...lines, line], { taxRateBps }), ...bump(invoice, now) },
    audit: { op: "add", kind: "shipping", unitCents, shipmentId },
  };
}

/** A voided shipment → remove the line it added (null when there is none). Draft only. */
export function planShipmentLineRemoval(invoice, lines, shipmentId, { now, taxRateBps }) {
  const line = lines.find((l) => l.shipmentId === shipmentId);
  if (!line) return null;
  assertDraft(invoice);
  return {
    op: { delete: line.id },
    patch: { ...computeTotals(lines.filter((l) => l !== line), { taxRateBps }), ...bump(invoice, now) },
    audit: { op: "remove", lineId: line.id, shipmentId },
  };
}
```

In `apps/api/src/services/billing/invoices.service.js`:
- change the drizzle import to `import { and, asc, eq } from "drizzle-orm";`;
- add `InvoiceError, planShipmentLine, planShipmentLineRemoval` to the `./invoice-rules.js` import;
- append:

```js
/**
 * Write one planned line change on a locked draft: the line operation, the
 * recomputed totals (only if the version is still the one read, else 409
 * STALE) and the audit row. THE tail every line edit shares: staff edits
 * (invoice-actions editDraft) and shipment lines below.
 */
export async function applyLinePlan(tx, invoice, plan, byUserId) {
  if (plan.op.insert) await tx.insert(invoiceLines).values(sealLine({ ...plan.op.insert, id: createId() }));
  if (plan.op.update) await tx.update(invoiceLines).set(sealLine(plan.op.update.values)).where(eq(invoiceLines.id, plan.op.update.id));
  if (plan.op.delete) await tx.delete(invoiceLines).where(eq(invoiceLines.id, plan.op.delete));
  const [updated] = await tx
    .update(invoices)
    .set(sealInvoice(plan.patch))
    .where(and(eq(invoices.id, invoice.id), eq(invoices.version, invoice.version)))
    .returning();
  if (!updated) throw new InvoiceError("STALE", "This invoice changed — reload.");
  await auditInvoice(tx, "invoice.edited", invoice, byUserId, plan.audit);
  return openInvoice(updated);
}

/**
 * A new shipment's shipping line on its order's draft, in the CALLER's
 * transaction (lab-shipping.service persistShipment). No invoice, or one that
 * is no longer a draft, adds nothing and says why; the caller notes it for staff.
 */
export async function addShipmentLine(tx, { labOrderId, shipmentId, description, unitCents, byUserId = null }) {
  const invoice = await invoiceForLabOrder(tx, labOrderId);
  if (!invoice) return { added: false, reason: "no_invoice" };
  if (invoice.status !== "draft") return { added: false, reason: "not_draft", invoiceNumber: invoice.invoiceNumber };
  const plan = planShipmentLine(invoice, await loadLines(tx, invoice.id), {
    shipmentId, description, unitCents, now: new Date(), taxRateBps: PRICING.taxRateBps,
  });
  await applyLinePlan(tx, invoice, plan, byUserId);
  return { added: true, invoiceNumber: invoice.invoiceNumber };
}

/** A voided shipment → remove the line it added, while that invoice is still a draft. */
export async function removeShipmentLine(tx, { shipmentId, byUserId = null }) {
  const [line] = await tx.select({ invoiceId: invoiceLines.invoiceId }).from(invoiceLines).where(eq(invoiceLines.shipmentId, shipmentId));
  if (!line) return { removed: false, reason: "no_line" };
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, line.invoiceId)).for("update");
  const invoice = openInvoice(row);
  if (invoice.status !== "draft") return { removed: false, reason: "not_draft", invoiceNumber: invoice.invoiceNumber };
  const plan = planShipmentLineRemoval(invoice, await loadLines(tx, invoice.id), shipmentId, { now: new Date(), taxRateBps: PRICING.taxRateBps });
  if (plan) await applyLinePlan(tx, invoice, plan, byUserId);
  return { removed: Boolean(plan), invoiceNumber: invoice.invoiceNumber };
}
```

In `apps/api/src/services/billing/invoice-actions.service.js`:
- import `applyLinePlan` from `./invoices.service.js`;
- replace the body of `editDraft`'s transaction with the shared tail:

```js
export function editDraft(id, { edit, expectedVersion, byUserId }, database = db) {
  return database.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    assertFreshInvoice(invoice, expectedVersion);
    const plan = planLineEdit(invoice, await loadLines(tx, id), edit, { now: new Date(), taxRateBps: PRICING.taxRateBps });
    return applyLinePlan(tx, invoice, plan, byUserId);
  });
}
```

Then remove `invoiceLines` and `sealLine` from that file's imports if nothing else in it uses them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/billing && cd ../../packages/shared && pnpm vitest run`
Expected: PASS. The existing `editDraft` tests still pass unchanged (same writes, same order).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/billing/billing.js apps/api/src/services/billing
git commit -m "feat(billing): a shipment can add (and its void remove) one shipping line on a draft

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Lab orders know about labels: `mutateIn`, label guard on status moves, link/unlink plans, board flag, detail block

**Files:**
- Modify:
  - `packages/shared/src/lab/lab-order-status.js` (+ test);
  - `apps/api/src/services/lab/lab-order-rules.js` (+ test);
  - `apps/api/src/services/lab/lab-orders.service.js` (+ test).

**Interfaces:**
- Consumes: `labOrders.shipmentId` (Task 3); `shipmentSummaries` (Task 7).
- Produces:
  - `allowedNextStatuses(status, { heldFrom, labelled })`: a labelled order at `ready_to_ship` may only go to `shipped`.
  - `planStatusChange` refuses any move but `shipped` for an order with `shipmentId` (`LabOrderError("INVALID")`).
  - `planShipmentLink(order, shipment, { byUserId, now }) → { patch, event }`, which throws `CONFLICT` if the order moved or was labelled.
  - `planShipmentUnlink(order, shipment, { byUserId, now }) → { patch, event } | null`.
  - `presentBoardCard(...)` gains `labelled: boolean`.
  - `mutateIn(tx, id, expectedVersion|null, plan) → { order, changed }`. `null` means a system move: the freshness check is skipped, but the update stays conditional on the version read. `mutate(id, v, plan, database)` is now a wrapper around it.
  - `getLabOrderDetail(id)` gains `shipment` (a `shipmentSummaries` row, or null).

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/lab/lab-order-status.test.js`:

```js
test("a labelled order only ships: hold, cancel and back-to-QC would strand its label", () => {
  assert.deepEqual(allowedNextStatuses("ready_to_ship", { labelled: true }), ["shipped"]);
  assert.deepEqual(allowedNextStatuses("ready_to_ship", { labelled: false }), ["shipped", "quality_check", "on_hold", "cancelled"]);
  assert.deepEqual(allowedNextStatuses("shipped", { labelled: true }), []);
});
```

Append to `apps/api/src/services/lab/lab-order-rules.test.js` (add `planShipmentLink, planShipmentUnlink` to its import):

```js
const labelled = { ...order, status: "ready_to_ship", shipmentId: "sh1" };
const ship = { id: "sh1", serviceName: "UPS Ground", trackingNumber: "1Z999AA10123456784" };

test("a labelled order can only move to shipped; anything else says to void the label first", () => {
  for (const to of ["on_hold", "cancelled", "quality_check"]) {
    assert.throws(() => planStatusChange(labelled, to, { reason: "x", now }), (e) => isCode("INVALID")(e) && /void the label/.test(e.message), to);
  }
  assert.equal(planStatusChange(labelled, "shipped", { now }).patch.status, "shipped");
});

test("linking a just-bought shipment: version bump and a 'shipment' event naming carrier and tracking only", () => {
  const { patch, event } = planShipmentLink({ ...order, status: "ready_to_ship", shipmentId: null }, ship, { byUserId: "u1", now });
  assert.deepEqual(patch, { shipmentId: "sh1", version: 4, updatedAt: now });
  assert.deepEqual([event.type, event.from, event.to, event.note], ["shipment", null, "sh1", "Label: UPS Ground 1Z999AA10123456784"]);
});

test("linking refuses an order that moved or was labelled by someone else meanwhile", () => {
  assert.throws(() => planShipmentLink({ ...order, status: "on_hold" }, ship, { now }), isCode("CONFLICT"));
  assert.throws(() => planShipmentLink({ ...order, status: "ready_to_ship", shipmentId: "sh0" }, ship, { now }), isCode("CONFLICT"));
});

test("unlinking a voided shipment clears only that shipment", () => {
  const { patch, event } = planShipmentUnlink(labelled, ship, { byUserId: "u1", now });
  assert.equal(patch.shipmentId, null);
  assert.deepEqual([event.type, event.from, event.to, event.note], ["shipment", "sh1", null, "Label voided: UPS Ground 1Z999AA10123456784"]);
  assert.equal(planShipmentUnlink({ ...labelled, shipmentId: "other" }, ship, { now }), null);
});

test("a board card says when its order has a label", () => {
  const row = { order: { ...order, status: "ready_to_ship", shipmentId: "sh1", source: "rx_case", receivedAt: now }, caseNumber: "RX-1", practiceName: "Lee Dental", assigneeName: null };
  assert.equal(presentBoardCard(row, [], "2026-10-07").labelled, true);
  assert.equal(presentBoardCard({ ...row, order: { ...row.order, shipmentId: null } }, [], "2026-10-07").labelled, false);
});
```

Append to `apps/api/src/services/lab/lab-orders.service.test.js`:

```js
test("mutateIn runs inside the caller's transaction; mutate is its one-line wrapper", () => {
  assert.equal(typeof mod.mutateIn, "function");
  assert.match(source, /export function mutate\(id, expectedVersion, plan, database = db\) \{\s*return database\.transaction\(\(tx\) => mutateIn\(tx, id, expectedVersion, plan\)\);/);
});

test("mutateIn: a system move (null version) skips the freshness check but still can't lose an update", async () => {
  const tx = fakeTx({ selects: [[baseRow]], updates: [[]] });
  const plan = () => ({ patch: { version: 4 }, event: { labOrderId: "lo-1", type: "note", note: null, at: new Date() } });
  await assert.rejects(mod.mutateIn(tx, "lo-1", null, plan), (e) => e instanceof LabOrderError && e.code === "STALE");
});

test("the order page gets its shipment summary (never the label image)", () => {
  const body = source.slice(source.indexOf("export async function getLabOrderDetail"), source.indexOf("export async function labOrdersForCases"));
  assert.match(body, /shipmentSummaries\(\[order\.shipmentId\]\)/);
  assert.doesNotMatch(body, /labelData/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/lab && cd ../../apps/api && pnpm vitest run src/services/lab`
Expected: FAIL. `labelled` is ignored, the planners don't exist, and `mutateIn` isn't exported.

- [ ] **Step 3: Implement**

In `packages/shared/src/lab/lab-order-status.js`, replace `allowedNextStatuses` with:

```js
/**
 * Every status `status` may move to. `heldFrom` is where an on-hold order
 * resumes; an on-hold row without a usable one resumes at received rather
 * than being stuck with no way out but cancel. A `labelled` order (it has a
 * live shipping label) only ships: anything else would strand the label, so
 * staff void the label first.
 */
export function allowedNextStatuses(status, { heldFrom = null, labelled = false } = {}) {
  if (!LAB_ORDER_STATUSES.includes(status) || isTerminalLabStatus(status)) return [];
  if (labelled) return status === "ready_to_ship" ? ["shipped"] : [];
  if (status === "on_hold") {
    const resume = FLOW[heldFrom] ? heldFrom : "received";
    return [resume, "cancelled"];
  }
  return [...FLOW[status], "on_hold", "cancelled"];
}
```

In `apps/api/src/services/lab/lab-order-rules.js`:
- update the `LabOrderError` code JSDoc union (already has `CONFLICT`);
- at the top of `planStatusChange`, before `const allowed`, insert the guard, and pass `labelled` through:

```js
  if (order.shipmentId && to !== "shipped") {
    throw new LabOrderError("INVALID", `Order #${order.orderNumber} has a shipping label — void the label before moving it.`);
  }
  const allowed = allowedNextStatuses(order.status, { heldFrom: order.heldFrom, labelled: Boolean(order.shipmentId) });
```

- add after `planFieldChange`:

```js
// ── Shipping (piece 4) ─────────────────────────────────────────────────────

const shipmentNote = (shipment, verb) => `${verb}: ${[shipment.serviceName, shipment.trackingNumber].filter(Boolean).join(" ")}`.slice(0, 200);

/**
 * Link an order to a just-bought shipment, inside the persisting transaction.
 * Re-checks what the pre-purchase check saw: an order that moved or was
 * labelled meanwhile fails the transaction, and the label is voided
 * (shipments.service purchaseAndPersist). The event names carrier, service
 * and tracking number only.
 */
export function planShipmentLink(order, shipment, { byUserId = null, now }) {
  if (order.status !== "ready_to_ship") {
    throw new LabOrderError("CONFLICT", `Order #${order.orderNumber} moved while the label was being bought.`);
  }
  if (order.shipmentId) throw new LabOrderError("CONFLICT", `Order #${order.orderNumber} was labelled by someone else.`);
  return {
    patch: { shipmentId: shipment.id, version: order.version + 1, updatedAt: now },
    event: { labOrderId: order.id, type: "shipment", from: null, to: shipment.id, byUserId, note: shipmentNote(shipment, "Label"), at: now },
  };
}

/** A voided shipment → clear it from the order (null when the order points elsewhere). */
export function planShipmentUnlink(order, shipment, { byUserId = null, now }) {
  if (order.shipmentId !== shipment.id) return null;
  return {
    patch: { shipmentId: null, version: order.version + 1, updatedAt: now },
    event: { labOrderId: order.id, type: "shipment", from: shipment.id, to: null, byUserId, note: shipmentNote(shipment, "Label voided"), at: now },
  };
}
```

- in `presentBoardCard`, add `labelled: Boolean(o.shipmentId),` after `isRemake`.

In `apps/api/src/services/lab/lab-orders.service.js`:
- add `import { shipmentSummaries } from "../shipping/shipments.service.js";`;
- replace `mutate` with:

```js
/**
 * Load → freshness check → plan → conditional update → event, inside the
 * CALLER's transaction, so several orders can change together (ship together,
 * mark a box shipped). The UPDATE is conditional on the version read, so two
 * technicians racing past assertFresh still can't both win.
 *
 * `expectedVersion === null` is a system move (shipping, the tracking sync):
 * there is no client version to check, and the conditional UPDATE still
 * prevents a lost update. Routes always validate a positive integer, so a
 * request can never send null.
 */
export async function mutateIn(tx, id, expectedVersion, plan) {
  const [row] = await tx.select().from(labOrders).where(eq(labOrders.id, id));
  if (!row) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
  const order = openOrder(row);
  if (expectedVersion !== null) assertFresh(order, expectedVersion);
  const planned = await plan(order, tx);
  if (!planned) return { order, changed: false };
  const [updated] = await tx
    .update(labOrders)
    .set(sealOrder(planned.patch))
    .where(and(eq(labOrders.id, id), eq(labOrders.version, order.version)))
    .returning();
  if (!updated) throw new LabOrderError("STALE", "This order changed — reload.");
  await tx.insert(labOrderEvents).values(sealEvent(planned.event));
  const opened = openOrder(updated);
  if (planned.after) await planned.after(tx, opened);
  return { order: opened, changed: true };
}

// `database` is injectable so the version/seal behaviour can be tested with a fake.
export function mutate(id, expectedVersion, plan, database = db) {
  return database.transaction((tx) => mutateIn(tx, id, expectedVersion, plan));
}
```

- in `getLabOrderDetail`, before the `return`, add:

```js
  const shipment = order.shipmentId ? ((await shipmentSummaries([order.shipmentId])).get(order.shipmentId) ?? null) : null;
```

and add `shipment,` to the returned object after `shopOrder,`.

- add `"mutateIn"` to the exported-names list in the existing "the service exposes…" test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test` (repo root)
Expected: PASS. Every existing lab-order test passes: `mutate` behaves exactly as before.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lab apps/api/src/services/lab
git commit -m "feat(lab): labelled orders only ship; mutateIn for multi-order moves; link/unlink plans

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Shipped email; doctor tracking on My cases

**Files:**
- Create: `apps/api/src/services/email-shipping.test.js`
- Modify:
  - `apps/api/src/services/email.service.js`: one sender, `sendShippedNotice`, appended at the end of the file;
  - `packages/shared/src/lab/lab-order-status.js` (+ test): `doctorTracking`, `doctorCaseView.tracking`;
  - `apps/api/src/services/lab/lab-orders.service.js` (+ test): `labOrdersForCases` joins the current shipment.

**Interfaces:**
- Consumes: `labIdentity` (Task 2); `trackingUrl`, `carrierName` (Task 1); `shipments` (Task 3).
- Produces:
  - `sendShippedNotice({ to, orderNumbers, carrier, trackingNumber, trackingUrl }) → Promise<boolean>`.
  - `doctorTracking(labOrder) → { carrier, trackingNumber, url, deliveredAt } | null`.
  - `doctorCaseView(...).tracking`.
  - `labOrdersForCases` rows gain `shipment: { carrier, serviceName, trackingNumber, status, deliveredAt } | null`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/email-shipping.test.js`:

```js
import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({
  env: { APP_ENV: "production", NODE_ENV: "test", EMAIL_FROM: "noreply@example.com", APP_URL: "https://portal.example" },
}));

const email = await import("./email.service.js");
const src = readFileSync(new URL("./email.service.js", import.meta.url), "utf8");
const capture = () => { const f = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", f); return f; };
const sent = (f) => new URLSearchParams(f.mock.calls[0][1].body);

test("one shipped email per box: every order number, the carrier, the tracking number and the link", async () => {
  const f = capture();
  const ok = await email.sendShippedNotice({
    to: "dr@x.com", orderNumbers: [100245, 100246], carrier: "UPS", trackingNumber: "1Z999AA10123456784",
    trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784",
  });
  assert.equal(ok, true);
  assert.equal(f.mock.calls.length, 1);
  const p = sent(f);
  assert.equal(p.get("to"), "dr@x.com");
  assert.equal(p.get("subject"), "Your order has shipped — Diamond Orthotic Laboratory");
  const html = p.get("html");
  assert.match(html, /#100245, #100246/);
  assert.match(html, /UPS/);
  assert.match(html, /1Z999AA10123456784/);
  assert.match(html, /href="https:\/\/www\.ups\.com\/track\?loc=en_US&amp;tracknum=1Z999AA10123456784"/);
  vi.unstubAllGlobals();
});

test("a manual shipment names the carrier staff typed and has no link; no tracking number means no email", async () => {
  const f = capture();
  await email.sendShippedNotice({ to: "dr@x.com", orderNumbers: [100245], carrier: "Lone Star Courier", trackingNumber: "LS-1", trackingUrl: null });
  const html = sent(f).get("html");
  assert.match(html, /Lone Star Courier/);
  assert.doesNotMatch(html, /href=/);
  assert.equal(await email.sendShippedNotice({ to: "dr@x.com", orderNumbers: [1], carrier: "UPS", trackingNumber: null }), false);
  assert.equal(f.mock.calls.length, 1);
  vi.unstubAllGlobals();
});

test("the shipped email can't carry patient data or a file", () => {
  const body = src.slice(src.indexOf("export async function sendShippedNotice"));
  assert.doesNotMatch(body, /patient|device|formData|caseNumber|attachment/i);
});
```

In `packages/shared/src/lab/lab-order-status.test.js`:
- add `doctorTracking` to the import;
- change the existing allow-list keys assertion to include `"tracking"`:

```js
  assert.deepEqual(Object.keys(view).sort(), [
    "caseNumber", "deviceSummary", "dueDate", "id", "isRemake", "orderNumber", "patientName", "status", "submittedAt", "tracking",
  ]);
```

- append:

```js
const shippedLo = {
  status: "shipped", isRemake: false, orderNumber: 100245, dueDate: null, createdAt: "2026-10-02T10:00:00Z",
  shipment: { carrier: "ups", serviceName: "UPS Ground", trackingNumber: "1Z999AA10123456784", status: "in_transit", deliveredAt: null },
};

test("a shipped case shows carrier, number, link and delivered date — nothing else from the shipment", () => {
  assert.deepEqual(doctorCaseView(caseRow, [shippedLo]).tracking, {
    carrier: "UPS", trackingNumber: "1Z999AA10123456784", url: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784", deliveredAt: null,
  });
});

test("no tracking before the order ships (a label can still be voided), for a voided label, or without a number", () => {
  assert.equal(doctorTracking({ ...shippedLo, status: "ready_to_ship" }), null);
  assert.equal(doctorTracking({ ...shippedLo, shipment: { ...shippedLo.shipment, status: "voided" } }), null);
  assert.equal(doctorTracking({ ...shippedLo, shipment: { ...shippedLo.shipment, trackingNumber: null } }), null);
  assert.equal(doctorTracking({ ...shippedLo, shipment: null }), null);
  assert.equal(doctorTracking(null), null);
});

test("a manual shipment shows what staff typed, with no link", () => {
  const t = doctorTracking({ ...shippedLo, shipment: { carrier: "manual", serviceName: "Lone Star Courier", trackingNumber: "LS-1234567", status: "in_transit", deliveredAt: null } });
  assert.deepEqual(t, { carrier: "Lone Star Courier", trackingNumber: "LS-1234567", url: null, deliveredAt: null });
});
```

Append to `apps/api/src/services/lab/lab-orders.service.test.js`:

```js
test("the doctor view's lab orders carry the current shipment's public facts only", () => {
  const body = source.slice(source.indexOf("export async function labOrdersForCases"), source.indexOf("export async function mutateIn"));
  assert.match(body, /leftJoin\(shipments, eq\(shipments\.id, labOrders\.shipmentId\)\)/);
  assert.doesNotMatch(body, /labelData|shipTo|chargeCents|trackingError/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/email-shipping.test.js src/services/lab && cd ../../packages/shared && pnpm vitest run src/lab`
Expected: FAIL. `sendShippedNotice` and `doctorTracking` don't exist, and the doctor view has no `tracking`.

- [ ] **Step 3: Implement**

At the very end of `apps/api/src/services/email.service.js`, add the import at the top (`import { labIdentity } from "../config/lab-identity.js";`) and append:

```js
/**
 * "Your order has shipped" — one per shipment, after the box leaves
 * (lab-shipping.service markShipmentShipped). Order numbers, carrier, tracking
 * number and link only: shipping never carries clinical content. Sent only
 * when there is a tracking number. Never throws (deliver()).
 */
export async function sendShippedNotice({ to, orderNumbers = [], carrier, trackingNumber, trackingUrl = null }) {
  if (!to || !trackingNumber) return false;
  const lab = labIdentity().name;
  const orders = orderNumbers.map((n) => `#${esc(n)}`).join(", ");
  const button = trackingUrl
    ? `<p style="margin:0 0 24px;"><a href="${esc(trackingUrl)}" style="display:inline-block;padding:12px 24px;background:#13AEEF;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;">Track your package</a></p>`
    : "";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2733;">
      <h1 style="font-size:20px;margin:0 0 12px;">Your order has shipped</h1>
      <p style="margin:0 0 6px;">Order${orderNumbers.length === 1 ? "" : "s"}: <strong>${orders}</strong></p>
      <p style="margin:0 0 6px;">Carrier: <strong>${esc(carrier)}</strong></p>
      <p style="margin:0 0 20px;">Tracking number: <strong>${esc(trackingNumber)}</strong></p>
      ${button}
      <p style="margin:0;font-size:12px;color:#8a98a6;">${esc(lab)}</p>
    </div>`;
  return deliver({ to, subject: `Your order has shipped — ${lab}`, html });
}
```

In `packages/shared/src/lab/lab-order-status.js`, add `import { trackingUrl, carrierName } from "../shipping/shipping.js";` at the top, and before `doctorCaseView`:

```js
/**
 * Tracking a doctor may see: only for a SHIPPED lab order whose shipment has
 * a tracking number and wasn't voided (a label bought today can still be
 * voided tomorrow). Carrier, number, public link and delivered date; nothing
 * else from the shipment.
 */
export function doctorTracking(labOrder) {
  const s = labOrder?.shipment;
  if (labOrder?.status !== "shipped" || !s?.trackingNumber || s.status === "voided") return null;
  return { carrier: carrierName(s), trackingNumber: s.trackingNumber, url: trackingUrl(s.carrier, s.trackingNumber), deliveredAt: s.deliveredAt ?? null };
}
```

and add `tracking: doctorTracking(current),` as the last property of `doctorCaseView`'s result.

In `apps/api/src/services/lab/lab-orders.service.js`, add `shipments` to the schema import and replace `labOrdersForCases` with:

```js
/**
 * The lab orders behind each case — allow-listed columns only (doctor view,
 * Rx case detail), plus the CURRENT shipment's public facts for doctorTracking.
 */
export async function labOrdersForCases(caseIds) {
  const out = new Map();
  if (caseIds.length === 0) return out;
  const rows = await db
    .select({
      id: labOrders.id, sourceId: labOrders.sourceId, status: labOrders.status, orderNumber: labOrders.orderNumber,
      dueDate: labOrders.dueDate, isRemake: labOrders.isRemake, createdAt: labOrders.createdAt,
      shipCarrier: shipments.carrier, shipServiceName: shipments.serviceName, shipTracking: shipments.trackingNumber,
      shipStatus: shipments.status, shipDeliveredAt: shipments.deliveredAt,
    })
    .from(labOrders)
    .leftJoin(shipments, eq(shipments.id, labOrders.shipmentId))
    .where(and(eq(labOrders.source, "rx_case"), inArray(labOrders.sourceId, caseIds)));
  for (const { sourceId, shipCarrier, shipServiceName, shipTracking, shipStatus, shipDeliveredAt, ...lo } of rows) {
    const shipment = shipCarrier
      ? { carrier: shipCarrier, serviceName: shipServiceName, trackingNumber: shipTracking, status: shipStatus, deliveredAt: shipDeliveredAt }
      : null;
    if (!out.has(sourceId)) out.set(sourceId, []);
    out.get(sourceId).push({ ...lo, shipment });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test` (repo root)
Expected: PASS, including `routes/__tests__/rx-doctor-view.test.js` and `services/email-staging.test.js` (every sender still goes through `deliver`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/email.service.js apps/api/src/services/email-shipping.test.js apps/api/src/services/lab packages/shared/src/lab
git commit -m "feat(shipping): shipped email (order numbers + tracking only); doctors see tracking once shipped

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Lab shipping glue: shippable checks, ship-to, charge policy, buy, void, mark shipped, ship context, list

**Files:**
- Create: `apps/api/src/services/lab/lab-shipping-rules.js`, `apps/api/src/services/lab/lab-shipping-rules.test.js`, `apps/api/src/services/lab/lab-shipping-queries.js`, `apps/api/src/services/lab/lab-shipping.service.js`, `apps/api/src/services/lab/lab-shipping.service.test.js`
- Modify: `apps/api/src/services/billing/statements.service.js` (`loadClient` gains phone and delivery fields), `apps/api/src/services/billing/statements.service.test.js`

**Interfaces:**
- Consumes:
  - the shipments service and rules (Task 7) and `addShipmentLine` / `removeShipmentLine` (Task 8);
  - `mutateIn`, `changeStatus`, `billingFollowUp` and the link/unlink planners (Task 9);
  - `sendShippedNotice` (Task 10);
  - `loadClient` and `labIdentity`.
- Produces:
  - Rules (`lab-shipping-rules.js`):
    - `planShippable(orders, requestedIds) → orders sorted by orderNumber`, which throws `NOT_SHIPPABLE` with `problems[]`;
    - `shipmentReference(orderNumbers) → string ≤ 30`;
    - `planShippingCharge({ policy, flatCents, label, orders }) → { add: false, reason } | { add: true, labOrderId, orderNumber, unitCents, description }`;
    - `assertOrdersVoidable(orders)`, `shipToFromClient(client)`, `shipToFromShopOrder(shop)`.
  - Queries (`lab-shipping-queries.js`): `loadOrders(ids, database?)`, `ordersOnShipment(shipmentId, database?)`, `shipContext(labOrderId, database?)`, `shipmentRecipient(orders, database?)` and `listShipmentsForLab(filters, database?) → { shipments, truncated }`.
  - Service (`lab-shipping.service.js`). Each takes `deps = { database, registry, log, shipFrom, charge, emailEnabled }`, and production omits it:
    - `rateShipment({ shipTo, parcel }, deps)`;
    - `buyForOrders({ orderIds, shipTo, parcel, carrier, serviceCode, manual, byUserId }, deps) → { shipmentId, carrier, serviceName, trackingNumber, chargeCents, labelFormat, hasLabel, orderIds, orderNumbers, invoiceLine }`;
    - `voidShipment(shipmentId, { byUserId }, deps) → { shipmentId, orderIds, invoiceLineRemoved }`;
    - `markShipmentShipped(shipmentId, { byUserId }, deps) → { shipmentId, ordersShipped: number[], alreadyShipped }`;
    - `markOrderShipped(labOrderId, { expectedVersion, byUserId }, deps) → { order, changed }`;
    - `markAllLabelledShipped({ byUserId }, deps) → { shipped, failed }`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/lab/lab-shipping-rules.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  planShippable, shipmentReference, planShippingCharge, assertOrdersVoidable, shipToFromClient, shipToFromShopOrder,
} from "./lab-shipping-rules.js";
import { ShippingError } from "../shipping/shipping-errors.js";

const o = (over) => ({ id: "lo1", orderNumber: 100245, status: "ready_to_ship", source: "rx_case", clientUserId: "doc1", isRemake: false, shipmentId: null, ...over });
const notShippable = (e) => e instanceof ShippingError && e.code === "NOT_SHIPPABLE";
const label = { carrier: "ups", serviceName: "UPS Ground", trackingNumber: "1Z999AA10123456784", chargeCents: 1142 };

test("shippable: ready, unlabelled orders of one client, returned lowest number first", () => {
  const out = planShippable([o({ id: "b", orderNumber: 100246 }), o({ id: "a" })], ["a", "b"]);
  assert.deepEqual(out.map((x) => x.id), ["a", "b"]);
});

test("shippable: every reason is listed, so staff fix them all at once", () => {
  assert.throws(() => planShippable([o({ status: "quality_check" }), o({ id: "b", orderNumber: 100246, shipmentId: "sh0" })], ["lo1", "b"]), (e) =>
    notShippable(e) && e.problems.length === 2 && /#100245 is not ready to ship/.test(e.problems[0]) && /#100246 already has a label/.test(e.problems[1]));
  assert.throws(() => planShippable([o()], ["lo1", "gone"]), (e) => notShippable(e) && /no longer exists/.test(e.message));
});

test("shippable: one client per box; a guest shop order ships alone", () => {
  assert.throws(() => planShippable([o(), o({ id: "b", orderNumber: 100246, clientUserId: "doc2" })], ["lo1", "b"]), notShippable);
  assert.throws(() => planShippable([o({ clientUserId: null }), o({ id: "b", orderNumber: 100246, clientUserId: null })], ["lo1", "b"]), notShippable);
  assert.equal(planShippable([o({ clientUserId: null, source: "shop_order" })], ["lo1"]).length, 1);
});

test("the label reference is order numbers only, within the carriers' 30 characters", () => {
  assert.equal(shipmentReference([100246, 100245]), "Order 100245, 100246");
  assert.equal(shipmentReference([100245, 100246, 100247, 100248]), "Orders 100245 +3");
});

test("charge policy none adds nothing", () => {
  assert.deepEqual(planShippingCharge({ policy: "none", flatCents: 0, label, orders: [o()] }), { add: false, reason: "policy_none" });
});

test("carrier_cost: the label's charge, on the lowest-numbered NON-REMAKE Rx order", () => {
  const plan = planShippingCharge({ policy: "carrier_cost", flatCents: 0, label, orders: [o({ id: "r", orderNumber: 100100, isRemake: true }), o({ id: "x", orderNumber: 100300 }), o()] });
  assert.deepEqual(plan, { add: true, labOrderId: "lo1", orderNumber: 100245, unitCents: 1142, description: "Shipping — UPS Ground 1Z999AA10123456784" });
});

test("flat: the configured amount; $0 adds nothing", () => {
  assert.equal(planShippingCharge({ policy: "flat", flatCents: 1500, label, orders: [o()] }).unitCents, 1500);
  assert.deepEqual(planShippingCharge({ policy: "flat", flatCents: 0, label, orders: [o()] }), { add: false, reason: "zero" });
});

test("remakes and shop orders never carry the shipping line", () => {
  assert.deepEqual(planShippingCharge({ policy: "carrier_cost", flatCents: 0, label, orders: [o({ isRemake: true })] }), { add: false, reason: "all_remakes" });
  assert.deepEqual(planShippingCharge({ policy: "carrier_cost", flatCents: 0, label, orders: [o({ source: "shop_order" })] }), { add: false, reason: "no_billable_order" });
});

test("void needs every order still waiting at ready_to_ship", () => {
  assert.doesNotThrow(() => assertOrdersVoidable([o({ shipmentId: "sh1" })]));
  assert.throws(() => assertOrdersVoidable([o({ status: "shipped" })]), (e) => e.code === "VOID_REFUSED" && /#100245/.test(e.message));
});

test("ship-to from a doctor's profile: practice as company, the doctor as the person; none without an address", () => {
  const client = { name: "Dr. Ada Smile", practice: "Smile Dental", phone: "512-555-0100", address1: "100 Main St", address2: null, city: "Austin", state: "tx", zip: "78701" };
  assert.deepEqual(shipToFromClient(client), {
    name: "Dr. Ada Smile", company: "Smile Dental", phone: "512-555-0100", address1: "100 Main St", address2: null,
    city: "Austin", state: "TX", postalCode: "78701", country: "US",
  });
  assert.equal(shipToFromClient({ ...client, address1: null }), null);
  assert.equal(shipToFromClient(null), null);
});

test("ship-to from a shop order: the checkout's address and phone", () => {
  const shop = { phone: "210-555-0111", shipping: { name: "Pat Smith", address1: "5 Elm", city: "Waco", state: "TX", postalCode: "76701" } };
  assert.deepEqual(shipToFromShopOrder(shop), {
    name: "Pat Smith", company: null, phone: "210-555-0111", address1: "5 Elm", address2: null, city: "Waco", state: "TX", postalCode: "76701", country: "US",
  });
  assert.equal(shipToFromShopOrder(null), null);
});
```

`apps/api/src/services/lab/lab-shipping.service.test.js`:

```js
import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const sentEmails = [];
vi.mock("../email.service.js", () => ({ sendShippedNotice: vi.fn(async (args) => { sentEmails.push(args); return true; }) }));

const svc = await import("./lab-shipping.service.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { fakeAdapter, fakeRegistry, TEST_SHIP_FROM, TEST_LABEL } = await import("../../test/carrier-config.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(new URL("./lab-shipping.service.js", import.meta.url), "utf8");

const shipTo = { name: "Dr. Ada", company: "Smile Dental", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const order = (over) => ({
  id: "lo1", orderNumber: 100245, status: "ready_to_ship", source: "rx_case", sourceId: "c1", clientUserId: "doc1",
  isRemake: false, shipmentId: null, version: 3, holdReason: null, labNotes: null, shippedAt: null, ...over,
});
const draft = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 1, subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0, notes: null, voidReason: null };
const deps = (database, adapters = [fakeAdapter("ups")], extra = {}) => ({
  database, registry: fakeRegistry(adapters), shipFrom: TEST_SHIP_FROM, charge: { policy: "none", flatCents: 0 },
  emailEnabled: true, log: { error: () => {} }, ...extra,
});
const buy = (over = {}) => ({ orderIds: ["lo1"], shipTo, parcel, carrier: "ups", serviceCode: "03", byUserId: "u1", ...over });
const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);

test("an order that isn't shippable is refused before any carrier call", async () => {
  const ups = fakeAdapter("ups");
  await assert.rejects(svc.buyForOrders(buy(), deps(fakeTx({ selects: [[order({ status: "quality_check" })]] }), [ups])), (e) => e.code === "NOT_SHIPPABLE");
  assert.equal(ups.calls.length, 0);
});

test("ship together: one label for the box, order numbers as the reference, every order linked in one transaction", async () => {
  const ups = fakeAdapter("ups");
  const a = order();
  const b = order({ id: "lo2", orderNumber: 100246, version: 1 });
  const tx = fakeTx({ selects: [[b, a], [a], [b]], updates: [[{ ...a, shipmentId: "x", version: 4 }], [{ ...b, shipmentId: "x", version: 2 }]] });
  const out = await svc.buyForOrders(buy({ orderIds: ["lo2", "lo1"] }), deps(tx, [ups]));
  const request = ups.calls.find(([n]) => n === "createLabel")[1];
  assert.equal(request.reference, "Order 100245, 100246");
  assert.deepEqual(request.shipFrom, TEST_SHIP_FROM);
  assert.deepEqual(out.orderNumbers, [100245, 100246]);
  assert.equal(out.trackingNumber, TEST_LABEL.trackingNumber);
  assert.deepEqual(out.invoiceLine, { added: false, reason: "policy_none" });
  const [shipmentRow, firstEvent, ...labEvents] = inserts(tx);
  assert.equal(shipmentRow.carrier, "ups");
  assert.equal(firstEvent.status, "label_created");
  assert.deepEqual(labEvents.map((e) => e.type), ["shipment", "shipment"]);
  assert.match(decryptField(labEvents[0].note), /^Label: UPS Ground 1Z999/);
});

test("an order labelled by someone else meanwhile: the save fails and the just-bought label is voided", async () => {
  const ups = fakeAdapter("ups");
  const tx = fakeTx({ selects: [[order()], [order({ shipmentId: "sh0" })]] });
  await assert.rejects(svc.buyForOrders(buy(), deps(tx, [ups])), (e) =>
    e.code === "LABEL_NOT_SAVED" && e.cause instanceof LabOrderError && e.cause.code === "CONFLICT");
  assert.equal(ups.calls.filter(([n]) => n === "voidLabel").length, 1);
});

test("carrier_cost: the label's charge goes on the lowest non-remake Rx order's draft", async () => {
  const remake = order({ id: "lo0", orderNumber: 100200, isRemake: true, version: 1 });
  const a = order();
  const tx = fakeTx({
    selects: [[remake, a], [remake], [a], [draft], []],
    updates: [[{ ...remake, shipmentId: "x", version: 2 }], [{ ...a, shipmentId: "x", version: 4 }], [{ ...draft, version: 2 }]],
  });
  const out = await svc.buyForOrders(buy({ orderIds: ["lo0", "lo1"] }), deps(tx, undefined, { charge: { policy: "carrier_cost", flatCents: 0 } }));
  assert.deepEqual(out.invoiceLine, { added: true, invoiceNumber: 500001 });
  const line = inserts(tx).find((v) => v.kind === "shipping");
  assert.deepEqual([line.unitCents, line.description, line.priceSource], [1142, "Shipping — UPS Ground 1Z999AA10123456784", "shipment"]);
});

test("an invoice that's no longer a draft gets nothing, and the order's history says why", async () => {
  const a = order();
  const tx = fakeTx({
    selects: [[a], [a], [{ ...draft, status: "issued" }], [{ ...a, shipmentId: "x", version: 4 }]],
    updates: [[{ ...a, shipmentId: "x", version: 4 }], [{ ...a, shipmentId: "x", version: 5 }]],
  });
  const out = await svc.buyForOrders(buy(), deps(tx, undefined, { charge: { policy: "carrier_cost", flatCents: 0 } }));
  assert.deepEqual(out.invoiceLine, { added: false, reason: "not_draft", invoiceNumber: 500001 });
  const note = inserts(tx).at(-1);
  assert.equal(note.type, "note");
  assert.match(decryptField(note.note), /invoice #500001 is no longer a draft/);
});

const shipment = { id: "sh1", carrier: "ups", status: "label_created", shippedAt: null, carrierShipmentId: "1Z1", trackingNumber: "1Z999AA10123456784", serviceName: "UPS Ground" };

test("void is refused (and the carrier never asked) once an order has moved", async () => {
  const ups = fakeAdapter("ups");
  const tx = fakeTx({ selects: [[shipment], [order({ status: "shipped", shipmentId: "sh1" })]] });
  await assert.rejects(svc.voidShipment("sh1", { byUserId: "u1" }, deps(tx, [ups])), (e) => e.code === "VOID_REFUSED");
  assert.equal(ups.calls.length, 0);
});

test("void: carrier first, then the shipment, the order link and the invoice line", async () => {
  const ups = fakeAdapter("ups");
  const linked = order({ shipmentId: "sh1" });
  const tx = fakeTx({ selects: [[shipment], [linked], [linked]], updates: [undefined, [{ ...linked, shipmentId: null, version: 4 }]] });
  const out = await svc.voidShipment("sh1", { byUserId: "u1" }, deps(tx, [ups]));
  assert.deepEqual(out, { shipmentId: "sh1", orderIds: ["lo1"], invoiceLineRemoved: false });
  assert.equal(ups.calls[0][0], "voidLabel");
  assert.equal(tx.log.find((l) => l.op === "set").values.status, "voided");
});

test("mark shipped: every order in the box ships, and ONE email lists them all", async () => {
  sentEmails.length = 0;
  const a = order({ shipmentId: "sh1" });
  const b = order({ id: "lo2", orderNumber: 100246, version: 1, shipmentId: "sh1" });
  const client = { id: "doc1", name: "Dr. Ada", email: "dr@x.com", role: "doctor", accountNumber: null, profile: null };
  const tx = fakeTx({
    // shipment, the box, then per order: its row + the billing follow-up's two reads; then the email's reads
    selects: [[shipment], [a, b], [a], [], [], [b], [], [], [a, b], [client]],
    updates: [[{ id: "sh1" }], [{ ...a, status: "shipped", version: 4 }], [{ ...b, status: "shipped", version: 2 }]],
  });
  const out = await svc.markShipmentShipped("sh1", { byUserId: "u1" }, deps(tx));
  assert.deepEqual(out, { shipmentId: "sh1", ordersShipped: [100245, 100246], alreadyShipped: false });
  assert.equal(sentEmails.length, 1);
  assert.deepEqual(sentEmails[0], {
    to: "dr@x.com", orderNumbers: [100245, 100246], carrier: "UPS", trackingNumber: "1Z999AA10123456784",
    trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784",
  });
});

test("mark shipped twice (staff and the tracking sync racing): the second sends nothing", async () => {
  sentEmails.length = 0;
  const shippedA = order({ shipmentId: "sh1", status: "shipped" });
  const tx = fakeTx({ selects: [[{ ...shipment, shippedAt: new Date() }], [shippedA]], updates: [[]] });
  const out = await svc.markShipmentShipped("sh1", { byUserId: null }, deps(tx));
  assert.deepEqual(out, { shipmentId: "sh1", ordersShipped: [], alreadyShipped: true });
  assert.equal(sentEmails.length, 0);
});

test("mark shipped on one order: an unlabelled order takes the normal path; a labelled one ships its box", () => {
  assert.match(source, /if \(!order\.shipmentId\) return changeStatus\(labOrderId, \{ to: "shipped", expectedVersion, byUserId \}\);/);
  assert.match(source, /assertFresh\(order, expectedVersion\);\s*await markShipmentShipped\(order\.shipmentId/);
});

test("a stale order page can't ship a box", async () => {
  const tx = fakeTx({ selects: [[order({ shipmentId: "sh1", version: 3 })]] });
  await assert.rejects(svc.markOrderShipped("lo1", { expectedVersion: 2, byUserId: "u1" }, deps(tx)), (e) => e instanceof LabOrderError && e.code === "STALE");
});

test("shipping never reads patient data", () => {
  assert.doesNotMatch(source, /patient|formData|caseSummary|decryptRxPhi/i);
});
```

Append to `apps/api/src/services/billing/statements.service.test.js`:

```js
test("loadClient carries the practice phone and delivery preferences (the Ship form's starting ship-to)", async () => {
  const c = await svc.loadClient("d1", fakeTx({ selects: [[{
    id: "d1", name: "Dr", email: "d@x.com", role: "doctor", accountNumber: null,
    profile: { companyName: "P", address1: "1 St", address2: null, city: "Austin", state: "TX", zip: "78701", phone: "512-555-0100", deliveryMethod: "UPS Ground", deliveryNotes: "Back door" },
  }]] }));
  assert.deepEqual([c.phone, c.deliveryMethod, c.deliveryNotes], ["512-555-0100", "UPS Ground", "Back door"]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/lab src/services/billing/statements.service.test.js`
Expected: FAIL. The lab shipping modules don't exist, and `loadClient` has no phone.

- [ ] **Step 3: Write the rules**

`apps/api/src/services/lab/lab-shipping-rules.js`:

```js
import { CARRIER_LABELS } from "@my-app/shared";
import { ShippingError } from "../shipping/shipping-errors.js";

/**
 * Pure lab-shipping rules: which orders may share a box, what the label's
 * reference says, what a shipment adds to the bill, and the ship-to a form
 * starts from. No DB and no clock.
 */

/**
 * The orders staff picked → sorted lowest number first, or NOT_SHIPPABLE with
 * every reason (so staff fix them all at once). Each must be at ready_to_ship
 * with no label, and all must belong to one client; a guest shop order (no
 * client) ships alone. Checked before the carrier is called and re-checked
 * per order inside the persisting transaction (planShipmentLink).
 */
export function planShippable(orders, requestedIds) {
  const problems = [];
  const found = new Set(orders.map((o) => o.id));
  if (requestedIds.some((id) => !found.has(id))) problems.push("An order in this shipment no longer exists.");
  const sorted = [...orders].sort((a, b) => a.orderNumber - b.orderNumber);
  for (const o of sorted) {
    if (o.status !== "ready_to_ship") problems.push(`Order #${o.orderNumber} is not ready to ship.`);
    if (o.shipmentId) problems.push(`Order #${o.orderNumber} already has a label.`);
  }
  const clients = new Set(sorted.map((o) => o.clientUserId ?? null));
  if (sorted.length > 1 && (clients.size > 1 || clients.has(null))) {
    problems.push("Orders in one box must belong to the same client, and a guest order ships on its own.");
  }
  if (problems.length) throw new ShippingError("NOT_SHIPPABLE", problems[0], { problems });
  return sorted;
}

/** The label's reference: order numbers only (never a patient, device or Rx text), ≤ 30 characters. */
export function shipmentReference(orderNumbers) {
  const nums = [...orderNumbers].sort((a, b) => a - b);
  const full = `Order ${nums.join(", ")}`;
  return full.length <= 30 ? full : `Orders ${nums[0]} +${nums.length - 1}`;
}

/**
 * SHIPPING_CHARGE_POLICY → the one shipping line a new shipment adds, or why
 * none. Shop orders paid their shipping at checkout and remakes are free, so
 * neither carries it: the line goes on the lowest-numbered non-remake Rx order.
 */
export function planShippingCharge({ policy, flatCents, label, orders }) {
  if (policy === "none") return { add: false, reason: "policy_none" };
  const billable = orders.filter((o) => o.source === "rx_case" && !o.isRemake).sort((a, b) => a.orderNumber - b.orderNumber);
  if (billable.length === 0) return { add: false, reason: orders.every((o) => o.isRemake) ? "all_remakes" : "no_billable_order" };
  const unitCents = policy === "flat" ? flatCents : label.chargeCents;
  if (!Number.isSafeInteger(unitCents) || unitCents <= 0) return { add: false, reason: "zero" };
  const what = [label.serviceName || CARRIER_LABELS[label.carrier], label.trackingNumber].filter(Boolean).join(" ");
  return { add: true, labOrderId: billable[0].id, orderNumber: billable[0].orderNumber, unitCents, description: `Shipping — ${what}`.slice(0, 255) };
}

/** Voiding needs every order on the label still waiting at ready_to_ship. */
export function assertOrdersVoidable(orders) {
  const moved = orders.find((o) => o.status !== "ready_to_ship");
  if (moved) throw new ShippingError("VOID_REFUSED", `Order #${moved.orderNumber} is no longer ready to ship, so its label can't be voided.`);
}

const upper = (s) => String(s ?? "").trim().toUpperCase();

/** A doctor (statements.service loadClient) → the ship-to: practice as company, the doctor as the person. */
export function shipToFromClient(client) {
  if (!client?.address1) return null;
  return {
    name: client.name ?? "", company: client.practice ?? null, phone: client.phone ?? null,
    address1: client.address1, address2: client.address2 ?? null, city: client.city ?? "",
    state: upper(client.state), postalCode: client.zip ?? "", country: "US",
  };
}

/** A shop order (orders.shipping + orders.phone) → the ship-to. */
export function shipToFromShopOrder(shop) {
  const s = shop?.shipping;
  if (!s?.address1) return null;
  return {
    name: s.name ?? "", company: s.company ?? null, phone: shop.phone ?? null,
    address1: s.address1, address2: s.address2 ?? null, city: s.city ?? "",
    state: upper(s.state), postalCode: s.postalCode ?? "", country: "US",
  };
}
```

- [ ] **Step 4: Write the queries**

In `apps/api/src/services/billing/statements.service.js`, extend `loadClient`'s returned object with:

```js
    phone: p?.phone ?? null, deliveryMethod: p?.deliveryMethod ?? null, deliveryNotes: p?.deliveryNotes ?? null,
```

and update its JSDoc to "The doctor's bill-to and ship-to block (statements, invoices, the Ship form), or null when the user isn't a doctor."

`apps/api/src/services/lab/lab-shipping-queries.js`:

```js
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { MAX_ORDERS_PER_SHIPMENT, trackingUrl } from "@my-app/shared";
import { db } from "../../config/database.js";
import { labOrders, labOrderEvents, orders, users } from "../../db/schema/index.js";
import { loadClient } from "../billing/statements.service.js";
import { carrierRegistry } from "../shipping/carrier-registry.js";
import { listShipments, SHIPMENT_LIST_LIMIT } from "../shipping/shipments.service.js";
import { shipToFromClient, shipToFromShopOrder } from "./lab-shipping-rules.js";

/** Lab-order reads for shipping. Allow-listed columns only: no notes, no patient data. */
const ORDER_COLS = {
  id: labOrders.id, orderNumber: labOrders.orderNumber, status: labOrders.status, source: labOrders.source,
  sourceId: labOrders.sourceId, clientUserId: labOrders.clientUserId, isRemake: labOrders.isRemake,
  shipmentId: labOrders.shipmentId, version: labOrders.version,
};

export function loadOrders(ids, database = db) {
  return database.select(ORDER_COLS).from(labOrders).where(inArray(labOrders.id, ids));
}

export function ordersOnShipment(shipmentId, database = db) {
  return database.select(ORDER_COLS).from(labOrders).where(eq(labOrders.shipmentId, shipmentId)).orderBy(asc(labOrders.orderNumber));
}

async function shopOrderFor(labOrder, database) {
  if (labOrder?.source !== "shop_order") return null;
  const [s] = await database
    .select({ id: orders.id, email: orders.email, phone: orders.phone, shipping: orders.shipping })
    .from(orders)
    .where(eq(orders.id, labOrder.sourceId));
  return s ?? null;
}

/**
 * What the Ship form opens with: the order, a ship-to (the shop checkout's
 * address, else the doctor's profile), the profile's delivery hint, the
 * client's other ready, unlabelled orders (ship together) and each carrier's
 * enabled state.
 */
export async function shipContext(labOrderId, database = db) {
  const [order] = await loadOrders([labOrderId], database);
  if (!order) return null;
  const client = order.clientUserId ? await loadClient(order.clientUserId, database) : null;
  const shop = await shopOrderFor(order, database);
  const siblings = order.clientUserId
    ? await database
        .select({ id: labOrders.id, orderNumber: labOrders.orderNumber, source: labOrders.source, isRemake: labOrders.isRemake })
        .from(labOrders)
        .where(and(
          eq(labOrders.clientUserId, order.clientUserId), eq(labOrders.status, "ready_to_ship"),
          isNull(labOrders.shipmentId), ne(labOrders.id, order.id),
        ))
        .orderBy(asc(labOrders.orderNumber))
        .limit(MAX_ORDERS_PER_SHIPMENT - 1)
    : [];
  return {
    order: { id: order.id, orderNumber: order.orderNumber, status: order.status, source: order.source, shipmentId: order.shipmentId },
    shipTo: shipToFromShopOrder(shop) ?? shipToFromClient(client),
    deliveryHint: client?.deliveryMethod || client?.deliveryNotes ? { method: client.deliveryMethod, notes: client.deliveryNotes } : null,
    siblings,
    carriers: carrierRegistry().status(),
  };
}

/** Who gets the shipped email: the client doctor, else the shop order's email (a guest). */
export async function shipmentRecipient(boxed, database = db) {
  const first = boxed[0];
  if (!first) return null;
  if (first.clientUserId) return (await loadClient(first.clientUserId, database))?.email ?? null;
  return (await shopOrderFor(first, database))?.email ?? null;
}

/**
 * Admin › Shipments rows: the shipment summary, the orders it carried (from
 * the "shipment" link events, so a voided label still shows what it was for),
 * who bought it, the public tracking link, and which actions apply. The ship-to
 * is reduced to a name.
 */
export async function listShipmentsForLab(filters = {}, database = db) {
  const rows = await listShipments(filters, database);
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await database
        .selectDistinct({ shipmentId: labOrderEvents.to, labOrderId: labOrders.id, orderNumber: labOrders.orderNumber })
        .from(labOrderEvents)
        .innerJoin(labOrders, eq(labOrders.id, labOrderEvents.labOrderId))
        .where(and(eq(labOrderEvents.type, "shipment"), inArray(labOrderEvents.to, ids)))
        .orderBy(asc(labOrders.orderNumber))
    : [];
  const userIds = [...new Set(rows.map((r) => r.createdByUserId).filter(Boolean))];
  const names = new Map(
    userIds.length ? (await database.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]) : [],
  );
  const byShipment = new Map();
  for (const l of links) {
    if (!byShipment.has(l.shipmentId)) byShipment.set(l.shipmentId, []);
    byShipment.get(l.shipmentId).push({ id: l.labOrderId, orderNumber: l.orderNumber });
  }
  return {
    shipments: rows.map(({ shipTo, ...s }) => ({
      ...s,
      shipToName: shipTo?.company || shipTo?.name || null,
      trackingUrl: trackingUrl(s.carrier, s.trackingNumber),
      orders: byShipment.get(s.id) ?? [],
      createdByName: names.get(s.createdByUserId) ?? null,
      canVoid: s.status === "label_created" && !s.shippedAt,
      canMarkShipped: !s.shippedAt && s.status !== "voided",
    })),
    truncated: rows.length >= SHIPMENT_LIST_LIMIT,
  };
}
```

- [ ] **Step 5: Write the service**

`apps/api/src/services/lab/lab-shipping.service.js`:

```js
import { carrierName, trackingUrl } from "@my-app/shared";
import { db } from "../../config/database.js";
import { env } from "../../config/env.js";
import { labIdentity } from "../../config/lab-identity.js";
import { createId } from "../../lib/id.js";
import { sendShippedNotice } from "../email.service.js";
import { addShipmentLine, removeShipmentLine } from "../billing/invoices.service.js";
import { carrierRegistry } from "../shipping/carrier-registry.js";
import { ShippingError } from "../shipping/shipping-errors.js";
import { planNewShipment, assertVoidable } from "../shipping/shipment-rules.js";
import * as shipments from "../shipping/shipments.service.js";
import { mutateIn, changeStatus, billingFollowUp } from "./lab-orders.service.js";
import { LabOrderError, assertFresh, planStatusChange, planShipmentLink, planShipmentUnlink } from "./lab-order-rules.js";
import { planShippable, shipmentReference, planShippingCharge, assertOrdersVoidable } from "./lab-shipping-rules.js";
import { loadOrders, ordersOnShipment, shipmentRecipient } from "./lab-shipping-queries.js";

/**
 * Lab glue: shipments (the generic layer, services/shipping/) ↔ lab orders and
 * their invoices. Orders always move through mutateIn + planStatusChange +
 * billingFollowUp, exactly like every other status change, so a shipped order's
 * invoice is issued the same way. `deps` exists for tests; production omits it.
 */
function resolve(deps = {}) {
  return {
    database: deps.database ?? db,
    registry: deps.registry ?? carrierRegistry(),
    log: deps.log ?? console,
    shipFrom: deps.shipFrom !== undefined ? deps.shipFrom : labIdentity().address,
    charge: deps.charge ?? { policy: env.SHIPPING_CHARGE_POLICY, flatCents: env.SHIPPING_FLAT_CENTS },
    emailEnabled: deps.emailEnabled ?? env.SHIPPED_EMAIL_ENABLED,
  };
}

export function rateShipment({ shipTo, parcel }, deps) {
  const d = resolve(deps);
  return shipments.rateAll({ shipFrom: d.shipFrom, shipTo, parcel }, { registry: d.registry });
}

/**
 * Buy one label for one or more orders (ship together). Checks every order
 * BEFORE the carrier is called, then saves the shipment, links each order and
 * applies the charge policy in ONE transaction. If that transaction fails, the
 * label is voided at the carrier (shipments.service purchaseAndPersist).
 * Idempotency is the route's job (withIdempotency).
 */
export async function buyForOrders({ orderIds, shipTo, parcel, carrier, serviceCode, manual, byUserId = null }, deps) {
  const d = resolve(deps);
  const ordered = planShippable(await loadOrders(orderIds, d.database), orderIds);
  const request = {
    carrier, serviceCode, manual, shipFrom: d.shipFrom, shipTo, parcel,
    reference: shipmentReference(ordered.map((o) => o.orderNumber)),
  };
  return shipments.purchaseAndPersist(
    request,
    (label) => d.database.transaction((tx) => persistShipment(tx, { label, ordered, parcel, shipTo, byUserId, d })),
    { registry: d.registry, log: d.log },
  );
}

async function persistShipment(tx, { label, ordered, parcel, shipTo, byUserId, d }) {
  const now = new Date();
  const plan = planNewShipment({ id: createId(), label, parcel, shipTo, shipFrom: d.shipFrom, createdByUserId: byUserId, now });
  await shipments.insertShipment(tx, plan);
  const linked = [];
  for (const o of ordered) {
    const { order } = await mutateIn(tx, o.id, null, (current) => planShipmentLink(current, plan.shipment, { byUserId, now }));
    linked.push(order);
  }
  const invoiceLine = await applyShippingCharge(tx, { label, orders: linked, shipmentId: plan.shipment.id, byUserId, now, charge: d.charge });
  const s = plan.shipment;
  return {
    shipmentId: s.id, carrier: s.carrier, serviceName: s.serviceName, trackingNumber: s.trackingNumber,
    chargeCents: s.chargeCents, labelFormat: s.labelFormat, hasLabel: Boolean(s.labelData),
    orderIds: linked.map((o) => o.id), orderNumbers: linked.map((o) => o.orderNumber), invoiceLine,
  };
}

/** The charge policy's line on the right draft; when it can't land, the order's history says why. */
async function applyShippingCharge(tx, { label, orders, shipmentId, byUserId, now, charge }) {
  const plan = planShippingCharge({ ...charge, label, orders });
  if (!plan.add) return { added: false, reason: plan.reason };
  const out = await addShipmentLine(tx, { labOrderId: plan.labOrderId, shipmentId, description: plan.description, unitCents: plan.unitCents, byUserId });
  if (!out.added) {
    const why = out.reason === "not_draft" ? `invoice #${out.invoiceNumber} is no longer a draft` : "it has no invoice";
    await mutateIn(tx, plan.labOrderId, null, (order) => ({
      patch: { version: order.version + 1, updatedAt: now },
      event: { labOrderId: order.id, type: "note", from: null, to: null, byUserId, note: `Shipping was not added to the bill: ${why}.`, at: now },
    }));
  }
  return out;
}

/**
 * Void an unused label: carrier first (a refusal stops here, in the carrier's
 * words), then the shipment, every order's link and the invoice line it added,
 * in one transaction. A DB failure after the carrier voided is logged
 * [SHIP][VOID_UNRECORDED] (ids only) for staff to reconcile.
 */
export async function voidShipment(shipmentId, { byUserId = null } = {}, deps) {
  const d = resolve(deps);
  const shipment = await shipments.getShipment(shipmentId, d.database);
  if (!shipment) throw new ShippingError("NOT_FOUND", "Shipment not found.");
  const linked = await ordersOnShipment(shipmentId, d.database);
  assertVoidable(shipment);
  assertOrdersVoidable(linked);
  await shipments.voidAtCarrier(shipment, { registry: d.registry });
  try {
    return await d.database.transaction(async (tx) => {
      const now = new Date();
      await shipments.markVoided(tx, shipment, { now });
      for (const o of linked) await mutateIn(tx, o.id, null, (current) => planShipmentUnlink(current, shipment, { byUserId, now }));
      const line = await removeShipmentLine(tx, { shipmentId, byUserId });
      return { shipmentId, orderIds: linked.map((o) => o.id), invoiceLineRemoved: line.removed };
    });
  } catch (err) {
    d.log.error(`[SHIP][VOID_UNRECORDED] shipment=${shipmentId} carrier=${shipment.carrier}`);
    throw err;
  }
}

/**
 * The box left. Every order on the shipment still at ready_to_ship moves to
 * shipped (each invoice is issued by billingFollowUp, in a savepoint), and
 * shippedAt is claimed once. After commit, ONLY the caller that claimed it sends
 * the one shipped email. Safe to call twice (staff and the tracking sync racing).
 */
export async function markShipmentShipped(shipmentId, { byUserId = null } = {}, deps) {
  const d = resolve(deps);
  const result = await d.database.transaction(async (tx) => {
    const shipment = await shipments.getShipment(shipmentId, tx);
    if (!shipment) throw new ShippingError("NOT_FOUND", "Shipment not found.");
    if (shipment.status === "voided") throw new ShippingError("INVALID", "This label was voided.");
    const now = new Date();
    const claimed = await shipments.stampShipped(tx, shipment, { now });
    const moved = [];
    for (const o of await ordersOnShipment(shipmentId, tx)) {
      if (o.status !== "ready_to_ship") continue;
      const { order } = await mutateIn(tx, o.id, null, (current) => ({
        ...planStatusChange(current, "shipped", { byUserId, now }),
        after: billingFollowUp("shipped", byUserId),
      }));
      moved.push(order.orderNumber);
    }
    return { shipment, claimed, moved };
  });
  if (result.claimed) {
    await notifyShipped(result.shipment, d).catch((err) =>
      d.log.error(`[SHIP][EMAIL_FAILED] shipment=${shipmentId}: ${String(err?.message || err).slice(0, 200)}`));
  }
  return { shipmentId, ordersShipped: result.moved, alreadyShipped: !result.claimed };
}

async function notifyShipped(shipment, d) {
  if (!d.emailEnabled || !shipment.trackingNumber) return false;
  const boxed = await ordersOnShipment(shipment.id, d.database);
  const to = await shipmentRecipient(boxed, d.database);
  if (!to) return false;
  return sendShippedNotice({
    to, orderNumbers: boxed.map((o) => o.orderNumber), carrier: carrierName(shipment),
    trackingNumber: shipment.trackingNumber, trackingUrl: trackingUrl(shipment.carrier, shipment.trackingNumber),
  });
}

/**
 * "→ Shipped" on one order (the order page, a board card). An unlabelled order
 * (a pick-up, a hand delivery) takes the normal status path; a labelled one
 * ships its whole box.
 */
export async function markOrderShipped(labOrderId, { expectedVersion, byUserId = null }, deps) {
  const d = resolve(deps);
  const [order] = await loadOrders([labOrderId], d.database);
  if (!order) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
  if (!order.shipmentId) return changeStatus(labOrderId, { to: "shipped", expectedVersion, byUserId });
  assertFresh(order, expectedVersion);
  await markShipmentShipped(order.shipmentId, { byUserId }, deps);
  const [after] = await loadOrders([labOrderId], d.database);
  return { order: after, changed: true };
}

/** End-of-day hand-off: every labelled, unshipped box. One failure is logged and the rest still ship. */
export async function markAllLabelledShipped({ byUserId = null } = {}, deps) {
  const d = resolve(deps);
  let shipped = 0;
  let failed = 0;
  for (const id of await shipments.unshippedShipmentIds(d.database)) {
    try {
      await markShipmentShipped(id, { byUserId }, deps);
      shipped += 1;
    } catch (err) {
      failed += 1;
      d.log.error(`[SHIP][MARK_SHIPPED_FAILED] shipment=${id}: ${String(err?.message || err).slice(0, 200)}`);
    }
  }
  return { shipped, failed };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/lab src/services/billing`
Expected: PASS.

If a `fakeTx` queue in `lab-shipping.service.test.js` is off by one because a read was added or removed, fix the **queue in the test** to match the documented read order (each test's comment lists it). Never reorder the service's reads to suit a test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/lab apps/api/src/services/billing/statements.service.js apps/api/src/services/billing/statements.service.test.js
git commit -m "feat(lab): buy, void and ship labels for one box of orders; charge policy on the right draft

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Routes: `/lab/shipments*`, ship context, carriers; the status route ships the whole box

**Files:**
- Create: `apps/api/src/routes/shipping.routes.js`, `apps/api/src/routes/__tests__/shipping-routes.test.js`
- Modify: `apps/api/src/routes/lab.routes.js` (`run` maps shipping errors; the status route delegates `to: "shipped"`), `apps/api/src/routes/__tests__/lab-routes.test.js`, `apps/api/src/index.js`

**Interfaces:**
- Consumes: Task 11's service and queries; `withIdempotency`, `ChargeInProgressError` (`lib/payment-helpers.js`); `STAFF` (`routes/lab.routes.js`); the schemas (Task 1); `getLabel` (Task 7).
- Produces (all `/api/v1`, all `STAFF` = signed-in `admin` or `lab`):

| Method | Path | Body / query | Returns `data` |
|---|---|---|---|
| GET | `/lab/orders/:id/ship` | — | `shipContext` |
| GET | `/lab/carriers` | — | `{ carriers: status[] }` |
| POST | `/lab/shipments/rates` | `shipmentRatesSchema` | `{ quotes, errors, disabled }` |
| POST | `/lab/shipments` | `shipmentBuySchema` + **`Idempotency-Key` header** | buy result (201) |
| GET | `/lab/shipments` | `shipmentListQuerySchema` | `{ shipments, truncated }` |
| GET | `/lab/shipments/:id/label` | — | raw label bytes (`image/gif`, `image/png`, or a `.zpl` attachment) |
| POST | `/lab/shipments/:id/void` | — | void result |
| POST | `/lab/shipments/:id/mark-shipped` | — | mark result |
| POST | `/lab/shipments/mark-all-shipped` | — | `{ shipped, failed }` |

  - Error codes: `NOT_SHIPPABLE`/`INVALID`/`CARRIER_DISABLED`/`VOID_REFUSED` 422, `NOT_FOUND` 404, `IN_PROGRESS` 409, `STALE`/`CONFLICT` 409, `CARRIER_ERROR` 502, `PURCHASE_UNCERTAIN` 504, `LABEL_NOT_SAVED` 500.
  - `shippingReply(err) → { status, body } | null` (exported for tests).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/routes/__tests__/shipping-routes.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../shipping.routes.js");
const fn = (name) => src.slice(src.indexOf(`async function ${name}`), src.indexOf("\n}\n", src.indexOf(`async function ${name}`)) + 2);

const MARKERS = [
  'fastify.get("/lab/orders/:id/ship",', 'fastify.get("/lab/carriers",', 'fastify.post("/lab/shipments/rates",',
  'fastify.post("/lab/shipments",', 'fastify.get("/lab/shipments",', 'fastify.get("/lab/shipments/:id/label",',
  'fastify.post("/lab/shipments/:id/void",', 'fastify.post("/lab/shipments/:id/mark-shipped",', 'fastify.post("/lab/shipments/mark-all-shipped",',
];

test("every shipping route is staff-only (admin or lab), using the lab routes' one STAFF guard", () => {
  for (const m of MARKERS) assert.match(handlerSource(src, m), /STAFF/, m);
  assert.match(src, /import \{ STAFF \} from "\.\/lab\.routes\.js"/);
});

test("Buy requires an Idempotency-Key, runs inside withIdempotency scoped by order, and maps a held key to 409", () => {
  assert.match(handlerSource(src, 'fastify.post("/lab/shipments",'), /validate\(shipmentBuySchema\)/);
  const body = fn("buyHandler");
  assert.match(body, /request\.headers\["idempotency-key"\]/);
  assert.match(body, /code\(422\)/);
  assert.match(body, /withIdempotency\(\s*redis,\s*`ship-buy:\$\{scope\}:\$\{key\}`/);
  assert.match(body, /ChargeInProgressError/);
  assert.match(body, /if \(!outcome\.replayed\) audit\(request, "shipment\.purchased"/);
});

test("purchase, void, mark-shipped and label views are audited (ids only)", () => {
  for (const [marker, action] of [
    ['fastify.post("/lab/shipments/:id/void",', "shipment.voided"],
    ['fastify.post("/lab/shipments/:id/mark-shipped",', "shipment.marked_shipped"],
    ['fastify.post("/lab/shipments/mark-all-shipped",', "shipment.marked_all_shipped"],
  ]) assert.match(handlerSource(src, marker), new RegExp(action.replace(".", "\\.")), marker);
  assert.match(fn("labelHandler"), /audit\(request, "shipment\.label_viewed"/);
  assert.match(src, /targetType: "shipment"/);
});

test("the label is never cached, and its filename is the tracking number only", () => {
  assert.match(handlerSource(src, 'fastify.get("/lab/shipments/:id/label",'), /labelHandler/);
  const body = fn("labelHandler");
  assert.match(body, /"Cache-Control", "no-store"/);
  assert.match(body, /LABEL_CONTENT_TYPES\[label\.labelFormat\]/);
  assert.match(body, /filename="label-\$\{safe\}\.\$\{label\.labelFormat\}"/);
});

test("a lab conflict behind LABEL_NOT_SAVED is told in one sentence", async () => {
  const { shippingReply } = await import("../shipping.routes.js");
  const { ShippingError } = await import("../../services/shipping/shipping-errors.js");
  const { LabOrderError } = await import("../../services/lab/lab-order-rules.js");
  const err = new ShippingError("LABEL_NOT_SAVED", "The label was bought but couldn't be saved, so it was voided. Try again.", {
    cause: new LabOrderError("CONFLICT", "Order #100245 was labelled by someone else."),
  });
  const r = shippingReply(err);
  assert.equal(r.status, 500);
  assert.equal(r.body.error.message, "Order #100245 was labelled by someone else. The label was bought but couldn't be saved, so it was voided. Try again.");
  assert.equal(shippingReply(new LabOrderError("STALE", "This order changed — reload.")).status, 409);
  assert.equal(shippingReply(new Error("boom")), null);
});

test("the shipping routes are registered under /api/v1", () => {
  assert.match(read("../../index.js"), /await fastify\.register\(shippingRoutes, \{ prefix: "\/api\/v1" \}\);/);
});
```

Append to `apps/api/src/routes/__tests__/lab-routes.test.js`:

```js
test("→ shipped goes through markOrderShipped (a labelled order ships its whole box); other moves are unchanged", () => {
  const body = handlerSource(labSource, 'fastify.post("/lab/orders/:id/status",');
  assert.match(body, /request\.body\.to === "shipped"\s*\?\s*await labShipping\.markOrderShipped\(/);
  assert.match(body, /: await labOrdersService\.changeStatus\(/);
  assert.match(labSource, /labErrorReply\(err\) \?\? shippingErrorReply\(err\)/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/shipping-routes.test.js src/routes/__tests__/lab-routes.test.js`
Expected: FAIL. `shipping.routes.js` doesn't exist, and the status route doesn't delegate.

- [ ] **Step 3: Write the routes**

`apps/api/src/routes/shipping.routes.js`:

```js
import {
  ERROR_CODES, LABEL_CONTENT_TYPES, shipmentRatesSchema, shipmentBuySchema, shipmentListQuerySchema,
} from "@my-app/shared";
import { redis } from "../config/redis.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { withIdempotency, ChargeInProgressError } from "../lib/payment-helpers.js";
import * as auditService from "../services/audit.service.js";
import * as labShipping from "../services/lab/lab-shipping.service.js";
import { shipContext, listShipmentsForLab } from "../services/lab/lab-shipping-queries.js";
import { getLabel } from "../services/shipping/shipments.service.js";
import { carrierRegistry } from "../services/shipping/carrier-registry.js";
import { shippingErrorReply } from "../services/shipping/shipping-errors.js";
import { labErrorReply } from "../services/lab/lab-errors.js";
import { LabOrderError } from "../services/lab/lab-order-rules.js";
import { STAFF } from "./lab.routes.js";

/**
 * Shipping labels (own-the-lab piece 4). Lab staff and admins rate, buy,
 * print, void and mark shipped. Every purchase, void, mark-shipped and label
 * view is audited with ids only. Carrier errors reach staff in the carrier's
 * own words; credentials never leave the server.
 */

const IN_PROGRESS = "This label purchase is already in progress, or its result is uncertain. Check Admin › Shipments before retrying.";

/** A shipping or lab error → its reply; a lab conflict behind LABEL_NOT_SAVED reads as one sentence. */
export function shippingReply(err) {
  const r = shippingErrorReply(err) ?? labErrorReply(err);
  if (r && err?.code === "LABEL_NOT_SAVED" && err.cause instanceof LabOrderError) {
    r.body.error.message = `${err.cause.message} ${err.message}`;
  }
  return r;
}

function audit(request, action, targetId, metadata) {
  auditService.logSafe({ userId: request.user.id, action, targetType: "shipment", targetId, metadata, ipAddress: request.ip });
}

async function run(reply, fn, status = 200) {
  try {
    return reply.code(status).send({ data: await fn() });
  } catch (err) {
    const r = shippingReply(err);
    if (r) return reply.code(r.status).send(r.body);
    throw err;
  }
}

/**
 * Buy: one Idempotency-Key per attempt (web useAttemptKey). A retry of the
 * same attempt replays the cached result; a key held by an uncertain purchase
 * stays locked (gatewayOutcomePending) and answers 409 instead of buying again.
 */
async function buyHandler(request, reply) {
  const key = request.headers["idempotency-key"];
  if (!key) {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
  }
  const scope = [...request.body.orderIds].sort()[0];
  try {
    const outcome = await withIdempotency(
      redis,
      `ship-buy:${scope}:${key}`,
      () => labShipping.buyForOrders({ ...request.body, byUserId: request.user.id }, { log: request.log }),
      { log: request.log },
    );
    if (!outcome.replayed) audit(request, "shipment.purchased", outcome.result.shipmentId, {
      carrier: outcome.result.carrier, orderIds: outcome.result.orderIds, chargeCents: outcome.result.chargeCents,
    });
    return reply.code(201).send({ data: outcome.result });
  } catch (err) {
    if (err instanceof ChargeInProgressError) return reply.code(409).send({ error: { code: "IN_PROGRESS", status: 409, message: IN_PROGRESS } });
    const r = shippingReply(err);
    if (r) return reply.code(r.status).send(r.body);
    throw err;
  }
}

async function labelHandler(request, reply) {
  const label = await getLabel(request.params.id);
  if (!label) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "This shipment has no label." } });
  audit(request, "shipment.label_viewed", request.params.id, { carrier: label.carrier, format: label.labelFormat });
  const safe = String(label.trackingNumber ?? request.params.id).replace(/[^A-Za-z0-9]/g, "");
  const disposition = label.labelFormat === "zpl" ? "attachment" : "inline";
  return reply
    .header("Cache-Control", "no-store")
    .header("Content-Type", LABEL_CONTENT_TYPES[label.labelFormat])
    .header("Content-Disposition", `${disposition}; filename="label-${safe}.${label.labelFormat}"`)
    .send(label.bytes);
}

export default async function shippingRoutes(fastify) {
  fastify.get("/lab/orders/:id/ship", { preHandler: STAFF }, async (request, reply) => {
    const context = await shipContext(request.params.id);
    if (!context) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    return { data: context };
  });

  fastify.get("/lab/carriers", { preHandler: STAFF }, async () => ({ data: { carriers: carrierRegistry().status() } }));

  fastify.post("/lab/shipments/rates", { preHandler: [...STAFF, validate(shipmentRatesSchema)] }, (request, reply) =>
    run(reply, () => labShipping.rateShipment(request.body)));

  fastify.post("/lab/shipments", { preHandler: [...STAFF, validate(shipmentBuySchema)] }, buyHandler);

  fastify.get("/lab/shipments", { preHandler: [...STAFF, validateQuery(shipmentListQuerySchema)] }, async (request) => ({
    data: await listShipmentsForLab(request.query),
  }));

  fastify.get("/lab/shipments/:id/label", { preHandler: STAFF }, labelHandler);

  fastify.post("/lab/shipments/:id/void", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const out = await labShipping.voidShipment(request.params.id, { byUserId: request.user.id }, { log: request.log });
      audit(request, "shipment.voided", request.params.id, { orderIds: out.orderIds, invoiceLineRemoved: out.invoiceLineRemoved });
      return out;
    }));

  fastify.post("/lab/shipments/:id/mark-shipped", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const out = await labShipping.markShipmentShipped(request.params.id, { byUserId: request.user.id }, { log: request.log });
      audit(request, "shipment.marked_shipped", request.params.id, { ordersShipped: out.ordersShipped, alreadyShipped: out.alreadyShipped });
      return out;
    }));

  fastify.post("/lab/shipments/mark-all-shipped", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const out = await labShipping.markAllLabelledShipped({ byUserId: request.user.id }, { log: request.log });
      audit(request, "shipment.marked_all_shipped", null, out);
      return out;
    }));
}
```

In `apps/api/src/index.js`, import and register after `labRoutes`:

```js
import shippingRoutes from "./routes/shipping.routes.js";
```

```js
await fastify.register(shippingRoutes, { prefix: "/api/v1" });
```

In `apps/api/src/routes/lab.routes.js`:
- add the imports:

```js
import * as labShipping from "../services/lab/lab-shipping.service.js";
import { shippingErrorReply } from "../services/shipping/shipping-errors.js";
```

- in `run`, change `const r = labErrorReply(err);` to `const r = labErrorReply(err) ?? shippingErrorReply(err);`;
- replace the status handler's body:

```js
  fastify.post("/lab/orders/:id/status", { preHandler: [...STAFF, validate(labStatusChangeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const args = { ...request.body, byUserId: request.user.id };
      // A labelled order ships with its whole box (and its shipped email): lab-shipping.service markOrderShipped.
      const { order } = request.body.to === "shipped"
        ? await labShipping.markOrderShipped(request.params.id, args)
        : await labOrdersService.changeStatus(request.params.id, args);
      audit(request, "lab_order.status_changed", order.id, { to: order.status, version: order.version });
      return { id: order.id, status: order.status, version: order.version };
    }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test` (repo root)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes apps/api/src/index.js
git commit -m "feat(api): shipping routes — rate, buy (idempotent), label, void, mark shipped; status route ships the box

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Tracking sync job and per-shipment refresh

**Files:**
- Create: `apps/api/src/services/shipping/tracking-sync.service.js`, `apps/api/src/services/shipping/tracking-sync.service.test.js`, `apps/api/src/jobs/definitions/shipping-tracking-sync.job.js`
- Modify: `apps/api/src/jobs/definitions/index.js`, `apps/api/src/services/lab/lab-shipping.service.js` (`syncLabTracking`), `apps/api/src/routes/shipping.routes.js` (refresh route), `apps/api/src/routes/__tests__/shipping-routes.test.js`

**Interfaces:**
- Consumes: `planTrackingUpdate`, `applyTrackingPlan` (Task 7); `markShipmentShipped` (Task 11); `defineJob` (`jobs/registry.js`).
- Produces:
  - `syncTracking({ shipmentIds?, dryRun?, now?, registry?, database?, onMoved?, log? }) → { checked, updated, moved, delivered, errors, unknownCodes, dryRun }` (generic).
  - `TRACKING_WINDOW_DAYS` (30) and `SYNC_LIMIT` (500).
  - `syncLabTracking(opts)`, which wires `onMoved` to `markShipmentShipped`.
  - The job `shipping-tracking-sync`.
  - `POST /lab/shipments/:id/refresh-tracking` (STAFF, audited `shipment.tracking_refreshed`).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/services/shipping/tracking-sync.service.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { syncTracking, TRACKING_WINDOW_DAYS } = await import("./tracking-sync.service.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { fakeAdapter, fakeRegistry } = await import("../../test/carrier-config.js");
const source = readFileSync(new URL("./tracking-sync.service.js", import.meta.url), "utf8");

const now = new Date("2026-10-21T15:00:00Z");
const row = (over) => ({ id: "sh1", carrier: "ups", trackingNumber: "1Z1", status: "label_created", shippedAt: null, ...over });
const result = (over) => ({ trackingNumber: "1Z1", status: "in_transit", carrierCode: "P", description: "Pickup Scan", location: "SAN ANTONIO, TX", occurredAt: now, deliveredAt: null, events: [], ...over });
const logger = () => { const lines = []; return { lines, error: (m) => lines.push(m), warn: (m) => lines.push(m) }; };

test("a dry run only counts", async () => {
  const ups = fakeAdapter("ups");
  const database = fakeTx({ selects: [[row(), row({ id: "sh2", trackingNumber: "1Z2" })]] });
  const out = await syncTracking({ dryRun: true, now, database, registry: fakeRegistry([ups]) });
  assert.deepEqual(out, { checked: 2, updated: 0, moved: 0, delivered: 0, errors: 0, unknownCodes: 0, dryRun: true });
  assert.equal(ups.calls.length, 0);
});

test("first movement: one event, the new status, and the box's orders are shipped (onMoved)", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result()] });
  const database = fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] });
  const moved = [];
  const out = await syncTracking({ now, database, registry: fakeRegistry([ups]), onMoved: async (id) => moved.push(id) });
  assert.deepEqual(moved, ["sh1"]);
  assert.equal(out.updated, 1);
  assert.equal(out.moved, 1);
  assert.equal(database.log.find((l) => l.op === "set").values.status, "in_transit");
  assert.equal(database.log.filter((l) => l.op === "insert").at(-1).values.description, "Pickup Scan");
});

test("delivered is counted and stamped; an already-shipped box isn't shipped again", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result({ status: "delivered", deliveredAt: now })] });
  const database = fakeTx({ selects: [[row({ status: "in_transit", shippedAt: now })]], updates: [[{ id: "sh1" }]] });
  const moved = [];
  const out = await syncTracking({ now, database, registry: fakeRegistry([ups]), onMoved: async (id) => moved.push(id) });
  assert.equal(out.delivered, 1);
  assert.deepEqual(moved, []);
  assert.equal(database.log.find((l) => l.op === "set").values.deliveredAt, now);
});

test("one carrier failing doesn't stop the other; each failed number keeps its error for the next run", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result({ status: null, error: { carrier: "ups", code: "151044", message: "No tracking information available" } })] });
  const fedex = fakeAdapter("fedex", { track: async () => [result({ trackingNumber: "7946" })] });
  const database = fakeTx({ selects: [[row(), row({ id: "sh2", carrier: "fedex", trackingNumber: "7946" })]], updates: [[{ id: "sh1" }], [{ id: "sh2" }]] });
  const out = await syncTracking({ now, database, registry: fakeRegistry([ups, fedex]), onMoved: async () => {} });
  assert.equal(out.errors, 1);
  assert.equal(out.updated, 1);
  const sets = database.log.filter((l) => l.op === "set").map((l) => l.values);
  assert.equal(sets[0].trackingError, "No tracking information available");
  assert.equal(sets[1].status, "in_transit");
});

test("an unknown carrier code is counted and logged by code, with no address", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result({ status: null, carrierCode: "ZZ" })] });
  const log = logger();
  const out = await syncTracking({ now, database: fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] }), registry: fakeRegistry([ups]), log });
  assert.equal(out.unknownCodes, 1);
  assert.deepEqual(log.lines, ["[SHIP][UNKNOWN_STATUS] carrier=ups code=ZZ shipment=sh1"]);
});

test("a failed onMoved is logged and retried next run (the shipment is still moving and unshipped)", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result()] });
  const log = logger();
  const out = await syncTracking({
    now, database: fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] }), registry: fakeRegistry([ups]), log,
    onMoved: async () => { throw new Error("stale"); },
  });
  assert.equal(out.moved, 0);
  assert.equal(out.errors, 1);
  assert.match(log.lines[0], /^\[SHIP\]\[MARK_SHIPPED_FAILED\] shipment=sh1/);
});

test("no tracking carrier enabled: nothing is read", async () => {
  const database = fakeTx();
  const out = await syncTracking({ now, database, registry: fakeRegistry([fakeAdapter("manual")]) });
  assert.equal(out.checked, 0);
  assert.equal(database.log.length, 0);
});

test("the sweep: open, trackable shipments bought in the last 30 days; a refresh by id ignores the window", () => {
  assert.equal(TRACKING_WINDOW_DAYS, 30);
  assert.match(source, /notInArray\(shipments\.status, TERMINAL_SHIPMENT_STATUSES\)/);
  assert.match(source, /if \(shipmentIds\) conds\.push\(inArray\(shipments\.id, shipmentIds\)\);\s*else conds\.push\(gte\(shipments\.purchasedAt/);
});

test("the job is registered under the name Cloud Scheduler calls", async () => {
  await import("../../jobs/definitions/index.js");
  const { listJobs } = await import("../../jobs/registry.js");
  assert.ok(listJobs().some((j) => j.name === "shipping-tracking-sync"));
});
```

Append to `apps/api/src/routes/__tests__/shipping-routes.test.js`:

```js
test("Refresh tracking is staff-only, runs the lab sync for one shipment, and is audited", () => {
  const body = handlerSource(src, 'fastify.post("/lab/shipments/:id/refresh-tracking",');
  assert.match(body, /STAFF/);
  assert.match(body, /syncLabTracking\(\{ shipmentIds: \[request\.params\.id\]/);
  assert.match(body, /shipment\.tracking_refreshed/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/shipping/tracking-sync.service.test.js src/routes/__tests__/shipping-routes.test.js`
Expected: FAIL. The module, the job and the route don't exist.

- [ ] **Step 3: Implement**

`apps/api/src/services/shipping/tracking-sync.service.js`:

```js
import { and, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { TERMINAL_SHIPMENT_STATUSES } from "@my-app/shared";
import { db } from "../../config/database.js";
import { shipments } from "../../db/schema/index.js";
import { carrierRegistry } from "./carrier-registry.js";
import { planTrackingUpdate } from "./shipment-rules.js";
import { applyTrackingPlan } from "./shipments.service.js";

export const TRACKING_WINDOW_DAYS = 30;
export const SYNC_LIMIT = 500;

function candidatesWhere({ shipmentIds, trackers, now }) {
  const conds = [notInArray(shipments.status, TERMINAL_SHIPMENT_STATUSES), isNotNull(shipments.trackingNumber), inArray(shipments.carrier, trackers)];
  if (shipmentIds) conds.push(inArray(shipments.id, shipmentIds));
  else conds.push(gte(shipments.purchasedAt, new Date(now.getTime() - TRACKING_WINDOW_DAYS * 86_400_000)));
  return and(...conds);
}

function tally(summary, plan, result, shipment, log) {
  if (plan.event) summary.updated += 1;
  if (plan.patch?.status === "delivered") summary.delivered += 1;
  if (!result || result.error) summary.errors += 1;
  if (plan.unknownCode) {
    summary.unknownCodes += 1;
    log?.warn?.(`[SHIP][UNKNOWN_STATUS] carrier=${shipment.carrier} code=${plan.unknownCode} shipment=${shipment.id}`);
  }
}

/**
 * Poll the carriers for every open shipment (not delivered, returned or
 * voided; with a tracking number; on a carrier that tracks; bought in the last
 * 30 days, or exactly `shipmentIds` for a manual refresh). Calls are batched
 * per carrier (the adapters chunk: FedEx 30 per request, UPS one).
 *
 * Each answer goes through planTrackingUpdate and is written in its own small
 * transaction, conditional on the status read. A shipment that is moving and
 * was never marked shipped is handed to `onMoved` (the lab glue ships its
 * box); a failure there is logged and the next run retries it. Idempotent; a
 * dry run only counts. Generic: lab behaviour arrives only through `onMoved`.
 */
export async function syncTracking({
  shipmentIds = null, dryRun = false, now = new Date(), registry = carrierRegistry(), database = db, onMoved = async () => {}, log,
} = {}) {
  const summary = { checked: 0, updated: 0, moved: 0, delivered: 0, errors: 0, unknownCodes: 0, dryRun };
  const trackers = registry.enabled().filter((a) => a.tracks).map((a) => a.id);
  if (trackers.length === 0) return summary;
  const rows = await database
    .select({ id: shipments.id, carrier: shipments.carrier, trackingNumber: shipments.trackingNumber, status: shipments.status, shippedAt: shipments.shippedAt })
    .from(shipments)
    .where(candidatesWhere({ shipmentIds, trackers, now }))
    .orderBy(sql`${shipments.lastTrackedAt} asc nulls first`)
    .limit(SYNC_LIMIT);
  summary.checked = rows.length;
  if (dryRun) return summary;

  const movedIds = [];
  for (const carrier of trackers) {
    const batch = rows.filter((r) => r.carrier === carrier);
    if (batch.length === 0) continue;
    let results = [];
    try {
      results = await registry.get(carrier).track(batch.map((r) => r.trackingNumber));
    } catch (err) {
      log?.error?.(`[SHIP][TRACK_FAILED] carrier=${carrier}: ${String(err?.message || err).slice(0, 200)}`);
    }
    const byNumber = new Map(results.map((r) => [r.trackingNumber, r]));
    for (const shipment of batch) {
      const result = byNumber.get(shipment.trackingNumber);
      const plan = planTrackingUpdate(shipment, result, now);
      tally(summary, plan, result, shipment, log);
      if (plan.patch) await database.transaction((tx) => applyTrackingPlan(tx, shipment, plan));
      if (plan.moved) movedIds.push(shipment.id);
    }
  }

  for (const id of movedIds) {
    try {
      await onMoved(id);
      summary.moved += 1;
    } catch (err) {
      summary.errors += 1;
      log?.error?.(`[SHIP][MARK_SHIPPED_FAILED] shipment=${id}: ${String(err?.message || err).slice(0, 200)}`);
    }
  }
  return summary;
}
```

Append to `apps/api/src/services/lab/lab-shipping.service.js` (and import `syncTracking` from `../shipping/tracking-sync.service.js`):

```js
/** The tracking sync with the lab's one rule: a shipment's first carrier movement ships its box. */
export function syncLabTracking(opts = {}) {
  return syncTracking({ ...opts, onMoved: (shipmentId) => markShipmentShipped(shipmentId, { byUserId: null }) });
}
```

`apps/api/src/jobs/definitions/shipping-tracking-sync.job.js`:

```js
import { defineJob } from "../registry.js";
import { syncLabTracking } from "../../services/lab/lab-shipping.service.js";

defineJob({
  name: "shipping-tracking-sync",
  description: "Poll UPS and FedEx tracking for open shipments; a box's first movement marks its orders shipped",
  // Moves no money. A dry run only counts; a live run writes tracking events
  // and ships boxes the carrier has picked up (idempotent).
  handler: async ({ dryRun, log }) => syncLabTracking({ dryRun, log }),
});
```

In `apps/api/src/jobs/definitions/index.js`, add `import "./shipping-tracking-sync.job.js";` after the existing two imports.

In `apps/api/src/routes/shipping.routes.js`, add inside `shippingRoutes` (after mark-all-shipped):

```js
  fastify.post("/lab/shipments/:id/refresh-tracking", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const summary = await labShipping.syncLabTracking({ shipmentIds: [request.params.id], log: request.log });
      audit(request, "shipment.tracking_refreshed", request.params.id, { checked: summary.checked, updated: summary.updated });
      return summary;
    }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test` (repo root)
Expected: PASS, including `jobs/runner.test.js` and `jobs/autopay-switched-off.test.js`, which are unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/shipping apps/api/src/services/lab/lab-shipping.service.js apps/api/src/jobs apps/api/src/routes
git commit -m "feat(shipping): tracking sync job (first movement ships the box) and per-shipment refresh

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 14: Web: Ship form, Shipping panel, board label badge, timeline

**Files:**
- Create:
  - `apps/web/src/lib/shipping.js` (+ `apps/web/src/lib/__tests__/shipping.test.js`);
  - in `apps/web/src/components/lab/`: `ShippingPanel.jsx`, `ShipModal.jsx`, `ShipToFields.jsx`, `ParcelFields.jsx`, `RateChooser.jsx`.
- Modify:
  - `apps/web/src/lib/lab-board.js` (+ `lib/__tests__/lab-board.test.js`);
  - `apps/web/src/config/routes.js` (+ `config/routes.test.js`);
  - `apps/web/src/pages/lab/LabOrderDetailPage.jsx`, `apps/web/src/pages/lab/LabBoardPage.jsx`.

**Interfaces:**
- Consumes:
  - the API from Task 12: `GET /lab/orders/:id/ship`, `POST /lab/shipments/rates`, `POST /lab/shipments` (+ `Idempotency-Key`), `POST /lab/shipments/:id/void`, `POST /lab/shipments/:id/mark-shipped`;
  - `detail.shipment` (Task 9) and `card.labelled` (Task 9);
  - `useAttemptKey` (`hooks/useAttemptKey.js`), `ConfirmButton`, `Modal`, `useToast`.
- Produces:
  - Form helpers (`lib/shipping.js`): `initialShipForm(context)`, `applyPreset(parcel, key)`, `weightOzFrom(lb, oz)`, `splitWeight(oz)`, `ratesBody(form)`, `buyBody(form)`, `buySignature(body)`, `quoteKey(form)`, `quoteId(q)`, `isUncertainPurchase(err)`.
  - Display helpers (`lib/shipping.js`): `labelBadge(card)`, `shipmentLine(s)`, `shipmentStatusLabel(s)`, `labelNeedsRotation({ width, height })`, `shipmentListParams(filters)`, `filenameFrom(disposition, fallback)`.
  - Routes: `ROUTES.ADMIN_SHIPMENTS` (`/admin/shipments`), `ROUTES.LAB_SHIPMENT_PRINT` (`/lab/shipments/:id/print`) and `shipmentPrintPath(id)`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/__tests__/shipping.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  initialShipForm, applyPreset, weightOzFrom, splitWeight, ratesBody, buyBody, buySignature, quoteKey,
  isUncertainPurchase, labelBadge, shipmentLine, labelNeedsRotation, shipmentListParams, filenameFrom,
} from "../shipping.js";
import { createAttemptKey } from "../idempotency.js";

const context = {
  order: { id: "lo1", orderNumber: 100245 },
  shipTo: { name: "Dr. Ada", company: "Smile Dental", phone: null, address1: "1 St", address2: null, city: "Austin", state: "TX", postalCode: "78701", country: "US" },
};

test("the form starts from the server's ship-to (nulls become empty inputs), this order ticked, a small box", () => {
  const f = initialShipForm(context);
  assert.deepEqual(f.orderIds, ["lo1"]);
  assert.equal(f.shipTo.phone, "");
  assert.equal(f.shipTo.company, "Smile Dental");
  assert.deepEqual(f.parcel, { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 });
  assert.equal(f.choice, null);
  assert.equal(initialShipForm({ order: { id: "x" }, shipTo: null }).shipTo.address1, "", "a doctor with no address gets an empty form, not a crash");
});

test("a preset fills dimensions and keeps the weight staff typed; custom keeps everything", () => {
  const p = applyPreset({ preset: "small_box", weightOz: 40, lengthIn: 8, widthIn: 6, heightIn: 4 }, "medium_box");
  assert.deepEqual(p, { preset: "medium_box", weightOz: 40, lengthIn: 12, widthIn: 10, heightIn: 6 });
  assert.deepEqual(applyPreset(p, "custom"), { ...p, preset: "custom" });
});

test("pounds and ounces become whole ounces and back", () => {
  assert.equal(weightOzFrom("2", "8"), 40);
  assert.equal(weightOzFrom("", "0"), 0);
  assert.deepEqual(splitWeight(40), { lb: 2, oz: 8 });
});

test("bodies: blanks become null, the state is uppercased, numbers are numbers", () => {
  const f = { ...initialShipForm(context), shipTo: { ...initialShipForm(context).shipTo, state: "tx", address2: "  " } };
  const r = ratesBody(f);
  assert.equal(r.shipTo.state, "TX");
  assert.equal(r.shipTo.address2, null);
  assert.equal(r.shipTo.phone, null);
  assert.equal(typeof r.parcel.weightOz, "number");
  assert.deepEqual(buyBody({ ...f, choice: { carrier: "ups", serviceCode: "03" } }).serviceCode, "03");
  const manual = buyBody({ ...f, choice: { carrier: "manual" }, manual: { carrierName: " Courier ", trackingNumber: " " } });
  assert.deepEqual([manual.carrier, manual.manual.carrierName, manual.manual.trackingNumber, "serviceCode" in manual], ["manual", "Courier", null, false]);
});

test("the same box, address and service reuse ONE Idempotency-Key; changing any of them is a new attempt", () => {
  const keys = createAttemptKey(((n) => () => `k${++n}`)(0));
  const f = { ...initialShipForm(context), choice: { carrier: "ups", serviceCode: "03" } };
  const first = keys.keyFor(buySignature(buyBody(f)));
  assert.equal(keys.keyFor(buySignature(buyBody(f))), first, "a double click or a retry is the same attempt");
  assert.notEqual(keys.keyFor(buySignature(buyBody({ ...f, choice: { carrier: "ups", serviceCode: "02" } }))), first);
});

test("quotes go stale when anything that was rated changes", () => {
  const f = initialShipForm(context);
  assert.equal(quoteKey(f), quoteKey({ ...f, choice: { carrier: "ups", serviceCode: "03" } }), "choosing a service doesn't re-rate");
  assert.notEqual(quoteKey(f), quoteKey({ ...f, parcel: { ...f.parcel, weightOz: 17 } }));
});

test("an uncertain or still-held purchase is recognised, so the form says 'check first' instead of retrying", () => {
  const err = (code) => ({ response: { data: { error: { code } } } });
  assert.equal(isUncertainPurchase(err("PURCHASE_UNCERTAIN")), true);
  assert.equal(isUncertainPurchase(err("IN_PROGRESS")), true);
  assert.equal(isUncertainPurchase(err("CARRIER_ERROR")), false);
});

test("display helpers", () => {
  assert.equal(labelBadge({ labelled: true, status: "ready_to_ship" }), "Label printed");
  assert.equal(labelBadge({ labelled: true, status: "shipped" }), null);
  assert.equal(shipmentLine({ carrier: "ups", serviceName: "UPS Ground", trackingNumber: "1Z9" }), "UPS Ground · 1Z9");
  assert.equal(shipmentLine({ carrier: "manual", serviceName: "Courier", trackingNumber: null }), "Courier · no tracking number");
  assert.equal(labelNeedsRotation({ width: 1200, height: 800 }), true);
  assert.equal(labelNeedsRotation({ width: 800, height: 1200 }), false);
  assert.deepEqual(shipmentListParams({ status: "in_transit", carrier: " ", from: "2026-10-01", to: "" }), { status: "in_transit", from: "2026-10-01" });
  assert.equal(filenameFrom('attachment; filename="label-1Z9.zpl"'), "label-1Z9.zpl");
  assert.equal(filenameFrom(null, "label.zpl"), "label.zpl");
});
```

Append to `apps/web/src/lib/__tests__/lab-board.test.js`:

```js
test("a labelled card offers only → Shipped (anything else would strand its label)", () => {
  assert.deepEqual(quickMoves({ status: "ready_to_ship", labelled: true }).map((m) => m.to), ["shipped"]);
  assert.deepEqual(quickMoves({ status: "ready_to_ship" }).map((m) => m.to), ["shipped", "quality_check"]);
});

test("shipment events read as sentences", () => {
  assert.equal(describeEvent({ type: "shipment", to: "sh1", byName: "Maria", note: "Label: UPS Ground 1Z9" }), "Maria: Label: UPS Ground 1Z9");
  assert.equal(describeEvent({ type: "shipment", from: "sh1", to: null, byName: "Maria", note: null }), "Maria: shipping label voided");
});
```

Append to `apps/web/src/config/routes.test.js` (add `shipmentPrintPath` to its import):

```js
test("the label print page and Admin › Shipments have one path each", () => {
  assert.equal(shipmentPrintPath("sh1"), "/lab/shipments/sh1/print");
  assert.equal(ROUTES.ADMIN_SHIPMENTS, "/admin/shipments");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm vitest run src/lib src/config`
Expected: FAIL. `lib/shipping.js` doesn't exist, `quickMoves` ignores `labelled`, and the routes are missing.

- [ ] **Step 3: Write the helpers and route entries**

`apps/web/src/lib/shipping.js`:

```js
import { parcelPreset, carrierName, SHIPMENT_STATUS_LABELS } from "@my-app/shared";

/**
 * Pure helpers for the Ship form, the Shipping panel, the label print page and
 * Admin › Shipments. The API owns every rule; these only shape requests and text.
 */
export const EMPTY_ADDRESS = { name: "", company: "", phone: "", address1: "", address2: "", city: "", state: "", postalCode: "" };
const DEFAULT_PRESET = "small_box";

/** The Ship form from GET /lab/orders/:id/ship. Server nulls become "" so every input stays controlled. */
export function initialShipForm(context) {
  const p = parcelPreset(DEFAULT_PRESET);
  const shipTo = Object.fromEntries(Object.keys(EMPTY_ADDRESS).map((k) => [k, context?.shipTo?.[k] ?? ""]));
  return {
    orderIds: context?.order ? [context.order.id] : [],
    shipTo,
    parcel: { preset: p.key, weightOz: p.weightOz, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn },
    choice: null,
    manual: { carrierName: "", trackingNumber: "" },
  };
}

/** A preset fills its dimensions and keeps the weight staff typed; "custom" keeps everything. */
export function applyPreset(parcel, key) {
  const p = parcelPreset(key);
  if (!p || key === "custom") return { ...parcel, preset: "custom" };
  return { ...parcel, preset: key, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, weightOz: parcel.weightOz || p.weightOz };
}

/** Pounds + ounces typed → whole ounces (what the API takes); 0 when nothing usable was typed. */
export function weightOzFrom(lb, oz) {
  const total = Math.round((Number(lb) || 0) * 16 + (Number(oz) || 0));
  return total > 0 ? total : 0;
}
export const splitWeight = (weightOz) => ({ lb: Math.floor((weightOz || 0) / 16), oz: (weightOz || 0) % 16 });

const text = (v) => String(v ?? "").trim();
const blankToNull = (v) => text(v) || null;

function cleanAddress(a) {
  return {
    name: text(a.name), company: blankToNull(a.company), phone: blankToNull(a.phone),
    address1: text(a.address1), address2: blankToNull(a.address2), city: text(a.city),
    state: text(a.state).toUpperCase(), postalCode: text(a.postalCode), country: "US",
  };
}
const cleanParcel = (p) => ({
  preset: p.preset, weightOz: Number(p.weightOz), lengthIn: Number(p.lengthIn), widthIn: Number(p.widthIn), heightIn: Number(p.heightIn),
});

/** Form → POST /lab/shipments/rates. */
export const ratesBody = (form) => ({ shipTo: cleanAddress(form.shipTo), parcel: cleanParcel(form.parcel) });

/** Form → POST /lab/shipments. */
export function buyBody(form) {
  const base = { orderIds: [...form.orderIds], shipTo: cleanAddress(form.shipTo), parcel: cleanParcel(form.parcel) };
  if (form.choice?.carrier === "manual") {
    return { ...base, carrier: "manual", manual: { carrierName: text(form.manual.carrierName), trackingNumber: blankToNull(form.manual.trackingNumber) } };
  }
  return { ...base, carrier: form.choice?.carrier, serviceCode: form.choice?.serviceCode };
}

/** One attempt = one Idempotency-Key (lib/idempotency.js): the same box, address and service. */
export const buySignature = (body) => JSON.stringify(body);

/** What was rated. A change makes the quotes on screen stale; picking a service doesn't. */
export const quoteKey = (form) => JSON.stringify(ratesBody(form));
export const quoteId = (q) => `${q.carrier}:${q.serviceCode}`;

/** The server couldn't confirm the purchase, or the attempt's key is still held: don't retry blindly. */
export function isUncertainPurchase(err) {
  const code = err?.response?.data?.error?.code;
  return code === "PURCHASE_UNCERTAIN" || code === "IN_PROGRESS";
}

/** "Label printed" on a board card while the box hasn't left. */
export const labelBadge = (card) => (card?.labelled && card.status === "ready_to_ship" ? "Label printed" : null);

/** "UPS Ground · 1Z…" */
export const shipmentLine = (s) => `${s.serviceName || carrierName(s)} · ${s.trackingNumber || "no tracking number"}`;
export const shipmentStatusLabel = (status) => SHIPMENT_STATUS_LABELS[status] ?? status ?? "—";

/** UPS GIF labels arrive landscape; the print page turns them onto the 4×6 portrait page. */
export const labelNeedsRotation = ({ width, height }) => Number(width) > Number(height);

/** Admin › Shipments filters → GET /lab/shipments params, blanks dropped. */
export function shipmentListParams(filters = {}) {
  const out = {};
  for (const k of ["status", "carrier", "from", "to"]) {
    const v = text(filters[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** The filename the API sent in Content-Disposition. */
export function filenameFrom(disposition, fallback = "label") {
  const m = /filename="([^"]+)"/.exec(disposition ?? "");
  return m ? m[1] : fallback;
}
```

In `apps/web/src/config/routes.js`:
- add `ADMIN_SHIPMENTS: "/admin/shipments",` to the Admin block;
- add `LAB_SHIPMENT_PRINT: "/lab/shipments/:id/print",` to the Lab block;
- below `adminInvoicePath`, add:

```js
export const shipmentPrintPath = (id) => `/lab/shipments/${id}/print`;
```

In `apps/web/src/lib/lab-board.js`:
- in `quickMoves`, pass the flag through:

```js
  return allowedNextStatuses(card.status, { heldFrom: card.heldFrom ?? null, labelled: Boolean(card.labelled) })
```

- in `describeEvent`, add before `default`:

```js
    case "shipment": return `${who}: ${e.note ?? (e.to ? "shipping label bought" : "shipping label voided")}`;
```

- [ ] **Step 4: Write the components**

`apps/web/src/components/lab/ShipToFields.jsx`:

```jsx
import { Info } from "lucide-react";

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

const FIELDS = [
  ["name", "Name (person)", "sm:col-span-1", 35],
  ["company", "Practice / company", "sm:col-span-1", 35],
  ["address1", "Street address", "sm:col-span-2", 35],
  ["address2", "Suite, unit (optional)", "sm:col-span-2", 35],
  ["city", "City", "sm:col-span-1", 30],
  ["phone", "Phone", "sm:col-span-1", 20],
];

/** Ship-to for THIS shipment only (the doctor's profile is not changed). Shows the profile's delivery hint. */
export function ShipToFields({ value, onChange, hint, disabled }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/50">Ship to</legend>
      {hint && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <Info size={12} className="mt-0.5" /> {[hint.method, hint.notes].filter(Boolean).join(" — ")}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map(([k, label, span, max]) => (
          <label key={k} className={`block ${span}`}>
            <span className="text-xs text-navy/50">{label}</span>
            <input className={INPUT} value={value[k]} maxLength={max} onChange={set(k)} disabled={disabled} />
          </label>
        ))}
        <label className="block">
          <span className="text-xs text-navy/50">State</span>
          <input className={INPUT} value={value.state} maxLength={2} onChange={set("state")} disabled={disabled} />
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">ZIP</span>
          <input className={INPUT} value={value.postalCode} maxLength={10} onChange={set("postalCode")} disabled={disabled} />
        </label>
      </div>
    </fieldset>
  );
}
```

`apps/web/src/components/lab/ParcelFields.jsx`:

```jsx
import { PARCEL_PRESETS } from "@my-app/shared";
import { applyPreset, splitWeight, weightOzFrom } from "../../lib/shipping.js";

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

/** The box: a preset (shared list) plus its weight; dimensions are editable. */
export function ParcelFields({ value, onChange, disabled }) {
  const { lb, oz } = splitWeight(value.weightOz);
  const dim = (k) => (e) => onChange({ ...value, preset: "custom", [k]: e.target.value === "" ? "" : Number(e.target.value) });
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/50">Box</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="text-xs text-navy/50">Preset</span>
          <select className={INPUT} value={value.preset} onChange={(e) => onChange(applyPreset(value, e.target.value))} disabled={disabled}>
            {PARCEL_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">Weight (lb)</span>
          <input type="number" min="0" className={INPUT} value={lb} onChange={(e) => onChange({ ...value, weightOz: weightOzFrom(e.target.value, oz) })} disabled={disabled} />
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">+ oz</span>
          <input type="number" min="0" max="15" className={INPUT} value={oz} onChange={(e) => onChange({ ...value, weightOz: weightOzFrom(lb, e.target.value) })} disabled={disabled} />
        </label>
        {["lengthIn", "widthIn", "heightIn"].map((k) => (
          <label key={k} className="block">
            <span className="text-xs text-navy/50">{{ lengthIn: "Length", widthIn: "Width", heightIn: "Height" }[k]} (in)</span>
            <input type="number" min="0" step="0.5" className={INPUT} value={value[k] ?? ""} onChange={dim(k)} disabled={disabled} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

`apps/web/src/components/lab/RateChooser.jsx`:

```jsx
import { Loader2, AlertCircle } from "lucide-react";
import { formatCents } from "@my-app/shared";
import { quoteId } from "../../lib/shipping.js";

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

/**
 * Get rates from every enabled carrier, then pick a service, or Manual (a
 * courier, a hand delivery): staff type the carrier and, if there is one, the
 * tracking number. A carrier that failed or is disabled says why and never
 * hides the others.
 */
export function RateChooser({ rates, stale, choice, manual, busy, carriers = [], onGetRates, onChoose, onManual }) {
  const picked = choice ? (choice.carrier === "manual" ? "manual" : quoteId(choice)) : null;
  const off = carriers.filter((c) => !c.ok);
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/50">Service</legend>
      <button type="button" onClick={onGetRates} disabled={busy} className="mb-2 flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-1.5 text-xs font-semibold text-navy hover:bg-surface-200 disabled:opacity-40">
        {busy && <Loader2 size={12} className="animate-spin" />} {rates ? "Refresh rates" : "Get rates"}
      </button>
      {stale && <p className="mb-2 text-xs text-amber-700">The box or address changed — get rates again before buying.</p>}
      {off.map((c) => <p key={c.id} className="text-xs text-navy/40">{c.reason}</p>)}
      {rates?.errors.map((e) => (
        <p key={e.carrier} className="flex items-center gap-1 text-xs text-red-700"><AlertCircle size={11} /> {e.carrier.toUpperCase()}: {e.message}</p>
      ))}
      <div className="mt-2 space-y-1">
        {rates?.quotes.map((q) => (
          <label key={quoteId(q)} className="flex items-center justify-between gap-3 rounded-lg border border-surface-300/50 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <input type="radio" name="service" checked={picked === quoteId(q)} onChange={() => onChoose(q)} disabled={busy || stale} />
              {q.serviceName}{q.estimatedDelivery ? <span className="text-xs text-navy/40"> · {q.estimatedDelivery}</span> : null}
            </span>
            <span className="font-mono text-xs">{formatCents(q.amountCents)}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 rounded-lg border border-dashed border-surface-300 px-3 py-2 text-sm">
          <input type="radio" name="service" checked={picked === "manual"} onChange={() => onChoose({ carrier: "manual" })} disabled={busy} />
          Manual — a courier, hand delivery or another carrier
        </label>
        {picked === "manual" && (
          <div className="grid gap-2 pl-6 sm:grid-cols-2">
            <input className={INPUT} placeholder="Carrier name" maxLength={40} value={manual.carrierName} onChange={(e) => onManual({ ...manual, carrierName: e.target.value })} disabled={busy} />
            <input className={INPUT} placeholder="Tracking number (optional)" maxLength={40} value={manual.trackingNumber} onChange={(e) => onManual({ ...manual, trackingNumber: e.target.value })} disabled={busy} />
          </div>
        )}
      </div>
    </fieldset>
  );
}
```

`apps/web/src/components/lab/ShipModal.jsx`:

```jsx
import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import api from "../../config/api.js";
import { Modal } from "../ui/Modal.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useAttemptKey } from "../../hooks/useAttemptKey.js";
import { errorText } from "../../lib/requests.js";
import { initialShipForm, ratesBody, buyBody, buySignature, quoteKey, isUncertainPurchase } from "../../lib/shipping.js";
import { ShipToFields } from "./ShipToFields.jsx";
import { ParcelFields } from "./ParcelFields.jsx";
import { RateChooser } from "./RateChooser.jsx";

/**
 * The Ship form: other ready orders for the same client (ship together), the
 * ship-to for this shipment, the box, the service; then Buy. Buy sends ONE
 * Idempotency-Key per attempt (useAttemptKey), so a double click or a retry of
 * the same box can't buy two labels. An uncertain purchase keeps its key and
 * tells staff to check Admin › Shipments first.
 */
export function ShipModal({ open, orderId, onClose, onBought }) {
  const { addToast } = useToast();
  const attempt = useAttemptKey();
  const [context, setContext] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [rates, setRates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setContext(null);
    setForm(null);
    setRates(null);
    setUncertain(null);
    setLoadError(null);
    api.get(`/lab/orders/${orderId}/ship`)
      .then((res) => { if (live) { setContext(res.data.data); setForm(initialShipForm(res.data.data)); } })
      .catch((err) => { if (live) setLoadError(errorText(err)); });
    return () => { live = false; };
  }, [open, orderId]);

  const rated = useMemo(() => (form ? quoteKey(form) : null), [form]);
  const stale = Boolean(rates) && rates.key !== rated;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (id) => set({ orderIds: form.orderIds.includes(id) ? form.orderIds.filter((x) => x !== id) : [...form.orderIds, id] });

  const getRates = async () => {
    setBusy(true);
    try {
      const res = await api.post("/lab/shipments/rates", ratesBody(form));
      setRates({ key: quoteKey(form), ...res.data.data });
      if (form.choice?.carrier !== "manual") set({ choice: null });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const buy = async () => {
    const body = buyBody(form);
    const key = attempt.keyFor(buySignature(body));
    setBusy(true);
    try {
      const res = await api.post("/lab/shipments", body, { headers: { "Idempotency-Key": key } });
      attempt.reset();
      addToast({ message: `Shipment recorded${res.data.data.trackingNumber ? `: ${res.data.data.trackingNumber}` : ""}`, type: "success" });
      onBought(res.data.data);
    } catch (err) {
      // Keep the key: retrying this attempt replays or waits, it never buys a second label.
      if (isUncertainPurchase(err)) setUncertain(errorText(err));
      else addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const manual = form?.choice?.carrier === "manual";
  const ready = Boolean(form?.orderIds.length) && Boolean(form?.choice) && (manual ? Boolean(form.manual.carrierName.trim()) : !stale);

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={context ? `Ship order #${context.order.orderNumber}` : "Ship"} className="max-w-2xl">
      {loadError && <p className="text-sm text-red-700">{loadError}</p>}
      {!form && !loadError && (
        <div className="flex items-center gap-2 py-8 text-sm text-navy/50"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      )}
      {form && (
        <div className="space-y-5">
          {context.siblings.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-navy/50">Ship together (same client, ready to ship)</legend>
              {context.siblings.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.orderIds.includes(s.id)} onChange={() => toggle(s.id)} disabled={busy} />
                  Order #{s.orderNumber}{s.isRemake ? " (remake)" : ""}
                </label>
              ))}
            </fieldset>
          )}
          <ShipToFields value={form.shipTo} onChange={(shipTo) => set({ shipTo })} hint={context.deliveryHint} disabled={busy} />
          <ParcelFields value={form.parcel} onChange={(parcel) => set({ parcel })} disabled={busy} />
          <RateChooser
            rates={rates} stale={stale} choice={form.choice} manual={form.manual} busy={busy} carriers={context.carriers}
            onGetRates={getRates} onChoose={(choice) => set({ choice })} onManual={(m) => set({ manual: m })}
          />
          {uncertain && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {uncertain}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-full bg-surface-100 px-4 py-2 text-sm font-semibold text-navy hover:bg-surface-200 disabled:opacity-40">
              Never mind
            </button>
            <button type="button" onClick={buy} disabled={!ready || busy} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
              {busy ? "Working…" : manual ? "Record shipment" : "Buy label"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

`apps/web/src/components/lab/ShippingPanel.jsx`:

```jsx
import { Truck, Printer, ExternalLink, PackageCheck } from "lucide-react";
import { formatCents, trackingUrl } from "@my-app/shared";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { shipmentPrintPath } from "../../config/routes.js";
import { shipmentLine, shipmentStatusLabel } from "../../lib/shipping.js";

const BTN = "flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40";

/**
 * The order page's Shipping panel. Ready and unlabelled: Ship. Labelled: the
 * label's facts, Print (a new tab), Mark shipped, and Void (two clicks, while
 * the label is unused). The server enforces every rule; this only calls it.
 */
export function ShippingPanel({ order, shipment, busy, onShip, onMarkShipped, onVoid }) {
  if (!shipment) {
    if (order.status !== "ready_to_ship") return null;
    return (
      <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
        <h2 className="mb-3 font-heading text-sm font-bold text-navy">Shipping</h2>
        <button type="button" disabled={busy} onClick={onShip} className={`${BTN} bg-brand-500 text-white hover:bg-brand-600`}>
          <Truck size={14} /> Ship
        </button>
      </section>
    );
  }
  const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
  const waiting = order.status === "ready_to_ship" && !shipment.shippedAt;
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <h2 className="mb-2 font-heading text-sm font-bold text-navy">Shipping</h2>
      <p className="text-sm text-navy">{shipmentLine(shipment)}</p>
      <p className="mt-0.5 text-xs text-navy/50">{shipmentStatusLabel(shipment.status)} · {formatCents(shipment.chargeCents)}</p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
          <ExternalLink size={11} /> Track
        </a>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {shipment.hasLabel && (
          <a href={shipmentPrintPath(shipment.id)} target="_blank" rel="noreferrer" className={`${BTN} bg-navy text-white hover:bg-navy/90`}>
            <Printer size={14} /> Print label
          </a>
        )}
        {waiting && (
          <button type="button" disabled={busy} onClick={onMarkShipped} className={`${BTN} bg-brand-500 text-white hover:bg-brand-600`}>
            <PackageCheck size={14} /> Mark shipped
          </button>
        )}
        {waiting && shipment.status === "label_created" && (
          <ConfirmButton onConfirm={onVoid} disabled={busy} confirmLabel="Click again to void the label" className={`${BTN} bg-red-50 text-red-700 hover:bg-red-100`}>
            Void label
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire them into the order page and the board**

In `apps/web/src/pages/lab/LabOrderDetailPage.jsx`:
- add the imports:

```jsx
import { ShippingPanel } from "../../components/lab/ShippingPanel.jsx";
import { ShipModal } from "../../components/lab/ShipModal.jsx";
```

- add state next to the others: `const [shipOpen, setShipOpen] = useState(false);`;
- change the destructuring after the early returns to `const { order, lines, events, rxCase, files, shopOrder, shipment } = detail;`;
- change `moves` to `const moves = allowedNextStatuses(order.status, { heldFrom: order.heldFrom, labelled: Boolean(order.shipmentId) });`;
- in the right-hand column, before `<Panel title="Status">`, add:

```jsx
          <ShippingPanel
            order={order}
            shipment={shipment}
            busy={busy}
            onShip={() => setShipOpen(true)}
            onMarkShipped={() => act(() => api.post(`/lab/shipments/${shipment.id}/mark-shipped`), "Marked shipped")}
            onVoid={() => act(() => api.post(`/lab/shipments/${shipment.id}/void`), "Label voided")}
          />
```

- before the closing `</div>` of the page (next to the reason `Modal`), add:

```jsx
      <ShipModal open={shipOpen} orderId={order.id} onClose={() => setShipOpen(false)} onBought={() => { setShipOpen(false); load(); }} />
```

In `apps/web/src/pages/lab/LabBoardPage.jsx`:
- add `Tag` to the lucide import and `import { labelBadge } from "../../lib/shipping.js";`;
- in `Card`, add after the Remake badge:

```jsx
          {labelBadge(card) && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
              <Tag size={10} /> {labelBadge(card)}
            </span>
          )}
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd apps/web && pnpm vitest run && cd ../.. && pnpm --filter @my-app/web build`
Expected: tests PASS; build succeeds with no new warnings about missing imports.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Ship form, Shipping panel and board label badge; one Idempotency-Key per purchase attempt

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Web: label print page, Shipments page, carriers panel, My cases tracking, nav

**Files:**
- Create: `apps/web/src/pages/lab/ShipmentLabelPrintPage.jsx`, `apps/web/src/pages/lab/ShipmentsPage.jsx`, `apps/web/src/components/lab/CarriersPanel.jsx`
- Modify: `apps/web/src/App.jsx`, `apps/web/src/components/layout/Sidebar.jsx`, `apps/web/src/pages/doctor/MyCasesPage.jsx`

**Interfaces:**
- Consumes: the API from Tasks 12–13: `GET /lab/shipments/:id/label`, `GET /lab/shipments`, `GET /lab/carriers`, `POST /lab/shipments/:id/{void,mark-shipped,refresh-tracking}`, `POST /lab/shipments/mark-all-shipped`; the `lib/shipping.js` helpers (Task 14); the doctor's `tracking` (Task 10).
- Produces: pages at `/lab/shipments/:id/print` (staff, no app shell) and `/admin/shipments` (staff, Lab nav).

All pure logic used here is already tested in Task 14 (`labelNeedsRotation`, `filenameFrom`, `shipmentListParams`, `shipmentLine`). This task's gate is the web build plus those tests. Don't drive a browser.

- [ ] **Step 1: Write the print page**

`apps/web/src/pages/lab/ShipmentLabelPrintPage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer, Download } from "lucide-react";
import api from "../../config/api.js";
import { blobErrorText } from "../../lib/requests.js";
import { labelNeedsRotation, filenameFrom } from "../../lib/shipping.js";

// A 4×6 page with no margins: prints on a 4×6 thermal printer through its
// driver, or on a letter page. UPS GIFs are landscape and are turned onto it.
const PRINT_CSS = `
  @page { size: 4in 6in; margin: 0; }
  @media print { .no-print { display: none !important; } html, body { margin: 0; background: #fff; } }
  .label-page { width: 4in; height: 6in; overflow: hidden; position: relative; background: #fff; }
  .label-img { display: block; width: 4in; height: 6in; object-fit: contain; }
  .label-img.rotated { width: 6in; height: 4in; transform: rotate(90deg) translateY(-100%); transform-origin: top left; }
`;

/**
 * The stored label, on its own page (no app shell). The server audit-logs every
 * view. An image label prints through the browser; a ZPL label is a file for a
 * Zebra printer, so it is offered as a download.
 */
export function ShipmentLabelPrintPage() {
  const { id } = useParams();
  const [label, setLabel] = useState(null);
  const [error, setError] = useState(null);
  const [rotated, setRotated] = useState(false);

  useEffect(() => {
    let url = null;
    let live = true;
    api.get(`/lab/shipments/${id}/label`, { responseType: "blob" })
      .then((res) => {
        url = URL.createObjectURL(res.data);
        if (!live) return;
        const type = res.headers["content-type"] ?? "";
        setLabel({ url, image: type.startsWith("image/"), filename: filenameFrom(res.headers["content-disposition"], `label-${id}.zpl`) });
      })
      .catch(async (err) => { if (live) setError(await blobErrorText(err)); });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (error) return <p className="p-8 text-sm text-red-700">{error}</p>;
  if (!label) return <div className="flex items-center gap-2 p-8 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading label…</div>;

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print flex items-center gap-3 border-b border-gray-200 p-4">
        {label.image ? (
          <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white">
            <Printer size={14} /> Print
          </button>
        ) : (
          <a href={label.url} download={label.filename} className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white">
            <Download size={14} /> Download {label.filename}
          </a>
        )}
        <span className="text-xs text-gray-500">{label.image ? "4 × 6 in. Choose the label printer, or letter paper." : "Send this file to the Zebra printer."}</span>
      </div>
      {label.image && (
        <div className="label-page">
          <img
            src={label.url}
            alt="Shipping label"
            className={`label-img ${rotated ? "rotated" : ""}`}
            onLoad={(e) => setRotated(labelNeedsRotation({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }))}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the carriers panel and the Shipments page**

`apps/web/src/components/lab/CarriersPanel.jsx`:

```jsx
import { CheckCircle2, XCircle } from "lucide-react";

/** Each carrier's state and, when disabled, why ("UPS: credentials not set (UPS_CLIENT_ID)"). */
export function CarriersPanel({ carriers }) {
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-4">
      <h2 className="mb-2 font-heading text-sm font-bold text-navy">Carriers</h2>
      <ul className="space-y-1 text-sm">
        {carriers.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            {c.ok ? <CheckCircle2 size={14} className="mt-0.5 text-emerald-600" /> : <XCircle size={14} className="mt-0.5 text-navy/30" />}
            <span>
              <span className="font-semibold text-navy">{c.label}</span>
              <span className="text-navy/50"> — {c.ok ? "enabled" : c.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`apps/web/src/pages/lab/ShipmentsPage.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Printer } from "lucide-react";
import { CARRIERS, CARRIER_LABELS, SHIPMENT_STATUSES, formatCents, formatLabDate } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { CarriersPanel } from "../../components/lab/CarriersPanel.jsx";
import { labOrderPath, shipmentPrintPath } from "../../config/routes.js";
import { errorText } from "../../lib/requests.js";
import { shipmentLine, shipmentStatusLabel, shipmentListParams } from "../../lib/shipping.js";

const INPUT = "px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm";
const ROW_BTN = "rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-200 disabled:opacity-40";

/** Admin › Shipments (lab staff and admins): every shipment, its orders, and the actions that apply. */
export function ShipmentsPage() {
  const { addToast } = useToast();
  const [filters, setFilters] = useState({ status: "", carrier: "", from: "", to: "" });
  const [data, setData] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, c] = await Promise.all([
        api.get("/lab/shipments", { params: shipmentListParams(filters) }),
        api.get("/lab/carriers"),
      ]);
      setData(list.data.data);
      setCarriers(c.data.data.carriers);
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  }, [filters, addToast]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const res = await fn();
      addToast({ message: typeof success === "function" ? success(res.data.data) : success, type: "success" });
      await load();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };
  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Shipments</h1>
        <ConfirmButton
          onConfirm={() => act(() => api.post("/lab/shipments/mark-all-shipped"), (d) => `${d.shipped} shipped${d.failed ? `, ${d.failed} failed (see logs)` : ""}`)}
          disabled={busy}
          confirmLabel="Click again: every labelled box has left"
          className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
        >
          Mark all labelled shipped
        </ConfirmButton>
      </div>

      <CarriersPanel carriers={carriers} />

      <div className="flex flex-wrap gap-2">
        <select className={INPUT} value={filters.status} onChange={setFilter("status")}>
          <option value="">Any status</option>
          {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{shipmentStatusLabel(s)}</option>)}
        </select>
        <select className={INPUT} value={filters.carrier} onChange={setFilter("carrier")}>
          <option value="">Any carrier</option>
          {CARRIERS.map((c) => <option key={c} value={c}>{CARRIER_LABELS[c]}</option>)}
        </select>
        <input type="date" className={INPUT} value={filters.from} onChange={setFilter("from")} aria-label="From" />
        <input type="date" className={INPUT} value={filters.to} onChange={setFilter("to")} aria-label="To" />
      </div>

      {!data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-navy/50"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : data.shipments.length === 0 ? (
        <p className="py-10 text-center text-sm text-navy/50">No shipments match.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] font-mono uppercase tracking-widest text-navy/40">
              <tr><th className="px-3 py-2">Bought</th><th>Shipment</th><th>Status</th><th>Orders</th><th>To</th><th>Charge</th><th>By</th><th /></tr>
            </thead>
            <tbody>
              {data.shipments.map((s) => (
                <tr key={s.id} className="border-t border-surface-300/40 align-top">
                  <td className="px-3 py-2 text-xs text-navy/60">{formatLabDate(s.purchasedAt)}</td>
                  <td className="py-2">
                    {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{shipmentLine(s)}</a> : shipmentLine(s)}
                    {s.trackingError && <div className="text-[11px] text-red-700">{s.trackingError}</div>}
                  </td>
                  <td className="py-2 text-xs">{shipmentStatusLabel(s.status)}</td>
                  <td className="py-2 text-xs">
                    {s.orders.length ? s.orders.map((o) => <Link key={o.id} to={labOrderPath(o.id)} className="mr-1 font-mono text-brand-600 hover:underline">#{o.orderNumber}</Link>) : "—"}
                  </td>
                  <td className="py-2 text-xs text-navy/70">{s.shipToName ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">{formatCents(s.chargeCents)}</td>
                  <td className="py-2 text-xs text-navy/60">{s.createdByName ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {s.hasLabel && <a href={shipmentPrintPath(s.id)} target="_blank" rel="noreferrer" className={ROW_BTN}><Printer size={10} className="inline" /> Print</a>}
                      {s.canMarkShipped && <button type="button" disabled={busy} className={ROW_BTN} onClick={() => act(() => api.post(`/lab/shipments/${s.id}/mark-shipped`), "Marked shipped")}>Mark shipped</button>}
                      {s.carrier !== "manual" && s.status !== "voided" && (
                        <button type="button" disabled={busy} className={ROW_BTN} onClick={() => act(() => api.post(`/lab/shipments/${s.id}/refresh-tracking`), (d) => (d.updated ? "Tracking updated" : "No change"))}>
                          <RefreshCw size={10} className="inline" /> Tracking
                        </button>
                      )}
                      {s.canVoid && (
                        <ConfirmButton onConfirm={() => act(() => api.post(`/lab/shipments/${s.id}/void`), "Label voided")} disabled={busy} confirmLabel="Click again to void" className={`${ROW_BTN} bg-red-50 text-red-700`}>
                          Void
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated && <p className="p-3 text-xs text-navy/50">Showing the newest 500. Narrow the dates to see older shipments.</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire routes, nav and My cases**

In `apps/web/src/App.jsx`:
- import both pages:

```jsx
import { ShipmentsPage } from "./pages/lab/ShipmentsPage.jsx";
import { ShipmentLabelPrintPage } from "./pages/lab/ShipmentLabelPrintPage.jsx";
```

- inside the existing `<Route element={<RequireStaff />}>` (under `AppShell`), add `<Route path="/admin/shipments" element={<ShipmentsPage />} />`;
- as a sibling of the AppShell route (so the label page has no sidebar), add:

```jsx
      {/* Label print page: staff only, no app shell (prints on a 4×6 page) */}
      <Route element={<RequireStaff />}>
        <Route path="/lab/shipments/:id/print" element={<ShipmentLabelPrintPage />} />
      </Route>
```

(`RequireStaff` → `RequireUserRole` already sends a signed-out visitor to login.)

In `apps/web/src/components/layout/Sidebar.jsx`, add `Truck` to the lucide import and a third staff item:

```jsx
const staffItems = [
  { label: "Production", to: ROUTES.LAB_BOARD,      icon: LayoutGrid },
  { label: "Rx Cases",   to: ROUTES.ADMIN_RX_CASES, icon: ClipboardCheck },
  { label: "Shipments",  to: ROUTES.ADMIN_SHIPMENTS, icon: Truck },
];
```

In `apps/web/src/pages/doctor/MyCasesPage.jsx`:
- add a `Tracking` header cell after `Due`: `<th className="px-4 py-3">Tracking</th>`;
- add the cell after the due-date cell:

```jsx
                  <td className="px-4 py-3 text-gray-600">
                    {c.tracking ? (
                      <>
                        {c.tracking.url
                          ? <a href={c.tracking.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{c.tracking.carrier} {c.tracking.trackingNumber}</a>
                          : <span>{c.tracking.carrier} {c.tracking.trackingNumber}</span>}
                        {c.tracking.deliveredAt && <div className="text-[11px] text-emerald-700">Delivered {dateText(c.tracking.deliveredAt)}</div>}
                      </>
                    ) : "—"}
                  </td>
```

- [ ] **Step 4: Run the tests and the build**

Run: `pnpm test && pnpm --filter @my-app/web build`
Expected: PASS; build succeeds.

Check by hand that the file sizes stay within the limits: `wc -l apps/web/src/pages/lab/ShipmentsPage.jsx apps/web/src/components/lab/*.jsx`. Each should be under 300.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): 4×6 label print page, Admin › Shipments with carrier status, doctor tracking on My cases

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Sandbox smoke script, go-live runbook, whole-piece verification and PR

**Files:**
- Create: `apps/api/scripts/carrier-sandbox-smoke.js`, `docs/shipping-operations.md`
- Modify: `apps/api/package.json` (script `carriers:smoke`)

**Interfaces:**
- Consumes: `carrierConfig`, `createRegistry`, `effectiveCarrierEnv`, `env`.
- Produces: `pnpm --filter @my-app/api carriers:smoke [ups|fedex] [--save=<dir>]`. It is manual only, sandbox only, and never in CI.

- [ ] **Step 1: Write the smoke script**

`apps/api/scripts/carrier-sandbox-smoke.js`:

```js
/**
 * Carrier SANDBOX smoke test — run by hand, never in CI (it is not a *.test.js).
 *
 * For each configured carrier (or the ones named on the command line): rate,
 * buy ONE test label, track it, void it, and print what each call returned
 * (codes and shapes, never credentials). Refuses to run unless the effective
 * carrier environment is "sandbox".
 *
 *   pnpm --filter @my-app/api carriers:smoke              # every configured carrier
 *   pnpm --filter @my-app/api carriers:smoke fedex        # one carrier
 *   pnpm --filter @my-app/api carriers:smoke --save=/tmp/labels   # also write each label file (FedEx certification)
 *
 * Go-live step 3 (docs/shipping-operations.md): every line must be ✓, and the
 * printed raw status codes must exist in carriers/carrier-status.js.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../src/config/env.js";
import { effectiveCarrierEnv } from "../src/config/app-env.js";
import { carrierConfig } from "../src/services/shipping/carrier-config.js";
import { createRegistry } from "../src/services/shipping/carrier-registry.js";

// UPS's test environment validates street addresses only in NY and CA.
const TEST_SHIP_TO = {
  name: "Smoke Test", company: "Carrier Sandbox", phone: "2125550100",
  address1: "1 Rockefeller Plz", city: "New York", state: "NY", postalCode: "10020", country: "US",
};
const PARCEL = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const GROUND = { ups: "03", fedex: "FEDEX_GROUND" };

const args = process.argv.slice(2);
const saveDir = args.find((a) => a.startsWith("--save="))?.slice("--save=".length) ?? null;
const only = args.filter((a) => !a.startsWith("--"));

async function smoke(adapter, config) {
  const quotes = await adapter.rate({ shipFrom: config.shipFrom, shipTo: TEST_SHIP_TO, parcel: PARCEL });
  console.log(`✓ ${adapter.label} rate: ${quotes.length} services (${quotes.map((q) => `${q.serviceCode} ${q.amountCents}¢`).join(", ")})`);
  const pick = quotes.find((q) => q.serviceCode === GROUND[adapter.id]) ?? quotes[0];
  if (!pick) throw new Error("no quotes returned");
  const label = await adapter.createLabel({
    shipFrom: config.shipFrom, shipTo: TEST_SHIP_TO, parcel: PARCEL, serviceCode: pick.serviceCode, reference: "Order SMOKE", labelFormat: config.labelFormat,
  });
  console.log(`✓ ${adapter.label} label: ${label.trackingNumber} ${label.labelFormat} (${label.labelData.length} base64 chars), ${label.chargeCents}¢, void id ${label.carrierShipmentId}`);
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    const file = join(saveDir, `label-${adapter.id}-${label.trackingNumber}.${label.labelFormat}`);
    writeFileSync(file, Buffer.from(label.labelData, "base64"));
    console.log(`  saved ${file}`);
  }
  const [tracked] = await adapter.track([label.trackingNumber]);
  console.log(`✓ ${adapter.label} track: status=${tracked?.status ?? "unmapped"} rawCode=${tracked?.carrierCode ?? "-"}${tracked?.error ? ` error=${tracked.error.code}: ${tracked.error.message}` : ""}`);
  const voided = await adapter.voidLabel(label);
  if (!voided.ok) throw new Error(`void failed: ${voided.reason}`);
  console.log(`✓ ${adapter.label} void`);
}

async function main() {
  if (effectiveCarrierEnv(env) !== "sandbox") {
    console.error("Refusing to run: the carrier environment is production. This script only buys SANDBOX labels.");
    process.exit(1);
  }
  const config = carrierConfig(env);
  const registry = createRegistry({ config });
  let failed = 0;
  for (const adapter of registry.all().filter((a) => a.tracks && (only.length === 0 || only.includes(a.id)))) {
    const ready = adapter.configured();
    if (!ready.ok) {
      console.log(`- ${adapter.label}: skipped (${ready.reason})`);
      continue;
    }
    try {
      await smoke(adapter, config);
    } catch (err) {
      failed += 1;
      console.log(`✗ ${adapter.label}: ${err.code ?? "ERROR"} ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
```

In `apps/api/package.json` `scripts`, add after `jobs:run`:

```json
    "carriers:smoke": "node --env-file=.env scripts/carrier-sandbox-smoke.js"
```

- [ ] **Step 2: Write the go-live runbook**

`docs/shipping-operations.md`:

````markdown
# Shipping labels — operations and go-live

Piece 4 of own-the-lab. Spec: `docs/superpowers/specs/2026-10-19-shipping-labels-design.md`.
Plan: `docs/superpowers/plans/2026-10-19-shipping-labels.md`.

## What works with no carrier accounts

**Manual** shipments are always enabled. In the Ship form, pick "Manual", type
the carrier (a courier, hand delivery, USPS bought elsewhere) and, if there is
one, the tracking number. This works from day one. UPS and FedEx appear in
Admin › Shipments › Carriers as disabled, and the panel says why.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `LAB_NAME` | Diamond Orthotic Laboratory | Invoices, statements, the shipped email |
| `LAB_PHONE`, `LAB_ADDRESS_LINE1`, `LAB_ADDRESS_LINE2`, `LAB_CITY`, `LAB_STATE`, `LAB_ZIP` | — | The ship-from. UPS/FedEx stay disabled until all but LINE2 are set |
| `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER` | — | Secret Manager in prod |
| `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, `FEDEX_ACCOUNT_NUMBER` | — | Secret Manager in prod |
| `CARRIER_ENV` | `sandbox` | `production` only after step 5. Staging is always sandbox |
| `LABEL_FORMAT` | `image` | `zpl` for a Zebra thermal printer |
| `SHIPPING_CHARGE_POLICY` | `none` | `carrier_cost` or `flat`; the lab's decision |
| `SHIPPING_FLAT_CENTS` | `0` | Used by `flat` |
| `SHIPPED_EMAIL_ENABLED` | `true` | One email per shipment: order numbers, carrier, tracking |

## Go-live checklist

1. **Accounts.** Create the UPS and FedEx developer apps and link the lab's shipper numbers. Put the credentials into Secret Manager (`diamond-labs-prod`) and wire them as env vars on the service.
2. **Ship-from.** Set the lab's street address and phone (`LAB_*`).
3. **Sandbox smoke.** With sandbox credentials in `apps/api/.env`, run `pnpm --filter @my-app/api carriers:smoke`. Every line must be ✓.
   - **FedEx cancel path:** if void fails with a 404 or 405, switch `FEDEX_CANCEL_METHOD` and `fedexPaths.cancel` in `services/shipping/carriers/fedex-requests.js` to `DELETE /ship/v1/shipments/{trackingNumber}`, and rerun.
   - **Status codes:** every `rawCode=` printed must appear in `services/shipping/carriers/carrier-status.js`. Add any missing code.
   - **Field names:** if a field name differs from a fixture under `apps/api/test-fixtures/carriers/`, replace that fixture with the real (sandbox) body and fix the parser in the same commit.
4. **FedEx label certification** (about 3 business days per project).
   - Run the smoke with `--save=<dir>`, print each service's label on the lab's real printer, and scan at ≥ 600 DPI.
   - Email the scans with the Label Cover Sheet to label@fedex.com.
   - Check whether UPS has an equivalent gate on the developer portal (unverified).
5. **Production.** Set `CARRIER_ENV=production` and the `LABEL_FORMAT` that matches the printer.
6. **Tracking job.** Schedule `shipping-tracking-sync` every 2 hours. This is the same setup as AutoPay (`docs/autopay-operations.md` §1.4–1.5): a Cloud Scheduler job invoking the jobs runner with job name `shipping-tracking-sync`. Do one dry run first, then live.
7. **Billing.** The lab chooses `SHIPPING_CHARGE_POLICY`.

## Alerts (Cloud Logging)

| Line | Meaning | Action |
|---|---|---|
| `[SHIP][PURCHASE_UNCERTAIN] carrier= code=` | A purchase timed out or failed ambiguously; the label may exist | Check the carrier's portal for the label. If it exists, void it there. The attempt's key stays locked for 24 h |
| `[SHIP][LABEL_ORPHANED] carrier= tracking=` | A label was bought, our DB write failed, and the void failed too | Void that tracking number in the carrier's portal |
| `[SHIP][VOID_UNRECORDED] shipment= carrier=` | The carrier voided the label but our DB write failed | The shipment still reads "Label created": void it again (the carrier will say it's already void) or fix the row |
| `[SHIP][UNKNOWN_STATUS] carrier= code=` | The tracking sync saw a code we don't map | Add it to `carrier-status.js` |
| `[SHIP][MARK_SHIPPED_FAILED] shipment=` | A moving shipment's orders couldn't be marked shipped | Retried on the next sync. Persistent: open the order |
| `[SHIP][EMAIL_FAILED] shipment=` | The shipped email failed | Nothing to retry automatically. Tell the doctor if needed |

## Rules worth knowing

- A labelled order can only move to Shipped. To change anything else, void the label first.
- "Mark shipped" ships every order in the box and sends one email.
- Void is possible only while the label is unused (not shipped, not moving).
- Shipping is never "un-shipped". Correct the bill with a credit on the invoice.
````

- [ ] **Step 3: Whole-piece verification**

Run each and read the output:

```bash
pnpm test
pnpm --filter @my-app/web build
cd apps/api && pnpm db:generate && cd ../..
git diff --name-only origin/feat/own-the-lab...HEAD | wc -l
```

Expected:
- every test passes;
- the build succeeds;
- `db:generate` prints "No schema changes";
- about 120 files (the plan's estimate).

Then confirm these by inspection:
- `grep -rn "alert(\|confirm(\|prompt(" apps/web/src/components/lab apps/web/src/pages/lab` finds nothing.
- `grep -rn "seazona" apps/api/src/services/shipping apps/api/src/services/lab/lab-shipping*` finds nothing.
- No new source file is over 1,000 lines: `git diff --name-only origin/feat/own-the-lab...HEAD | grep -E '\.(js|jsx)$' | xargs wc -l | sort -n | tail -5`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/carrier-sandbox-smoke.js apps/api/package.json docs/shipping-operations.md
git commit -m "docs(shipping): sandbox smoke script and go-live runbook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Open the PR (after the user's go-ahead)**

1. Count the files: `git diff --name-only origin/feat/own-the-lab...HEAD | wc -l`. If it is near or over 150, stop, tell the user, and split along the seam in "Estimated size" instead.
2. Check CodeRabbit capacity. Look at the repo's recent PRs for a "Review paused" notice and count reviews in the last hour. If no slot is free, wait or tell the user.
3. Push: `git push origin feat/own-the-lab-4-shipping` (never a bare `git push`).
4. Create the PR: `gh pr create --base feat/own-the-lab --head feat/own-the-lab-4-shipping`. The body covers:
   - each task in one line, and the file count;
   - **the one business decision** (`SHIPPING_CHARGE_POLICY`: none / carrier_cost / flat), still `none`;
   - the go-live checklist link (`docs/shipping-operations.md`);
   - the follow-ups:
     - the remaining hard-coded lab name (emails, Authorize.net descriptions);
     - splitting `LabOrderDetailPage` (already over the component limit);
     - the parcel presets to confirm with the lab;
   - the closing line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. Verify that a review actually ran (real inline findings, not just the walkthrough). Batch fixes and push once per round.

---

## Self-review (done while writing; kept for the executor)

**Spec coverage.** Each spec section maps to its task:
- Goal / adapter interface → Tasks 4–6, with the contract test in Task 4.
- Model: `shipments`, `shipment_events`, `lab_orders.shipment_id` and the `shipment` event type → Task 3 and Task 9.
- Normalised types and statuses, presets, tracking-URL builder → Task 1.
- UPS and FedEx adapters (pure builders and parsers plus a thin fetch; cents in the parser; order-numbers-only reference) → Tasks 5–6.
- Manual adapter → Task 4. Token cache (per carrier and environment, 60s early, single-flight) → Task 4. Registry with reasons, never failing at boot → Task 4.
- Config and env, lab identity, models switched → Task 2. Staging guard → Task 2 (spec correction 13).
- Flow 1, Buy:
  - siblings and ship-to prefill + hint → Task 11 `shipContext`, Task 14 form;
  - parcel presets → Tasks 1 and 14;
  - parallel rates with per-carrier timeout and visible errors → Task 7 `rateAll`, Task 4 `TIMEOUTS`;
  - Manual → Tasks 4, 14;
  - idempotent Buy → Task 12 route, Task 14 key;
  - checks before the carrier (422) → Task 11 `planShippable`;
  - one transaction plus void on failure, and the `[SHIP][LABEL_ORPHANED]` log → Task 7 `purchaseAndPersist`, Task 11 `persistShipment`.
- Flow 2, Print: label endpoint with content types, ZPL download and audit → Task 12. 4×6 print view with rotation → Task 15. No new dependency.
- Flow 3, Shipped: "Label printed" → Tasks 9 and 14. Mark shipped / Mark all labelled shipped through the status path → Tasks 11, 12, 15. First movement → Task 13. `shippedAt` → Task 7 `stampShipped`.
- Flow 4, Void: allowed states → Tasks 7 and 11. Carrier → shipment → unlink → invoice line → Task 11 `voidShipment`, Task 8. Two-click → Tasks 14 and 15. Never un-ship → the Task 9 guard plus the runbook.
- Flow 5, Tracking: the job, its filters, batching, events, `deliveredAt` / `lastTrackedAt`, `trackingError` retry, idempotent and dry run → Task 13 (rules in Task 7). Refresh button → Tasks 13 and 15.
- Flow 6, Doctor-facing: My cases tracking → Tasks 10 and 15. Shipped email (flag, after commit, never fails the move, one per shipment) → Tasks 10 and 11.
- Shipping-charge policy (none / carrier_cost / flat; the lowest order; remakes and non-draft) → Tasks 8 and 11, with the corrected targeting in spec correction 7.
- Admin › Shipments (list, filters, actions, Carriers panel) → Tasks 11, 12, 15.
- Errors and safety:
  - normalised carrier errors shown verbatim, no bodies or credentials logged → Task 4;
  - timeouts 10s/30s → Task 4;
  - uncertain purchase keeps its key → Tasks 7 and 12;
  - audit on purchase, void, mark-shipped and label → Task 12;
  - cents end to end → Tasks 5–6;
  - lab sees `chargeCents` only in the form and list → Tasks 11, 14, 15;
  - adapter file split and lab glue in its own file → Tasks 5, 6, 11.
- Testing:
  - fixtures for every adapter call and an error body → Tasks 5–6;
  - status table → Task 5; token cache → Task 4; registry reasons → Tasks 4–6;
  - shippable checks and charge policy → Task 11; sync state machine → Tasks 7 and 13;
  - tracking-URL builder → Task 1; contract test → Task 4; route source tests → Task 12;
  - smoke script → Task 16.
- Go-live checklist → Task 16 runbook. Out of scope: nothing built.

**Placeholder scan.**
- No "TBD" or "similar to Task N"; every code step carries its code.
- The one deliberately unverified value, FedEx's cancel method and path, is isolated in two named constants with the check in the runbook. That is a fact still to be learned, not a placeholder.

**Type consistency.** These names are used identically across tasks:
- `Address`, `Parcel`, `RateQuote`, `TrackResult`, `LABEL_RESULT_KEYS`;
- `createRegistry` / `carrierRegistry`, `planTrackingUpdate` → `applyTrackingPlan`;
- `stampShipped` → `markShipmentShipped` → `syncLabTracking`;
- `mutateIn(tx, id, null, plan)`;
- `addShipmentLine` / `removeShipmentLine`, which return `{ added|removed, reason, invoiceNumber }`;
- `shipContext` → `initialShipForm`, `buyBody` → `shipmentBuySchema`, `detail.shipment` → `ShippingPanel`, `card.labelled` → `quickMoves` / `labelBadge`, `doctorCaseView.tracking` → `MyCasesPage`.

**Review Focus.** Each of the five lines is pinned to a named test in its owning task (see Review Focus above).
