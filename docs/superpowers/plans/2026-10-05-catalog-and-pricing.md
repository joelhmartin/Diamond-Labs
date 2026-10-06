# Catalog & Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make our database own the product catalog (families → option axes → variant SKUs) and each client's negotiated prices, with every shop price decided by one integer-cents pricing service.

**Architecture:** Five new tables (`product_families`, `product_options`, `product_option_values`, `product_variants`, `product_variant_option_values`) plus `client_prices`. Pure modules hold the rules (`lib/money.js`, `lib/pricing.js`, `lib/catalog-variants.js`, the import planners) and are unit-tested; thin services/routes do the DB work. A one-time import builds the catalog from the local `products` table (already in our DB) plus an explicit Rx family seed — no Seazona API calls. Client prices are entered by staff; inferring them from invoice history is deferred to the migration piece. The shop moves from a localStorage catalog to `GET /catalog` + `POST /catalog/quote`.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM 0.36 (Postgres), Zod 3 (`@my-app/shared`), Vitest (+ `node:assert/strict`), React + Vite + Zustand, axios (`apps/web/src/config/api.js`).

**Spec:** `docs/superpowers/specs/2026-10-05-catalog-and-pricing-design.md` (roadmap: `docs/superpowers/specs/2026-10-05-own-the-lab-roadmap.md`)

## Global Constraints

- All work happens in the worktree `/Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab` on branch `feat/own-the-lab`. Never `cd` to the main checkout; another agent works there.
- This piece is built on `feat/own-the-lab-1-catalog` (cut from `feat/own-the-lab` in Task 1) and lands by PR into `feat/own-the-lab`. Push with `git push origin feat/own-the-lab-1-catalog` — never a bare `git push`.
- New money is **integer cents**. Columns: `integer`. Never store a new float dollar amount.
- Tax rate **800 bps**, flat shipping **1200 cents** when subtotal > 0, max **999** per line — values carried over unchanged from `payment.routes.js`.
- **No DB foreign keys** (repo convention); ids are cuid2 via `createId()` from `apps/api/src/lib/id.js`, `varchar(128)`.
- **No Seazona API calls** anywhere in this piece — no reads, no writes. The catalog import reads only our own `products` table.
- The old `products` table and its sync/admin API stay untouched (read-only import source until piece 5).
- Tests: Vitest files import `{ test } from "vitest"` and `assert from "node:assert/strict"` (never `node:test`). Test pure functions; there is no DB test harness.
- Verification bar for every task that touches schema: `cd apps/api && pnpm db:generate` must print "No schema changes" after the migration is committed.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Subagents: Sonnet minimum, never Haiku.

## Sequencing (from the Rx/payments session, 2026-10-05)

- **Before Task 1:** PR #37 (AutoPay) and #36 (security) land on `main` first. Rebase `feat/own-the-lab` onto `origin/main` before cutting the piece branch. Main then has migrations up to 0024; this piece's migration must come from `pnpm db:generate` after the rebase (expect 0025). Never hand-number migrations.
- **Task 9:** #37 moves charge/recording logic out of `payment.routes.js` into `services/payment-recording.service.js`, so the line numbers in Task 9 are stale. Read the current checkout handler and apply the same change wherever the products-mirror pricing loop and the order-items insert now live. The contract doesn't change: price through `priceShopCart`, record `variantId`.
- **Rx mapping:** `catalog-map` rows are keyed by stable `mapKey`s, and `rx_code_overrides` (the lab's accumulated "always" choices) is keyed on them. This piece doesn't rekey anything: rows still resolve to a lab code, and a variant carries that same code (`variantByCode`). Do not edit `catalog-map/*` or `rx_code_overrides` here. If any Rx file is touched, run the replay harness `apps/api/scripts/rx-replay/run.mjs` as a regression check.
- **Seazona:** no calls from this machine. The dev IP is currently blocked.

## Review Focus

1. **A doctor's access token has expired while they shop** → they must not be silently priced as a guest (and charged base price). `optionalAuthenticate` 401s when a token is presented but invalid, so the client refreshes; it treats only a missing header as guest. Test in Task 6.
2. **Same variant on two cart lines** (e.g. 600 + 600) → the 999 cap and the line total apply to the merged quantity. Test in Task 3.
3. **A shopper with a cart saved before this change** (items keyed by old shop SKU ids like `"16"`) → the cart empties cleanly on load instead of failing at checkout with an opaque 422. Test in Task 12 (`migrateCart`).
4. **A client's negotiated price of $0.00** (comped item) → it's a real price, not "no price"; it must win over base. Test in Task 3.
5. **An admin adds an option to a family that already has priced, active variants** → nothing new becomes buyable: every new combination is created unpriced and inactive, and existing variants keep their price. Pinned by the `combinations`/`missingCombinations` tests in Task 4 and the smoke test in Task 13.

---

## File Structure

**API — new**
- `apps/api/src/lib/money.js` — cents helpers + the single `round2`.
- `apps/api/src/config/pricing.js` — tax/shipping/qty knobs.
- `apps/api/src/lib/pricing.js` — pure price rules (`unitPriceFor`, `priceLines`, `PricingError`).
- `apps/api/src/lib/catalog-variants.js` — pure variant-grid rules + `shapeFamily` + `presentShopFamily`.
- `apps/api/src/db/schema/catalog.js`, `apps/api/src/db/schema/client-prices.js` — tables.
- `apps/api/src/services/catalog.service.js` — catalog DB operations.
- `apps/api/src/services/pricing.service.js` — loads variants/client prices, calls `lib/pricing.js`.
- `apps/api/src/services/client-prices.service.js` — client price CRUD.
- `apps/api/src/routes/catalog.routes.js` — public `GET /catalog`, `POST /catalog/quote`.
- `apps/api/src/routes/admin-catalog.routes.js` — admin catalog + client price routes.
- `apps/api/src/db/catalog-import/family-seed.js`, `plan-catalog.js` — pure import logic.
- `apps/api/src/db/import-catalog.js` — import script.
- `packages/shared/src/schemas/catalog.schema.js` — Zod schemas.

**API — modified**
- `apps/api/src/middleware/authenticate.js` — add `optionalAuthenticate`.
- `apps/api/src/routes/payment.routes.js` — checkout prices through `pricing.service`.
- `apps/api/src/routes/invoice.routes.js`, `apps/api/src/lib/payment-summary.js` — import `round2`.
- `apps/api/src/db/schema/order-items.js`, `apps/api/src/db/schema/index.js`.
- `apps/api/src/index.js` — register two route plugins.
- `packages/shared/src/schemas/payment.schema.js`, `packages/shared/src/index.js`.

**Web**
- New: `apps/web/src/lib/money.js`, `apps/web/src/lib/catalog.js`, `apps/web/src/hooks/useCatalog.js`, `apps/web/src/hooks/useCartQuote.js`, `apps/web/src/pages/app/AdminCatalogPage.jsx`, `apps/web/src/pages/app/AdminClientPricingPage.jsx`.
- Modified: `stores/cart.store.js`, `components/marketing/CatalogSection.jsx`, `CatalogCard.jsx`, `CatalogDetail.jsx`, `CartDrawer.jsx`, `pages/marketing/Checkout.jsx`, `pages/app/AdminUsersPage.jsx`, `App.jsx`, `config/routes.js`.
- Deleted: `stores/catalog.store.js`, `pages/app/AdminProductsPage.jsx`.

---

### Task 1: Worktree environment + money module

**Files:**
- Create: `apps/api/src/lib/money.js`, `apps/api/src/lib/money.test.js`
- Modify: `apps/api/src/routes/payment.routes.js:58-61`, `apps/api/src/routes/invoice.routes.js:13-15`, `apps/api/src/lib/payment-summary.js:8-10`

**Interfaces:**
- Produces: `round2(n) → number`, `toCents(value: number|string|null) → integer|null` (throws `TypeError` on non-numeric), `toDecimalString(cents) → "12.34"`, `formatCents(cents) → "$12.34"`, `assertCents(c, label?) → c`, `sumCents(cents[]) → integer`, `mulCents(cents, qty) → integer`, `pctOfCents(cents, rateBps) → integer` (half-up).

- [ ] **Step 1: Cut the piece branch, set up an isolated local DB and env**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab
git switch -c feat/own-the-lab-1-catalog
```

The worktree has no `.env`, and the shared dev DB `diamond_labs` is used by other branches — this branch's migrations must not land there.

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab
git check-ignore .env apps/api/.env   # both must print — never commit .env
cp /Users/bif/Developer/sites/Diamond-Labs/.env .env
createdb diamond_labs_own_the_lab
pg_dump diamond_labs | psql -q diamond_labs_own_the_lab
sed -i '' 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://bif@localhost:5432/diamond_labs_own_the_lab#' .env
ln -s ../../.env apps/api/.env
pnpm install
grep '^DATABASE_URL' .env   # expect diamond_labs_own_the_lab
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/lib/money.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  round2, toCents, toDecimalString, formatCents, sumCents, mulCents, pctOfCents,
} from "./money.js";

test("toCents reads Postgres numeric strings and JS numbers exactly", () => {
  assert.equal(toCents("199.00"), 19900);
  assert.equal(toCents(199), 19900);
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents("-5.5"), -550);
});

test("toCents rounds the third decimal half-up", () => {
  assert.equal(toCents("1.005"), 101);
  assert.equal(toCents("1.0049"), 100);
});

test("toCents passes null/empty through and refuses junk", () => {
  assert.equal(toCents(null), null);
  assert.equal(toCents(""), null);
  assert.throws(() => toCents("abc"), TypeError);
  assert.throws(() => toCents("1e21"), TypeError);
});

test("toDecimalString writes numeric(12,2) column values", () => {
  assert.equal(toDecimalString(19900), "199.00");
  assert.equal(toDecimalString(5), "0.05");
  assert.equal(toDecimalString(-5), "-0.05");
});

test("formatCents formats USD", () => {
  assert.equal(formatCents(123456), "$1,234.56");
});

test("integer arithmetic refuses non-integer cents", () => {
  assert.equal(sumCents([]), 0);
  assert.equal(sumCents([100, 250]), 350);
  assert.equal(mulCents(1999, 3), 5997);
  assert.throws(() => mulCents(1.5, 2), TypeError);
  assert.throws(() => mulCents(100, 1.5), TypeError);
});

test("pctOfCents uses basis points and rounds half-up", () => {
  assert.equal(pctOfCents(1250, 800), 100);
  assert.equal(pctOfCents(1999, 800), 160); // 159.92
  assert.equal(pctOfCents(1, 5000), 1);     // 0.5 → 1
  assert.equal(pctOfCents(0, 800), 0);
});

test("round2 is the legacy dollar helper", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/lib/money.test.js`
Expected: FAIL — cannot resolve `./money.js`.

- [ ] **Step 4: Implement**

`apps/api/src/lib/money.js`:

```js
/**
 * Money. New code works in integer cents. `round2` is the dollar-float helper
 * the Seazona invoice paths still use; piece 3 of own-the-lab replaces those.
 */

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const AMOUNT = /^-?\d+(\.\d+)?$/;

/** Dollars (number, or a decimal string such as a Postgres numeric) → cents, half-up. */
export function toCents(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!AMOUNT.test(s)) throw new TypeError(`Not a money amount: ${value}`);
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const digits = (frac + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

export function assertCents(c, label = "amount") {
  if (!Number.isSafeInteger(c)) throw new TypeError(`${label} must be integer cents, got ${c}`);
  return c;
}

/** Cents → the string a numeric(12,2) column expects. */
export function toDecimalString(cents) {
  assertCents(cents);
  const a = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatCents(cents) {
  return USD.format(assertCents(cents) / 100);
}

export function sumCents(list) {
  return list.reduce((s, c) => s + assertCents(c), 0);
}

export function mulCents(cents, qty) {
  assertCents(cents);
  if (!Number.isSafeInteger(qty)) throw new TypeError(`qty must be an integer, got ${qty}`);
  return cents * qty;
}

/** A percentage given in basis points (800 = 8%), rounded half-up to the cent. */
export function pctOfCents(cents, rateBps) {
  assertCents(cents);
  assertCents(rateBps, "rateBps");
  const raw = cents * rateBps;
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(raw) + 5000) / 10000);
}
```

- [ ] **Step 5: Replace the three local `round2` copies**

In each of `apps/api/src/routes/payment.routes.js`, `apps/api/src/routes/invoice.routes.js`, `apps/api/src/lib/payment-summary.js`: delete the local `function round2(n) { ... }` (and its doc comment) and add the import beside the file's other imports:

```js
import { round2 } from "../lib/money.js";   // routes/*.js
import { round2 } from "./money.js";        // lib/payment-summary.js
```

- [ ] **Step 6: Run the suite**

Run: `cd apps/api && pnpm vitest run`
Expected: PASS, including the existing `payment-summary.test.js`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/money.js apps/api/src/lib/money.test.js apps/api/src/routes/payment.routes.js apps/api/src/routes/invoice.routes.js apps/api/src/lib/payment-summary.js
git commit -m "feat(money): integer-cents helpers; one round2 instead of three

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Catalog and client-price tables

**Files:**
- Create: `apps/api/src/db/schema/catalog.js`, `apps/api/src/db/schema/client-prices.js`, `apps/api/src/db/schema/catalog.test.js`
- Modify: `apps/api/src/db/schema/order-items.js`, `apps/api/src/db/schema/index.js`
- Generated: `apps/api/src/db/migrations/00NN_*.sql` + `meta/`

**Interfaces:**
- Produces (Drizzle tables): `productFamilies`, `productOptions`, `productOptionValues`, `productVariants`, `productVariantOptionValues`, `clientPrices`; `orderItems.variantId`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/schema/catalog.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  productFamilies, productOptions, productOptionValues, productVariants,
  productVariantOptionValues, clientPrices, orderItems,
} from "./index.js";

const has = (table, cols) => {
  const keys = Object.keys(table);
  for (const c of cols) assert.ok(keys.includes(c), `missing column: ${c}`);
};

test("catalog tables expose the columns the services depend on", () => {
  has(productFamilies, ["id", "slug", "name", "description", "category", "imageUrl", "channel", "active", "position"]);
  has(productOptions, ["id", "familyId", "name", "position"]);
  has(productOptionValues, ["id", "optionId", "value", "position"]);
  has(productVariants, ["id", "familyId", "code", "name", "basePriceCents", "taxable", "active", "catalogId", "legacySeazonaProductId"]);
  has(productVariantOptionValues, ["variantId", "optionValueId"]);
});

test("client prices are cents with a provenance", () => {
  has(clientPrices, ["id", "clientUserId", "variantId", "priceCents", "source", "reviewedAt", "reviewedBy", "note"]);
});

