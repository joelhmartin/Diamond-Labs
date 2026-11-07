# Diamond Orthotic Laboratory marketing site

The marketing pages (`apps/web/src/pages/marketing/`, `components/marketing/`) follow the design rules below. Home is the visual bar: an interior page that looks plainer than Home is unfinished.

The original "cinematic multi-page builder" brief that this site started from (aesthetic presets, per-page section lists, Unsplash imagery, live-software cards, required sliders, pull-quotes, stat bars) is superseded by the Global Design Rules for this site. Do not build from it.

---

## Global Design Rules (Apply to Every Page)

- **Noise texture overlay** — rendered once by `MarketingLayout` (SVG `<feTurbulence>`, about 0.05 opacity, see `.noise-overlay`). Pages do not add their own.
- **Visual richness** — every page has a hero with imagery, appliance imagery below the fold, and a rhythm of light and dark sections. No screenful is only text on a pale background. Remove fake stats and filler copy, not visuals. `pages/marketing/DigitalWorkflow.jsx` is the reference.
- **Rounded containers** — `border-radius: 2rem` to `3rem` on cards, panels and images. Use white cards, glass panels on dark, icon tiles and large rounded photos freely.
- **Navbar** — Fixed, pill-shaped, centered. Transparent at hero top, morphs to frosted glass (`backdrop-blur-xl`) on scroll. Contains logo text, page links, CTA button.
- **Footer** — Dark background, `border-radius: 4rem 4rem 0 0`. Brand name, nav columns (sentence-case headings), legal links. No status indicator.
- **Colour roles** — `navy` and the `HeroStage` gradient for dark sections and heroes; `accent-500` for the primary action; on light backgrounds use `brand-700`, not `brand-500`, for text; supporting text at least `navy/70` on light and `on-dark/60` on dark. No off-palette decoration.
- **Type** — Plus Jakarta Sans for headings and body. Cormorant italic for hero accent lines, sequence numerals and dark-section accents. IBM Plex Mono for technical values.
- **Shared components** — marketing pages use `PageHero` (with a `product` cut-out), `HeroStage`, `SectionHeading`, `CtaBand` (with `product` for the dark closing panel), `StatRow` and `Reveal` from `components/marketing/`. Do not build per-page versions of these.
- **Motion** — a hero intro and section reveals through `lib/playOnView`, with hover lift on clickable cards. Content is never hidden in markup and never stuck hidden. New motion checks `lib/reducedMotion`.
- **Sliders and pinned sections** — use them where the content calls for it (a gallery, a true sequence), not as a per-page quota. Sliders are full-width, touch-enabled, with custom arrows.
- **Button micro-interactions** — `scale(1.03)` hover with spring easing. Overflow-hidden with sliding background span. No flat hover color swaps.
- **Olmos policy** — Product names stay (Olmos Series, Day, Night, Orthotic, Neuromuscular Device/Positioner). Dr. Olmos has no menu link, feature or portrait outside his own page at `/about/dr-olmos`; a factual name mention on Courses and Certified Labs is fine. Lab positioning built on his name ("Olmos-Method", "Olmos Protocol", "built around the Olmos Series") is not used.
- **Labels** — sentence case; no tracked all-caps eyebrows above headings that already say it.
- **Copy** — plain and factual: no superlatives ("only", "premier", "gold standard", "global authority"), no invented figures, and no clinical claim that cannot be traced to the lab. Material and process claims name the cases they cover (digital cases, printed appliances); the site also sells acrylic and thermoform.
- **Contact details** — phone and email are always `tel:` / `mailto:` links. Cases are sent by approved doctors through the Rx form in the account portal; others call the lab.

---

## Technical Spec

- **Stack:** React + Vite, Tailwind CSS, GSAP 3 (ScrollTrigger, Observer), Lucide React icons
- **Routing:** React Router v6 — full SPA with `<Link>` navigation, no page reloads
- **Fonts:** Plus Jakarta Sans (body and headings), Cormorant italic (hero accent line), IBM Plex Mono (technical values)
- **Images:** The lab's own appliance photos in `apps/web/public/images`. No stock that does not depict the lab's work.
- **Responsive:** Mobile-first. Hero font scales. Cards stack. Navbar collapses to hamburger.
- **Animation pattern:** All GSAP inside `gsap.context()` + `useEffect`. Cleanup with `ctx.revert()`. Easing: `power3.out` for entrances, `power2.inOut` for morphs.

---

## Project Architecture

