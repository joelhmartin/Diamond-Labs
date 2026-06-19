# Live Theme Editor + Color-System Tokenization — Design

**Date:** 2026-06-19
**Status:** Approved design → implementation plan
**Scope:** `apps/web` (frontend), `apps/api` (one new route group + table)

---

## Problem

The frontend color system is convoluted and not actually editable:

- **There are zero CSS custom properties.** Every color is a hard-coded hex in
  `apps/web/tailwind.config.js`. Components reference them only through Tailwind
  classes (`text-navy`, `bg-brand-500`). Attempting to "change the variable"
  fails because there is no variable — you are editing compiled Tailwind values.
- One-off hexes bypass even Tailwind: SVG strokes/fills in `Home.jsx`, canvas
  pen colors, Three.js lights, the Digital Rx gradient that had to be manually
  de-hard-coded.
- Dark sections (hero, footer, manifesto, sticky panels) hard-use `text-white`
  with no way to flip to dark text.

The client (Diamond Labs) needs to tune the live look — colors, typography,
and dark-section text polarity — through an in-app editor, **save** that as the
production look, and **reset** back to the original at any time. The original
design must remain the untouched fallback.

## Goals

1. Single source of truth for every themeable color and font, as CSS variables.
2. An admin-only, flag-gated **theme editor pop-out** (fixed, bottom-left) with
   live preview, **Save**, and **Reset**.
3. A **white⇄dark text toggle** for dark sections.
4. Saved theme persists and is served to production at boot **without a
   redeploy** ("override layer"), falling back to the untouched core for any
   token not overridden.
5. Eliminate hard-coded hex/rgb/rgba from **UI chrome**. Leave genuine
   content/data colors as data.

## Non-Goals

- Theming content/data colors: sport-guard material swatches
  (`rx-devices.js`), drawing pen colors (`Artboard.jsx`), `ModelViewer`
  Three.js light colors, and the **logo artwork** (`logoFull.jsx`). These are
  content/brand assets, not theme, and stay as-is.
- Per-user themes. There is exactly **one** global app theme override.
- Light/dark OS mode switching. The "dark sections" toggle is about text
  polarity within already-dark sections, not a full dark mode.

---

## Architecture

Four layers, bottom to top:

```
┌─────────────────────────────────────────────────────────┐
│  Theme Editor pop-out  (admin-only, VITE_THEME_EDITOR)   │  layer 4
│  live preview · Save · Reset · Copy-CSS                  │
└─────────────────────────────────────────────────────────┘
                 │ PUT/DELETE /api/v1/theme (admin)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Override layer   <style id="theme-overrides">:root{…}   │  layer 3
│  injected at boot from GET /api/v1/theme                 │
│  any token not overridden → falls through to core        │
└─────────────────────────────────────────────────────────┘
                 ▼ overrides
┌─────────────────────────────────────────────────────────┐
│  Semantic role tokens   --color-text, --text-on-dark, …  │  layer 2
└─────────────────────────────────────────────────────────┘
                 ▼ reference
┌─────────────────────────────────────────────────────────┐
│  Core palette + font tokens   :root in index.css         │  layer 1
│  (the untouched originals / fallback)                    │
└─────────────────────────────────────────────────────────┘
```

### Layer 1 — Core tokens (the untouched originals)

Defined once in `apps/web/src/index.css` `:root`. Core file is **never mutated
by the app** — it is the permanent fallback.

Palette stops are stored as **space-separated RGB channels**, not hex, so
Tailwind's `/<alpha>` opacity modifiers keep working
(`text-white/50`, `bg-navy/60`, etc., which the footer and overlays rely on):

