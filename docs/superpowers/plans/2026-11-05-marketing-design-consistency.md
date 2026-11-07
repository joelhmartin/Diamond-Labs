# Marketing Design Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every interior marketing page one visual system derived from the homepage, reduce Dr. Olmos to a modest feature, and remove AI tells and contradictory claims, with the palette and home hero unchanged.

**Architecture:** Four shared marketing components replace the per-page heroes, CTAs and stat strips. Pages are then migrated in groups. A source-scanning guard test holds the copy and design rules in place.

**Tech Stack:** React, Vite, Tailwind, GSAP ScrollTrigger, Vitest, Playwright (screenshots only).

**Spec:** `docs/superpowers/specs/2026-11-05-marketing-design-consistency-design.md`

## Global Constraints

- Worktree `.claude/worktrees/design-rework`, branch `feat/design-rework`. Run `pnpm install` first.
- Do not change palette values in `index.css` or `theme-tokens.js`.
- Do not change Home hero layout, imagery or motion. Only the two text strings in Task 6 may change.
- Do not edit `CatalogCard`, `CatalogDetail`, `CatalogSection`, `CartDrawer`, `Checkout.jsx`, `apps/web/src/data/**` or `packages/shared/**`.
- Do not add a font, a colour or a dependency.
- All GSAP inside `gsap.context()` with `ctx.revert()`. Reveals use `lib/playOnView`.
- Do not use `alert()`, `confirm()` or `prompt()`.
- Files stay under 1,000 lines and components under 300.
- Commit per task. `git push origin feat/design-rework` only, never a bare push. Do not merge or deploy.

## Review Focus

- Content stuck at `opacity: 0` after a route change or when scrolled quickly. Expect every section visible (Task 1 reveal behaviour; Task 7 screenshots after scroll).
- `prefers-reduced-motion`: expect all content visible with no animation (Task 1 test).
- Mobile at 390px: expect no horizontal scroll, and the floating cart button not covering a primary action (Task 7 check).
- A page hero with a long title at 390px: expect it to wrap without clipping under the nav (Task 7 check).
- Old links to `/about/dr-olmos`: expect the page to still load without being in the menu (Task 2 test).

---

### Task 1: Shared components and guard test

**Files:**
- Create: `apps/web/src/components/marketing/PageHero.jsx`, `SectionHeading.jsx`, `CtaBand.jsx`, `StatRow.jsx`
- Create: `apps/web/src/components/marketing/shared-marketing.test.jsx`
- Create: `apps/web/src/pages/marketing/marketing-design.guard.test.js`
- Modify: `apps/web/src/App.jsx` (`MarketingLayout` renders the noise overlay)
- Modify: `apps/web/src/pages/marketing/Home.jsx` (remove `NoiseOverlay`; `CTASection` becomes `CtaBand`, visually unchanged)

**Interfaces:**
- Produces: `PageHero({ variant: "image"|"compact", title, titleAccent, intro, image, imageAlt, children })`
- Produces: `SectionHeading({ title, intro, as = "h2", align = "left" })`
- Produces: `CtaBand({ title, titleAccent, intro, primary: {label,to,href}, secondary })`. `titleAccent` exists only so Home's existing CTA renders unchanged. Interior pages omit it.
- Produces: `StatRow({ stats: [{value,label}], tone: "light"|"dark" })`

- [ ] **Step 1: Write failing component tests** in `shared-marketing.test.jsx`:
  - `PageHero` renders one `h1` containing `title` and `titleAccent`.
  - The `compact` variant renders no `img`.
  - `CtaBand` renders `primary.label` as a link to `primary.to`.
  - With `matchMedia('(prefers-reduced-motion: reduce)')` true, `PageHero` content has no inline `opacity: 0`.
- [ ] **Step 2: Write the guard test** in `marketing-design.guard.test.js`, scanning `pages/marketing/**` and `components/marketing/**`. Failing expectations:
  - No matches for `/Olmos[- ]Method|Olmos Protocol|System Operational|555\) 123|every micron/i`.
  - `Navbar.jsx` does not contain `/about/dr-olmos`.
  - No page except `Home.jsx` and `Checkout.jsx` contains `function Hero` or `hero-gradient`.
  - The `index.css` palette lines for `--navy`, `--navy-dark`, `--brand-500`, `--accent-500` equal `17 55 106`, `0 96 230`, `31 184 249`, `247 157 30`.