### Monorepo Structure
- **pnpm workspaces + Turborepo** — `apps/web`, `apps/api`, `packages/shared`
- **Frontend:** React + Vite at `apps/web/`
- **Backend:** Fastify v5 + Drizzle ORM at `apps/api/`, on Cloud Run
- **Deploy:** ONE Cloud Run service for both. `apps/api/Dockerfile` builds
  `apps/web` and bakes `apps/web/dist` into the API image; Fastify serves the SPA
  and `/api/v1` from the same origin. Push to `main` fires the `deploy-api-on-main`
  Cloud Build trigger (`cloudbuild.yaml`: build → push → migrate → deploy).
  There is no separate frontend host and no second deploy pipeline — if you are
  looking for one, it does not exist.
- **Shared:** Zod schemas, roles/permissions, error codes at `packages/shared/`

### Backend Stack
- **Fastify** — REST API at `/api/v1/`
- **Drizzle ORM** — PostgreSQL schema + migrations (`apps/api/src/db/schema/`)
- **jose** — JWT access/refresh tokens
- **bcrypt** — password hashing
- **Resend** — transactional email
- **Redis** — rate limiting, temporary tokens (magic links, MFA setup, etc.)

### Database
- **Local:** PostgreSQL at `postgresql://bif@localhost:5432/diamond_labs` (native install, not Docker)
- **Production:** Cloud SQL Postgres 15 on GCP project `diamond-labs-prod`, instance `diamond-labs-db`, IP `34.45.85.116`
- **Migrations:** `cd apps/api && pnpm db:generate && pnpm db:migrate`
- **Drizzle config** uses `dotenv/config` — needs `.env` symlinked or present in `apps/api/`

### Authentication & Roles
- JWT + httpOnly refresh cookie auth
- User roles: `user`, `doctor`, `admin` (enum on users table)
- Doctors require admin approval (`approvalStatus`: pending → approved/rejected)
- Doctor registration → admin email with approve/reject links → one-click approval
- Middleware: `authenticate.js` (JWT), `authorize.js` (membership RBAC), `require-role.js` (user-level role guards)

### External APIs

#### Seazona (lab management — clients, invoices, orders, payments)

Source of truth for clients (doctors), invoices, orders, and recorded payments. Our DB stores `users.seazonaClientId` + `users.seazonaAccountNumber` to link a doctor to their Seazona client record.

- **Base URL:** `https://diamond.seazonaapi.net/` (env `SEAZONA_BASE_URL`) — **trailing slash required** (the wrapper joins `${BASE_URL}v1/...`). The old `https://diamondapi.labzona.net/` host was retired 2026-06-15 (returned 403 from everywhere); creds were rotated to a UUID Client ID + 64-hex Client Secret on the new host.
- **Auth:** HTTP Basic — `Authorization: Basic base64(SEAZONA_API_KEY:SEAZONA_SECRET)`. Seazona's portal labels these "Client ID" / "Client Secret"; the code still reads them under the `SEAZONA_API_KEY` / `SEAZONA_SECRET` env names (values-only swap, no rename).
- **Content-Type:** `application/json` on every request — applied AFTER caller headers in the wrapper so it (and `Authorization`) can't be overridden.
- **Wrapper:** `apps/api/src/services/seazona.service.js` — `requestRaw()` returns `{ ok, status, data }`; the `request()` convenience wrapper returns `data` (or `null` on any failure; `[]` for list helpers). On non-2xx/network error it logs a `[Seazona] … → <status>` line (matched by the GCP alert) and never throws — routes must handle `null`/empty. Reachability-aware helpers `getInvoicesResult()` / `getAllInvoicesResult()` return `{ reachable, invoices }` so callers can tell "unreachable" from "empty"; `checkHealth()` backs `GET /api/v1/health/seazona`.

**🛑 Rate limit — Seazona blocks the whole host IP when it's exceeded** (`403 API access is temporarily disabled for this host`; it has happened twice: Aug and Oct 2026, the second time from bulk history pulls). Documented limit is **60 requests/minute**, and it's shared by everything on that IP. Rules:
- **Never call Seazona except through `seazona.service.js`** — it enforces the 60/min limit. No raw `fetch`/`curl` loops, no hand-rolled wrappers in scripts.
- **One stream at a time.** Never run two Seazona-calling processes in parallel.
- **Anything over ~100 requests needs the user's OK first**, with the request count and how long it will take at 60/min.
- **Never bulk-call from Cloud Run/prod** — a block there takes down the live portal.

**Endpoints (use exactly these paths — 404s on small variations):**

