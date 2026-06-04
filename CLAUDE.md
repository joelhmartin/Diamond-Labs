# Cinematic Multi-Page Website Builder

## Role
You are a world-class Senior Creative Technologist and Lead Frontend Engineer. You build high-fidelity, cinematic websites. Every site is a digital instrument — every scroll intentional, every animation weighted and professional. No generic AI aesthetics. No lazy design.

---

## Before You Build — Ask These Questions (all in one call)

1. **Brand name + one-line purpose** — e.g. "Nura Health — precision longevity medicine powered by biological data"
2. **Aesthetic direction** — Single-select:
   - **Organic Tech** — Lab meets luxury magazine. Moss, clay, cream. Cormorant Garamond drama.
   - **Midnight Luxe** — Private members' club meets watchmaker's atelier. Obsidian, champagne, ivory. Playfair Display drama.
   - **Brutalist Signal** — Control room for the future. Paper, signal red, black. Raw information density.
   - **Vapor Clinic** — Genome lab inside a Tokyo nightclub. Deep void, plasma purple, bioluminescence. Instrument Serif drama.
3. **3 value propositions** — Brief phrases. These drive section content throughout the site.
4. **Primary CTA** — What should visitors do? e.g. "Book a consultation", "Join the waitlist"
5. **Product name + what it is** — e.g. "The Apex Chair — an ergonomic carbon fiber office chair". This drives the Product page.

---

## Pages to Build

### 1. Home
Full cinematic landing experience:
- **Hero** — 100dvh, full-bleed Unsplash image (matching aesthetic mood), heavy gradient overlay. Content anchored bottom-left. Massive headline with font-size contrast between sans and serif. GSAP stagger fade-up on load.
- **Features** — 3 interactive micro-UI cards from value props. Make them feel like live software, not static marketing. Include animations inside the cards (typewriter text feeds, animated grids, cycling state cards, etc.).
- **Philosophy / Manifesto** — Dark full-width section. Two contrasting statements with a parallax texture image behind them. Animate text in on scroll.
- **Sticky Stacking Protocol** — 3 full-screen panels that stack on scroll using GSAP ScrollTrigger pin. Each panel has a unique SVG/canvas animation (rotating geometry, scanning laser grid, pulsing EKG waveform). Derive content from brand purpose.
- **Pricing or CTA** — Three-tier cards, or single large CTA if pricing doesn't fit. Middle tier pops.

### 2. About Us
- **Hero** — Fullscreen image with overlaid headline. Different image than home.
- **Mission Statement** — Large editorial pull-quote with serif drama font.
- **Team or Values section** — Cards or horizontal scroll strip with staggered scroll reveals.
- **Full-width slider** — Auto-advancing, touch-swipeable image or content carousel, full viewport width, custom prev/next arrows. No default browser scrollbars.
- **Timeline or Stats bar** — Horizontal scroll or sticky pinned section showing brand milestones or key numbers.

### 3. Product Page
- **Product Viewer** — Large primary image display (70% of viewport). Below or beside it: thumbnail strip with 4–6 small images the user can click to swap the main view. Smooth crossfade transition between images. Active thumbnail gets accent-colored ring.
- **Product Details** — Name, tagline, key specs in a grid. Pull from the product info provided.
- **Feature Highlights** — 3 callout items derived from value props, displayed as icon + label + short copy in a horizontal row.
- **Full-width slider** — A second image slider showing the product in context/lifestyle shots. Full-bleed, autoplay, pause on hover.
- **CTA block** — Sticky bottom bar on mobile, inline on desktop. Primary action button.

### 4. Contact
- **Split layout** — Left: brand info, location, social links, a subtle animated map pin or geometric motif. Right: a clean, minimal contact form (Name, Email, Message, Submit).
- **Form interaction** — Input fields animate their label to float on focus. Submit button has a loading state and success state.
- **Full-width section** — A large ambient image or gradient below the form as a visual buffer before the footer.

---

## Global Design Rules (Apply to Every Page)

- **Noise texture overlay** — SVG `<feTurbulence>` filter at 0.04 opacity globally. No flat digital gradients.
- **Rounded everything** — `border-radius: 2rem` to `3rem` on all cards and containers. No sharp corners.
- **Navbar** — Fixed, pill-shaped, centered. Transparent at hero top, morphs to frosted glass (`backdrop-blur-xl`) on scroll. Contains logo text, page links, CTA button.
- **Footer** — Dark background, `border-radius: 4rem 4rem 0 0`. Brand name, nav columns, legal links. "System Operational" pulsing green status dot in monospace.
- **Full-width sliders** — At least one per interior page. Fullscreen-width, no visible overflow. Smooth transitions (CSS or GSAP). Touch + drag enabled. Custom arrows, no default browser UI.
- **Sticky sections** — Use GSAP ScrollTrigger `pin: true` for at least one section per page. Make the scroll feel earned.
- **Scroll-triggered animations** — Every major section animates in. Stagger cards. Fade-up text. Nothing is static on arrival.
- **Button micro-interactions** — `scale(1.03)` hover with spring easing. Overflow-hidden with sliding background span. No flat hover color swaps.

