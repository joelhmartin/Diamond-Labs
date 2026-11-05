# Marketing site design consistency: design

## Intent

Diamond Orthotic Laboratory's visitors are dentists and their staff. They come to send a case, find an appliance, check a material or call the lab. The site should feel like a precise working lab that knows the clinical side, not a software startup.

The owner likes the home hero and most of the homepage. The interior pages are inconsistent and sometimes read as AI-generated. The lab also wants Dr. Steven Olmos featured, without a menu link or the current level of reverence.

## Goals

- One visual system across all interior marketing pages, derived from the homepage.
- Dr. Olmos is a feature, not the site's identity.
- Remove AI tells and claims that contradict each other.
- Keep the saved palette exactly.

## Non-goals

- Home hero layout, imagery and motion do not change.
- No restructure of the rest of Home. It gets copy corrections only.
- No changes to the portal, auth, admin, doctor or lab app screens.
- Catalog components (`CatalogCard`, `CatalogDetail`, `CatalogSection`, `CartDrawer`) and `Checkout.jsx` are out of scope, because `feat/own-the-lab` is actively editing them.
- Rx data and forms (`apps/web/src/data/**`, `packages/shared/**`) are functional. Olmos device names there stay.

## Anti-goals

The work has failed if any of these are true:

- It looks like a different company from the homepage.
- A palette value changed.
- Dr. Olmos vanished, or an Olmos product name was changed.
- A functional flow broke (cart, Rx submission, sign-in).

## Palette (where it lives)

The palette is the committed default in `apps/web/src/index.css` (commit `274ab4d`, 2026-08-06), mirrored in `components/theme/theme-tokens.js`. The `app_theme` override row is empty on production and staging and absent locally, so the theme widget has no separately saved values. Do not touch these values.

| Token | Value |
|---|---|
| `navy` | `#11376A` |
| `navy-dark` | `#0060E6` |
| `brand-500` | `#1FB8F9` |
| `brand-600` | `#2E9CCC` |
| `accent-500` | `#F79D1E` |
| `surface-100` | `#F7F7F5` |

## Design system

**Colour roles, using existing tokens only:**

- `navy`: dark sections and heroes.
- `accent-500`: the primary action, everywhere except the nav's existing Submit Case pill.
- `brand-500`: on navy only. It measures about 2:1 on the light page.
- `brand-700` (`#13739B`, about 5:1): links and accent text on light backgrounds.
- Body and supporting text on light: at least `navy/70`. Remove `navy/30` to `navy/50` text.
- Remove off-palette decoration, such as the purple and green value bars on About.

**Type:**

- Plus Jakarta Sans for everything.
- Cormorant italic only on the second line of a page hero's H1. Section H2s are plain, with no accented word.
- IBM Plex Mono only for true technical values such as phone numbers or file formats. It is not a label style.
- Labels are sentence case. Drop the tracked all-caps eyebrow where the heading already says it.
- Scale: H1 `text-4xl md:text-6xl`, with `md:text-7xl` on the italic line; H2 `text-3xl md:text-5xl`.

**Page hero: one component, two variants.**

- `image`: navy base with a left-weighted scrim over a photo. `min-h-[60dvh]`, content anchored bottom-left. Used on About, Digital Workflow and Contact, where the photo is sharp and not reused.
- `compact`: solid navy, `pt-36 pb-16`, left-aligned. Used on Products, TMD, Sleep, Submit Case, Downloads, Videos, New Client, Dr. Olmos, Certified Labs, Team, Courses and Rx Instructions (the last three had soft or duplicated photos).
- Both are dark from the top edge, so the white nav is always legible. This fixes Team and Products and makes `HEROLESS_ROUTES` removable.
- The grey fade (`hero-gradient`) is no longer used by these pages. `Checkout` still uses the class, so the CSS stays.

**Imagery:** Prefer Diamond's own appliance photos in `public/images`. Remove stock that does not depict the lab's work: the goggles close-up on Team, the phone-in-hand on Contact, the office lounge on Contact.

**Structure follows content:**

- Use a list or table when the content is a list: the lab directory, symptoms, downloads, and spec rows.
- Use numbers only for true sequences. Digital Workflow's six stages qualify, so they become one ordered list.
- Keep rounded containers for images and featured panels, matching Home.
- Stop chopping every list into identical cards.

**Shared pieces:** `PageHero`, `SectionHeading`, `CtaBand` (extracted from Home's CTA so Home looks unchanged) and `StatRow`, in `components/marketing/`. These replace about ten per-page `Hero`s, ten `CTA`s and six stat strips. `RxInstructions`' private `playOnView` copy goes away in favour of `lib/playOnView`.

**Motion:**

- One hero intro.
- One quiet reveal per section, no per-card stagger, no decorative floating.
- All of it is skipped under `prefers-reduced-motion`.
- The noise overlay moves from Home into `MarketingLayout` so every page matches.

## Dr. Olmos policy

1. **Product names stay:** Olmos Series, Olmos Day, Olmos Night, Olmos Orthotic, Olmos Neuromuscular Device/Positioner. John Olmos, a staff member, stays on Team.
2. **Lab positioning goes:** "Olmos-Method", "Olmos Protocol", "built around the Olmos Series", "premier Olmos-Method". Use "clinical protocol" or describe the work directly.
3. **The person is featured modestly:**
   - Menu: remove "Dr. Steven Olmos". Rename "Dr. Steven Olmos Courses" to "Courses".
   - About: replace the full-width portrait section with a compact feature lower on the page, without "global authority". It links to his page.
   - `/about/dr-olmos`: keep the URL so existing links and search traffic survive. No menu link, compact hero, biography and credentials kept.
   - Courses and Certified Labs: name him where factually relevant, because he directs the courses and co-administers the certification. Do not lead with him.

## Claims and copy

- Replace "The only lab built around..." on every page. The old Certified Labs page claims seven labs but its directory lists five, so "only" contradicts the site. No count is published until the lab confirms it.
- Home stats: "100% Digital Workflow" becomes "19 Lab Team Members" and "50+ Certified Labs" becomes "3 Countries With Certified Labs" (US, Canada, Australia). No lab count is stated.
- Remove filler stats: "100% Digital Workflow", "∞ Digital Reprints", "6 Pipeline Stages", "1 Lab, Every Protocol", "Olmos Series Certified".
- Keep factual ones: 10 business days, FDA 510(k) on sleep appliances, Team counts.
- Remove "every micron calculated", "No analog guesswork", "gold standard" and "System Operational".
- Contact: replace the placeholder `(555) 123-4567` and "San Diego" with the Certified Labs page's `619.724.6400` and "La Mesa, California".
- Footer: every link goes to the page it names. Today Digital Workflow points to `/about` and Case Submission to `/contact`.

## Decided by the builder

- Keep white text on orange and cyan buttons so interiors match the hero, even though it measures about 2:1. Flagged to the owner rather than changed.
- Home's `Home.jsx` is 1,133 lines, over the 1,000 limit. This work only edits copy there and extracts the CTA and noise overlay. A full split is a later refactor.
- Update the project `CLAUDE.md` design rules that generate these tells, so future work does not reintroduce them.