test("order items can point at a variant and no longer require a shop SKU", () => {
  has(orderItems, ["variantId", "catalogId"]);
  assert.equal(orderItems.catalogId.notNull, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/db/schema/catalog.test.js`
Expected: FAIL — `productFamilies` is undefined.

- [ ] **Step 3: Implement the tables**

`apps/api/src/db/schema/catalog.js`:

```js
import { pgTable, varchar, text, boolean, integer, timestamp, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

// Our own product catalog. Replaces the Seazona mirror in `products`, which
// stays read-only on this branch as the import source until cutover.
//
//   family  — what a doctor or shopper recognises ("Olmos Night")
//   option  — an axis on a family ("Design", "Material")
//   variant — the sellable SKU: one lab code, one base price. A family with
//             no options has exactly one variant.
//
// No DB foreign keys (repo convention); services/catalog.service.js holds
// integrity inside transactions.

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const productFamilies = pgTable("product_families", {
  id: varchar("id", { length: 128 }).primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  imageUrl: text("image_url"),
  // shop = sold online; rx = billed by the lab on cases; both
  channel: varchar("channel", { length: 10 }).notNull().default("shop"),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  ...stamps,
}, (t) => [uniqueIndex("product_families_slug_idx").on(t.slug)]);

export const productOptions = pgTable("product_options", {
  id: varchar("id", { length: 128 }).primaryKey(),
  familyId: varchar("family_id", { length: 128 }).notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_options_family_idx").on(t.familyId)]);

export const productOptionValues = pgTable("product_option_values", {
  id: varchar("id", { length: 128 }).primaryKey(),
  optionId: varchar("option_id", { length: 128 }).notNull(),
  value: varchar("value", { length: 120 }).notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_option_values_option_idx").on(t.optionId)]);

export const productVariants = pgTable("product_variants", {
  id: varchar("id", { length: 128 }).primaryKey(),
  familyId: varchar("family_id", { length: 128 }).notNull(),
  // The lab's product code ("2119"). Kept so invoice history and the
  // technicians' vocabulary carry over. Nullable for brand-new items.
  code: varchar("code", { length: 60 }),
  name: text("name").notNull(),
  // null = not priced yet → not sellable.
  basePriceCents: integer("base_price_cents"),
  taxable: boolean("taxable").notNull().default(false),
  active: boolean("active").notNull().default(true),
  // Legacy shop SKU id from data/catalog.js ("16").
  catalogId: varchar("catalog_id", { length: 100 }),
  // Retired in piece 5 with the rest of Seazona.
  legacySeazonaProductId: varchar("legacy_seazona_product_id", { length: 100 }),
  ...stamps,
}, (t) => [
  index("product_variants_family_idx").on(t.familyId),
  uniqueIndex("product_variants_code_idx").on(t.code),
  uniqueIndex("product_variants_catalog_id_idx").on(t.catalogId),
  uniqueIndex("product_variants_legacy_idx").on(t.legacySeazonaProductId),
]);

export const productVariantOptionValues = pgTable("product_variant_option_values", {
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  optionValueId: varchar("option_value_id", { length: 128 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.variantId, t.optionValueId] }),
  index("product_variant_option_values_value_idx").on(t.optionValueId),
]);
```

`apps/api/src/db/schema/client-prices.js`:

```js
import { pgTable, varchar, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// A client's negotiated price for one variant. The billing client is the user
// carrying the Seazona client link — the same key invoice_payments uses.
//   source: manual   — entered by staff
//           imported — from a Seazona price-list export
//           inferred — last price actually billed (filled by the piece-5
//                      migration); used, but flagged until reviewedAt is set
export const clientPrices = pgTable("client_prices", {
  id: varchar("id", { length: 128 }).primaryKey(),
  clientUserId: varchar("client_user_id", { length: 128 }).notNull(),
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  priceCents: integer("price_cents").notNull(),
  source: varchar("source", { length: 12 }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: varchar("reviewed_by", { length: 128 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("client_prices_client_variant_idx").on(t.clientUserId, t.variantId),
  index("client_prices_variant_idx").on(t.variantId),
]);
```

In `apps/api/src/db/schema/order-items.js`: change `catalogId` to drop `.notNull()`, add after it:

```js
  // The catalog variant sold (own-the-lab). Null on orders placed before it.
  variantId: varchar("variant_id", { length: 128 }),
```

and update the comment line "Always populated — checkout 422s earlier…" to: `// Legacy shop SKU id; null when the variant has none.`

Append to `apps/api/src/db/schema/index.js`:

```js
export {
  productFamilies, productOptions, productOptionValues, productVariants, productVariantOptionValues,
} from "./catalog.js";
export { clientPrices } from "./client-prices.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm vitest run src/db/schema/catalog.test.js`
Expected: PASS

- [ ] **Step 5: Generate and apply the migration, then check drift**

```bash
cd apps/api
pnpm db:generate     # writes one new migrations/00NN_*.sql
pnpm db:migrate      # applies to diamond_labs_own_the_lab
pnpm db:generate     # expect: "No schema changes"
```

Read the generated SQL: it must contain 6 `CREATE TABLE`s, `ALTER TABLE "order_items" ADD COLUMN "variant_id"`, `ALTER COLUMN "catalog_id" DROP NOT NULL`, and no `DROP` of anything else.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema apps/api/src/db/migrations
git commit -m "feat(catalog): families, options, variants and client prices tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The pricing rules

**Files:**
- Create: `apps/api/src/config/pricing.js`, `apps/api/src/lib/pricing.js`, `apps/api/src/lib/pricing.test.js`, `apps/api/src/services/pricing.service.js`

**Interfaces:**
- Consumes: `mulCents`, `pctOfCents`, `sumCents` (Task 1); tables (Task 2).
- Produces:
  - `PRICING = { taxRateBps: 800, shippingFlatCents: 1200, maxQty: 999 }`
  - `class PricingError extends Error { code: "EMPTY"|"BAD_QTY"|"QTY_LIMIT"|"UNAVAILABLE"|"UNPRICED"; variantId: string|null }`
  - `unitPriceFor(variant, clientPriceCents|undefined) → { cents, source: "client"|"base" } | null`
  - `priceLines({ lines:[{variantId, qty}], variants: Map<id, Variant>, clientPrices?: Map<id, cents>, config }) → Quote` where `Quote = { lines: [{ variantId, code, name, catalogId, legacySeazonaProductId, qty, unitCents, priceSource, lineCents, taxable }], subtotalCents, taxCents, shippingCents, totalCents }`. `Variant` needs `{ id, code, name, basePriceCents, taxable, active, catalogId, legacySeazonaProductId }` where `active` already folds in family active + channel.
  - service: `pricingClientFor(user) → userId|null`, `loadShopVariants(ids) → Map`, `loadClientPrices(clientUserId, ids) → Map`, `priceShopCart({ lines, clientUserId }) → Quote`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/lib/pricing.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { priceLines, unitPriceFor, PricingError } from "./pricing.js";

const config = { taxRateBps: 800, shippingFlatCents: 1200, maxQty: 999 };
const v = (id, over = {}) => ({
  id, code: `C${id}`, name: `Item ${id}`, basePriceCents: 1000, taxable: false,
  active: true, catalogId: null, legacySeazonaProductId: null, ...over,
});
const variants = new Map([
  ["a", v("a", { basePriceCents: 2000, taxable: true })],
  ["b", v("b", { basePriceCents: 500 })],
  ["off", v("off", { active: false })],
  ["nop", v("nop", { basePriceCents: null })],
]);
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof PricingError); return e.code; } assert.fail("expected PricingError"); };

test("a client's negotiated price wins over base", () => {
  assert.deepEqual(unitPriceFor(variants.get("a"), 1500), { cents: 1500, source: "client" });
  assert.deepEqual(unitPriceFor(variants.get("a"), undefined), { cents: 2000, source: "base" });
});

test("a negotiated $0.00 is a real price, not a missing one", () => {
  assert.deepEqual(unitPriceFor(variants.get("a"), 0), { cents: 0, source: "client" });
});

test("guests pay base; tax applies only to taxable lines; flat shipping", () => {
  const q = priceLines({ lines: [{ variantId: "a", qty: 1 }, { variantId: "b", qty: 2 }], variants, config });
  assert.equal(q.subtotalCents, 3000);
  assert.equal(q.taxCents, 160);          // 8% of the 2000 taxable line only
  assert.equal(q.shippingCents, 1200);
  assert.equal(q.totalCents, 4360);
  assert.equal(q.lines[0].priceSource, "base");
});

test("client prices flow into the totals", () => {
  const q = priceLines({ lines: [{ variantId: "a", qty: 1 }], variants, clientPrices: new Map([["a", 1500]]), config });
  assert.equal(q.lines[0].unitCents, 1500);
  assert.equal(q.lines[0].priceSource, "client");
  assert.equal(q.taxCents, 120);
});

test("an all-free cart charges no shipping", () => {
  const q = priceLines({ lines: [{ variantId: "a", qty: 1 }], variants, clientPrices: new Map([["a", 0]]), config });
  assert.equal(q.subtotalCents, 0);
  assert.equal(q.shippingCents, 0);
  assert.equal(q.totalCents, 0);
});

test("the same variant on two lines is merged before the quantity cap", () => {
  const q = priceLines({ lines: [{ variantId: "b", qty: 2 }, { variantId: "b", qty: 3 }], variants, config });
  assert.equal(q.lines.length, 1);
  assert.equal(q.lines[0].qty, 5);
  assert.equal(code(() => priceLines({ lines: [{ variantId: "b", qty: 600 }, { variantId: "b", qty: 600 }], variants, config })), "QTY_LIMIT");
});

test("unknown, inactive and unpriced variants are refused, never guessed", () => {
  assert.equal(code(() => priceLines({ lines: [{ variantId: "zzz", qty: 1 }], variants, config })), "UNAVAILABLE");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "off", qty: 1 }], variants, config })), "UNAVAILABLE");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "nop", qty: 1 }], variants, config })), "UNPRICED");
});

test("bad quantities and empty carts are refused", () => {
  assert.equal(code(() => priceLines({ lines: [], variants, config })), "EMPTY");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "a", qty: 0 }], variants, config })), "BAD_QTY");
  assert.equal(code(() => priceLines({ lines: [{ variantId: "a", qty: 1.5 }], variants, config })), "BAD_QTY");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/lib/pricing.test.js`
Expected: FAIL — cannot resolve `./pricing.js`.

- [ ] **Step 3: Implement**

`apps/api/src/config/pricing.js`:

```js
// Shop pricing knobs, carried over unchanged from payment.routes.js
// (TAX_RATE 0.08 on taxable lines, SHIPPING_FLAT $12, MAX_QTY 999).
export const PRICING = Object.freeze({
  taxRateBps: 800,
  shippingFlatCents: 1200,
  maxQty: 999,
});
```

`apps/api/src/lib/pricing.js`:

```js
import { mulCents, pctOfCents, sumCents } from "./money.js";

// The one place a price is decided. Pure: callers load variants and client
// prices (services/pricing.service.js) and pass them in.

export class PricingError extends Error {
  constructor(code, message, variantId = null) {
    super(message);
    this.code = code;
    this.variantId = variantId;
  }
}

/** A client's negotiated price wins over base. null = nothing to charge from. */
export function unitPriceFor(variant, clientPriceCents) {
  if (clientPriceCents != null) return { cents: clientPriceCents, source: "client" };
  if (variant.basePriceCents == null) return null;
  return { cents: variant.basePriceCents, source: "base" };
}

export function priceLines({ lines, variants, clientPrices = new Map(), config }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PricingError("EMPTY", "There is nothing to price.");
  }
  // Merge repeats so the quantity cap can't be dodged by splitting a line.
  const merged = new Map();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new PricingError("BAD_QTY", "Each item needs a whole-number quantity.", l.variantId);
    }
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
  }

  const out = [];
  for (const [variantId, qty] of merged) {
    if (qty > config.maxQty) {
      throw new PricingError(
        "QTY_LIMIT",
        `Quantity exceeds the maximum of ${config.maxQty} per order. Contact the lab for bulk orders.`,
        variantId,
      );
    }
    const variant = variants.get(variantId);
    if (!variant || !variant.active) {
      throw new PricingError("UNAVAILABLE", "Item not available for online order. Contact the lab to place this order.", variantId);
    }
    const price = unitPriceFor(variant, clientPrices.get(variantId));
    if (!price) {
      throw new PricingError("UNPRICED", "Item has no price yet. Contact the lab to place this order.", variantId);
    }
    out.push({
      variantId,
      code: variant.code ?? null,
      name: variant.name,
      catalogId: variant.catalogId ?? null,
      legacySeazonaProductId: variant.legacySeazonaProductId ?? null,
      qty,
      unitCents: price.cents,
      priceSource: price.source,
      lineCents: mulCents(price.cents, qty),
      taxable: Boolean(variant.taxable),
    });
  }

  const subtotalCents = sumCents(out.map((l) => l.lineCents));
  const taxCents = pctOfCents(sumCents(out.filter((l) => l.taxable).map((l) => l.lineCents)), config.taxRateBps);
  const shippingCents = subtotalCents > 0 ? config.shippingFlatCents : 0;
  return { lines: out, subtotalCents, taxCents, shippingCents, totalCents: subtotalCents + taxCents + shippingCents };
}
```

`apps/api/src/services/pricing.service.js`:

```js
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { productVariants, productFamilies, clientPrices } from "../db/schema/index.js";
import { priceLines } from "../lib/pricing.js";
import { PRICING } from "../config/pricing.js";

/** Whose negotiated prices apply to a request — null means guest pricing. */
export function pricingClientFor(user) {
  if (!user || user.role !== "doctor" || user.approvalStatus !== "approved") return null;
  return user.id;
}

/** Variants by id, with `active` folding in the family's active flag and shop channel. */
export async function loadShopVariants(variantIds) {
  if (variantIds.length === 0) return new Map();
  const rows = await db
    .select({ v: productVariants, f: productFamilies })
    .from(productVariants)
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(inArray(productVariants.id, variantIds));
  return new Map(rows.map(({ v, f }) => [v.id, { ...v, active: v.active && f.active && f.channel !== "rx" }]));
}

export async function loadClientPrices(clientUserId, variantIds) {
  if (!clientUserId || variantIds.length === 0) return new Map();
  const rows = await db
    .select({ variantId: clientPrices.variantId, priceCents: clientPrices.priceCents })
    .from(clientPrices)
    .where(and(eq(clientPrices.clientUserId, clientUserId), inArray(clientPrices.variantId, variantIds)));
  return new Map(rows.map((r) => [r.variantId, r.priceCents]));
}

export async function priceShopCart({ lines, clientUserId = null }) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const [variants, prices] = await Promise.all([loadShopVariants(ids), loadClientPrices(clientUserId, ids)]);
  return priceLines({ lines, variants, clientPrices: prices, config: PRICING });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm vitest run src/lib/pricing.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/pricing.js apps/api/src/lib/pricing.js apps/api/src/lib/pricing.test.js apps/api/src/services/pricing.service.js
git commit -m "feat(pricing): one integer-cents price rule; client price wins over base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Variant-grid rules and the catalog service

**Files:**
- Create: `apps/api/src/lib/catalog-variants.js`, `apps/api/src/lib/catalog-variants.test.js`, `apps/api/src/services/catalog.service.js`

**Interfaces:**
- Consumes: tables (Task 2); `unitPriceFor` (Task 3); `createId`.
- Produces (pure, `lib/catalog-variants.js`):
  - `combinations(options:[{id, values:[{id}]}]) → string[][]`
  - `comboKey(ids) → string`
  - `missingCombinations(options, variants:[{optionValueIds}]) → string[][]`
  - `validateCombination(options, optionValueIds) → { ok: true } | { ok: false, reason }`
  - `findDuplicateCombination(variants:[{id, optionValueIds}], optionValueIds, exceptVariantId?) → variant|null`
  - `shapeFamily({ family, options, values, variants, links }) → ShapedFamily` = family columns + `options:[{id,name,position,values:[{id,value,position}]}]` + `variants:[...variant columns, optionValueIds:string[]]`
  - `presentShopFamily(shaped, clientPrices: Map) → PublicFamily|null` = `{ id, slug, name, description, category, imageUrl, options, variants:[{ id, code, name, optionValueIds, priceCents, priceSource, taxable }] }`; only active variants with a price; `null` when none remain.
- Produces (DB, `services/catalog.service.js`):
  - `class CatalogError extends Error { code: "NOT_FOUND"|"CONFLICT"|"INVALID" }`
  - `listFamilies({ shopOnly?: boolean }) → ShapedFamily[]`
  - `getFamily(id) → ShapedFamily` (throws NOT_FOUND)
  - `insertPlannedFamily(tx, planned) → familyId` where `planned = { slug, name, channel, category, description, imageUrl, options:[{name, values:string[]}], variants:[{ code, name, basePriceCents, taxable, active, catalogId, legacySeazonaProductId, values:{[optionName]: value} }] }`
  - `createFamily(input) → ShapedFamily`, `updateFamily(id, patch) → ShapedFamily`
  - `addOption(familyId, { name, values }) → ShapedFamily`, `addOptionValue(optionId, value) → ShapedFamily`
  - `updateVariant(id, patch) → ShapedFamily`
  - `mergeSingleVariantFamily({ targetFamilyId, sourceFamilyId, optionValueIds }) → ShapedFamily`
  - `variantByCode(code) → variant|null`