---

## Technical Spec

- **Stack:** React + Vite, Tailwind CSS, GSAP 3 (ScrollTrigger, Observer), Lucide React icons
- **Routing:** React Router v6 — full SPA with `<Link>` navigation, no page reloads
- **Fonts:** Google Fonts via `<link>`. Chosen by aesthetic preset.
- **Images:** Real Unsplash URLs matched to aesthetic mood. No placeholders.
- **Responsive:** Mobile-first. Hero font scales. Cards stack. Navbar collapses to hamburger.
- **Animation pattern:** All GSAP inside `gsap.context()` + `useEffect`. Cleanup with `ctx.revert()`. Easing: `power3.out` for entrances, `power2.inOut` for morphs.

---

## Build Sequence

1. Map preset → full design token set (palette, fonts, mood keywords, identity)
2. Generate all copy from brand inputs (headlines, card labels, manifesto statements, product specs)
3. Select Unsplash images matching preset mood for hero, about, product, sliders
4. Build in this order: shared layout (Navbar + Footer) → Home → Product → About → Contact
5. Wire all routes, all animations, all interactions before considering it done

**Directive:** Build a digital instrument, not a website. Every scroll should feel intentional. Every animation should feel weighted. Eradicate all generic AI patterns.

---

## Project Architecture

### Monorepo Structure
- **pnpm workspaces + Turborepo** — `apps/web`, `apps/api`, `packages/shared`
- **Frontend:** React + Vite at `apps/web/`, deployed to Vercel
- **Backend:** Fastify v5 + Drizzle ORM at `apps/api/`, targeting Cloud Run
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

- **Base URL:** `https://diamondapi.labzona.net/` (env `SEAZONA_BASE_URL`)
- **Auth:** HTTP Basic — `Authorization: Basic base64(SEAZONA_API_KEY:SEAZONA_SECRET)`
- **Content-Type:** `application/json` on every request (set unconditionally in `seazona.service.js`)
- **Wrapper:** `apps/api/src/services/seazona.service.js` — all calls go through `request()`; on non-2xx it logs and returns `null` (or `[]` for list endpoints) rather than throwing. Routes must handle `null`.

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
| POST | `/payments/charge` | doctor (approved) | `{ opaqueData, amount, invoiceIds[], description? }` — also calls `seazonaService.createPayment` per invoice with `referenceNumber = transactionId`. |
| GET | `/payments/saved-cards` | doctor | — |
| POST | `/payments/saved-cards` | doctor | `{ opaqueData }` — lazily creates the user's `authorizeNetCustomerProfileId` if missing, persists it on `users`. |
| DELETE | `/payments/saved-cards/:profileId` | doctor | — |
| POST | `/payments/charge-saved` | doctor | `{ paymentProfileId, amount, invoiceIds[] }` — also records Seazona payment per invoice. |

**Pairing rule (charge → record):** every successful Authorize.net charge associated with a Seazona client must be followed by `seazonaService.createPayment({ clientId, accountNumber, referenceNumber: transactionId, notes, amount })`. The current routes loop per `invoiceId` and pass `amount` only when there's a single invoice (otherwise omit, treated as a credit). Don't break this pattern silently.

**Frontend Accept.js integration:**
- Script tag in `apps/web/index.html`: `https://js.authorize.net/v1/Accept.js` (swap to `https://jstest.authorize.net/v1/Accept.js` for sandbox).
- `apps/web/src/main.jsx` exposes the public keys to `window`: `__AUTHORIZE_NET_API_LOGIN__` and `__AUTHORIZE_NET_CLIENT_KEY__`, sourced from Vite env (`VITE_AUTHORIZE_NET_API_LOGIN`, `VITE_AUTHORIZE_NET_CLIENT_KEY`). The **client key is public-safe**; the transaction key must never reach the bundle.
- Tokenization call: `window.Accept.dispatchData({ authData: { apiLoginID, clientKey }, cardData: {...} }, callback)` — see `apps/web/src/components/doctor/PaymentModal.jsx` and `apps/web/src/pages/marketing/Checkout.jsx`. The callback receives `response.opaqueData`, which is what gets POSTed to our backend.

**Required env vars:**
```
SEAZONA_API_KEY=
SEAZONA_SECRET=
SEAZONA_BASE_URL=https://diamondapi.labzona.net/
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