- [ ] **Step 3: Run** `pnpm --filter @my-app/web test`. Expected: both new files fail. The guard stays red until Task 6.
- [ ] **Step 4: Implement the components** per the spec's Design system section. The hero intro uses `power3.out` with a stagger and is skipped under reduced motion.
- [ ] **Step 5: Run** the component tests. Expected: `shared-marketing.test.jsx` passes.
- [ ] **Step 6: Commit.** The guard test goes in with the components, noted as expected-red in the commit body.

### Task 2: Navigation and footer

**Files:**
- Modify: `apps/web/src/components/marketing/Navbar.jsx`, `Footer.jsx`, `apps/web/index.html`
- Test: `apps/web/src/components/marketing/shared-marketing.test.jsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `NAV_LINKS` without any `/about/dr-olmos` entry.

- [ ] **Step 1: Write failing tests:**
  - The nav has no "Dr. Steven Olmos" text and has a "Courses" link to `/resources/courses`.
  - The footer has no "System Operational".
  - The footer's "Digital Workflow" links to `/services/digital-workflow`, and "Case Submission" to `/submit-case`.
  - `/about/dr-olmos` is still registered in `App.jsx`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Update the menu.** Remove the Dr. Olmos item, rename "Dr. Steven Olmos Courses" to "Courses" and "Additional Resources" to "Resources". Apply the same to the mobile menu.
- [ ] **Step 4: Update the footer.**
  - Blurb and `index.html` meta description: "A digital orthotic laboratory in La Mesa, California, making TMD orthotics and sleep appliances for dentists."
  - Point every link at its named page and remove the status line.
  - Change the "Olmos Series" link label to "TMD Orthotics", and collapse duplicates.
  - For legal links with no destination page, leave them as they are and list them in the task report.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 3: Company pages (About, Team, Dr. Olmos, Contact)

**Files:**
- Modify: `apps/web/src/pages/marketing/About.jsx`, `Team.jsx`, `DrOlmos.jsx`, `Contact.jsx`

**Interfaces:**
- Consumes: `PageHero`, `SectionHeading`, `CtaBand`, `StatRow` from Task 1.

- [ ] **Step 1: About.**
  - `PageHero` image variant with the existing `about-hero.webp`.
  - Remove the "Olmos clinical protocol" mission wording and the "only lab" line.
  - Replace the portrait section with a compact feature lower on the page, using `/images/dr-olmos.jpg` at no more than a third of the width, without the circular badge. Copy: "We work with Dr. Steven Olmos, creator of the Olmos Series appliances and founder of TMJ & Sleep Therapy Centres International." Link: "About Dr. Olmos".
  - Values become plain on-palette text columns, without the coloured bars.
  - Replace the duplicate 01/02/03 workflow cards with one link to Digital Workflow.
  - Remove the stats strip.
- [ ] **Step 2: Team.** Image hero using an appliance photo, removing the goggles stock photo. Keep the real counts through `StatRow`.
- [ ] **Step 3: Dr. Olmos.** Compact hero with the title "Dr. Steven Olmos, DDS". Keep biography and credentials. Remove reverential headlines and the oversized quote treatment. Use `CtaBand`.
- [ ] **Step 4: Contact.**
  - Title "Contact the lab" using an appliance or lab image.
  - Replace the phone with `619.724.6400` and the location with "La Mesa, California".
  - Remove the lounge stock image.
  - Leave the form's behaviour alone (see the open decision in the handoff).
- [ ] **Step 5: Run** `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: build succeeds, and the only failures are guard lines for files not yet migrated.
- [ ] **Step 6: Commit.**

### Task 4: Product pages (Products, TMD, Sleep, Digital Workflow)

**Files:**
- Modify: `apps/web/src/pages/marketing/Product.jsx`, `Tmd.jsx`, `Sleep.jsx`, `DigitalWorkflow.jsx`
- Modify: `apps/web/src/components/marketing/Navbar.jsx` (remove `HEROLESS_ROUTES`)

**Interfaces:**
- Consumes: Task 1 components.

- [ ] **Step 1: Products.** Compact hero, `CtaBand`. The Olmos-Method highlight becomes "Built to your prescription", with "Every appliance follows the clinical parameters on your Rx." Do not edit catalog components.
- [ ] **Step 2: TMD and Sleep.**
  - Compact hero placed above the product viewer, with the existing H1s.
  - Remove the filler stats, keeping FDA 510(k) on Sleep.
  - The symptoms list becomes a plain two-column list.
  - Section H2s are plain.
  - Keep every Olmos product name.
  - Remove `HEROLESS_ROUTES` once both pages have a dark hero.
- [ ] **Step 3: Digital Workflow.**
  - Image hero using an appliance photo.
  - The six stages become one ordered list.
  - Remove the `100%`, `6` and `∞` stats. "10 business days" stays in the headline.
  - Replace "Olmos-Method parameters" with "the parameters on your Rx".