- [ ] **Step 1: Write the failing test**

`apps/api/src/lib/catalog-variants.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  combinations, missingCombinations, validateCombination,
  findDuplicateCombination, shapeFamily, presentShopFamily,
} from "./catalog-variants.js";

const design = { id: "d", values: [{ id: "d1" }, { id: "d2" }] };
const material = { id: "m", values: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] };

test("combinations is the cartesian product, one value per option", () => {
  assert.deepEqual(combinations([]), [[]]);
  assert.equal(combinations([design, material]).length, 6);
  assert.deepEqual(combinations([design]), [["d1"], ["d2"]]);
  assert.deepEqual(combinations([{ id: "x", values: [] }]), []);
});

test("missingCombinations ignores value order", () => {
  const have = [{ optionValueIds: ["m1", "d1"] }];
  const missing = missingCombinations([design, material], have);
  assert.equal(missing.length, 5);
  assert.ok(!missing.some((c) => c.includes("d1") && c.includes("m1")));
});

test("a variant picks exactly one value from every option", () => {
  assert.deepEqual(validateCombination([design, material], ["d1", "m2"]), { ok: true });
  assert.equal(validateCombination([design, material], ["d1"]).ok, false);
  assert.equal(validateCombination([design, material], ["d1", "d2"]).ok, false);
  assert.equal(validateCombination([design, material], ["d1", "zz"]).ok, false);
  assert.deepEqual(validateCombination([], []), { ok: true });
});

test("duplicate combinations are found, except against the variant itself", () => {
  const variants = [{ id: "v1", optionValueIds: ["d1", "m1"] }];
  assert.equal(findDuplicateCombination(variants, ["m1", "d1"])?.id, "v1");
  assert.equal(findDuplicateCombination(variants, ["m1", "d1"], "v1"), null);
});

const shaped = shapeFamily({
  family: { id: "f", slug: "f", name: "Fam", description: null, category: null, imageUrl: null, channel: "shop", active: true, position: 0 },
  options: [{ id: "m", familyId: "f", name: "Material", position: 0 }],
  values: [{ id: "m2", optionId: "m", value: "PMT", position: 1 }, { id: "m1", optionId: "m", value: "Nylon", position: 0 }],
  variants: [
    { id: "v1", familyId: "f", code: "1", name: "Fam Nylon", basePriceCents: 1000, taxable: false, active: true },
    { id: "v2", familyId: "f", code: "2", name: "Fam PMT", basePriceCents: null, taxable: false, active: true },
    { id: "v3", familyId: "f", code: "3", name: "Fam Old", basePriceCents: 900, taxable: false, active: false },
  ],
  links: [{ variantId: "v1", optionValueId: "m1" }, { variantId: "v2", optionValueId: "m2" }],
});

test("shapeFamily nests values in position order and attaches each variant's values", () => {
  assert.deepEqual(shaped.options[0].values.map((v) => v.value), ["Nylon", "PMT"]);
  assert.deepEqual(shaped.variants.find((v) => v.id === "v1").optionValueIds, ["m1"]);
  assert.deepEqual(shaped.variants.find((v) => v.id === "v3").optionValueIds, []);
});

test("the shop sees only active, priced variants — with the client's price", () => {
  const pub = presentShopFamily(shaped, new Map([["v1", 800]]));
  assert.deepEqual(pub.variants.map((v) => v.id), ["v1"]);
  assert.equal(pub.variants[0].priceCents, 800);
  assert.equal(pub.variants[0].priceSource, "client");
});

test("a family with nothing sellable is hidden", () => {
  const empty = { ...shaped, variants: shaped.variants.filter((v) => v.id !== "v1") };
  assert.equal(presentShopFamily(empty, new Map()), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/lib/catalog-variants.test.js`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the pure rules**

`apps/api/src/lib/catalog-variants.js`:

```js
import { unitPriceFor } from "./pricing.js";

// Variant-grid rules. Pure — services/catalog.service.js does the DB work.

/** Every way to pick one value from each option, in option order. */
export function combinations(options) {
  return options.reduce(
    (acc, opt) => acc.flatMap((prefix) => opt.values.map((v) => [...prefix, v.id])),
    [[]],
  );
}

export const comboKey = (ids) => [...ids].sort().join("|");

export function missingCombinations(options, variants) {
  const have = new Set(variants.map((v) => comboKey(v.optionValueIds)));
  return combinations(options).filter((c) => !have.has(comboKey(c)));
}

export function validateCombination(options, optionValueIds) {
  const optionOf = new Map();
  for (const o of options) for (const v of o.values) optionOf.set(v.id, o.id);
  const seen = new Set();
  for (const id of optionValueIds) {
    const o = optionOf.get(id);
    if (!o) return { ok: false, reason: `Unknown option value ${id}.` };
    if (seen.has(o)) return { ok: false, reason: "Two values were picked for the same option." };
    seen.add(o);
  }
  if (seen.size !== options.length) return { ok: false, reason: "Every option needs a value." };
  return { ok: true };
}

export function findDuplicateCombination(variants, optionValueIds, exceptVariantId = null) {
  const key = comboKey(optionValueIds);
  return variants.find((v) => v.id !== exceptVariantId && comboKey(v.optionValueIds) === key) ?? null;
}

const byPosition = (a, b) => a.position - b.position;

export function shapeFamily({ family, options, values, variants, links }) {
  const valuesByOption = new Map();
  for (const v of [...values].sort(byPosition)) {
    if (!valuesByOption.has(v.optionId)) valuesByOption.set(v.optionId, []);
    valuesByOption.get(v.optionId).push({ id: v.id, value: v.value, position: v.position });
  }
  const valueIdsByVariant = new Map();
  for (const l of links) {
    if (!valueIdsByVariant.has(l.variantId)) valueIdsByVariant.set(l.variantId, []);
    valueIdsByVariant.get(l.variantId).push(l.optionValueId);
  }
  return {
    ...family,
    options: [...options].sort(byPosition).map((o) => ({
      id: o.id, name: o.name, position: o.position, values: valuesByOption.get(o.id) ?? [],
    })),
    variants: variants.map((v) => ({ ...v, optionValueIds: valueIdsByVariant.get(v.id) ?? [] })),
  };
}

/** What the public shop may see of a family. null = nothing sellable. */
export function presentShopFamily(shaped, clientPrices) {
  const variants = [];
  for (const v of shaped.variants) {
    if (!v.active) continue;
    const price = unitPriceFor(v, clientPrices.get(v.id));
    if (!price) continue;
    variants.push({
      id: v.id, code: v.code, name: v.name, optionValueIds: v.optionValueIds,
      priceCents: price.cents, priceSource: price.source, taxable: v.taxable,
    });
  }
  if (variants.length === 0) return null;
  const { id, slug, name, description, category, imageUrl, options } = shaped;
  return { id, slug, name, description, category, imageUrl, options, variants };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm vitest run src/lib/catalog-variants.test.js`
Expected: PASS

- [ ] **Step 5: Implement the catalog service**

`apps/api/src/services/catalog.service.js`:

```js
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../config/database.js";
import {
  productFamilies, productOptions, productOptionValues, productVariants, productVariantOptionValues,
} from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import {
  shapeFamily, missingCombinations, validateCombination, findDuplicateCombination,
} from "../lib/catalog-variants.js";

export class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // NOT_FOUND | CONFLICT | INVALID
  }
}

const UNIQUE_VIOLATION = "23505";
function rethrowConflict(err, what) {
  if (err?.code === UNIQUE_VIOLATION) throw new CatalogError("CONFLICT", `${what} is already used by another product.`);
  throw err;
}

async function loadShaped(familyRows, conn = db) {
  if (familyRows.length === 0) return [];
  const familyIds = familyRows.map((f) => f.id);
  const options = await conn.select().from(productOptions).where(inArray(productOptions.familyId, familyIds));
  const optionIds = options.map((o) => o.id);
  const values = optionIds.length
    ? await conn.select().from(productOptionValues).where(inArray(productOptionValues.optionId, optionIds))
    : [];
  const variants = await conn.select().from(productVariants)
    .where(inArray(productVariants.familyId, familyIds)).orderBy(asc(productVariants.name));
  const variantIds = variants.map((v) => v.id);
  const links = variantIds.length
    ? await conn.select().from(productVariantOptionValues).where(inArray(productVariantOptionValues.variantId, variantIds))
    : [];
  return familyRows.map((family) => {
    const opts = options.filter((o) => o.familyId === family.id);
    const optIds = new Set(opts.map((o) => o.id));
    const vars = variants.filter((v) => v.familyId === family.id);
    const varIds = new Set(vars.map((v) => v.id));
    return shapeFamily({
      family,
      options: opts,
      values: values.filter((v) => optIds.has(v.optionId)),
      variants: vars,
      links: links.filter((l) => varIds.has(l.variantId)),
    });
  });
}

export async function listFamilies({ shopOnly = false } = {}) {
  const where = shopOnly
    ? and(eq(productFamilies.active, true), ne(productFamilies.channel, "rx"))
    : undefined;
  const rows = await db.select().from(productFamilies).where(where)
    .orderBy(asc(productFamilies.position), asc(productFamilies.name));
  return loadShaped(rows);
}

export async function getFamily(id, conn = db) {
  const rows = await conn.select().from(productFamilies).where(eq(productFamilies.id, id));
  if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Product family not found.");
  return (await loadShaped(rows, conn))[0];
}

/**
 * Insert a whole family from a plan. Shared by the admin "new family" action
 * and db/import-catalog.js so there is one way a family gets built.
 */
export async function insertPlannedFamily(tx, planned) {
  const familyId = createId();
  await tx.insert(productFamilies).values({
    id: familyId, slug: planned.slug, name: planned.name, channel: planned.channel,
    category: planned.category ?? null, description: planned.description ?? null, imageUrl: planned.imageUrl ?? null,
  });
  const valueIdByOptionAndValue = new Map();
  for (const [i, opt] of planned.options.entries()) {
    const optionId = createId();
    await tx.insert(productOptions).values({ id: optionId, familyId, name: opt.name, position: i });
    for (const [j, value] of opt.values.entries()) {
      const valueId = createId();
      await tx.insert(productOptionValues).values({ id: valueId, optionId, value, position: j });
      valueIdByOptionAndValue.set(`${opt.name}\u0000${value}`, valueId);
    }
  }
  for (const pv of planned.variants) {
    const variantId = createId();
    await tx.insert(productVariants).values({
      id: variantId, familyId, code: pv.code ?? null, name: pv.name,
      basePriceCents: pv.basePriceCents ?? null, taxable: Boolean(pv.taxable), active: pv.active !== false,
      catalogId: pv.catalogId ?? null, legacySeazonaProductId: pv.legacySeazonaProductId ?? null,
    });
    for (const opt of planned.options) {
      const valueId = valueIdByOptionAndValue.get(`${opt.name}\u0000${pv.values?.[opt.name]}`);
      if (!valueId) throw new CatalogError("INVALID", `Variant ${pv.name} has no ${opt.name}.`);
      await tx.insert(productVariantOptionValues).values({ variantId, optionValueId: valueId });
    }
  }
  return familyId;
}

/** A new family starts with one unpriced, inactive variant to fill in. */
export async function createFamily(input) {
  try {
    const id = await db.transaction((tx) => insertPlannedFamily(tx, {
      ...input, options: [],
      variants: [{ name: input.name, basePriceCents: null, taxable: false, active: false, values: {} }],
    }));
    return getFamily(id);
  } catch (err) { rethrowConflict(err, "That slug"); }
}

export async function updateFamily(id, patch) {
  await getFamily(id);
  try {
    await db.update(productFamilies).set({ ...patch, updatedAt: new Date() }).where(eq(productFamilies.id, id));
  } catch (err) { rethrowConflict(err, "That slug"); }
  return getFamily(id);
}

/**
 * Add an axis. Existing variants take the axis's first value, then every
 * missing combination is created inactive and unpriced, so adding an option
 * never makes anything buyable by accident.
 */
export async function addOption(familyId, { name, values }) {
  return db.transaction(async (tx) => {
    const family = await getFamily(familyId, tx);
    if (family.options.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
      throw new CatalogError("CONFLICT", `This family already has an option called ${name}.`);
    }
    const optionId = createId();
    await tx.insert(productOptions).values({ id: optionId, familyId, name, position: family.options.length });
    const valueIds = [];
    for (const [i, value] of values.entries()) {
      const id = createId();
      valueIds.push(id);
      await tx.insert(productOptionValues).values({ id, optionId, value, position: i });
    }
    for (const v of family.variants) {
      await tx.insert(productVariantOptionValues).values({ variantId: v.id, optionValueId: valueIds[0] });
    }
    await fillMissingCombinations(tx, familyId);
    return getFamily(familyId, tx);
  });
}

export async function addOptionValue(optionId, value) {
  return db.transaction(async (tx) => {
    const [option] = await tx.select().from(productOptions).where(eq(productOptions.id, optionId));
    if (!option) throw new CatalogError("NOT_FOUND", "Option not found.");
    const existing = await tx.select().from(productOptionValues).where(eq(productOptionValues.optionId, optionId));
    if (existing.some((v) => v.value.toLowerCase() === value.toLowerCase())) {
      throw new CatalogError("CONFLICT", `${option.name} already has ${value}.`);
    }
    await tx.insert(productOptionValues).values({ id: createId(), optionId, value, position: existing.length });
    await fillMissingCombinations(tx, option.familyId);
    return getFamily(option.familyId, tx);
  });
}

async function fillMissingCombinations(tx, familyId) {
  const family = await getFamily(familyId, tx);
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  for (const combo of missingCombinations(family.options, family.variants)) {
    const variantId = createId();
    await tx.insert(productVariants).values({
      id: variantId, familyId, name: [family.name, ...combo.map((id) => labelOf.get(id))].join(" "),
      basePriceCents: null, taxable: false, active: false,
    });
    for (const optionValueId of combo) {
      await tx.insert(productVariantOptionValues).values({ variantId, optionValueId });
    }
  }
}

export async function updateVariant(id, patch) {
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, id));
  if (!variant) throw new CatalogError("NOT_FOUND", "Variant not found.");
  try {
    await db.update(productVariants).set({ ...patch, updatedAt: new Date() }).where(eq(productVariants.id, id));
  } catch (err) { rethrowConflict(err, "That code or shop SKU"); }
  return getFamily(variant.familyId);
}

/**
 * Fold a one-variant family into another family as a specific combination —
 * how "Mute Small", "Mute Medium", "Mute Large" become one product with a
 * Size option. The source family is deleted.
 */
export async function mergeSingleVariantFamily({ targetFamilyId, sourceFamilyId, optionValueIds }) {
  if (targetFamilyId === sourceFamilyId) throw new CatalogError("INVALID", "A family cannot be merged into itself.");
  return db.transaction(async (tx) => {
    const target = await getFamily(targetFamilyId, tx);
    const source = await getFamily(sourceFamilyId, tx);
    if (source.variants.length !== 1 || source.options.length !== 0) {
      throw new CatalogError("INVALID", "Only a family with a single variant and no options can be merged.");
    }
    const check = validateCombination(target.options, optionValueIds);
    if (!check.ok) throw new CatalogError("INVALID", check.reason);
    const clash = findDuplicateCombination(target.variants, optionValueIds);
    // An inactive, unpriced placeholder created by the grid can be replaced.
    if (clash && (clash.active || clash.basePriceCents != null)) {
      throw new CatalogError("CONFLICT", `That combination is already ${clash.name}.`);
    }
    if (clash) {
      await tx.delete(productVariantOptionValues).where(eq(productVariantOptionValues.variantId, clash.id));
      await tx.delete(productVariants).where(eq(productVariants.id, clash.id));
    }
    const moving = source.variants[0];
    await tx.update(productVariants).set({ familyId: targetFamilyId, updatedAt: new Date() })
      .where(eq(productVariants.id, moving.id));
    for (const optionValueId of optionValueIds) {
      await tx.insert(productVariantOptionValues).values({ variantId: moving.id, optionValueId });
    }
    await tx.delete(productFamilies).where(eq(productFamilies.id, sourceFamilyId));
    return getFamily(targetFamilyId, tx);
  });
}

export async function variantByCode(code) {
  if (!code) return null;
  const [row] = await db.select().from(productVariants).where(eq(productVariants.code, String(code)));
  return row ?? null;
}
```

