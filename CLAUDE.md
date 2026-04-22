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
- **Seazona** — `https://diamondapi.labzona.net/`, Basic auth. Client lookup, invoices, payments. Note: `v1/clients/` list endpoint returns 404; use `v1/clients/login-exists?email=` for email check, `v1/products` works.
- **Authorize.net** — Production credentials (NOT sandbox). Uses JSON API directly, Accept.js for PCI-compliant card tokenization on frontend. CIM for saved cards.

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