- [ ] **Step 4: Run** test and build, with the same expectation as Task 3.
- [ ] **Step 5: Commit.**

### Task 5: Resource pages (Submit Case, Rx Instructions, Downloads, Videos, Certified Labs, Courses, Coming Soon)

**Files:**
- Modify: `apps/web/src/pages/marketing/CaseSubmission.jsx`, `RxInstructions.jsx`, `Downloads.jsx`, `InstructionalVideos.jsx`, `CertifiedLabs.jsx`, `Courses.jsx`, `ComingSoon.jsx`

**Interfaces:**
- Consumes: Task 1 components, `lib/playOnView`.

- [ ] **Step 1: Utility pages.** Submit Case, Downloads, Videos and Coming Soon use the compact hero. Remove the overlapping grey fade and "Back to Home". Downloads becomes a plain list. Do not change the Submit Case behaviour.
- [ ] **Step 2: Rx Instructions.** Image hero. Remove the private `playOnView` in favour of `lib/playOnView`. Keep the "Olmos Orthotic Rx (PDF)" and device names.
- [ ] **Step 3: Certified Labs.**
  - Title "Certified laboratories", intro "Laboratories in the US, Canada and Australia are certified to make these appliances."
  - The directory becomes per-country rows and keeps every lab, link and phone number.
  - Remove "Phase I · Phase II · Sleep".
  - Dr. Olmos stays named in the administration paragraph, with its link to his page.
- [ ] **Step 4: Courses.**
  - Title "Courses for TMD and sleep dentistry", removing the "Dr. Steven Olmos · Courses" eyebrow.
  - Keep the factual "directed by Dr. Steven R. Olmos" in the intro.
  - Remove the flag emoji in the locations list.
- [ ] **Step 5: Run** test and build, with the same expectation as Task 3.
- [ ] **Step 6: Commit.**

### Task 6: Home copy corrections

**Files:**
- Modify: `apps/web/src/pages/marketing/Home.jsx`

**Interfaces:**
- None. Copy only, with no className or layout edits.

- [ ] **Step 1: Hero strings** (subject to the open decision):
  - Pill: "TMD & SLEEP ORTHOTIC LAB".
  - Paragraph: "The orthotic lab for TMD and sleep dentistry. Digital workflow. Clinical accuracy. Every appliance, every time."
- [ ] **Step 2: Other copy:**
  - Card title "Olmos-Method Expertise" becomes "Clinical Protocol Expertise", with "We understand the clinical protocol, not just the fabrication."
  - Shuffler label becomes "Protocol Assessment".
  - Telemetry line becomes "Bite registration verified".
  - "Olmos-Method protocol" becomes "a documented clinical protocol".
  - Design panel becomes "CAD articulation to the parameters on your Rx. Every occlusal surface mapped."
  - Stats: "100% Digital Workflow" becomes "19 Lab Team Members"; "50+ Certified Labs" becomes "3 Countries With Certified Labs". No lab count is stated.
  - "Full digital workflow. No analog guesswork. Consistent..." becomes "Full digital workflow. Consistent, accurate appliances with fast turnaround."
- [ ] **Step 3: Run** `pnpm --filter @my-app/web test`. Expected: the whole suite passes, guard test included.
- [ ] **Step 4: Commit.**

### Task 7: Verify, update the rules, hand over

**Files:**
- Modify: `CLAUDE.md` (Global Design Rules section)

**Interfaces:**
- None.

- [ ] **Step 1: Update the design rules in `CLAUDE.md`.**
  - Remove the "System Operational" requirement.
  - Add the colour roles, the italic-in-hero-only rule, mono-for-technical-values-only, and "use `PageHero`, `SectionHeading`, `CtaBand`, `StatRow`".
- [ ] **Step 2: Run** the full check: `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: all pass.
- [ ] **Step 3: Screenshot** all 16 routes at 1440 and 390 from local Vite with Playwright, scrolling first, then compare to the baseline capture. Confirm:
  - The home hero matches apart from the two strings.
  - No blank sections.
  - No horizontal scroll at 390.
  - White nav legible at the top of every page.
- [ ] **Step 4: Regression click-through:** add to cart, open Submit Case, and open sign-in from the nav.
- [ ] **Step 5: Whole-branch review** by one Opus reviewer. Fix findings in one batch.
- [ ] **Step 6: Commit and push** `feat/design-rework`. Open a PR with `@coderabbitai ignore` per the repo's review policy. Do not merge. `main` auto-deploys and needs the owner's sign-off.