- [ ] **Step 6: Syntax-check and run the suite**

Run: `cd apps/api && node --check src/services/catalog.service.js && pnpm vitest run`
Expected: no output from `node --check`; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/catalog-variants.js apps/api/src/lib/catalog-variants.test.js apps/api/src/services/catalog.service.js
git commit -m "feat(catalog): variant-grid rules and catalog service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shared Zod schemas (catalog + cart lines)

**Files:**
- Create: `packages/shared/src/schemas/catalog.schema.js`, `apps/api/src/routes/__tests__/catalog.schema.test.js`
- Modify: `packages/shared/src/index.js`, `packages/shared/src/schemas/payment.schema.js:104-115`, `apps/api/src/routes/__tests__/payment.schema.test.js` (checkout fixtures)

**Interfaces:**
- Produces: `CATALOG_CHANNELS`, `familyCreateSchema`, `familyUpdateSchema`, `optionCreateSchema`, `optionValueCreateSchema`, `variantUpdateSchema`, `familyMergeSchema`, `clientPriceUpsertSchema`, `clientPriceReviewSchema`, `cartLinesSchema`, `catalogQuoteSchema`. `checkoutSchema.items` becomes `cartLinesSchema` (`[{ variantId, qty }]`).

- [ ] **Step 1: Write the failing test**

`apps/api/src/routes/__tests__/catalog.schema.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  familyCreateSchema, familyUpdateSchema, optionCreateSchema, variantUpdateSchema,
  clientPriceUpsertSchema, cartLinesSchema, checkoutSchema,
} from "@my-app/shared";

test("a family needs a name and a url-safe slug", () => {
  assert.equal(familyCreateSchema.safeParse({ name: "Mute", slug: "mute" }).success, true);
  assert.equal(familyCreateSchema.safeParse({ name: "Mute", slug: "Mute Guard" }).success, false);
  assert.equal(familyCreateSchema.parse({ name: "Mute", slug: "mute" }).channel, "shop");
});

test("an update must change something", () => {
  assert.equal(familyUpdateSchema.safeParse({}).success, false);
  assert.equal(familyUpdateSchema.safeParse({ active: false }).success, true);
});

test("option values are unique, case-insensitively", () => {
  assert.equal(optionCreateSchema.safeParse({ name: "Size", values: ["S", "M"] }).success, true);
  assert.equal(optionCreateSchema.safeParse({ name: "Size", values: ["S", "s"] }).success, false);
  assert.equal(optionCreateSchema.safeParse({ name: "Size", values: [] }).success, false);
});

test("prices are whole cents, zero allowed, never negative", () => {
  assert.equal(variantUpdateSchema.safeParse({ basePriceCents: 1999 }).success, true);
  assert.equal(variantUpdateSchema.safeParse({ basePriceCents: 19.99 }).success, false);
  assert.equal(variantUpdateSchema.safeParse({ basePriceCents: null }).success, true);
  assert.equal(clientPriceUpsertSchema.safeParse({ priceCents: 0 }).success, true);
  assert.equal(clientPriceUpsertSchema.safeParse({ priceCents: -1 }).success, false);
});

test("cart lines name a variant and a positive whole quantity", () => {
  assert.equal(cartLinesSchema.safeParse([{ variantId: "v1", qty: "2" }]).success, true);
  assert.equal(cartLinesSchema.safeParse([{ id: "16", qty: 1 }]).success, false);
  assert.equal(cartLinesSchema.safeParse([]).success, false);
});

test("checkout items are cart lines", () => {
  const base = {
    opaqueData: { dataDescriptor: "d", dataValue: "v" },
    email: "a@b.co",
    shipping: { name: "A", address1: "1 St", city: "C", state: "TX", postalCode: "75001" },
  };
  assert.equal(checkoutSchema.safeParse({ ...base, items: [{ variantId: "v1", qty: 1 }] }).success, true);
  assert.equal(checkoutSchema.safeParse({ ...base, items: [{ id: "16", qty: 1 }] }).success, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/catalog.schema.test.js`
Expected: FAIL — `familyCreateSchema` is undefined.

- [ ] **Step 3: Implement**

`packages/shared/src/schemas/catalog.schema.js`:

```js
import { z } from "zod";

export const CATALOG_CHANNELS = ["shop", "rx", "both"];

const cents = z.number().int().min(0).max(10_000_000);
const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes only.");
const nonEmpty = (o) => Object.keys(o).length > 0;

export const familyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug,
  category: z.string().trim().max(100).nullish(),
  description: z.string().max(5000).nullish(),
  imageUrl: z.string().trim().max(2000).nullish(),
  channel: z.enum(CATALOG_CHANNELS).default("shop"),
});

export const familyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: slug.optional(),
  category: z.string().trim().max(100).nullish(),
  description: z.string().max(5000).nullish(),
  imageUrl: z.string().trim().max(2000).nullish(),
  channel: z.enum(CATALOG_CHANNELS).optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
}).refine(nonEmpty, "Nothing to update.");

export const optionCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  values: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
}).refine((o) => new Set(o.values.map((v) => v.toLowerCase())).size === o.values.length, {
  message: "Option values must be unique.", path: ["values"],
});

export const optionValueCreateSchema = z.object({ value: z.string().trim().min(1).max(120) });

export const variantUpdateSchema = z.object({
  code: z.string().trim().min(1).max(60).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  basePriceCents: cents.nullable().optional(),
  taxable: z.boolean().optional(),
  active: z.boolean().optional(),
  catalogId: z.string().trim().min(1).max(100).nullable().optional(),
}).refine(nonEmpty, "Nothing to update.");

export const familyMergeSchema = z.object({
  sourceFamilyId: z.string().min(1).max(128),
  optionValueIds: z.array(z.string().min(1).max(128)).max(10),
});

export const clientPriceUpsertSchema = z.object({
  priceCents: cents,
  note: z.string().max(500).nullish(),
});

export const clientPriceReviewSchema = z.object({
  variantIds: z.array(z.string().min(1).max(128)).min(1).max(1000),
});

export const cartLinesSchema = z.array(z.object({
  variantId: z.string().min(1).max(128),
  qty: z.coerce.number().int().positive(),
})).min(1).max(100);

export const catalogQuoteSchema = z.object({ items: cartLinesSchema });
```

In `packages/shared/src/index.js`, under `// Schemas` add:

```js
export * from "./schemas/catalog.schema.js";
```

In `packages/shared/src/schemas/payment.schema.js`, add `import { cartLinesSchema } from "./catalog.schema.js";` at the top and replace the whole `items: z.array(...).min(1),` block inside `checkoutSchema` with:

```js
    items: cartLinesSchema,
```

- [ ] **Step 4: Update the existing checkout fixtures**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/payment.schema.test.js`
Any checkout fixture using `{ id: ..., qty: ... }` now fails. In that file, change each checkout item to `{ variantId: "<same id as a string>", qty: <same qty> }`. Do not change assertions about other schemas.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src apps/api/src/routes/__tests__/catalog.schema.test.js apps/api/src/routes/__tests__/payment.schema.test.js
git commit -m "feat(shared): catalog schemas; checkout items are variant cart lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Optional authentication

**Files:**
- Modify: `apps/api/src/middleware/authenticate.js`
- Create: `apps/api/src/middleware/authenticate.test.js`

**Interfaces:**
- Produces: `authenticate(request, reply)` (unchanged behaviour), `optionalAuthenticate(request, reply)` — no `Authorization` header → continues as guest (`request.user` stays undefined); a header that fails → 401 with the same error `authenticate` would send.

- [ ] **Step 1: Write the failing test**

`apps/api/src/middleware/authenticate.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { optionalAuthenticate } from "./authenticate.js";

function fakeReply() {
  return {
    statusCode: null, body: null,
    code(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
  };
}

test("no token: continue as a guest", async () => {
  const request = { headers: {} };
  const reply = fakeReply();
  await optionalAuthenticate(request, reply);
  assert.equal(request.user, undefined);
  assert.equal(reply.statusCode, null);
});

test("a presented but invalid token is refused, not downgraded to guest pricing", async () => {
  // Downgrading would quietly charge an approved doctor the base price.
  const request = { headers: { authorization: "Bearer not-a-real-token" } };
  const reply = fakeReply();
  await optionalAuthenticate(request, reply);
  assert.equal(reply.statusCode, 401);
  assert.equal(request.user, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/middleware/authenticate.test.js`
Expected: FAIL — `optionalAuthenticate` is not exported.

- [ ] **Step 3: Implement**

Replace the body of `apps/api/src/middleware/authenticate.js` below the imports with:

```js
/**
 * Resolve the bearer token to an active user.
 * → { user } on success; { user: null, presented: false } when no token was
 *   sent; { user: null, presented: true, error } when one was sent and failed.
 */
async function resolveBearerUser(request) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, presented: false, error: ERROR_CODES.UNAUTHORIZED };
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        status: users.status,
        role: users.role,
        approvalStatus: users.approvalStatus,
        seazonaClientId: users.seazonaClientId,
        seazonaAccountNumber: users.seazonaAccountNumber,
        authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
        defaultPaymentProfileId: users.defaultPaymentProfileId,
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user || user.status !== "active") {
      return { user: null, presented: true, error: ERROR_CODES.UNAUTHORIZED };
    }
    return { user, presented: true };
  } catch {
    return { user: null, presented: true, error: ERROR_CODES.TOKEN_EXPIRED };
  }
}

export async function authenticate(request, reply) {
  const r = await resolveBearerUser(request);
  if (!r.user) return reply.code(401).send({ error: r.error });
  request.user = r.user;
}

/**
 * For public routes whose answer depends on who is asking (client pricing).
 * No token → guest. A token that fails → 401, so the client refreshes and
 * retries instead of being quietly priced as a guest.
 */