```css
:root {
  /* palette ramps (channels) */
  --brand-50: 244 249 251;
  /* … 100..950 … */
  --brand-500: 19 174 239;     /* was #13AEEF */
  --brand-600: 19 147 201;
  --accent-400: 251 185 77;
  --accent-500: 247 157 30;
  --accent-600: 217 133 10;
  --surface-50: 255 255 255;
  --surface-100: 247 247 245;
  --surface-200: 238 237 233;
  --surface-300: 226 224 219;
  --surface-400: 209 207 200;
  --navy:        11 26 46;      /* was #0B1A2E */
  --navy-light:  19 40 68;
  --navy-dark:    6 13 23;

  /* font tokens */
  --font-sans:    '"Plus Jakarta Sans"', system-ui, sans-serif;
  --font-heading: '"Plus Jakarta Sans"', system-ui, sans-serif;
  --font-drama:   '"Cormorant Garamond"', Georgia, serif;
  --font-mono:    '"IBM Plex Mono"', monospace;
}
```

`tailwind.config.js` changes every color from hex to the channel form, and each
font family to its var. No component class changes are required:

```js
colors: {
  brand: { 500: "rgb(var(--brand-500) / <alpha-value>)", /* … */ },
  navy:  { DEFAULT: "rgb(var(--navy) / <alpha-value>)", light: "...", dark: "..." },
  /* accent, surface similarly */
},
fontFamily: {
  sans:    "var(--font-sans)",
  heading: "var(--font-heading)",
  drama:   "var(--font-drama)",
  mono:    "var(--font-mono)",
},
```

### Layer 2 — Semantic role tokens

A small meaning-layer that references the palette. These are what the editor
mostly exposes (the ramps stay mostly internal):

| Token | Default | Purpose |
|---|---|---|
| `--color-page` | `var(--surface-100)` | page background |
| `--color-text` | `var(--navy)` | body text on light |
| `--color-primary` | `var(--brand-500)` | primary brand color |
| `--color-accent` | `var(--accent-500)` | accent / CTA gold |
| `--color-border` | `var(--surface-300)` | hairlines, dividers |
| `--text-on-dark` | `255 255 255` (white) | **text over dark sections** |
| `--accent-on-dark` | `var(--accent-500)` | accent within dark sections |

**The white⇄dark toggle** flips `--text-on-dark` between white channels and
`var(--navy)`. A new Tailwind color `on-dark` maps to
`rgb(var(--text-on-dark) / <alpha-value>)`. Every dark-section text that today
uses `text-white` / `text-white/50` is swapped to `text-on-dark` /
`text-on-dark/50`. Because the token is channel-based, opacity variants survive
the toggle.

Affected dark-section files (swap `text-white*` → `text-on-dark*`):
`components/marketing/Footer.jsx`, `pages/marketing/Home.jsx` (hero, manifesto,
sticky panels), and the navy-hero headers across
`pages/marketing/*` (CaseSubmission, Downloads, InstructionalVideos,
CertifiedLabs, About, Contact, DigitalWorkflow, Courses, DrOlmos, Product,
Team, RxInstructions). `text-white` that sits on a colored *button* (not a dark
section) stays as-is.

### Layer 3 — Override layer

- **Table** (`apps/api/src/db/schema/app-theme.js`): single-row durable config.
  ```js
  appTheme = pgTable("app_theme", {
    id: text("id").primaryKey().default("singleton"),
    tokens: jsonb("tokens").notNull().default("{}"),  // { "--navy": "10 20 30", ... }
    updatedAt: timestamp(..).defaultNow(),
    updatedBy: text("updated_by"),  // admin user id
  });
  ```
  (Not `kv_store` — that table is explicitly ephemeral/TTL.)
- **Routes** (`apps/api/src/routes/theme.routes.js`, under `/api/v1`):
  | Method | Path | Auth | Body / Returns |
  |---|---|---|---|
  | GET | `/theme` | public | → `{ tokens: {…} }` (or empty). Cached-friendly. |
  | PUT | `/theme` | **admin** | `{ tokens: {…} }` validated by Zod (keys must be known token names, values must be channel triplets / safe font strings). Replaces the row. |
  | DELETE | `/theme` | **admin** | clears tokens → `{}`. |
  - Zod schema lives in `packages/shared`. Server **rejects unknown token keys
    and malformed values** — never injects arbitrary CSS.
