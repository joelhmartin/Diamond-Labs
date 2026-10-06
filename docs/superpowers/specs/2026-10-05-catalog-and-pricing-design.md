# Piece 1 — Catalog & Pricing (design)

_2026-10-05 · branch `feat/own-the-lab` · roadmap:
`2026-10-05-own-the-lab-roadmap.md`_

## Goal

Make our database the owner of what the lab sells and what each client pays.
Products gain real **variations** (option axes → variant SKUs), clients keep
their **negotiated prices**, and every money calculation in the app goes
through **one pricing service in integer cents**. Pieces 2–4 (orders,
invoices, shipping) price everything through this.

## What exists today (and why it can't stay)

- `products` is a **one-way Seazona mirror** keyed by `seazonaProductId`
  (~390 flat rows). Seazona-authoritative columns get overwritten by sync.
- The **shop catalog lives in the browser**: `stores/catalog.store.js`
  hydrates `data/catalog.js` seed into localStorage; admin "edits" never
  reach the server. The server only knows prices through `products.catalogId`.
- **Variants already exist implicitly**: `services/rx/catalog-map/devices.table.js`
  maps device × material → one Seazona code (e.g. Olmos Night OND × Nylon →
  `2119`). That is a variant table written as code.
- **Client price lists** exist only in Seazona's UI (Clients > Pricing);
  115 of 214 sampled order lines were billed off-catalog.
- **Money**: floats + three separate `round2` copies (`payment.routes.js`,
  `invoice.routes.js`, `lib/payment-summary.js`); tax `0.08` and shipping
  `$12` are constants inside `payment.routes.js`.

## Data model

All money columns are `integer` cents. No DB foreign keys (repo convention —
integrity via transactions), ids are cuid2 `varchar(128)`.

**`product_families`** — the thing a doctor or shopper recognizes.
`id, slug (unique), name, description, category, imageUrl, channel
(shop | rx | both), active, position, createdAt, updatedAt`

**`product_options`** — an axis on a family (Material, Arch, Size).
`id, familyId, name, position`

**`product_option_values`** — `id, optionId, value, position`

**`product_variants`** — the sellable SKU. Every family has ≥1 variant; a
family with no options has exactly one.
`id, familyId, code (unique — the lab's product code, e.g. "2119", kept so
history and technicians' vocabulary carry over), name, basePriceCents,
taxable, active, catalogId (unique, nullable — legacy shop SKU link),
legacySeazonaProductId (unique, nullable — retired in piece 5)`

**`product_variant_option_values`** — `variantId, optionValueId` (composite
unique). A variant's option combination must be unique within its family —
enforced in the service on write.

**`client_prices`** — negotiated price per client per variant.
`id, clientUserId, variantId, priceCents, source (manual | imported |
inferred), reviewedAt, reviewedBy, note, createdAt, updatedAt`; unique
`(clientUserId, variantId)`. The billing client is the **user carrying the
Seazona client link** — 1:1 with Seazona clients today and what
`invoice_payments` already keys on; piece 3 keeps that.

The old `products` table stays, untouched and read-only on this branch, as the
import source and so `main`'s Seazona sync paths keep compiling. Piece 5
drops it.

## Services

**`lib/money.js`** — `toCents`, `fromCents`, `formatCents`, `sumCents`,
`mulCents(cents, qty)`, `pctOfCents(cents, rateBps)` (integer math, rate in
basis points; percentages round half-up to the cent, applied once to the
taxable subtotal, not per line). Replaces all three `round2` copies; those call
sites switch to it in this piece.

**`services/catalog.service.js`** — family/option/variant CRUD;
`findVariant({ familyId, optionValueIds })`; `variantByCode(code)`;
generates the variant grid when an option axis is added (new combinations
created inactive with no price, so nothing becomes buyable by accident).

**`services/pricing.service.js`** — the one place a price is decided.
- `unitPrice({ variantId, clientUserId? })` → `{ cents, source:
  "client" | "base" }`. Client price wins; guests get base.
- `priceLines({ lines:[{variantId, qty}], clientUserId? })` →
  per-line `{unitCents, lineCents, taxable}`, `subtotalCents`, `taxCents`,
  `shippingCents`, `totalCents`.
