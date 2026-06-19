# Live Theme Editor + Color-System Tokenization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded Tailwind color system with CSS-variable tokens, then add an admin-only theme editor pop-out that saves a server-served override layer (palette, fonts, and a dark-section white⇄dark text toggle) which falls back to the untouched core.

**Architecture:** Four layers — (1) core palette/font tokens as channel-based CSS variables in `index.css`, with `tailwind.config.js` resolving every color through them; (2) semantic role tokens on top; (3) a server-stored override injected at app boot as one `<style id="theme-overrides">`; (4) an admin-only, flag-gated editor pop-out that previews live and persists via the API.

**Tech Stack:** React + Vite + Tailwind (web), Fastify v5 + Drizzle + Postgres (api), Zod in `@my-app/shared`, Vitest.

## Global Constraints

- **No hard-coded hex/rgb/rgba/hsl in UI chrome.** All chrome colors resolve through CSS variables. Content/data colors are exempt (see Non-Goals).
- **Palette tokens are space-separated RGB channels** (e.g. `--navy: 11 26 46;`), never hex, so Tailwind `/<alpha>` opacity modifiers keep working.
- **Core `index.css` `:root` is the permanent fallback** — never mutated by the app at runtime. Overrides only ever come from the injected `#theme-overrides` block.
- **Exactly one global theme** (single-row `app_theme` table, id `"singleton"`). No per-user themes.
- **Admin-only writes, server-enforced.** `PUT`/`DELETE /api/v1/theme` use `authenticate` + `requireAdmin`. `GET /api/v1/theme` is public.
- **Editor gating:** renders only when `import.meta.env.VITE_THEME_EDITOR === "on"` AND `useAuthStore.getState().user?.role === "admin"`.
- **Shared package import name:** `@my-app/shared`. Error codes via `ERROR_CODES` from it.
- **Out of scope (leave as data):** `rx-devices.js` SPORT_COLORS, `Artboard.jsx`/`Signature.jsx` canvas colors, `ModelViewer.jsx` Three.js lights, `logoFull.jsx`/`logoIcon.jsx` artwork.

---

## File Structure

**Create:**
- `apps/api/src/db/schema/app-theme.js` — single-row theme table.
- `apps/api/src/routes/theme.routes.js` — GET/PUT/DELETE `/theme`.
- `packages/shared/src/schemas/theme.schema.js` — `THEME_TOKEN_KEYS`, `FONT_TOKEN_KEYS`, validators, `themeUpdateSchema`.
- `apps/api/src/routes/__tests__/theme.schema.test.js` — Zod schema unit tests.
- `apps/web/src/lib/theme.js` — `applyTheme()`, `fetchTheme()`, `saveTheme()`, `resetTheme()`, `tokensToCss()`.
- `apps/web/src/components/theme/theme-tokens.js` — editor metadata (label, group, var, control, default) for each editable token.
- `apps/web/src/components/theme/ThemeEditor.jsx` — the pop-out.
- `apps/web/src/lib/__tests__/theme.test.js` — `tokensToCss` unit test.

**Modify:**
- `apps/web/src/index.css` — add `:root` core palette/font tokens + role tokens.
- `apps/web/tailwind.config.js` — colors → `rgb(var(--x) / <alpha-value>)`, fonts → `var(--font-*)`, add `on-dark` color.
- `apps/web/src/main.jsx` — boot-time override fetch + inject.
- `apps/web/src/App.jsx` — mount `<ThemeEditor />`.
- `apps/api/src/db/schema/index.js` — export `appTheme`.
- `apps/api/src/index.js` — register `themeRoutes`.
- `packages/shared/src/index.js` — export theme schema.
- Dark-section files — `text-white*` → `text-on-dark*` (Task 3).
- `apps/web/src/pages/marketing/Home.jsx` — SVG decoration hexes → tokens (Task 9).
- `apps/web/src/config/brand.js` — delete dead `#2563eb`/`#1d4ed8` (Task 9).

---

## Task 1: Core tokens + Tailwind variable refactor (no-op)

Convert the palette/fonts to CSS variables. This must render **identically** to before — a pure refactor.

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/tailwind.config.js`
- Test: `apps/web/tailwind.config.test.js`

**Interfaces:**
- Produces: CSS variables `--brand-50..950`, `--accent-400/500/600`, `--surface-50..400`, `--navy`, `--navy-light`, `--navy-dark` (channel triplets); `--font-sans/heading/drama/mono`. Tailwind colors `brand/accent/surface/navy` and fonts now resolve through them.

- [ ] **Step 1: Write the failing test** — assert no raw hex remains in the Tailwind color config and every color resolves through a CSS var.

Create `apps/web/tailwind.config.test.js`:
```js
import { describe, it, expect } from "vitest";
import config from "./tailwind.config.js";