| Method | Path | Notes |
|---|---|---|
| GET | `v1/clients/?lastModified=` | **Trailing slash + empty `lastModified` query param are both required.** Without the query the API 400s. Empty string returns everything. |
| GET | `v1/clients/login-exists?email=<urlencoded>` | Cheap "does this email exist" check. Returns client object or null. |
| GET | `v1/clients/:id` | Single client. |
| GET | `v1/invoices/?lastModified=<ISO>` | Same gotcha — `lastModified` is required. We default to `1900-01-01T00:00:00Z` to mean "everything". |
| GET | `v1/invoices/:id` | Single invoice. |
| GET | `v1/orders/?ordered=<ISO>` | Required `ordered` query param (NOT `lastModified`). Empty = 400. Default to `1900-01-01T00:00:00Z`. |
| GET | `v1/orders/:id` | Returns order with products, files, settings. |
| POST | `v1/payments/` | Body: `{ clientId, accountNumber, referenceNumber, notes, amount }`. |
| GET | `v1/products` | Works as expected. |

**Known gotchas:**
- There is **no list endpoint for `/v1/payments/`** — payment reconciliation by querying the API in bulk is not possible. We record each payment individually after charging via Authorize.net.
- The `status` field on an invoice is a workflow state (`Shipped`, `Hold`, `In Production`, …), **not** paid/unpaid. Don't write logic that treats it as a payment status.
- `listClients()` does the brute force fetch-all + in-memory filter for things like phone lookup (`findClientByPhone`). There's no server-side filter for these.

**Real Seazona invoice shape (live):**
```
{ id, invoiceNumber, patient, clientId, fullName, company,
  sales, tax, discounts, total, status, due, lastModified }
```
The frontend renders the normalized shape produced by `normalizeInvoice()` in `apps/api/src/routes/invoice.routes.js`.

**Bulk import:** `pnpm db:import-seazona` (wraps `apps/api/src/db/import-seazona-clients.js`) creates doctor users + accounts + memberships from `listClients()`. Idempotent — skips by `seazonaClientId` link or matching email. `DRY_RUN=1 pnpm db:import-seazona` previews. Imported users have `passwordHash=null` and must complete a password reset before login.

#### Authorize.net (card processing — direct JSON API + Accept.js)

**Production credentials, not sandbox.** All card data is tokenized in the browser via Accept.js — the backend only ever sees opaque nonces (`dataDescriptor` + `dataValue`). CIM stores cards on file for approved doctors; guest checkout charges without storing.

- **Wrapper:** `apps/api/src/services/authorizenet.service.js` — direct `fetch` against the JSON XML endpoint. We do **not** use the official `authorizenet` npm package.
- **Endpoint:** `https://api.authorize.net/xml/v1/request.api` (production) / `https://apitest.authorize.net/xml/v1/request.api` (sandbox), selected via `AUTHORIZE_NET_ENV`.
- **Auth (every payload):** `merchantAuthentication: { name: AUTHORIZE_NET_API_LOGIN, transactionKey: AUTHORIZE_NET_TRANSACTION_KEY }`.
- **Response quirk:** Authorize.net responses are prefixed with a UTF-8 BOM (`﻿`). `apiRequest()` strips it before `JSON.parse` — don't `res.json()` directly or it'll throw on the BOM.
- **Error shape:** `messages.resultCode !== "Ok"` → throw with `err.authNetResponse = data`. Caller can introspect.

**Backend service exports** (`authorizenet.service.js`):

| Function | Authorize.net request | Returns |
|---|---|---|
| `chargeWithNonce({ amount, opaqueData, description, invoiceNumber })` | `createTransactionRequest` (`authCaptureTransaction`) | `{ transactionId, responseCode, authCode }` |
| `createCustomerProfile({ email, description })` | `createCustomerProfileRequest` | `customerProfileId` |
| `addPaymentProfileFromNonce({ customerProfileId, opaqueData })` | `createCustomerPaymentProfileRequest` (`validationMode` = liveMode in prod) | `customerPaymentProfileId` |
| `listPaymentProfiles(customerProfileId)` | `getCustomerProfileRequest` (`includeIssuerInfo: "true"`) | `[{ paymentProfileId, cardNumber (masked XXXX1234), cardType, expirationDate }]` |
| `chargeCustomerProfile({ customerProfileId, paymentProfileId, amount, invoiceNumber })` | `createTransactionRequest` with `profile.{customerProfileId,paymentProfile.paymentProfileId}` | `{ transactionId, responseCode, authCode }` |
| `deletePaymentProfile({ customerProfileId, paymentProfileId })` | `deleteCustomerPaymentProfileRequest` | void |