- **Boot injection** (`apps/web/src/main.jsx`): before render, `fetch GET
  /theme`; build one `<style id="theme-overrides">:root{ --x: v; … }</style>`
  appended to `<head>` after the core stylesheet. Network failure → no override
  (silent fallback to core). This keeps core untouched and makes any saved
  change live immediately on next load.

### Layer 4 — Editor pop-out

- **Component:** `apps/web/src/components/theme/ThemeEditor.jsx` (+ a small
  `theme-tokens.js` describing the editable token set: label, group, css var,
  control type). Mounted once in `App.jsx`.
- **Gating:** renders only when `import.meta.env.VITE_THEME_EDITOR === "on"`
  **and** the logged-in user is an admin (via auth store). Public launch = flag
  off → nothing renders. Server enforces admin on PUT/DELETE regardless.
- **UI:** fixed bottom-left pill trigger → slide-out panel, grouped:
  - **Palette** — color pickers for the role tokens + key ramp stops
    (brand-500/600, accent-500, surface-100, navy). Picker works in hex for
    humans; converts to channel triplets on write.
  - **Typography** — font-family dropdown per family (`--font-sans/heading/
    drama/mono`) from a curated Google-Fonts list.
  - **Dark sections** — the `--text-on-dark` white⇄dark toggle and
    `--accent-on-dark` picker.
  - **Actions** — **Save** (`PUT`), **Reset** (`DELETE` + clear live block),
    **Copy override CSS** (dumps the current `:root{…}` block to clipboard so
    the developer can fold it into core and retire the override).
- **Live preview:** every control writes to the in-page `#theme-overrides`
  block immediately (no save needed to see it). Save persists; Reset clears both
  the live block and the stored row.

---

## Tokenization cleanup (UI chrome only)

Swap to tokens:
- `Home.jsx` SVG `stroke`/`fill`/`stopColor` decoration hexes (`#0B1A2E`,
  `#13AEEF`, `#E63B2E`) → `currentColor` driven by a token class, or inline
  `rgb(var(--…))`.
- Confirm `index.css` `.hero-gradient` and the Digital Rx gradient resolve
  through tokens (already `theme()`-based; verify post-refactor).
- Delete unused `apps/web/src/config/brand.js` `#2563eb` / `#1d4ed8` (dead and
  inconsistent with the real palette).

Leave as data (explicitly out of scope): `rx-devices.js` SPORT_COLORS,
`Artboard.jsx` pen colors + canvas guides, `Signature.jsx` stroke,
`ModelViewer.jsx` Three.js lights, `logoFull.jsx` / `logoIcon.jsx` artwork.

---

## Sequencing & risk

1. **Commit current state** as a rollback point (per global rule).
2. **Layer 1 first, in isolation** — define core channel tokens + flip
   `tailwind.config.js` to vars. This is the one load-bearing change; a wrong
   channel triplet shifts a color site-wide. Visually verify every page renders
   identically to before (it should be a pure no-op refactor).
3. Layer 2 role tokens + dark-section `text-white`→`text-on-dark` swap. Verify
   dark sections unchanged with toggle at default (white).
4. API table + routes + shared Zod schema.
5. Boot injection in `main.jsx`.
6. Editor pop-out, wired to live preview + Save/Reset.
7. UI-chrome hex cleanup.

## Testing

- **Refactor no-op check:** before/after the Layer 1+2 swap, every page looks
  identical with no override present.
- **API:** Zod rejects unknown keys / bad values; non-admin gets 403 on
  PUT/DELETE; GET works anonymously; Reset empties the row.
- **Override fallthrough:** with a partial override saved, untouched tokens
  still resolve to core values.
- **Toggle:** `--text-on-dark` flip turns all dark-section text navy, opacity
  variants intact.
- **Gating:** editor invisible with flag off and/or non-admin; visible only for
  admin + flag on.

## Open endgame (manual, by the developer)

When the client signs off: use **Copy override CSS** to paste the chosen values
into `index.css` core, `DELETE /theme` to empty the override, flip
`VITE_THEME_EDITOR` off, and (optionally) delete the editor component + theme
table. Core then carries the launch look with nothing overriding it.