describe("tailwind color tokens", () => {
  const colors = config.theme.extend.colors;
  const leaves = [];
  const walk = (o) => Object.values(o).forEach((v) =>
    typeof v === "string" ? leaves.push(v) : walk(v));
  walk(colors);

  it("every color value resolves through a CSS variable", () => {
    for (const v of leaves) expect(v).toMatch(/var\(--/);
  });
  it("no raw hex remains in color config", () => {
    for (const v of leaves) expect(v).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
  it("fonts resolve through CSS variables", () => {
    for (const v of Object.values(config.theme.extend.fontFamily))
      expect(v).toMatch(/var\(--font-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/web" && npx vitest run tailwind.config.test.js`
Expected: FAIL — current config has hex values, no `var(--`.

- [ ] **Step 3: Add core tokens to `index.css`** — insert this block at the very top of `apps/web/src/index.css`, before `@tailwind base;`:

```css
:root {
  /* ── Core palette (RGB channels; never hex — keeps Tailwind /alpha working) ── */
  --brand-50: 244 249 251;
  --brand-100: 227 241 247;
  --brand-200: 194 230 244;
  --brand-300: 157 216 241;
  --brand-400: 101 199 241;
  --brand-500: 19 174 239;
  --brand-600: 19 147 201;
  --brand-700: 19 115 155;
  --brand-800: 17 86 115;
  --brand-900: 13 56 74;
  --brand-950: 10 36 46;

  --accent-400: 251 185 77;
  --accent-500: 247 157 30;
  --accent-600: 217 133 10;

  --surface-50: 255 255 255;
  --surface-100: 247 247 245;
  --surface-200: 238 237 233;
  --surface-300: 226 224 219;
  --surface-400: 209 207 200;

  --navy: 11 26 46;
  --navy-light: 19 40 68;
  --navy-dark: 6 13 23;

  /* ── Font tokens ── */
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-heading: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-drama: "Cormorant Garamond", Georgia, serif;
  --font-mono: "IBM Plex Mono", monospace;
}
```
> Channel values are the exact decimal RGB of the current hex (verified: `#13AEEF` = `19 174 239`, `#0B1A2E` = `11 26 46`, `#F79D1E` = `247 157 30`, `#F7F7F5` = `247 247 245`, etc.).

- [ ] **Step 4: Flip `tailwind.config.js` colors and fonts to variables** — replace the entire `colors` and `fontFamily` blocks:

```js
colors: {
  brand: {
    50: "rgb(var(--brand-50) / <alpha-value>)",
    100: "rgb(var(--brand-100) / <alpha-value>)",
    200: "rgb(var(--brand-200) / <alpha-value>)",
    300: "rgb(var(--brand-300) / <alpha-value>)",
    400: "rgb(var(--brand-400) / <alpha-value>)",
    500: "rgb(var(--brand-500) / <alpha-value>)",
    600: "rgb(var(--brand-600) / <alpha-value>)",
    700: "rgb(var(--brand-700) / <alpha-value>)",
    800: "rgb(var(--brand-800) / <alpha-value>)",
    900: "rgb(var(--brand-900) / <alpha-value>)",
    950: "rgb(var(--brand-950) / <alpha-value>)",
  },
  accent: {
    400: "rgb(var(--accent-400) / <alpha-value>)",
    500: "rgb(var(--accent-500) / <alpha-value>)",
    600: "rgb(var(--accent-600) / <alpha-value>)",
  },
  surface: {
    50: "rgb(var(--surface-50) / <alpha-value>)",
    100: "rgb(var(--surface-100) / <alpha-value>)",
    200: "rgb(var(--surface-200) / <alpha-value>)",
    300: "rgb(var(--surface-300) / <alpha-value>)",
    400: "rgb(var(--surface-400) / <alpha-value>)",
  },
  navy: {
    DEFAULT: "rgb(var(--navy) / <alpha-value>)",
    light: "rgb(var(--navy-light) / <alpha-value>)",
    dark: "rgb(var(--navy-dark) / <alpha-value>)",
  },
},
fontFamily: {
  sans: "var(--font-sans)",
  heading: "var(--font-heading)",
  drama: "var(--font-drama)",
  mono: "var(--font-mono)",
},
```
> Note: `.hero-gradient` in `index.css` uses `theme(colors.brand.600)` / `theme(colors.surface.100)`. After this change `theme()` returns the `rgb(var(--…) / <alpha-value>)` string, which is valid CSS in a gradient stop. Verify visually in Step 6.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "apps/web" && npx vitest run tailwind.config.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Build + visual no-op check**

Run: `cd "apps/web" && npx vite build`
Expected: build succeeds, no errors.
Then run `npx vite preview`, open the site, and confirm Home hero, footer, `.hero-gradient` pages (CaseSubmission/Downloads/InstructionalVideos), and a brand-colored button look **identical** to before. Any color shift = a wrong channel triplet in Step 3; fix it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/index.css apps/web/tailwind.config.js apps/web/tailwind.config.test.js
git commit -m "refactor(theme): drive Tailwind colors/fonts from CSS variable tokens"
```

---

## Task 2: Semantic role tokens + `on-dark` color

Add the meaning-layer tokens and the Tailwind color the dark-text toggle binds to. No component changes yet — pure additions.

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/tailwind.config.js`
- Test: `apps/web/tailwind.config.test.js` (extend)

**Interfaces:**
- Produces: CSS vars `--color-page`, `--color-text`, `--color-primary`, `--color-accent`, `--color-border`, `--text-on-dark`, `--accent-on-dark`. Tailwind colors `on-dark` and `accent-on-dark`.

- [ ] **Step 1: Extend the test** — append to `apps/web/tailwind.config.test.js`:
```js
describe("semantic role colors", () => {
  it("exposes on-dark and accent-on-dark", () => {
    const c = config.theme.extend.colors;
    expect(c["on-dark"]).toMatch(/var\(--text-on-dark/);
    expect(c["accent-on-dark"]).toMatch(/var\(--accent-on-dark/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/web" && npx vitest run tailwind.config.test.js`
Expected: FAIL — `on-dark` undefined.

- [ ] **Step 3: Add role tokens** — append inside the `:root` block in `index.css` (after the font tokens):
```css
  /* ── Semantic role tokens (reference palette; what the editor exposes) ── */
  --color-page: var(--surface-100);
  --color-text: var(--navy);
  --color-primary: var(--brand-500);
  --color-accent: var(--accent-500);
  --color-border: var(--surface-300);
  --text-on-dark: 255 255 255;      /* white — flips to navy via the editor */
  --accent-on-dark: var(--accent-500);
```

- [ ] **Step 4: Add Tailwind colors** — add to the `colors` object in `tailwind.config.js`:
```js
  "on-dark": "rgb(var(--text-on-dark) / <alpha-value>)",
  "accent-on-dark": "rgb(var(--accent-on-dark) / <alpha-value>)",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "apps/web" && npx vitest run tailwind.config.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/index.css apps/web/tailwind.config.js apps/web/tailwind.config.test.js
git commit -m "feat(theme): add semantic role tokens and on-dark text color"
```

---

## Task 3: Swap dark-section text to `text-on-dark`

Bind dark-section text to the toggle. **Only section text** (headings, paragraphs, links, icons). Do **not** touch `text-white` inside buttons/CTAs — a navy button with navy text would be unreadable after the toggle.

**Files:**
- Modify: `apps/web/src/components/marketing/Footer.jsx`
- Modify: `apps/web/src/pages/marketing/Home.jsx` (hero, manifesto, sticky panels)
- Modify navy-hero headers: `apps/web/src/pages/marketing/{CaseSubmission,Downloads,InstructionalVideos,CertifiedLabs,About,Contact,DigitalWorkflow,Courses,DrOlmos,Product,Team,RxInstructions}.jsx`

**Interfaces:**
- Consumes: `--text-on-dark` token + `on-dark` Tailwind color (Task 2).
- Produces: dark sections use `text-on-dark` / `text-on-dark/NN`.

- [ ] **Step 1: List every occurrence to review**

Run:
```bash
cd "apps/web" && grep -rn "text-white" src/components/marketing/Footer.jsx src/pages/marketing/ | grep -v -i "button\|btn-\|cta"
```
Expected: a list of `text-white` / `text-white/50` / `text-white/30` etc. in dark-section text.

- [ ] **Step 2: Swap in `Footer.jsx`** — the footer is entirely dark. Replace all `text-white` with `text-on-dark` and `text-white/` with `text-on-dark/` in this file (headings, description, section headers, links, social icons, bottom bar). Leave `bg-white/5`, `bg-white/10`, `border-white/*` unchanged (those are surface tints, not text).

```bash
# from apps/web
perl -pi -e 's/\btext-white\//text-on-dark\//g; s/\btext-white\b/text-on-dark/g' src/components/marketing/Footer.jsx
```

- [ ] **Step 3: Swap dark-section text in the marketing pages** — for each file in the list, apply the same two replacements, but FIRST open the file and confirm each `text-white` hit is section text, not inside a `<button>`, `Button`, `.btn-magnetic`, or a colored CTA. Skip those. For hero/manifesto/panel headings and paragraphs only:

```bash
# Review per file, then apply to the confirmed dark-section lines.
# Safe bulk for files whose only text-white usages are section text:
for f in src/pages/marketing/CaseSubmission.jsx src/pages/marketing/Downloads.jsx \
         src/pages/marketing/InstructionalVideos.jsx src/pages/marketing/CertifiedLabs.jsx \
         src/pages/marketing/DigitalWorkflow.jsx src/pages/marketing/Courses.jsx \
         src/pages/marketing/DrOlmos.jsx src/pages/marketing/Team.jsx \
         src/pages/marketing/RxInstructions.jsx; do
  grep -q "text-white" "$f" && echo "REVIEW: $f" ;
done
```
> For `Home.jsx`, `About.jsx`, `Product.jsx`, `Contact.jsx` (which contain both dark sections AND buttons), do the swap manually per-occurrence using the grep output from Step 1 — change only the hero/manifesto/panel/footer-adjacent text, leave button `text-white` alone.

- [ ] **Step 4: Verify no button text was flipped**

Run:
```bash
cd "apps/web" && grep -rn "text-on-dark" src/ | grep -i "button\|btn-\|cta"
```
Expected: **no output**. If any line appears, revert that specific change back to `text-white`.

- [ ] **Step 5: Build + visual check at default**

Run: `cd "apps/web" && npx vite build` (expect success).
With no override active, dark sections must look **unchanged** (white text), because `--text-on-dark` defaults to white.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/marketing/Footer.jsx apps/web/src/pages/marketing/
git commit -m "feat(theme): bind dark-section text to --text-on-dark toggle token"
```

---

## Task 4: Shared Zod theme schema + token key manifest

Single source of truth for which token keys are writable and how values are validated. Imported by both the API validator and the editor metadata.

**Files:**
- Create: `packages/shared/src/schemas/theme.schema.js`
- Modify: `packages/shared/src/index.js`

**Interfaces:**
- Produces:
  - `THEME_COLOR_KEYS: string[]` — writable channel-valued tokens.
  - `THEME_FONT_KEYS: string[]` — writable font tokens.
  - `CHANNEL_RE: RegExp` — `/^\d{1,3} \d{1,3} \d{1,3}$/`.
  - `themeUpdateSchema` — Zod object: `{ tokens: Record<string,string> }` where every key ∈ allowed keys and every value validates (channels for color keys; a non-empty ≤120-char string with no `;`/`}`/`<` for font keys).

- [ ] **Step 1: Create the schema**

`packages/shared/src/schemas/theme.schema.js`:
```js
import { z } from "zod";

// Color tokens the editor may override (channel triplets). Keys WITHOUT the
// leading "--"; the CSS var name is `--${key}`.
export const THEME_COLOR_KEYS = [
  "brand-500", "brand-600", "accent-500", "surface-100",
  "navy", "navy-light", "navy-dark",
  "color-page", "color-text", "color-primary", "color-accent", "color-border",
  "text-on-dark", "accent-on-dark",
];

export const THEME_FONT_KEYS = [
  "font-sans", "font-heading", "font-drama", "font-mono",
];

export const CHANNEL_RE = /^\d{1,3} \d{1,3} \d{1,3}$/;
const FONT_RE = /^[^;{}<>]{1,120}$/;

const channelValue = z.string().regex(CHANNEL_RE, "Expected 'R G B' channels").refine(
  (v) => v.split(" ").every((n) => Number(n) >= 0 && Number(n) <= 255),
  "Channels must be 0–255",
);
const fontValue = z.string().regex(FONT_RE, "Invalid font-family value");

export const themeUpdateSchema = z.object({
  tokens: z.record(z.string(), z.string()).superRefine((tokens, ctx) => {
    for (const [key, value] of Object.entries(tokens)) {
      if (THEME_COLOR_KEYS.includes(key)) {
        if (!channelValue.safeParse(value).success)
          ctx.addIssue({ code: "custom", message: `Bad channel value for ${key}`, path: [key] });
      } else if (THEME_FONT_KEYS.includes(key)) {
        if (!fontValue.safeParse(value).success)
          ctx.addIssue({ code: "custom", message: `Bad font value for ${key}`, path: [key] });
      } else {
        ctx.addIssue({ code: "custom", message: `Unknown token key: ${key}`, path: [key] });
      }
    }
  }),
});
```

- [ ] **Step 2: Export it** — add to `packages/shared/src/index.js` under the `// Schemas` group:
```js
export * from "./schemas/theme.schema.js";
```

- [ ] **Step 3: Smoke-check the import**

Run: `cd "apps/api" && node -e "import('@my-app/shared').then(m => console.log(typeof m.themeUpdateSchema.parse, m.THEME_COLOR_KEYS.length))"`
Expected: prints `function 14`.

- [ ] **Step 4: Commit**
```bash
git add packages/shared/src/schemas/theme.schema.js packages/shared/src/index.js
git commit -m "feat(theme): shared Zod theme schema + token key manifest"
```

---

## Task 5: API — `app_theme` table + theme routes + schema tests

**Files:**
- Create: `apps/api/src/db/schema/app-theme.js`
- Modify: `apps/api/src/db/schema/index.js`
- Create: `apps/api/src/routes/theme.routes.js`
- Modify: `apps/api/src/index.js`
- Create: `apps/api/src/routes/__tests__/theme.schema.test.js`

**Interfaces:**
- Consumes: `themeUpdateSchema`, `ERROR_CODES` from `@my-app/shared`; `authenticate`, `requireAdmin` middleware.
- Produces: routes `GET /api/v1/theme` → `{ tokens }`; `PUT /api/v1/theme` (admin) body `{ tokens }`; `DELETE /api/v1/theme` (admin).

- [ ] **Step 1: Write the failing schema test**

`apps/api/src/routes/__tests__/theme.schema.test.js`:
```js
import { describe, it, expect } from "vitest";
import { themeUpdateSchema } from "@my-app/shared";

describe("themeUpdateSchema", () => {
  it("accepts valid channel + font tokens", () => {
    const r = themeUpdateSchema.safeParse({ tokens: { navy: "10 20 30", "font-sans": "Inter, sans-serif" } });
    expect(r.success).toBe(true);
  });
  it("rejects unknown token keys", () => {
    expect(themeUpdateSchema.safeParse({ tokens: { "evil-key": "1 2 3" } }).success).toBe(false);
  });
  it("rejects malformed channel values", () => {
    expect(themeUpdateSchema.safeParse({ tokens: { navy: "#000000" } }).success).toBe(false);
    expect(themeUpdateSchema.safeParse({ tokens: { navy: "300 0 0" } }).success).toBe(false);
  });
  it("rejects font values with CSS injection chars", () => {
    expect(themeUpdateSchema.safeParse({ tokens: { "font-sans": "x; } body{display:none}" } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/api" && npx vitest run src/routes/__tests__/theme.schema.test.js`
Expected: FAIL until Task 4 is merged; if Task 4 done, this should already PASS (schema exists). If it PASSES here, that's fine — proceed.

- [ ] **Step 3: Create the table**

`apps/api/src/db/schema/app-theme.js`:
```js
import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row global theme override. id is always "singleton". `tokens` maps
 * CSS-var keys (without leading --) to values, e.g. { "navy": "10 20 30" }.
 * Empty object = no override (app falls back to core index.css tokens).
 * Holds NO PHI.
 */
export const appTheme = pgTable("app_theme", {
  id: text("id").primaryKey().default("singleton"),
  tokens: jsonb("tokens").notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

- [ ] **Step 4: Export the table** — add to `apps/api/src/db/schema/index.js`:
```js
export { appTheme } from "./app-theme.js";
```

- [ ] **Step 5: Generate + run the migration**

Run:
```bash
cd "apps/api" && pnpm db:generate && pnpm db:migrate
```
Expected: a new migration creating `app_theme`; migrate applies cleanly.

- [ ] **Step 6: Create the routes**

`apps/api/src/routes/theme.routes.js`:
```js
import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { appTheme } from "../db/schema/index.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { themeUpdateSchema, ERROR_CODES } from "@my-app/shared";

const SINGLETON = "singleton";

export default async function themeRoutes(fastify) {
  // Public: current override (empty object when none).
  fastify.get("/theme", async (request, reply) => {
    const row = await db.select().from(appTheme).where(eq(appTheme.id, SINGLETON)).limit(1);
    reply.header("Cache-Control", "public, max-age=30");
    return { tokens: row[0]?.tokens ?? {} };
  });

  // Admin: replace the override.
  fastify.put("/theme", { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = themeUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: parsed.error.issues[0]?.message ?? "Invalid theme" },
      });
    }
    const { tokens } = parsed.data;
    await db.insert(appTheme)
      .values({ id: SINGLETON, tokens, updatedBy: request.user.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appTheme.id,
        set: { tokens, updatedBy: request.user.id, updatedAt: new Date() },
      });
    return { tokens };
  });

  // Admin: clear the override (reset to core).
  fastify.delete("/theme", { preHandler: [authenticate, requireAdmin] }, async () => {
    await db.insert(appTheme)
      .values({ id: SINGLETON, tokens: {} })
      .onConflictDoUpdate({ target: appTheme.id, set: { tokens: {}, updatedAt: new Date() } });
    return { tokens: {} };
  });
}
```
> Confirm `ERROR_CODES.VALIDATION_ERROR` exists in `@my-app/shared`; if the codebase uses a different key (e.g. `BAD_REQUEST`), use that. Check `packages/shared/src/constants/errors.js`.

- [ ] **Step 7: Register the routes** — in `apps/api/src/index.js`, import alongside the others and register under the `/api/v1` prefix exactly as sibling routes are registered (mirror the `adminRoutes` registration line):
```js
import themeRoutes from "./routes/theme.routes.js";
// …wherever routes are registered with the /api/v1 prefix:
await fastify.register(themeRoutes, { prefix: "/api/v1" });
```
> Match the existing registration style in this file (find how `adminRoutes`/`rxRoutes` are registered and copy it exactly — same prefix, same options).

- [ ] **Step 8: Run schema tests**

Run: `cd "apps/api" && npx vitest run src/routes/__tests__/theme.schema.test.js`
Expected: PASS (4 tests).

- [ ] **Step 9: Manual route verification** — start the API (`pnpm dev` in `apps/api`) and:
```bash
# public GET returns empty
curl -s localhost:8080/api/v1/theme            # → {"tokens":{}}   (adjust port to your API)
# unauthenticated PUT is rejected
curl -s -X PUT localhost:8080/api/v1/theme -H 'content-type: application/json' \
  -d '{"tokens":{"navy":"10 20 30"}}'           # → 401/403 error
```
> A full authed PUT is exercised end-to-end via the editor in Task 8. Adjust the port/host to your local API (see `apps/api/src/index.js` listen config).

- [ ] **Step 10: Commit**
```bash
git add apps/api/src/db/schema/app-theme.js apps/api/src/db/schema/index.js \
        apps/api/src/routes/theme.routes.js apps/api/src/routes/__tests__/theme.schema.test.js \
        apps/api/src/index.js apps/api/drizzle/
git commit -m "feat(theme): app_theme table + admin-guarded /theme routes"
```

---

## Task 6: Frontend theme lib + boot injection

**Files:**
- Create: `apps/web/src/lib/theme.js`
- Create: `apps/web/src/lib/__tests__/theme.test.js`
- Modify: `apps/web/src/main.jsx`

**Interfaces:**
- Produces:
  - `tokensToCss(tokens): string` → `:root{--navy:10 20 30;--font-sans:Inter;}`
  - `applyTheme(tokens): void` → upserts `<style id="theme-overrides">` in `<head>`.
  - `fetchTheme(): Promise<Record<string,string>>` → GET `/api/v1/theme`, returns `tokens` (or `{}` on any failure).
  - `saveTheme(tokens): Promise<void>` → PUT.
  - `resetTheme(): Promise<void>` → DELETE.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/theme.test.js`:
```js
import { describe, it, expect } from "vitest";
import { tokensToCss } from "../theme.js";

describe("tokensToCss", () => {
  it("builds a :root block with -- prefixes", () => {
    expect(tokensToCss({ navy: "10 20 30", "font-sans": "Inter, sans-serif" }))
      .toBe(":root{--navy:10 20 30;--font-sans:Inter, sans-serif;}");
  });
  it("returns empty string for no tokens", () => {
    expect(tokensToCss({})).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/web" && npx vitest run src/lib/__tests__/theme.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/web/src/lib/theme.js`**

```js
const API = (import.meta.env.VITE_API_URL || "") + "/api/v1/theme";
const STYLE_ID = "theme-overrides";

export function tokensToCss(tokens) {
  const entries = Object.entries(tokens || {});
  if (entries.length === 0) return "";
  return `:root{${entries.map(([k, v]) => `--${k}:${v};`).join("")}}`;
}

export function applyTheme(tokens) {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el); // appended last → wins over core index.css
  }
  el.textContent = tokensToCss(tokens);
}

export async function fetchTheme() {
  try {
    const res = await fetch(API, { credentials: "include" });
    if (!res.ok) return {};
    const data = await res.json();
    return data.tokens || {};
  } catch {
    return {};
  }
}

export async function saveTheme(tokens) {
  const res = await fetch(API, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
  if (!res.ok) throw new Error("Failed to save theme");
}

export async function resetTheme() {
  const res = await fetch(API, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Failed to reset theme");
}
```
> Confirm the API base env var name. Other web code reads the API base — grep `VITE_API` in `apps/web/src` and use the same var. If requests go through a Vite proxy with a relative `/api`, set `API = "/api/v1/theme"` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "apps/web" && npx vitest run src/lib/__tests__/theme.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Inject at boot** — in `apps/web/src/main.jsx`, import and apply the override before/around render (non-blocking, so first paint isn't delayed for production visitors):

```js
import { fetchTheme, applyTheme } from "./lib/theme.js";

// Apply any saved global theme override (falls back to core on failure/empty).
fetchTheme().then(applyTheme);
```
Place this after the Authorize.net key lines and before/after `createRoot(...).render(...)` (order doesn't matter — it patches `<head>` when it resolves).

- [ ] **Step 6: Build check**

Run: `cd "apps/web" && npx vite build`
Expected: success.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/lib/theme.js apps/web/src/lib/__tests__/theme.test.js apps/web/src/main.jsx
git commit -m "feat(theme): theme lib + boot-time override injection"
```

---

## Task 7: Editor token metadata

A flat description of every editable token so the editor renders generically. Keys mirror `THEME_COLOR_KEYS`/`THEME_FONT_KEYS`.

**Files:**
- Create: `apps/web/src/components/theme/theme-tokens.js`

**Interfaces:**
- Produces: `EDITOR_TOKENS: Array<{ key, label, group, type, default }>` where `type` ∈ `"color" | "font" | "toggle"`; `group` ∈ `"Palette" | "Typography" | "Dark sections"`. Color defaults are hex (for the picker); the editor converts hex→channels on write. The `text-on-dark` toggle stores channels.
- `FONT_OPTIONS: string[]` — curated font-family stacks.

- [ ] **Step 1: Create the metadata**

`apps/web/src/components/theme/theme-tokens.js`:
```js
// hex defaults mirror the core channel values in index.css (for the color picker UI)
export const EDITOR_TOKENS = [
  { key: "color-primary",   label: "Primary",        group: "Palette",      type: "color", default: "#13AEEF" },
  { key: "color-accent",    label: "Accent",         group: "Palette",      type: "color", default: "#F79D1E" },
  { key: "color-page",      label: "Page background",group: "Palette",      type: "color", default: "#F7F7F5" },
  { key: "color-text",      label: "Body text",      group: "Palette",      type: "color", default: "#0B1A2E" },
  { key: "color-border",    label: "Borders",        group: "Palette",      type: "color", default: "#E2E0DB" },
  { key: "brand-500",       label: "Brand 500",      group: "Palette",      type: "color", default: "#13AEEF" },
  { key: "brand-600",       label: "Brand 600",      group: "Palette",      type: "color", default: "#1393C9" },
  { key: "navy",            label: "Navy (dark bg)", group: "Palette",      type: "color", default: "#0B1A2E" },
  { key: "navy-dark",       label: "Navy dark",      group: "Palette",      type: "color", default: "#060D17" },

  { key: "font-sans",       label: "Body font",      group: "Typography",   type: "font",  default: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { key: "font-heading",    label: "Heading font",   group: "Typography",   type: "font",  default: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { key: "font-drama",      label: "Drama font",     group: "Typography",   type: "font",  default: '"Cormorant Garamond", Georgia, serif' },
  { key: "font-mono",       label: "Mono font",      group: "Typography",   type: "font",  default: '"IBM Plex Mono", monospace' },

  { key: "text-on-dark",    label: "Dark-section text", group: "Dark sections", type: "toggle", default: "255 255 255" },
  { key: "accent-on-dark",  label: "Dark-section accent", group: "Dark sections", type: "color", default: "#F79D1E" },
];

export const FONT_OPTIONS = [
  '"Plus Jakarta Sans", system-ui, sans-serif',
  '"Inter", system-ui, sans-serif',
  '"Cormorant Garamond", Georgia, serif',
  '"Playfair Display", Georgia, serif',
  '"IBM Plex Mono", monospace',
  '"Space Grotesk", system-ui, sans-serif',
];

// toggle endpoints for text-on-dark
export const ON_DARK_WHITE = "255 255 255";
export const ON_DARK_NAVY = "11 26 46";
```

- [ ] **Step 2: Smoke-check**

Run: `cd "apps/web" && node -e "import('./src/components/theme/theme-tokens.js').then(m=>console.log(m.EDITOR_TOKENS.length, m.FONT_OPTIONS.length))"`
Expected: prints `15 6`.

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/components/theme/theme-tokens.js
git commit -m "feat(theme): editor token metadata"
```

---

## Task 8: Theme editor pop-out

The admin-only UI. Renders a bottom-left pill that opens a panel; controls live-preview via `applyTheme`; Save/Reset hit the API.

**Files:**
- Create: `apps/web/src/components/theme/ThemeEditor.jsx`
- Modify: `apps/web/src/App.jsx`

**Interfaces:**
- Consumes: `applyTheme`, `saveTheme`, `resetTheme`, `fetchTheme` (Task 6); `EDITOR_TOKENS`, `FONT_OPTIONS`, `ON_DARK_WHITE`, `ON_DARK_NAVY` (Task 7); `useAuthStore` for the admin check.

- [ ] **Step 1: Add hex↔channel helpers + the component**

`apps/web/src/components/theme/ThemeEditor.jsx`:
```jsx
import { useEffect, useState } from "react";
import { useAuthStore } from "../../stores/auth.store.js";
import { applyTheme, fetchTheme, saveTheme, resetTheme } from "../../lib/theme.js";
import { EDITOR_TOKENS, FONT_OPTIONS, ON_DARK_WHITE, ON_DARK_NAVY } from "./theme-tokens.js";

const hexToChannels = (hex) => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
};
const channelsToHex = (ch) => {
  const [r, g, b] = ch.split(" ").map(Number);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export function ThemeEditor() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const enabled = import.meta.env.VITE_THEME_EDITOR === "on" && isAdmin;

  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState({});   // working override (channels/font strings)
  const [status, setStatus] = useState("");

  useEffect(() => { if (enabled) fetchTheme().then(setTokens); }, [enabled]);
  useEffect(() => { if (enabled) applyTheme(tokens); }, [tokens, enabled]); // live preview

  if (!enabled) return null;

  const setToken = (key, value) => setTokens((t) => ({ ...t, [key]: value }));
  const valueFor = (tok) =>
    tokens[tok.key] ?? (tok.type === "color" ? hexToChannels(tok.default) : tok.default);

  const groups = ["Palette", "Typography", "Dark sections"];

  return (
    <div className="fixed bottom-5 left-5 z-[10000] font-sans">
      {!open && (
        <button onClick={() => setOpen(true)}
          className="rounded-full bg-navy text-on-dark px-5 py-3 shadow-xl text-sm font-semibold">
          🎨 Theme
        </button>
      )}
      {open && (
        <div className="w-80 max-h-[80vh] overflow-y-auto rounded-[2rem] bg-surface-50 shadow-2xl border border-color-border p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-color-text">Theme editor</span>
            <button onClick={() => setOpen(false)} className="text-color-text/50">✕</button>
          </div>

          {groups.map((g) => (
            <section key={g} className="mb-5">
              <h4 className="text-xs uppercase tracking-wide text-color-text/40 mb-2">{g}</h4>
              {EDITOR_TOKENS.filter((t) => t.group === g).map((tok) => (
                <div key={tok.key} className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-sm text-color-text/80">{tok.label}</label>
                  {tok.type === "color" && (
                    <input type="color" value={channelsToHex(valueFor(tok))}
                      onChange={(e) => setToken(tok.key, hexToChannels(e.target.value))} />
                  )}
                  {tok.type === "font" && (
                    <select value={valueFor(tok)} onChange={(e) => setToken(tok.key, e.target.value)}
                      className="text-xs border border-color-border rounded px-1 py-1 max-w-[55%]">
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/"/g, "")}</option>)}
                    </select>
                  )}
                  {tok.type === "toggle" && (
                    <button
                      onClick={() => setToken(tok.key, valueFor(tok) === ON_DARK_WHITE ? ON_DARK_NAVY : ON_DARK_WHITE)}
                      className="text-xs rounded-full border border-color-border px-3 py-1">
                      {valueFor(tok) === ON_DARK_WHITE ? "White text" : "Dark text"}
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}

          <div className="flex gap-2 mt-4">
            <button onClick={async () => { try { await saveTheme(tokens); setStatus("Saved ✓"); } catch { setStatus("Save failed"); } }}
              className="flex-1 rounded-full bg-brand-500 text-on-dark py-2 text-sm font-semibold">Save</button>
            <button onClick={async () => { try { await resetTheme(); setTokens({}); applyTheme({}); setStatus("Reset"); } catch { setStatus("Reset failed"); } }}
              className="flex-1 rounded-full border border-color-border py-2 text-sm">Reset</button>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`:root{${Object.entries(tokens).map(([k,v]) => `--${k}:${v};`).join("")}}`)}
            className="w-full mt-2 text-xs text-color-text/50 underline">Copy override CSS</button>
          {status && <p className="text-xs text-color-text/60 mt-2">{status}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `App.jsx`** — import and render once inside the top-level tree (e.g. just inside `<ToastProvider>` or alongside the router, so it overlays every route):
```jsx
import { ThemeEditor } from "./components/theme/ThemeEditor.jsx";
// …inside the returned JSX, near the root:
<ThemeEditor />
```

- [ ] **Step 3: Build check**

Run: `cd "apps/web" && npx vite build`
Expected: success.

- [ ] **Step 4: End-to-end manual verification** — with `VITE_THEME_EDITOR=on` in `apps/web/.env`, logged in as an admin, run the dev server:
  1. Bottom-left "🎨 Theme" pill appears (and does NOT appear when logged out or flag unset).
  2. Changing Primary/Navy updates the page live.
  3. The Dark-section toggle flips hero/footer text white⇄navy.
  4. **Save**, reload the page → the override persists (served from the API).
  5. **Reset**, reload → back to core look.
  6. Confirm in a second non-admin/incognito session that PUT is server-rejected (the override only changes via an admin save).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/components/theme/ThemeEditor.jsx apps/web/src/App.jsx
git commit -m "feat(theme): admin-only theme editor pop-out with live preview"
```

---

## Task 9: UI-chrome hex cleanup

Remove the remaining UI-decoration hexes so the chrome is fully tokenized. Content/data colors stay.

**Files:**
- Modify: `apps/web/src/pages/marketing/Home.jsx`
- Modify: `apps/web/src/config/brand.js`
- Modify: `apps/web/src/index.css` (verify gradients only)

**Interfaces:** none exported; pure cleanup.

- [ ] **Step 1: Inventory the chrome hexes in Home.jsx**

Run: `cd "apps/web" && grep -n "#[0-9a-fA-F]\{3,8\}" src/pages/marketing/Home.jsx`
Expected: SVG `stroke="#0B1A2E"`, `fill="#13AEEF"`, `stroke="#E63B2E"`, `stopColor="#13AEEF"`.

- [ ] **Step 2: Replace SVG decoration hexes with token-driven colors** — for each SVG element, drive color from a CSS var via inline style, e.g.:
  - `stroke="#0B1A2E"` → `stroke="rgb(var(--navy))"`
  - `fill="#13AEEF"` / `stopColor="#13AEEF"` → `fill="rgb(var(--brand-500))"` / `stopColor="rgb(var(--brand-500))"`
  - `stroke="#E63B2E"` (an error/alert red not in the palette) → add a core token `--alert: 230 59 46;` in `index.css` `:root`, then `stroke="rgb(var(--alert))"`.

> SVG presentation attributes accept `rgb(var(--x))`. If any element sets color via the `style` prop instead, use `style={{ stroke: "rgb(var(--navy))" }}`.

- [ ] **Step 3: Add the `--alert` token** — append to the core `:root` palette in `index.css`:
```css
  --alert: 230 59 46;   /* was #E63B2E — error/alert accent used in Home SVGs */
```

- [ ] **Step 4: Delete dead brand.js colors** — open `apps/web/src/config/brand.js`, remove the `primary: "#2563eb"` and `primaryHover: "#1d4ed8"` entries (verified unused by the audit). If removing them empties an object or breaks an import, grep first:
```bash
cd "apps/web" && grep -rn "brand\.\(primary\|primaryHover\)\|from .*config/brand" src/
```
Expected: no references to those two keys; safe to delete.

- [ ] **Step 5: Verify no chrome hexes remain in the two target files**

Run:
```bash
cd "apps/web" && grep -n "#[0-9a-fA-F]\{3,8\}" src/pages/marketing/Home.jsx src/config/brand.js
```
Expected: **no output** (logo/data files are intentionally untouched and excluded here).

- [ ] **Step 6: Build + visual check**

Run: `cd "apps/web" && npx vite build` (expect success). Confirm Home SVG graphics render with the same colors as before.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/pages/marketing/Home.jsx apps/web/src/config/brand.js apps/web/src/index.css
git commit -m "refactor(theme): tokenize Home SVG colors, drop dead brand.js hexes"
```

---

## Final verification

- [ ] `cd apps/web && npx vitest run` — all web tests pass.
- [ ] `cd apps/api && npx vitest run` — all api tests pass.
- [ ] `cd apps/web && npx vite build` — clean build.
- [ ] Repo-wide chrome-hex sweep (data/logo files excluded):
  ```bash
  cd apps/web && grep -rn "#[0-9a-fA-F]\{3,8\}\|rgba\?(" src/ \
    | grep -v "rx-devices.js\|Artboard.jsx\|Signature.jsx\|ModelViewer.jsx\|logoFull.jsx\|logoIcon.jsx"
  ```
  Expected: only `rgb(var(--…))` token references — no raw hex/rgba literals.
- [ ] Editor gating confirmed: invisible with flag off or non-admin; visible for admin + flag on.
- [ ] Save → reload persists; Reset → reload returns to core.

## Endgame (manual, post-sign-off — not a code task)

When the client approves a look: use **Copy override CSS**, paste the values into the core `:root` in `index.css`, `DELETE /api/v1/theme` (Reset) to empty the override, set `VITE_THEME_EDITOR` off, and optionally remove `ThemeEditor.jsx` + the boot `fetchTheme()` call + the `app_theme` table. Core then carries the launch look with nothing overriding it.

---

## Self-Review

- **Spec coverage:** core tokens (T1), role tokens + on-dark (T2), dark-text toggle wiring (T3), override table+routes (T5), shared validation (T4), boot injection (T6), editor metadata+pop-out (T7/T8), UI-chrome cleanup (T9), gating/admin enforcement (Global + T5/T8), endgame (documented). All spec sections mapped.
- **Placeholder scan:** every code step carries full code; no TBD/TODO. Two verification-dependent notes (API base env var in T6; `ERROR_CODES.VALIDATION_ERROR` key in T5; route registration style in T5) are flagged as "confirm against existing code" with the grep to do it — these are real codebase-fit checks, not placeholders.
- **Type consistency:** `tokensToCss`/`applyTheme`/`fetchTheme`/`saveTheme`/`resetTheme` signatures consistent across T6/T8. Token keys consistent across `THEME_COLOR_KEYS` (T4), `EDITOR_TOKENS` (T7), and core `:root` (T1/T2). `text-on-dark` channel default `255 255 255` consistent T2/T7. `app_theme` columns consistent T5.