**API routes** (`apps/api/src/routes/payment.routes.js`, all under `/api/v1`):

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/payments/checkout` | public | `{ opaqueData, amount, items, email, shipping{name,address1,city,state,postalCode}, phone? }` — guest catalog checkout, **no CIM**. Generates `invoiceNumber = DOL-<last8 of Date.now()>`. |
| POST | `/payments/charge` | doctor (approved) | `{ opaqueData, amount, allocations[], description? }` — after the charge, records ONE account-level `seazonaService.createPayment` for the whole charge (see pairing rule) and one local `invoice_payments` row per allocation. |
| GET | `/payments/saved-cards` | doctor | — |
| POST | `/payments/saved-cards` | doctor | `{ opaqueData }` — lazily creates the user's `authorizeNetCustomerProfileId` if missing, persists it on `users`. |
| DELETE | `/payments/saved-cards/:profileId` | doctor | — |
| POST | `/payments/charge-saved` | doctor | `{ paymentProfileId, amount, allocations[] }` — records the same one account-level Seazona payment + local per-allocation ledger as `/payments/charge`. |

**Pairing rule (charge → record):** every successful Authorize.net charge associated with a Seazona client must be followed by a Seazona payment write. Seazona's payment API has **no invoice-level granularity** (`GET /v1/payments/` → 405; create + get-one-by-id only), so the routes record **ONE account-level** `seazonaService.createPayment({ clientId, accountNumber, referenceNumber, notes, amount })` per charge — where `referenceNumber` is the `"Invoices <num>, <num>"` token Seazona's report parses to attribute the payment to specific invoices (by invoice NUMBER, verified live 2026-06-10), and `amount` is the full charge total. The per-invoice split is captured in the local `invoice_payments` ledger, all rows sharing the one `seazonaPaymentId`. Do NOT refactor this into N separate Seazona payments — that creates N account-level credits and breaks reconciliation. This funnels through `recordPaymentAndAllocations()` in `payment.routes.js`; if `createPayment` returns no id after a successful charge it logs an alertable `[Seazona][PAYMENT_WRITE_FAILED]` line (never throws — can't un-charge a card).

**Paid/balance is NOT readable from Seazona** — even with full API permissions: invoices carry `total`/`due`(date)/`status`(workflow), no paid flag; clients carry no balance; `/v1/payments/` is write-only; ledger/statement endpoints 404. The portal's paid/balance state therefore comes from the local `invoice_payments` ledger (auto-marks an invoice paid when its portal balance hits 0); payments staff enter directly in Seazona are invisible to the portal.

**Frontend Accept.js integration:**
- Script tag in `apps/web/index.html`: `https://js.authorize.net/v1/Accept.js` (swap to `https://jstest.authorize.net/v1/Accept.js` for sandbox).
- `apps/web/src/main.jsx` exposes the public keys to `window`: `__AUTHORIZE_NET_API_LOGIN__` and `__AUTHORIZE_NET_CLIENT_KEY__`, sourced from Vite env (`VITE_AUTHORIZE_NET_API_LOGIN`, `VITE_AUTHORIZE_NET_CLIENT_KEY`). The **client key is public-safe**; the transaction key must never reach the bundle.
- Tokenization call: `window.Accept.dispatchData({ authData: { apiLoginID, clientKey }, cardData: {...} }, callback)` — see `apps/web/src/components/doctor/PaymentModal.jsx` and `apps/web/src/pages/marketing/Checkout.jsx`. The callback receives `response.opaqueData`, which is what gets POSTed to our backend.

**Required env vars:**
```
SEAZONA_API_KEY=
SEAZONA_SECRET=
SEAZONA_BASE_URL=https://diamond.seazonaapi.net/   # trailing slash required
AUTHORIZE_NET_API_LOGIN=
AUTHORIZE_NET_TRANSACTION_KEY=
AUTHORIZE_NET_ENV=production            # or "sandbox"
VITE_AUTHORIZE_NET_API_LOGIN=           # mirrors API_LOGIN, public
VITE_AUTHORIZE_NET_CLIENT_KEY=          # public client key from the merchant portal
```

### Environment
- `.env` lives at project root, symlinked to `apps/api/.env` for Drizzle
- API dev/start scripts use `node --env-file=.env`
- GCP secrets stored in Secret Manager on `diamond-labs-prod`
- `project.config.js` at repo root — imported by API with relative paths (3 levels from `src/`, 4 from `src/config/`)

### Key File Paths
- DB schemas: `apps/api/src/db/schema/*.js`
- Services: `apps/api/src/services/` (auth, email, seazona, authorizenet)
- Routes: `apps/api/src/routes/` (auth, user, account, member, invitation, invoice, payment, health)
- Frontend pages: `apps/web/src/pages/` (marketing, auth, app, doctor)
- Auth store: `apps/web/src/stores/auth.store.js` (Zustand)
- Route config: `apps/web/src/config/routes.js`
- 3D models: `apps/web/public/models/` (OBJ+MTL for 4 products)
- Downloads: `apps/web/public/downloads/` (PDFs)