export async function optionalAuthenticate(request, reply) {
  const r = await resolveBearerUser(request);
  if (r.user) {
    request.user = r.user;
    return;
  }
  if (r.presented) return reply.code(401).send({ error: r.error });
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && pnpm vitest run src/middleware/authenticate.test.js src/routes/__tests__/auth-security.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/authenticate.js apps/api/src/middleware/authenticate.test.js
git commit -m "feat(auth): optionalAuthenticate for public routes priced per client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Public catalog and quote routes

**Files:**
- Create: `apps/api/src/routes/catalog.routes.js`, `apps/api/src/routes/__tests__/catalog-routes.test.js`
- Modify: `apps/api/src/index.js:~205` (register)

**Interfaces:**
- Consumes: `optionalAuthenticate` (6), `catalogQuoteSchema` (5), `listFamilies` (4), `presentShopFamily` (4), `pricingClientFor`, `loadClientPrices`, `priceShopCart` (3), `PricingError` (3).
- Produces: `GET /api/v1/catalog` → `{ data: { families: PublicFamily[] } }`; `POST /api/v1/catalog/quote` body `{ items }` → `{ data: Quote }` or 422 `{ error: { code: "VALIDATION_ERROR", message, reason, variantId } }`. Exported pure helper `pricingErrorReply(err) → { status: 422, body }`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/routes/__tests__/catalog-routes.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { pricingErrorReply } from "../catalog.routes.js";
import { PricingError } from "../../lib/pricing.js";

test("a pricing refusal becomes a 422 that names the item and the reason", () => {
  const r = pricingErrorReply(new PricingError("UNPRICED", "Item has no price yet.", "v9"));
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  assert.equal(r.body.error.reason, "UNPRICED");
  assert.equal(r.body.error.variantId, "v9");
  assert.equal(r.body.error.message, "Item has no price yet.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/catalog-routes.test.js`
Expected: FAIL — cannot resolve `../catalog.routes.js`.

- [ ] **Step 3: Implement**

`apps/api/src/routes/catalog.routes.js`:

```js
import { ERROR_CODES, catalogQuoteSchema } from "@my-app/shared";
import { optionalAuthenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validate.js";
import { listFamilies } from "../services/catalog.service.js";
import { presentShopFamily } from "../lib/catalog-variants.js";
import { pricingClientFor, loadClientPrices, priceShopCart } from "../services/pricing.service.js";
import { PricingError } from "../lib/pricing.js";

export function pricingErrorReply(err) {
  return {
    status: 422,
    body: { error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message, reason: err.code, variantId: err.variantId } },
  };
}

export default async function catalogRoutes(fastify) {
  // The shop catalog. Approved doctors see their negotiated prices.
  fastify.get("/catalog", { preHandler: [optionalAuthenticate] }, async (request) => {
    const families = await listFamilies({ shopOnly: true });
    const prices = await loadClientPrices(
      pricingClientFor(request.user),
      families.flatMap((f) => f.variants.map((v) => v.id)),
    );
    return { data: { families: families.map((f) => presentShopFamily(f, prices)).filter(Boolean) } };
  });

  // The priced cart — the same computation checkout charges.
  fastify.post("/catalog/quote", {
    preHandler: [optionalAuthenticate, validate(catalogQuoteSchema)],
  }, async (request, reply) => {
    try {
      const quote = await priceShopCart({ lines: request.body.items, clientUserId: pricingClientFor(request.user) });
      return { data: quote };
    } catch (err) {
      if (err instanceof PricingError) {
        const r = pricingErrorReply(err);
        return reply.code(r.status).send(r.body);
      }
      throw err;
    }
  });
}
```

In `apps/api/src/index.js` add the import next to the other route imports and register after `paymentRoutes`:

```js
import catalogRoutes from "./routes/catalog.routes.js";
// …
await fastify.register(catalogRoutes, { prefix: "/api/v1" });
```

- [ ] **Step 4: Run tests and boot-check**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/catalog-routes.test.js && node --check src/index.js`
Expected: PASS, no syntax output.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/catalog.routes.js apps/api/src/routes/__tests__/catalog-routes.test.js apps/api/src/index.js
git commit -m "feat(catalog): public catalog and quote endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin catalog and client-price routes

**Files:**
- Create: `apps/api/src/services/client-prices.service.js`, `apps/api/src/routes/admin-catalog.routes.js`, `apps/api/src/routes/__tests__/admin-catalog.test.js`
- Modify: `apps/api/src/index.js` (register)

**Interfaces:**
- Consumes: catalog service + `CatalogError` (4), schemas (5), `authenticate`, `requireAdmin`, `validate`.
- Produces: `catalogErrorReply(err) → { status, body }` (exported). Routes (all `authenticate, requireAdmin`):
  - `GET /admin/catalog/families` → `{ data: { families: ShapedFamily[] } }`
  - `GET /admin/catalog/families/:id` → `{ data: { family } }`
  - `POST /admin/catalog/families` (familyCreateSchema) → 201 `{ data: { family } }`
  - `PATCH /admin/catalog/families/:id` (familyUpdateSchema)
  - `POST /admin/catalog/families/:id/options` (optionCreateSchema)
  - `POST /admin/catalog/options/:id/values` (optionValueCreateSchema)
  - `PATCH /admin/catalog/variants/:id` (variantUpdateSchema)
  - `POST /admin/catalog/families/:id/merge` (familyMergeSchema)
  - `GET /admin/clients/:userId/prices` → `{ data: { prices: [{ ...clientPrice, variantName, variantCode, basePriceCents, familyName }] } }`
  - `PUT /admin/clients/:userId/prices/:variantId` (clientPriceUpsertSchema) → source `manual`, reviewed now by the admin
  - `DELETE /admin/clients/:userId/prices/:variantId`
  - `POST /admin/clients/:userId/prices/review` (clientPriceReviewSchema) → `{ data: { reviewed: n } }`
- Client-price service: `listForClient(userId)`, `upsertManual({ clientUserId, variantId, priceCents, note, adminId })`, `removePrice(clientUserId, variantId) → boolean`, `markReviewed({ clientUserId, variantIds, adminId }) → number`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/routes/__tests__/admin-catalog.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { catalogErrorReply } from "../admin-catalog.routes.js";
import { CatalogError } from "../../services/catalog.service.js";

test("catalog errors map to the status an admin UI can act on", () => {
  assert.equal(catalogErrorReply(new CatalogError("NOT_FOUND", "x")).status, 404);
  assert.equal(catalogErrorReply(new CatalogError("CONFLICT", "x")).status, 409);
  assert.equal(catalogErrorReply(new CatalogError("INVALID", "x")).status, 422);
  assert.equal(catalogErrorReply(new CatalogError("CONFLICT", "Code taken.")).body.error.message, "Code taken.");
});

test("anything else is not swallowed", () => {
  assert.equal(catalogErrorReply(new Error("boom")), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/admin-catalog.test.js`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the client-price service**

`apps/api/src/services/client-prices.service.js`:

```js
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { clientPrices, productVariants, productFamilies } from "../db/schema/index.js";
import { createId } from "../lib/id.js";

export async function listForClient(clientUserId) {
  const rows = await db
    .select({ p: clientPrices, v: productVariants, f: productFamilies })
    .from(clientPrices)
    .innerJoin(productVariants, eq(productVariants.id, clientPrices.variantId))
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(eq(clientPrices.clientUserId, clientUserId));
  return rows
    .map(({ p, v, f }) => ({
      ...p, variantName: v.name, variantCode: v.code, basePriceCents: v.basePriceCents, familyName: f.name,
    }))
    .sort((a, b) => a.familyName.localeCompare(b.familyName) || a.variantName.localeCompare(b.variantName));
}

/** A price entered by staff is reviewed by definition. */
export async function upsertManual({ clientUserId, variantId, priceCents, note = null, adminId }) {
  const now = new Date();
  await db.insert(clientPrices).values({
    id: createId(), clientUserId, variantId, priceCents, source: "manual",
    note, reviewedAt: now, reviewedBy: adminId,
  }).onConflictDoUpdate({
    target: [clientPrices.clientUserId, clientPrices.variantId],
    set: { priceCents, source: "manual", note, reviewedAt: now, reviewedBy: adminId, updatedAt: now },
  });
}

export async function removePrice(clientUserId, variantId) {
  const deleted = await db.delete(clientPrices)
    .where(and(eq(clientPrices.clientUserId, clientUserId), eq(clientPrices.variantId, variantId)))
    .returning({ id: clientPrices.id });
  return deleted.length > 0;
}

export async function markReviewed({ clientUserId, variantIds, adminId }) {
  const updated = await db.update(clientPrices)
    .set({ reviewedAt: new Date(), reviewedBy: adminId, updatedAt: new Date() })
    .where(and(eq(clientPrices.clientUserId, clientUserId), inArray(clientPrices.variantId, variantIds)))
    .returning({ id: clientPrices.id });
  return updated.length;
}
```

- [ ] **Step 4: Implement the routes**

`apps/api/src/routes/admin-catalog.routes.js`:

```js
import { and, eq } from "drizzle-orm";
import {
  ERROR_CODES, familyCreateSchema, familyUpdateSchema, optionCreateSchema, optionValueCreateSchema,
  variantUpdateSchema, familyMergeSchema, clientPriceUpsertSchema, clientPriceReviewSchema,
} from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { db } from "../config/database.js";
import { users, productVariants } from "../db/schema/index.js";
import * as catalog from "../services/catalog.service.js";
import * as clientPricesService from "../services/client-prices.service.js";
import * as auditService from "../services/audit.service.js";

const STATUS = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

export function catalogErrorReply(err) {
  if (!(err instanceof catalog.CatalogError)) return null;
  const status = STATUS[err.code] ?? 422;
  const base = status === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR;
  return { status, body: { error: { ...base, message: err.message } } };
}

export default async function adminCatalogRoutes(fastify) {
  const admin = { preHandler: [authenticate, requireAdmin] };
  const withBody = (schema) => ({ preHandler: [authenticate, requireAdmin, validate(schema)] });

  // Run a catalog operation; map CatalogError to a reply, rethrow the rest.
  async function run(reply, fn, status = 200) {
    try {
      const family = await fn();
      return reply.code(status).send({ data: { family } });
    } catch (err) {
      const r = catalogErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }

  fastify.get("/admin/catalog/families", admin, async () => ({
    data: { families: await catalog.listFamilies() },
  }));
  fastify.get("/admin/catalog/families/:id", admin, (req, reply) =>
    run(reply, () => catalog.getFamily(req.params.id)));
  fastify.post("/admin/catalog/families", withBody(familyCreateSchema), (req, reply) =>
    run(reply, () => catalog.createFamily(req.body), 201));
  fastify.patch("/admin/catalog/families/:id", withBody(familyUpdateSchema), (req, reply) =>
    run(reply, () => catalog.updateFamily(req.params.id, req.body)));
  fastify.post("/admin/catalog/families/:id/options", withBody(optionCreateSchema), (req, reply) =>
    run(reply, () => catalog.addOption(req.params.id, req.body)));
  fastify.post("/admin/catalog/options/:id/values", withBody(optionValueCreateSchema), (req, reply) =>
    run(reply, () => catalog.addOptionValue(req.params.id, req.body.value)));
  fastify.patch("/admin/catalog/variants/:id", withBody(variantUpdateSchema), (req, reply) =>
    run(reply, () => catalog.updateVariant(req.params.id, req.body)));
  fastify.post("/admin/catalog/families/:id/merge", withBody(familyMergeSchema), (req, reply) =>
    run(reply, () => catalog.mergeSingleVariantFamily({ targetFamilyId: req.params.id, ...req.body })));

  async function requireClient(userId, reply) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) {
      reply.code(404).send({ error: ERROR_CODES.USER_NOT_FOUND });
      return false;
    }
    return true;
  }

  fastify.get("/admin/clients/:userId/prices", admin, async (req, reply) => {
    if (!(await requireClient(req.params.userId, reply))) return reply;
    return { data: { prices: await clientPricesService.listForClient(req.params.userId) } };
  });

  fastify.put("/admin/clients/:userId/prices/:variantId", withBody(clientPriceUpsertSchema), async (req, reply) => {
    const { userId, variantId } = req.params;
    if (!(await requireClient(userId, reply))) return reply;
    const [v] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, variantId));
    if (!v) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Variant not found." } });
    await clientPricesService.upsertManual({
      clientUserId: userId, variantId, priceCents: req.body.priceCents, note: req.body.note ?? null, adminId: req.user.id,
    });
    auditService.logSafe({
      userId: req.user.id, action: "client_price.set", targetType: "user", targetId: userId,
      metadata: { variantId, priceCents: req.body.priceCents },
    });
    return { data: { prices: await clientPricesService.listForClient(userId) } };
  });

  fastify.delete("/admin/clients/:userId/prices/:variantId", admin, async (req, reply) => {
    const { userId, variantId } = req.params;
    const removed = await clientPricesService.removePrice(userId, variantId);
    if (!removed) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "No price to remove." } });
    auditService.logSafe({
      userId: req.user.id, action: "client_price.remove", targetType: "user", targetId: userId, metadata: { variantId },
    });
    return { data: { prices: await clientPricesService.listForClient(userId) } };
  });

  fastify.post("/admin/clients/:userId/prices/review", withBody(clientPriceReviewSchema), async (req) => {
    const reviewed = await clientPricesService.markReviewed({
      clientUserId: req.params.userId, variantIds: req.body.variantIds, adminId: req.user.id,
    });
    return { data: { reviewed } };
  });
}
```

Register in `apps/api/src/index.js` next to `adminRoutes`:

```js
import adminCatalogRoutes from "./routes/admin-catalog.routes.js";
// …
await fastify.register(adminCatalogRoutes, { prefix: "/api/v1" });
```

Before committing, open `apps/api/src/services/audit.service.js` and confirm `logSafe` takes the same object `log` does (`{ userId, accountId, action, targetType, targetId, metadata, ipAddress }`). If its signature differs, adapt the three calls to it; do not change the audit service.

- [ ] **Step 5: Run tests and syntax checks**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/admin-catalog.test.js && node --check src/routes/admin-catalog.routes.js && node --check src/index.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/client-prices.service.js apps/api/src/routes/admin-catalog.routes.js apps/api/src/routes/__tests__/admin-catalog.test.js apps/api/src/index.js
git commit -m "feat(catalog): admin catalog and client price endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Checkout prices through the pricing service

**Files:**
- Modify: `apps/api/src/routes/payment.routes.js` (constants block ~48-56, checkout handler ~520-610, `recordGuestOrder` order-items insert ~458-470)
- Create: `apps/api/src/routes/__tests__/checkout-lines.test.js`

**Interfaces:**
- Consumes: `priceShopCart`, `pricingClientFor` (3); `PricingError` (3); `pricingErrorReply` (7); `optionalAuthenticate` (6); `fromCents` via `toDecimalString`/division (1).
- Produces: exported pure `checkoutLinesFromQuote(quote) → [{ variantId, catalogId, seazonaProductId, name, unitPrice, qty, lineTotal, taxable }]` (dollar numbers — the shape `recordGuestOrder`, receipts and the Seazona push already consume).

- [ ] **Step 1: Write the failing test**

`apps/api/src/routes/__tests__/checkout-lines.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { checkoutLinesFromQuote } from "../payment.routes.js";

test("quote lines become the order/receipt line shape, in dollars", () => {
  const lines = checkoutLinesFromQuote({
    lines: [{
      variantId: "v1", code: "61", name: "Mute Small", catalogId: "61", legacySeazonaProductId: "sz-1",
      qty: 2, unitCents: 2199, priceSource: "base", lineCents: 4398, taxable: true,
    }],
  });
  assert.deepEqual(lines, [{
    variantId: "v1", catalogId: "61", seazonaProductId: "sz-1", name: "Mute Small",
    unitPrice: 21.99, qty: 2, lineTotal: 43.98, taxable: true,
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/routes/__tests__/checkout-lines.test.js`
Expected: FAIL — `checkoutLinesFromQuote` is not exported.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/payment.routes.js`:

1. Delete the `TAX_RATE`, `SHIPPING_FLAT`, `MAX_QTY` constants and the comment block above them (the "Guest-checkout pricing constants" section). They now live in `config/pricing.js`.
2. Add imports:

```js
import { optionalAuthenticate } from "../middleware/authenticate.js";
import { priceShopCart, pricingClientFor } from "../services/pricing.service.js";
import { PricingError } from "../lib/pricing.js";
import { pricingErrorReply } from "./catalog.routes.js";
```

(`authenticate` is already imported from the same module — merge into one import line: `import { authenticate, optionalAuthenticate } from "../middleware/authenticate.js";`.)

3. Add above `export default async function paymentRoutes`:

```js
/** Quote lines → the dollar line shape orders, receipts and the Seazona push use. */
export function checkoutLinesFromQuote(quote) {
  return quote.lines.map((l) => ({
    variantId: l.variantId,
    catalogId: l.catalogId,
    seazonaProductId: l.legacySeazonaProductId,
    name: l.name,
    unitPrice: l.unitCents / 100,
    qty: l.qty,
    lineTotal: l.lineCents / 100,
    taxable: l.taxable,
  }));
}
```

4. Change the checkout route options to `{ ...CHARGE_RATE_LIMIT, preHandler: [optionalAuthenticate, validate(checkoutSchema)] }`.
5. Replace everything from the comment `// ── Server-side price authority: recompute every line from the products` down to and including `const total = round2(subtotal + tax + shippingCost);` with:

```js
    // ── Server-side price authority: the same pricing service the cart quote
    // uses (client price for approved doctors, else base). Client-sent prices
    // and amount are ignored entirely.
    let quote;
    try {
      quote = await priceShopCart({ lines: items, clientUserId: pricingClientFor(request.user) });
    } catch (err) {
      if (err instanceof PricingError) {
        const r = pricingErrorReply(err);
        return reply.code(r.status).send(r.body);
      }
      throw err;
    }
    const lines = checkoutLinesFromQuote(quote);
    const subtotal = quote.subtotalCents / 100;
    const tax = quote.taxCents / 100;
    const shippingCost = quote.shippingCents / 100;
    const total = quote.totalCents / 100;
```

Leave the `!(total > 0)` guard, the client-amount warning and everything after unchanged.

6. In `recordGuestOrder`'s `tx.insert(orderItems).values(lines.map((l) => ({ ... })))`, add `variantId: l.variantId,` next to `catalogId: l.catalogId,`.

7. Search the file for any remaining use of `products` (the table import) and of `TAX_RATE`/`SHIPPING_FLAT`/`MAX_QTY`:

Run: `grep -n "TAX_RATE\|SHIPPING_FLAT\|MAX_QTY\|\bproducts\b" apps/api/src/routes/payment.routes.js`
Expected: only the `products` name inside the schema import line, if any. Remove `products` from that import if it is now unused.

- [ ] **Step 4: Run tests and syntax check**

Run: `cd apps/api && node --check src/routes/payment.routes.js && pnpm vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/payment.routes.js apps/api/src/routes/__tests__/checkout-lines.test.js
git commit -m "feat(checkout): charge the pricing-service quote for variant cart lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Catalog import

**Files:**
- Create: `apps/api/src/db/catalog-import/family-seed.js`, `apps/api/src/db/catalog-import/plan-catalog.js`, `apps/api/src/db/catalog-import/plan-catalog.test.js`, `apps/api/src/db/import-catalog.js`
- Modify: `apps/api/package.json` (script)

**Interfaces:**
- Consumes: `DEVICE_ROWS` (`services/rx/catalog-map/devices.table.js`), `toCents` (1), `insertPlannedFamily` (4), `SEED_CATALOG` from `apps/web/src/data/catalog.js`.
- Produces: `FAMILY_SEED`; `planCatalogImport({ products, familySeed, shopSeed }) → { families: PlannedFamily[], warnings: string[] }`; `slugify(s)`; script `pnpm db:import-catalog` (`DRY_RUN=1` supported).

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/catalog-import/plan-catalog.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { FAMILY_SEED } from "./family-seed.js";
import { planCatalogImport, slugify } from "./plan-catalog.js";
import { DEVICE_ROWS } from "../../services/rx/catalog-map/devices.table.js";

test("every seeded code is a lab-confirmed device row", () => {
  const confirmed = new Set(DEVICE_ROWS.filter((r) => r.status === "confirmed").map((r) => r.code));
  for (const f of FAMILY_SEED) for (const v of f.variants) {
    assert.ok(confirmed.has(v.code), `${f.slug}: ${v.code} is not a confirmed DEVICE_ROWS code`);
  }
});

test("the seed is internally consistent", () => {
  const codes = FAMILY_SEED.flatMap((f) => f.variants.map((v) => v.code));
  assert.equal(new Set(codes).size, codes.length, "a code appears twice");
  for (const f of FAMILY_SEED) {
    const combos = new Set();
    for (const v of f.variants) {
      for (const o of f.options) assert.ok(v.values[o], `${f.slug} ${v.code} has no ${o}`);
      const key = f.options.map((o) => v.values[o]).join("|");
      assert.ok(!combos.has(key), `${f.slug} repeats ${key}`);
      combos.add(key);
    }
  }
});

const products = [
  { seazonaProductId: "p1", code: "2119", name: "OND Nylon", price: "450.00", taxable: false, catalogId: null, purchasable: false },
  { seazonaProductId: "p2", code: "2114", name: "OND PMT", price: "400.00", taxable: false, catalogId: null, purchasable: false },
  { seazonaProductId: "p3", code: "61", name: "Mute", price: "21.99", taxable: true, catalogId: "61", purchasable: true },
  { seazonaProductId: "p4", code: "2367", name: "Digital Model Fabrication", price: "35.00", taxable: false, catalogId: null, purchasable: false },
];
const familySeed = [{
  slug: "olmos-night", name: "Olmos Night", channel: "rx", options: ["Design", "Material"],
  variants: [
    { code: "2119", values: { Design: "ON-D Deprogrammer", Material: "Nylon" } },
    { code: "2114", values: { Design: "ON-D Deprogrammer", Material: "PMT" } },
    { code: "9999", values: { Design: "ON-D Deprogrammer", Material: "Gold" } },
  ],
}];
const shopSeed = [{ id: "61", name: "Mute", description: "Small / Medium / Large", image: "/catalog/mute.webp", categories: ["Sleep"], active: true }];

test("seeded families group their variants under real option values", () => {
  const { families, warnings } = planCatalogImport({ products, familySeed, shopSeed });
  const night = families.find((f) => f.slug === "olmos-night");
  assert.equal(night.variants.length, 2);
  assert.deepEqual(night.options, [
    { name: "Design", values: ["ON-D Deprogrammer"] },
    { name: "Material", values: ["Nylon", "PMT"] },
  ]);
  assert.equal(night.variants[0].basePriceCents, 45000);
  assert.equal(night.variants[0].legacySeazonaProductId, "p1");
  assert.ok(warnings.some((w) => w.includes("9999")));
});

test("everything else becomes a one-variant family; shop items keep their presentation", () => {
  const { families } = planCatalogImport({ products, familySeed, shopSeed });
  const mute = families.find((f) => f.name === "Mute");
  assert.equal(mute.channel, "shop");
  assert.equal(mute.imageUrl, "/catalog/mute.webp");
  assert.equal(mute.category, "Sleep");
  assert.deepEqual(mute.options, []);
  assert.equal(mute.variants[0].catalogId, "61");
  assert.equal(mute.variants[0].active, true);
  const lab = families.find((f) => f.name === "Digital Model Fabrication");
  assert.equal(lab.channel, "rx");
});

test("every product lands in exactly one family and slugs are unique", () => {
  const { families } = planCatalogImport({ products, familySeed, shopSeed });
  const legacy = families.flatMap((f) => f.variants.map((v) => v.legacySeazonaProductId));
  assert.deepEqual([...legacy].sort(), ["p1", "p2", "p3", "p4"]);
  const slugs = families.map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("slugify makes url-safe slugs", () => {
  assert.equal(slugify("Diamond (PMT/Acrylic) Sample Models"), "diamond-pmt-acrylic-sample-models");
  assert.equal(slugify("  --  "), "item");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run src/db/catalog-import/plan-catalog.test.js`
Expected: FAIL — cannot resolve `./family-seed.js`.

- [ ] **Step 3: Write the family seed**

`apps/api/src/db/catalog-import/family-seed.js`:

```js
// Rx device families, written out by hand from the lab-confirmed rows of
// services/rx/catalog-map/devices.table.js. plan-catalog.test.js fails if a
// code here is not a confirmed row there. Everything not listed imports as a
// one-variant family; admins group the rest in the Catalog page.
export const FAMILY_SEED = [
  {
    slug: "olmos-day", name: "Olmos Day", channel: "rx", options: ["Material"],
    variants: [
      { code: "2102", values: { Material: "PMT" } },
      { code: "2527", values: { Material: "BioFlex" } },
      { code: "2108", values: { Material: "Nylon" } },
      { code: "2103", values: { Material: "Acrylic w/Clasps" } },
      { code: "2105", values: { Material: "Dual Laminate" } },
      { code: "2106", values: { Material: "Milled" } },
    ],
  },
  {
    slug: "olmos-night", name: "Olmos Night", channel: "rx", options: ["Design", "Material"],
    variants: [
      { code: "2144", values: { Design: "ON-T Titration", Material: "Nylon" } },
      { code: "2119", values: { Design: "ON-D Deprogrammer", Material: "Nylon" } },
      { code: "2114", values: { Design: "ON-D Deprogrammer", Material: "PMT" } },
      { code: "2118", values: { Design: "ON-D Deprogrammer", Material: "Biomed" } },
      { code: "2117", values: { Design: "ON-D Deprogrammer", Material: "Dual Laminate" } },
      { code: "2115", values: { Design: "ON-D Deprogrammer", Material: "Acrylic w/Clasps" } },
      { code: "2130", values: { Design: "ON-P Positioner", Material: "Nylon" } },
      { code: "2125", values: { Design: "ON-P Positioner", Material: "PMT" } },
      { code: "2129", values: { Design: "ON-P Positioner", Material: "Biomed" } },
      { code: "2128", values: { Design: "ON-P Positioner", Material: "Dual Laminate" } },
      { code: "2126", values: { Design: "ON-P Positioner", Material: "Acrylic w/Clasps" } },
      { code: "2142", values: { Design: "ON-R Ramp", Material: "Nylon" } },
      { code: "2137", values: { Design: "ON-R Ramp", Material: "PMT" } },
      { code: "2141", values: { Design: "ON-R Ramp", Material: "Biomed" } },
      { code: "2140", values: { Design: "ON-R Ramp", Material: "Dual Laminate" } },
      { code: "2138", values: { Design: "ON-R Ramp", Material: "Acrylic w/Clasps" } },
    ],
  },
  {
    slug: "ddso", name: "DDSO", channel: "rx", options: ["Material"],
    variants: [
      { code: "2608", values: { Material: "Nylon" } },
      { code: "2146", values: { Material: "Biomed" } },
    ],
  },
  {
    slug: "sport-guard", name: "Sport-Guard", channel: "rx", options: ["Tier"],
    variants: [
      { code: "2173", values: { Tier: "Trainer (mandibular only)" } },
      { code: "2172", values: { Tier: "Pro" } },
      { code: "2174", values: { Tier: "CAD/CAM" } },
    ],
  },
];
```

- [ ] **Step 4: Write the planner**

`apps/api/src/db/catalog-import/plan-catalog.js`:

```js
import { toCents } from "../../lib/money.js";

// Pure: products mirror + family seed + shop seed → families to insert.
// Never infers a grouping from product names — only FAMILY_SEED groups.

export function slugify(s) {
  const slug = String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return slug || "item";
}

function uniqueSlug(base, taken) {
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

const variantFrom = (p) => ({
  code: p.code ?? null,
  name: p.name ?? p.code ?? p.seazonaProductId,
  basePriceCents: toCents(p.price),
  taxable: Boolean(p.taxable),
  active: true,
  catalogId: p.catalogId ?? null,
  legacySeazonaProductId: p.seazonaProductId,
});

export function planCatalogImport({ products, familySeed, shopSeed = [] }) {
  const warnings = [];
  const byCode = new Map();
  for (const p of products) {
    if (!p.code) continue;
    if (byCode.has(p.code)) warnings.push(`Seazona code ${p.code} appears twice — grouped the first (${byCode.get(p.code).seazonaProductId}).`);
    else byCode.set(p.code, p);
  }
  const shopById = new Map(shopSeed.map((s) => [String(s.id), s]));
  const used = new Set();
  const slugs = new Set();
  const families = [];

  for (const f of familySeed) {
    const variants = [];
    for (const sv of f.variants) {
      const p = byCode.get(sv.code);
      if (!p) { warnings.push(`${f.slug}: code ${sv.code} is not in the products table — skipped.`); continue; }
      used.add(p.seazonaProductId);
      variants.push({ ...variantFrom(p), values: sv.values });
    }
    if (variants.length === 0) continue;
    families.push({
      slug: uniqueSlug(f.slug, slugs), name: f.name, channel: f.channel,
      category: f.category ?? null, description: null, imageUrl: null,
      options: f.options.map((name) => ({ name, values: [...new Set(variants.map((v) => v.values[name]))] })),
      variants,
    });
  }

  for (const p of products) {
    if (used.has(p.seazonaProductId)) continue;
    const shop = p.catalogId ? shopById.get(String(p.catalogId)) : null;
    const isShop = Boolean(p.purchasable || shop);
    const name = p.name ?? p.code ?? p.seazonaProductId;
    families.push({
      slug: uniqueSlug(slugify(name), slugs),
      name,
      channel: isShop ? "shop" : "rx",
      category: p.category ?? shop?.categories?.[0] ?? null,
      description: p.description ?? shop?.description ?? null,
      imageUrl: p.imageUrl ?? shop?.image ?? null,
      options: [],
      variants: [{
        ...variantFrom(p),
        active: isShop ? Boolean(p.purchasable) && shop?.active !== false : true,
        values: {},
      }],
    });
  }
  return { families, warnings };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && pnpm vitest run src/db/catalog-import/plan-catalog.test.js`
Expected: PASS. If the "confirmed" test fails, a seed code is wrong — fix the seed from `devices.table.js`, never relax the test.

- [ ] **Step 6: Write the import script**

`apps/api/src/db/import-catalog.js`:

```js
/**
 * Build the owned catalog from the Seazona products mirror.
 *
 *   pnpm db:import-catalog            # write
 *   DRY_RUN=1 pnpm db:import-catalog  # preview only
 *
 * Idempotent: a planned family is skipped when any of its products is already
 * a variant (matched by legacySeazonaProductId).
 */
import { inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { products, productVariants } from "./schema/index.js";
import { FAMILY_SEED } from "./catalog-import/family-seed.js";
import { planCatalogImport } from "./catalog-import/plan-catalog.js";
import { insertPlannedFamily } from "../services/catalog.service.js";
import { SEED_CATALOG } from "../../../web/src/data/catalog.js";

const DRY_RUN = process.env.DRY_RUN === "1";

const rows = await db.select().from(products);
const { families, warnings } = planCatalogImport({ products: rows, familySeed: FAMILY_SEED, shopSeed: SEED_CATALOG });

const legacyIds = families.flatMap((f) => f.variants.map((v) => v.legacySeazonaProductId));
const existing = new Set(
  legacyIds.length
    ? (await db.select({ id: productVariants.legacySeazonaProductId }).from(productVariants)
        .where(inArray(productVariants.legacySeazonaProductId, legacyIds))).map((r) => r.id)
    : [],
);
const todo = families.filter((f) => !f.variants.some((v) => existing.has(v.legacySeazonaProductId)));

console.log(`${rows.length} products → ${families.length} families (${todo.length} new, ${families.length - todo.length} already imported)`);
console.log(`  grouped: ${todo.filter((f) => f.options.length > 0).map((f) => `${f.name} (${f.variants.length})`).join(", ") || "none"}`);
console.log(`  shop: ${todo.filter((f) => f.channel === "shop").length}, lab-billed: ${todo.filter((f) => f.channel === "rx").length}`);
for (const w of warnings) console.warn(`  ! ${w}`);

if (DRY_RUN) {
  console.log("DRY RUN — nothing written.");
  process.exit(0);
}

await db.transaction(async (tx) => {
  for (const f of todo) await insertPlannedFamily(tx, f);
});
console.log(`Imported ${todo.length} families.`);
process.exit(0);
```

Add to `apps/api/package.json` scripts:

```json
    "db:import-catalog": "node --env-file=.env src/db/import-catalog.js",
```

- [ ] **Step 7: Dry-run, then import into the worktree DB**

```bash
cd apps/api
DRY_RUN=1 pnpm db:import-catalog
```

Expected: ~390 products → families; "grouped:" lists Olmos Day, Olmos Night, DDSO, Sport-Guard; warnings only for codes genuinely missing. Then:

```bash
pnpm db:import-catalog && pnpm db:import-catalog
```

Expected: first run "Imported N families."; second run reports `0 new` and imports 0 (idempotent).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/catalog-import apps/api/src/db/import-catalog.js apps/api/package.json
git commit -m "feat(catalog): one-time import from the products mirror with Rx family seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Client prices inferred from billed history — DEFERRED

Moved to piece 5 (migration) on 2026-10-05 at the user's direction: this piece touches no Seazona invoices. Client prices are entered by staff on the Pricing page (Task 14). The `client_prices.source` values `inferred`/`imported` and the review flag stay in the schema so the migration can fill them later without a schema change.

---

### Task 12: Shop on the API (catalog, cart, checkout quote)

**Files:**
- Create: `apps/web/src/lib/money.js`, `apps/web/src/lib/catalog.js`, `apps/web/src/lib/catalog.test.js`, `apps/web/src/hooks/useCatalog.js`, `apps/web/src/hooks/useCartQuote.js`
- Modify: `apps/web/src/stores/cart.store.js`, `apps/web/src/components/marketing/CatalogSection.jsx`, `CatalogCard.jsx`, `CatalogDetail.jsx`, `CartDrawer.jsx`, `apps/web/src/pages/marketing/Checkout.jsx`
- Delete: `apps/web/src/stores/catalog.store.js`

**Interfaces:**
- Consumes: `GET /catalog`, `POST /catalog/quote` (Task 7); `POST /payments/checkout` items `[{ variantId, qty }]` (Task 9).
- Produces:
  - `lib/money.js`: `formatUSD(dollars)`, `formatCents(cents)`.
  - `lib/catalog.js`: `familyToProduct(family) → ShopProduct` (`{ id, name, description, image, thumbnail, categories, availability: "in-stock", active: true, priceFromCents, singleVariant: Variant|null, family }`), `variantFor(family, selectedValueIds) → Variant|null`, `variantLabel(family, variant) → string`, `cartItemFor(family, variant) → { id, variantId, name, price, image }`, `migrateCart(persisted, version) → state`.
  - `useCatalog() → { products, loading, error, reload }`, `useCartQuote(items) → { quote, loading, error }`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/catalog.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { familyToProduct, variantFor, variantLabel, cartItemFor, migrateCart } from "./catalog.js";

const family = {
  id: "f1", slug: "mute", name: "Mute", description: "Anti-snoring", category: "Sleep", imageUrl: "/catalog/mute.webp",
  options: [{ id: "o1", name: "Size", values: [{ id: "s", value: "Small" }, { id: "l", value: "Large" }] }],
  variants: [
    { id: "v-s", code: "61S", name: "Mute Small", optionValueIds: ["s"], priceCents: 2199, priceSource: "base", taxable: true },
    { id: "v-l", code: "61L", name: "Mute Large", optionValueIds: ["l"], priceCents: 2499, priceSource: "base", taxable: true },
  ],
};
const single = { ...family, id: "f2", options: [], variants: [{ ...family.variants[0], id: "v-1", optionValueIds: [] }] };

test("a family becomes a shop card priced from its cheapest variant", () => {
  const p = familyToProduct(family);
  assert.equal(p.id, "f1");
  assert.equal(p.priceFromCents, 2199);
  assert.deepEqual(p.categories, ["Sleep"]);
  assert.equal(p.singleVariant, null);
  assert.equal(familyToProduct(single).singleVariant.id, "v-1");
});

test("the picked option values select exactly one variant", () => {
  assert.equal(variantFor(family, ["l"]).id, "v-l");
  assert.equal(variantFor(family, []), null);
  assert.equal(variantFor(single, []).id, "v-1");
});

test("a cart line is keyed by variant and labelled with its options", () => {
  const item = cartItemFor(family, family.variants[1]);
  assert.equal(item.id, "v-l");
  assert.equal(item.variantId, "v-l");
  assert.equal(item.name, "Mute — Large");
  assert.equal(item.price, 24.99);
  assert.equal(variantLabel(single, single.variants[0]), "Mute");
});

test("carts saved before variants existed are emptied, not sent to checkout", () => {
  const old = { items: [{ id: "16", name: "NovaDent", price: 15, qty: 1 }], isOpen: false };
  assert.deepEqual(migrateCart(old, 0).items, []);
  const kept = { items: [{ id: "v-l", variantId: "v-l", qty: 1 }] };
  assert.equal(migrateCart(kept, 0).items.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run src/lib/catalog.test.js`
Expected: FAIL — cannot resolve `./catalog.js`.

- [ ] **Step 3: Implement the helpers and hooks**

`apps/web/src/lib/money.js`:

```js
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatUSD = (dollars) => USD.format(Number(dollars));
export const formatCents = (cents) => USD.format(cents / 100);
```

`apps/web/src/lib/catalog.js`:

```js
// Shop-side view of GET /catalog families. Prices arrive in cents and are
// display-only: checkout charges the server quote.

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function familyToProduct(family) {
  const prices = family.variants.map((v) => v.priceCents);
  return {
    id: family.id,
    name: family.name,
    description: family.description ?? "",
    image: family.imageUrl ?? null,
    thumbnail: family.imageUrl ?? null,
    categories: family.category ? [family.category] : [],
    availability: "in-stock",
    active: true,
    priceFromCents: Math.min(...prices),
    singleVariant: family.variants.length === 1 ? family.variants[0] : null,
    family,
  };
}

export function variantFor(family, selectedValueIds) {
  return family.variants.find((v) => sameSet(v.optionValueIds, selectedValueIds)) ?? null;
}

export function variantLabel(family, variant) {
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  const parts = variant.optionValueIds.map((id) => labelOf.get(id)).filter(Boolean);
  return parts.length ? `${family.name} — ${parts.join(" · ")}` : family.name;
}

export function cartItemFor(family, variant) {
  return {
    id: variant.id,
    variantId: variant.id,
    name: variantLabel(family, variant),
    price: variant.priceCents / 100,
    image: family.imageUrl ?? null,
  };
}

/** zustand persist migrate: pre-variant carts held shop SKU ids, which checkout now refuses. */
export function migrateCart(persisted) {
  const items = (persisted?.items ?? []).filter((i) => i.variantId);
  return { ...persisted, items };
}
```

`apps/web/src/hooks/useCatalog.js`:

```js
import { useCallback, useEffect, useState } from "react";
import api from "../config/api.js";
import { familyToProduct } from "../lib/catalog.js";

export function useCatalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/catalog");
      setProducts(res.data.data.families.map(familyToProduct));
    } catch {
      setError("The catalog couldn't be loaded. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { products, loading, error, reload };
}
```

`apps/web/src/hooks/useCartQuote.js`:

```js
import { useEffect, useState } from "react";
import api from "../config/api.js";

/** The server's priced cart — the exact numbers checkout will charge. */
export function useCartQuote(items) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = JSON.stringify(items.map((i) => [i.variantId, i.qty]));

  useEffect(() => {
    if (items.length === 0) { setQuote(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    api.post("/catalog/quote", { items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) })
      .then((res) => { if (!cancelled) { setQuote(res.data.data); setError(null); } })
      .catch((err) => { if (!cancelled) { setQuote(null); setError(err.response?.data?.error?.message || "Couldn't price your cart."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quote, loading, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run src/lib/catalog.test.js`
Expected: PASS

- [ ] **Step 5: Rewire the cart store**

In `apps/web/src/stores/cart.store.js`:
- `add(item, qty = 1)` now receives a `cartItemFor(...)` object. Replace the new-item literal with `{ ...item, qty }` (keep the existing "increment if present" branch, which matches on `i.id` — the variant id).
- Change the persist options from `{ name: "diamond-cart" }` to:

```js
    { name: "diamond-cart", version: 2, migrate: migrateCart }
```

and add `import { migrateCart } from "../lib/catalog.js";` at the top.

- [ ] **Step 6: Rewire the shop components**

`CatalogSection.jsx`: replace `import { useCatalogStore } from "../../stores/catalog.store";` with `import { useCatalog } from "../../hooks/useCatalog.js";` and `const products = useCatalogStore((s) => s.products);` with:

```js
  const { products, loading, error } = useCatalog();
```

In the search filter, replace `p.id.toString().includes(q)` with `p.family.variants.some((v) => (v.code ?? "").toLowerCase().includes(q))`. Above the product grid render, show `loading` as the existing `Spinner` (or a "Loading catalog…" line) and `error` as a short message.

`CatalogCard.jsx`:
- Imports: add `import { cartItemFor } from "../../lib/catalog.js";` and `import { formatCents } from "../../lib/money.js";`; delete the local `formatPrice`.
- `cartItem` lookup: `s.items.find((i) => i.id === product.singleVariant?.id)`.
- `handleAdd`: if `product.singleVariant` is null, call `onOpen()` and return (the detail view has the option pickers); otherwise `add(cartItemFor(product.family, product.singleVariant))`.
- `handleInc`/`handleDec`: use `product.singleVariant.id` instead of `product.id`.
- Price display: `product.singleVariant ? formatCents(product.singleVariant.priceCents) : \`From ${formatCents(product.priceFromCents)}\`` (show "Included" when the value is 0, as before).
- The add button label for multi-variant families: "Choose options".

`CatalogDetail.jsx` — replace the file's component and `toViewerShape` with:

```jsx
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ProductViewer } from "./ProductViewer";
import { useCartStore } from "../../stores/cart.store";
import { AVAILABILITY_META } from "../../data/catalog";
import { variantFor, cartItemFor } from "../../lib/catalog.js";
import { formatCents } from "../../lib/money.js";

function toViewerShape(p, variant) {
  const priceCents = variant ? variant.priceCents : p.priceFromCents;
  const price = priceCents === 0 ? "Included" : `${variant ? "" : "From "}${formatCents(priceCents)}`;
  const specs = [
    ...(variant?.code ? [{ label: "SKU", value: `#${variant.code}` }] : []),
    { label: "Price", value: price },
    { label: "Availability", value: AVAILABILITY_META[p.availability]?.label ?? "In Stock" },
    ...(p.categories.length ? [{ label: "Category", value: p.categories.join(" · ") }] : []),
  ];
  return {
    name: p.name,
    fullName: p.description || p.categories[0] || "Diamond Orthotic Catalog",
    tagline: p.description || "Contact the lab for questions on this item.",
    category: p.categories[0] || "Catalog",
    categoryColor: "text-navy/60",
    categoryBg: "bg-surface-200/80",
    images: [{ src: p.image, label: p.name }],
    specs,
  };
}

export function CatalogDetail({ product, onClose }) {
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);
  const family = product?.family;
  const [picked, setPicked] = useState({});

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const variant = useMemo(
    () => (family ? variantFor(family, Object.values(picked)) : null),
    [family, picked],
  );

  if (!product) return null;
  const viewerProduct = toViewerShape(product, variant);
  const priceValue = viewerProduct.specs.find((s) => s.label === "Price").value;

  // A combination can exist in the option lists without a sellable variant
  // (the server hides unpriced ones), so only offer values that still lead somewhere.
  function reachable(optionId, valueId) {
    const others = Object.entries(picked).filter(([o]) => o !== optionId).map(([, v]) => v);
    return family.variants.some((v) => v.optionValueIds.includes(valueId) && others.every((o) => v.optionValueIds.includes(o)));
  }

  function handleAdd() {
    if (!variant) return;
    add(cartItemFor(family, variant));
    open();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end md:items-center justify-center p-0 md:p-6 bg-navy/50 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl bg-white md:card-radius-lg rounded-t-[2rem] md:rounded-[3rem] p-6 md:p-10 shadow-2xl max-h-[95dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 md:top-6 md:right-6 z-10 w-10 h-10 rounded-full bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-navy/60 hover:text-navy transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {family.options.length > 0 && (
          <div className="mb-6 space-y-4">
            {family.options.map((o) => (
              <div key={o.id}>
                <p className="font-mono text-xs text-navy/40 uppercase tracking-widest mb-2">{o.name}</p>
                <div className="flex flex-wrap gap-2">
                  {o.values.map((v) => {
                    const on = picked[o.id] === v.id;
                    const ok = reachable(o.id, v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={!ok}
                        onClick={() => setPicked((p) => ({ ...p, [o.id]: v.id }))}
                        className={`px-4 py-2 rounded-full text-sm border transition-all ${
                          on ? "bg-navy text-white border-navy" : "bg-white border-surface-300 text-navy hover:border-brand-500"
                        } ${ok ? "" : "opacity-30 cursor-not-allowed"}`}
                      >
                        {v.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <ProductViewer
          product={viewerProduct}
          onCta={handleAdd}
          ctaLabel={variant ? `Add to Cart · ${priceValue}` : "Choose options"}
          registered={false}
        />
      </div>
    </div>
  );
}
```

For a single-variant family, `variantFor(family, [])` returns that variant, so `picked` stays `{}` and Add works immediately.

`CartDrawer.jsx`: delete the local `formatUSD` and `import { formatUSD } from "../../lib/money.js";`. Lines render `item.name` as-is (it already carries the option label).

- [ ] **Step 7: Checkout shows the server quote**

In `apps/web/src/pages/marketing/Checkout.jsx`:
- Delete the local `formatUSD` and import it from `../../lib/money.js`; import `{ formatCents }` too, and `import { useCartQuote } from "../../hooks/useCartQuote.js";`.
- Replace the comment block and the five lines from `const TAX_RATE = 0.08;` through `const total = subtotal + SHIPPING + TAX;` with:

```js
  // The server's priced cart — the same numbers the charge will use.
  const { quote, loading: quoting, error: quoteError } = useCartQuote(items);
  const total = quote ? quote.totalCents / 100 : 0;
```

- In `validate()`, before the `total <= 0` check, add:

```js
    if (quoteError) { setError(quoteError); return false; }
    if (!quote || quoting) { setError("Still pricing your order — one moment."); return false; }
```

- In `submit()`, replace the `items:` line in `payload` with `items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })),`.
- In the summary: Subtotal → `quote ? formatCents(quote.subtotalCents) : "—"`; Shipping → `!quote ? "—" : quote.shippingCents === 0 ? "Free" : formatCents(quote.shippingCents)`; the tax row label becomes "Tax" and its value `quote ? formatCents(quote.taxCents) : "—"`; Total → `quote ? formatCents(quote.totalCents) : "—"`. Show `quoteError` (if any) in the existing red error box style above the pay button.
- If `subtotal` from the cart store is now unused, remove it from the store selector at the top of the component.

- [ ] **Step 8: Remove the browser-side catalog**

```bash
cd apps/web
git rm src/stores/catalog.store.js
grep -rn "catalog.store\|useCatalogStore" src   # expect: no matches
```

- [ ] **Step 9: Build and test**

Run: `cd apps/web && pnpm vitest run && pnpm build`
Expected: tests PASS, build succeeds.

- [ ] **Step 10: Smoke-test against the worktree API**

Run the API and web dev servers from the worktree (`pnpm dev` at the repo root), open the shop, and check: products load; a multi-option product disables unreachable values and enables "Add" only once a full combination is picked; checkout shows server tax/shipping. Do not submit a card — Authorize.net is production. Report what you saw.

- [ ] **Step 11: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(shop): catalog from the API with option pickers; checkout shows the server quote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Admin catalog page

**Files:**
- Create: `apps/web/src/pages/app/AdminCatalogPage.jsx`, `apps/web/src/pages/app/AdminCatalogPage.test.jsx`
- Modify: `apps/web/src/App.jsx:30,215`
- Delete: `apps/web/src/pages/app/AdminProductsPage.jsx`

**Interfaces:**
- Consumes: admin catalog routes (Task 8); `formatCents` (12).
- Produces: exported pure helpers `parsePriceInput(str) → integer cents | null | undefined` (`""` → `null` = clear price; invalid → `undefined`), `familyBadge(family) → string`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/app/AdminCatalogPage.test.jsx`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { parsePriceInput, familyBadge } from "./AdminCatalogPage.jsx";

test("admins type dollars; the API gets cents", () => {
  assert.equal(parsePriceInput("199"), 19900);
  assert.equal(parsePriceInput("$1,234.5"), 123450);
  assert.equal(parsePriceInput("0"), 0);
  assert.equal(parsePriceInput(""), null);
  assert.equal(parsePriceInput("abc"), undefined);
  assert.equal(parsePriceInput("-3"), undefined);
  assert.equal(parsePriceInput("1.999"), undefined);
});

test("the family badge says what still needs doing", () => {
  const v = (over) => ({ active: true, basePriceCents: 100, ...over });
  assert.equal(familyBadge({ variants: [v(), v()] }), "2 variants");
  assert.equal(familyBadge({ variants: [v(), v({ basePriceCents: null, active: false })] }), "2 variants · 1 unpriced");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run src/pages/app/AdminCatalogPage.test.jsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the page**

`apps/web/src/pages/app/AdminCatalogPage.jsx`:

```jsx
import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, AlertCircle, Plus, Layers, Save } from "lucide-react";
import api from "../../config/api.js";
import { formatCents } from "../../lib/money.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";
const CHANNELS = [["all", "All"], ["shop", "Shop"], ["rx", "Lab-billed"], ["both", "Both"]];

/** "$1,234.50" → 123450. "" → null (no price). Anything else → undefined (invalid). */
export function parsePriceInput(str) {
  const s = String(str ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function familyBadge(family) {
  const n = family.variants.length;
  const unpriced = family.variants.filter((v) => v.basePriceCents == null).length;
  return `${n} variant${n === 1 ? "" : "s"}${unpriced ? ` · ${unpriced} unpriced` : ""}`;
}

const errorText = (err) => err.response?.data?.error?.message || "Something went wrong.";

function VariantRow({ family, variant, onSaved }) {
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  const [draft, setDraft] = useState({
    code: variant.code ?? "",
    price: variant.basePriceCents == null ? "" : (variant.basePriceCents / 100).toFixed(2),
    taxable: variant.taxable,
    active: variant.active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const basePriceCents = parsePriceInput(draft.price);
    if (basePriceCents === undefined) { setError("Price must be dollars and cents, e.g. 199.00"); return; }
    if (draft.active && basePriceCents == null) { setError("A variant needs a price before it can be active."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch(`/admin/catalog/variants/${variant.id}`, {
        code: draft.code.trim() || null, basePriceCents, taxable: draft.taxable, active: draft.active,
      });
      onSaved(res.data.data.family);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-surface-300/40 align-top">
      <td className="px-3 py-2 text-sm">
        {variant.optionValueIds.map((id) => labelOf.get(id)).join(" · ") || variant.name}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </td>
      <td className="px-3 py-2 w-28"><input className={INPUT} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></td>
      <td className="px-3 py-2 w-32"><input className={INPUT} value={draft.price} placeholder="unpriced" onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></td>
      <td className="px-3 py-2 text-center"><input type="checkbox" checked={draft.taxable} onChange={(e) => setDraft({ ...draft, taxable: e.target.checked })} /></td>
      <td className="px-3 py-2 text-center"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /></td>
      <td className="px-3 py-2">
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </td>
    </tr>
  );
}

function FamilyDetail({ family, families, onChange }) {
  const [optionName, setOptionName] = useState("");
  const [optionValues, setOptionValues] = useState("");
  const [newValue, setNewValue] = useState({});
  const [mergeSource, setMergeSource] = useState("");
  const [mergePick, setMergePick] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try { onChange((await fn()).data.data.family); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  const mergeable = families.filter((f) => f.id !== family.id && f.options.length === 0 && f.variants.length === 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading font-bold text-xl text-navy">{family.name}</h2>
        <span className="text-xs text-navy/50">{family.channel === "rx" ? "Lab-billed" : family.channel === "both" ? "Shop + lab" : "Shop"}</span>
        <label className="ml-auto text-sm flex items-center gap-2">
          <input type="checkbox" checked={family.active} onChange={(e) => act(() => api.patch(`/admin/catalog/families/${family.id}`, { active: e.target.checked }))} />
          Active
        </label>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm flex gap-2"><AlertCircle size={16} />{error}</div>}

      <div className="rounded-xl border border-surface-300/50 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface-50 text-xs text-navy/50 uppercase">
            <tr><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Base price</th><th className="px-3 py-2">Taxable</th><th className="px-3 py-2">Active</th><th /></tr>
          </thead>
          <tbody>
            {family.variants.map((v) => (
              <VariantRow key={`${v.id}:${v.updatedAt}`} family={family} variant={v} onSaved={onChange} />
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold text-sm text-navy">Options</h3>
        {family.options.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium w-24">{o.name}</span>
            {o.values.map((v) => <span key={v.id} className="px-2 py-1 rounded-full bg-surface-100">{v.value}</span>)}
            <input className={`${INPUT} w-36`} placeholder={`Add ${o.name.toLowerCase()}`} value={newValue[o.id] ?? ""} onChange={(e) => setNewValue({ ...newValue, [o.id]: e.target.value })} />
            <button type="button" disabled={busy || !newValue[o.id]?.trim()} className="text-brand-600 disabled:opacity-40"
              onClick={() => act(() => api.post(`/admin/catalog/options/${o.id}/values`, { value: newValue[o.id].trim() })).then(() => setNewValue({ ...newValue, [o.id]: "" }))}>
              <Plus size={16} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 items-center">
          <input className={`${INPUT} w-40`} placeholder="New option (e.g. Size)" value={optionName} onChange={(e) => setOptionName(e.target.value)} />
          <input className={`${INPUT} w-64`} placeholder="Values, comma-separated" value={optionValues} onChange={(e) => setOptionValues(e.target.value)} />
          <button type="button" disabled={busy || !optionName.trim() || !optionValues.trim()} className="px-3 py-2 rounded-lg bg-navy text-white text-sm disabled:opacity-40"
            onClick={() => act(() => api.post(`/admin/catalog/families/${family.id}/options`, {
              name: optionName.trim(), values: optionValues.split(",").map((s) => s.trim()).filter(Boolean),
            })).then(() => { setOptionName(""); setOptionValues(""); })}>
            Add option
          </button>
        </div>
        <p className="text-xs text-navy/50">Adding an option gives existing variants its first value and creates every other combination unpriced and inactive.</p>
      </section>

      {family.options.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold text-sm text-navy flex items-center gap-2"><Layers size={16} /> Merge another product in as a variant</h3>
          <select className={INPUT} value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
            <option value="">Choose a single-variant product…</option>
            {mergeable.map((f) => <option key={f.id} value={f.id}>{f.name}{f.variants[0].code ? ` (#${f.variants[0].code})` : ""}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {family.options.map((o) => (
              <select key={o.id} className={`${INPUT} w-48`} value={mergePick[o.id] ?? ""} onChange={(e) => setMergePick({ ...mergePick, [o.id]: e.target.value })}>
                <option value="">{o.name}…</option>
                {o.values.map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}
              </select>
            ))}
          </div>
          <button type="button" className="px-3 py-2 rounded-lg bg-navy text-white text-sm disabled:opacity-40"
            disabled={busy || !mergeSource || family.options.some((o) => !mergePick[o.id])}
            onClick={() => act(() => api.post(`/admin/catalog/families/${family.id}/merge`, {
              sourceFamilyId: mergeSource, optionValueIds: family.options.map((o) => mergePick[o.id]),
            })).then(() => { setMergeSource(""); setMergePick({}); })}>
            Merge
          </button>
        </section>
      )}
    </div>
  );
}

export function AdminCatalogPage() {
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/admin/catalog/families");
      setFamilies(res.data.data.families);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function onFamilyChange(updated) {
    setFamilies((fs) => fs.map((f) => (f.id === updated.id ? updated : f)));
    load(); // a merge deletes the source family, so refresh the list too
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return families.filter((f) =>
      (channel === "all" || f.channel === channel) &&
      (!q || f.name.toLowerCase().includes(q) || f.variants.some((v) => (v.code ?? "").includes(q))));
  }, [families, query, channel]);
  const selected = families.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="font-heading font-bold text-2xl text-navy mb-1">Catalog</h1>
      <p className="text-sm text-navy/50 mb-6">Products, their options and base prices. Client-specific prices live on each client's Pricing page.</p>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
      <div className="grid md:grid-cols-[22rem_1fr] gap-6">
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-navy/30" />
            <input className={`${INPUT} pl-9`} placeholder="Search name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {CHANNELS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setChannel(k)} className={`px-3 py-1 rounded-full text-xs ${channel === k ? "bg-navy text-white" : "bg-surface-100 text-navy/70"}`}>{label}</button>
            ))}
          </div>
          <NewFamilyForm onCreated={(f) => { setFamilies((fs) => [f, ...fs]); setSelectedId(f.id); }} />
          {loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-navy/40" /></div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto divide-y divide-surface-300/40 rounded-xl border border-surface-300/50">
              {filtered.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => setSelectedId(f.id)} className={`w-full text-left px-3 py-2 ${f.id === selectedId ? "bg-brand-50" : "hover:bg-surface-50"}`}>
                    <span className={`block text-sm ${f.active ? "text-navy" : "text-navy/40 line-through"}`}>{f.name}</span>
                    <span className="block text-xs text-navy/40">{familyBadge(f)}{f.variants.length === 1 && f.variants[0].basePriceCents != null ? ` · ${formatCents(f.variants[0].basePriceCents)}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>{selected ? <FamilyDetail family={selected} families={families} onChange={onFamilyChange} /> : <p className="text-sm text-navy/40">Select a product.</p>}</div>
      </div>
    </div>
  );
}

function NewFamilyForm({ onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const res = await api.post("/admin/catalog/families", { name: name.trim(), slug, channel: "shop" });
      onCreated(res.data.data.family);
      setName("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <input className={INPUT} placeholder="New product name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" disabled={busy || !name.trim()} onClick={create} className="px-3 rounded-lg bg-navy text-white disabled:opacity-40"><Plus size={16} /></button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
```

In `apps/web/src/App.jsx` replace `import { AdminProductsPage } from "./pages/app/AdminProductsPage.jsx";` with `import { AdminCatalogPage } from "./pages/app/AdminCatalogPage.jsx";` and the route element `<AdminProductsPage />` with `<AdminCatalogPage />` (path `/admin/products` stays, so existing nav links work). Then `git rm apps/web/src/pages/app/AdminProductsPage.jsx`.

- [ ] **Step 4: Run tests and build**

Run: `cd apps/web && pnpm vitest run && pnpm build`
Expected: PASS; build succeeds; `grep -rn "AdminProductsPage" src` returns nothing.

- [ ] **Step 5: Smoke-test**

With dev servers running against the worktree DB, as an admin: open Catalog, select Olmos Night (expect 16 variants under Design × Material); add a value "Milled" to Material (expect new unpriced inactive combinations); price one and activate it; try activating an unpriced one (expect the inline error). Report what you saw.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(admin): catalog page — families, options, variant prices, merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Client pricing page

**Files:**
- Create: `apps/web/src/pages/app/AdminClientPricingPage.jsx`, `apps/web/src/pages/app/AdminClientPricingPage.test.jsx`
- Modify: `apps/web/src/App.jsx` (route), `apps/web/src/config/routes.js` (constant), `apps/web/src/pages/app/AdminUsersPage.jsx` (link per row)

**Interfaces:**
- Consumes: `GET/PUT/DELETE /admin/clients/:userId/prices…`, `POST …/prices/review`, `GET /admin/catalog/families` (variant picker); `parsePriceInput` (13); `formatCents` (12).
- Produces: route `/admin/users/:userId/pricing`; exported pure `priceDelta(priceCents, basePriceCents) → string` (e.g. `"−10%"`, `"+5%"`, `""` when base is null or equal).

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/app/AdminClientPricingPage.test.jsx`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { priceDelta } from "./AdminClientPricingPage.jsx";

test("the delta against base is shown as a rounded percentage", () => {
  assert.equal(priceDelta(40500, 45000), "−10%");
  assert.equal(priceDelta(47250, 45000), "+5%");
  assert.equal(priceDelta(45000, 45000), "");
  assert.equal(priceDelta(100, null), "");
  assert.equal(priceDelta(0, 2000), "−100%");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run src/pages/app/AdminClientPricingPage.test.jsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

`apps/web/src/pages/app/AdminClientPricingPage.jsx`:

```jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Trash2, CheckCircle } from "lucide-react";
import api from "../../config/api.js";
import { formatCents } from "../../lib/money.js";
import { parsePriceInput } from "./AdminCatalogPage.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";
const errorText = (err) => err.response?.data?.error?.message || "Something went wrong.";

export function priceDelta(priceCents, basePriceCents) {
  if (basePriceCents == null || basePriceCents === 0 || priceCents === basePriceCents) return "";
  const pct = Math.round(((priceCents - basePriceCents) / basePriceCents) * 100);
  return pct < 0 ? `−${Math.abs(pct)}%` : `+${pct}%`;
}

export function AdminClientPricingPage() {
  const { userId } = useParams();
  const [prices, setPrices] = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pick, setPick] = useState({ variantId: "", price: "" });

  async function load() {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.get(`/admin/clients/${userId}/prices`),
        api.get("/admin/catalog/families"),
      ]);
      setPrices(p.data.data.prices);
      setVariants(c.data.data.families.flatMap((f) => f.variants.map((v) => ({ ...v, familyName: f.name }))));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [userId]);

  const unreviewed = useMemo(() => prices.filter((p) => !p.reviewedAt), [prices]);

  async function call(fn) {
    setError(null);
    try { const res = await fn(); if (res.data.data.prices) setPrices(res.data.data.prices); else await load(); }
    catch (err) { setError(errorText(err)); }
  }

  function save() {
    const priceCents = parsePriceInput(pick.price);
    if (priceCents == null) { setError("Enter a price in dollars, e.g. 405.00"); return; }
    call(() => api.put(`/admin/clients/${userId}/prices/${pick.variantId}`, { priceCents }))
      .then(() => setPick({ variantId: "", price: "" }));
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm text-navy/50 hover:text-navy"><ArrowLeft size={14} /> Users</Link>
      <h1 className="font-heading font-bold text-2xl text-navy">Client pricing</h1>
      {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

      {unreviewed.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 text-amber-800 text-sm flex flex-wrap items-center gap-3">
          {unreviewed.length} price{unreviewed.length === 1 ? " was" : "s were"} inferred from past invoices and {unreviewed.length === 1 ? "hasn't" : "haven't"} been checked.
          They are already being charged.
          <button type="button" className="ml-auto inline-flex items-center gap-1 font-medium"
            onClick={() => call(() => api.post(`/admin/clients/${userId}/prices/review`, { variantIds: unreviewed.map((p) => p.variantId) }))}>
            <CheckCircle size={16} /> Mark all reviewed
          </button>
        </div>
      )}

      {loading ? <Loader2 className="animate-spin text-navy/40" /> : (
        <table className="w-full text-left rounded-xl border border-surface-300/50 overflow-hidden">
          <thead className="bg-surface-50 text-xs text-navy/50 uppercase">
            <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Base</th><th className="px-3 py-2">Client price</th><th className="px-3 py-2">Source</th><th /></tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-t border-surface-300/40 text-sm">
                <td className="px-3 py-2">{p.variantName}</td>
                <td className="px-3 py-2 text-navy/60">{p.variantCode ?? "—"}</td>
                <td className="px-3 py-2 text-navy/60">{p.basePriceCents == null ? "—" : formatCents(p.basePriceCents)}</td>
                <td className="px-3 py-2 font-medium">{formatCents(p.priceCents)} <span className="text-xs text-navy/40">{priceDelta(p.priceCents, p.basePriceCents)}</span></td>
                <td className="px-3 py-2 text-xs">{p.source}{!p.reviewedAt && <span className="ml-1 text-amber-600">· unreviewed</span>}</td>
                <td className="px-3 py-2">
                  <button type="button" aria-label="Remove" className="text-navy/40 hover:text-red-600"
                    onClick={() => call(() => api.delete(`/admin/clients/${userId}/prices/${p.variantId}`))}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {prices.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-navy/40 text-sm">No negotiated prices — this client pays base prices.</td></tr>}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select className={`${INPUT} md:w-96`} value={pick.variantId} onChange={(e) => setPick({ ...pick, variantId: e.target.value })}>
          <option value="">Set a price for…</option>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.familyName === v.name ? v.name : `${v.familyName} — ${v.name}`}{v.code ? ` (#${v.code})` : ""}</option>)}
        </select>
        <input className={`${INPUT} w-32`} placeholder="0.00" value={pick.price} onChange={(e) => setPick({ ...pick, price: e.target.value })} />
        <button type="button" disabled={!pick.variantId || !pick.price} onClick={save} className="px-4 py-2.5 rounded-lg bg-navy text-white text-sm disabled:opacity-40">Save price</button>
      </div>
    </div>
  );
}
```

Note `parsePriceInput("")` returns `null`, which `save` rejects — a client price can be $0.00 (`"0"` → `0`) but not blank.

`apps/web/src/config/routes.js`: add `ADMIN_CLIENT_PRICING: "/admin/users/:userId/pricing",` after `ADMIN_USERS`.

`apps/web/src/App.jsx`: import `{ AdminClientPricingPage }` and add next to the `/admin/users` route:

```jsx
          <Route path="/admin/users/:userId/pricing" element={<AdminClientPricingPage />} />
```

`apps/web/src/pages/app/AdminUsersPage.jsx`: add `import { Link } from "react-router-dom";` (if not already imported) and, in the last `<td>` of the `filtered.map((u) => (` row (~line 378), when `u.role === "doctor"`, add:

```jsx
<Link to={`/admin/users/${u.id}/pricing`} className="text-xs font-medium text-brand-600 hover:text-brand-700">Pricing</Link>
```

- [ ] **Step 4: Run tests and build**

Run: `cd apps/web && pnpm vitest run && pnpm build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(admin): per-client pricing page with inferred-price review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Whole-piece verification and PR into the branch

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
cd /Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab
pnpm test
(cd apps/api && pnpm db:generate)        # expect "No schema changes"
(cd apps/web && pnpm build)
grep -rn "TAX_RATE\|SHIPPING_FLAT\|useCatalogStore\|function round2" apps/ --include=*.js --include=*.jsx | grep -v node_modules
```

Expected: all tests pass; no schema drift; build succeeds; the grep prints only `apps/api/src/lib/money.js`'s `round2`.

- [ ] **Step 2: File-count check (CodeRabbit skips >150 files)**

Run: `git diff --name-only origin/feat/own-the-lab...HEAD | wc -l`
Expected: well under 150. If not, stop and report.

- [ ] **Step 3: Push the piece branch and open the PR into `feat/own-the-lab`**

The work above is on `feat/own-the-lab-1-catalog` (cut in Task 1). Before pushing, check CodeRabbit capacity: look at the repo's PRs from the last hour for "Review paused" notices; if one is active, wait and report rather than push.

```bash
git push origin feat/own-the-lab-1-catalog
gh pr create --base feat/own-the-lab --head feat/own-the-lab-1-catalog \
  --title "Own the lab · piece 1: catalog & pricing" \
  --body "$(cat <<'EOF'
Piece 1 of retiring Seazona (roadmap: docs/superpowers/specs/2026-10-05-own-the-lab-roadmap.md).

- Owned catalog: families → options → variants, imported from the Seazona products mirror with an explicit Rx family seed.
- Client negotiated prices, entered per client by staff (inference from invoice history is deferred to the migration piece).
- One integer-cents pricing service used by the shop catalog, cart quote and checkout.
- Shop reads the catalog from the API with option pickers; checkout shows the server quote.
- Admin Catalog page and per-client Pricing page.

Merges into feat/own-the-lab, not main. No Seazona writes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm the review actually ran**

After CodeRabbit posts, check for real inline findings, not just the walkthrough. Address its notes in one batched push.