- Tax rate and flat shipping move from `payment.routes.js` constants into
  `config/pricing.js` (same values: 800 bps, 1200 cents). A real tax engine
  is out of scope.

## One-time catalog import (`pnpm db:import-catalog`, idempotent, `DRY_RUN=1`)

1. Every `products` row → a variant (`code`, `name`, `basePriceCents`,
   `taxable`, `catalogId`, `legacySeazonaProductId`), each in its own
   single-variant family.
2. **Rx device families are grouped automatically** from `DEVICE_ROWS`: rows
   sharing a `device` become one family, `material` becomes the option axis.
   These groupings are lab-confirmed data already (status `confirmed`);
   `proposed`/`open` rows stay single-variant.
3. Everything else is grouped by an admin in the UI (merge families, add an
   axis). The import never guesses a grouping from product names.
4. Shop presentation fields (`imageUrl`, `description`, `category`,
   `purchasable`) come from `products` + `data/catalog.js`.

## Client price import (`pnpm db:import-client-prices`, `DRY_RUN=1`)

Seazona exposes no price-list API, so prices are inferred from what was
actually billed: for each client × product, the **most recent billed unit
price**, written only when it differs from base, `source = "inferred"`,
`reviewedAt = null`. Read-only against Seazona, serial with ~110 ms spacing
(host rate limit), uses `getAllInvoicesResult()` (10k cap workaround).

Inferred prices are **used** (they're what the client was last charged) but
flagged in the admin UI until someone marks them reviewed. If a portal export
of Clients > Pricing turns up, it imports as `source = "imported"` and wins.

## API

- `GET /api/v1/catalog` (public) — active shop/both families with options and
  active variants; prices are base. Authenticated doctors get their client
  prices (`source` included).
- `GET/POST/PATCH /api/v1/admin/catalog/families…`, `…/variants…`,
  `…/options…` — admin CRUD.
- `GET/PUT/DELETE /api/v1/admin/clients/:userId/prices[/:variantId]`;
  `POST …/prices/review` marks inferred prices reviewed.

Zod schemas in `packages/shared/src/schemas/catalog.schema.js`.

## UI

- **Admin Products** (`AdminProductsPage`) becomes family-first: list of
  families → detail with option axes, variant grid (code, price, taxable,
  active), merge-families action.
- **Client pricing** panel on the admin user view: negotiated prices,
  inferred ones flagged, review action.
- **Shop**: `CatalogSection` reads `GET /catalog`; product cards with options
  get option pickers; cart line = `variantId`. `catalog.store.js`'s
  localStorage persistence and the client-side admin CRUD are removed —
  the seed file stays only as the import's presentation source.
- **Checkout** (`POST /payments/checkout`) accepts `variantId` lines and
  prices through `pricing.service.priceLines`; `order_items` gains
  `variantId` and stores cents.

## Rx

Rx resolution keeps resolving by **code** (unchanged tables, unchanged
tests). `rx_case_lines` gains `variantId`, set by `variantByCode` when a line
resolves. Moving `DEVICE_ROWS` itself into DB-driven options is a later
refactor, not this piece.

## Errors & safety

- A variant with no price, inactive, or missing → 422 at checkout (same
  fail-safe as today's unmapped SKU).
- Pricing never falls back silently: an unknown client id prices at base and
  says `source: "base"`.
- Imports are idempotent and dry-runnable; no Seazona writes anywhere in this
  piece.

## Testing

Vitest. Pure units for `money` and `pricing` (client-vs-base, tax on taxable
only, rounding at the line, totals). Catalog service: grid generation,
duplicate-combination rejection. Import: fixture `products` + `DEVICE_ROWS`
→ expected families. Route tests for `/catalog` (guest vs doctor pricing) and
checkout with `variantId`, following `routes/__tests__/`. Verification bar
also includes `pnpm db:generate` drift check and `apps/web` build.

## Out of scope

Inventory/stock, tax engine, discounts/promotions, DB-driven Rx option
resolution, removing Seazona code (piece 5).
