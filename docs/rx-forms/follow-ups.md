# Rx mapping — known follow-ups

Carried out of the whole-branch review of the Rx consolidation + catalog-map
work (merged as `b056102`). Each was deliberately parked with a ruling rather
than fixed, so none is a surprise. Ordered by what I'd do first.

## 1. ~~`DDSO design` reaches the lab through no channel at all~~ — fixed

Fixed on `feat/rx-history-backed-services`. Two halves:

- The retired wizard's DDSO `design` and guard `thickness`, and the live
  form's guard-matrix clearance / teeth / colour / "Other" cells, are now in
  `deviceOptionLines()`.
- More importantly, the REAL push (`payloadFromLines`, stored lines) never
  called `deviceOptionLines()` at all — only the admin send-test builder did.
  So occlusal contact, design preference, titration placement and device
  comments reached a pushed order only as $0 line items or not at all. The
  push now appends `compileNotesMulti(caseRow, devicesForCase(caseRow))`.

## 2. Nightguard picker selections hold every such order — mostly cleared

Evidence from real orders now answers two of the three keys:
`Dual Arch - FLATPLANE` alone proposes 2163 (77% of n=43) and
`Dual Arch - SLIDER` alone proposes 2176 (84% of n=73). One is still held:

- `guard:single-arch-nightguard` — picker-only orders split 2166 40% /
  2164 24% / 2170 14% (n=105). When the doctor also fills the
  Full Occlusion row, that row now decides and nothing is held.

The lab sign-off form (`docs/rx-forms/create-lab-signoff-form.gs`) still asks
the Slider Type, SLIDER and Full Coverage questions the order history has now
answered — trim it before it is sent.

## 3. `Dual Arch - FLATPLANE` lists as Confirmed but is unreachable

**Largely superseded:** the FLATPLANE picker now takes its material from the
Full Occlusion row (2162 / 2163 reachable), and alone proposes 2163. Only the
BioFlex row (2531) still needs a doctor to type "BioFlex" into a matrix cell.
The original note follows.

Codes 2162 / 2163 / 2531 appear under **Confirmed** in
`docs/rx-forms/mapping-status.md`, but no doctor-facing input can currently
produce them — the row is a `nightguardDevice` picker option, not one of the
seven `standardGuards` matrix rows. Confirming them is unnecessary rather than
harmful, so the lab document is not wrong, just over-inclusive.

**Fix:** mark unreachable rows in the generated document, and restore an
independent reachability check. The current test iterates
`Object.keys(GUARD_MATRIX)` — the same source `GUARD_ROWS` derives from — so it
can no longer catch this class.

## 4. ~~Guard de-duplication is exact-label only~~ — fixed

`resolveGuard` now knows which picker render is which matrix row (`PICKERS` in
`resolvers/guard.js`): SLIDER is covered by the Slider Type / NTI Type rows,
Single Arch NIGHTGUARD by Full Occlusion, and FLATPLANE takes its material
from the Full Occlusion row. Dual-arch appliances (NTI Slider, FLATPLANE) are
also one line however many arches are ticked — real orders carried 2176 as a
single line on 70/70 orders.

## 4a. The live form's guard matrix is free text, and was being dropped

`MatrixField` stores cells flat (`"<row>__<column>": text`) with a text input
in every cell, but `resolveGuard` read a nested `{ row: { col } }` shape — so
every matrix row ordered on the live form resolved to nothing. Fixed in the
resolver (`nestGuardMatrix` accepts both shapes; materials match the known
literals exactly, ignoring case and the parenthetical). The form itself should
still render the arch columns as checkboxes and Base Material as a dropdown,
as JotForm did — a typo'd material is held for staff today, not guessed.

## 4b. Open questions the order history raised

- **Single-arch rows with both arches ticked.** Every real nightguard /
  Michigan order (125 of them) carries its product once, with no arch. The
  resolver still bills one line per ticked arch for single-arch rows. Is a
  two-arch single-arch nightguard really two appliances?
- **NTI Type in BIOMED** billed 2165 Nightguard-Single Arch Biomed on 3/3
  orders, not the mapped 2175. Small n; left as is.
- **Rush on the digital form** (`formData.rushCase`) never reaches the push —
  `rush` is a column only `POST /rx/cases` fills, and the lab-service lines
  do not add a rush product either.
- **MORA** stays proposed: 2593 MORA - PMT and 2594 MORA - ClearSplint were
  each billed exactly once in 3,600 orders.

## 5. The send-test `ok` gate has no route-level test

`POST /admin/rx-mapping/send-test` is the only route that writes to the live
Seazona account, and it now correctly refuses when `ok` is false. But the test
covers the extracted pure function, not the route — reverting the route's guard
would leave the suite green.

**Fix:** add a route-level assertion.

## 6. Server-side adapter for form submissions (missing feature, not a defect)

`POST /rx/form-submissions` stores `deviceKey: null`, and the only
form→device adapter (`formAnswersToCaseInput`) runs in the browser. So a
submission from the consolidated Rx form cannot currently be turned into a
Seazona order automatically.

The case itself is stored complete and PHI-encrypted, so the lab works it by
hand — the same workflow JotForm required. Closing this needs a product
decision about where that adapter should live, not just code.

## 7. Smaller items

- `.env.example` still documents `SEAZONA_BASE_URL=https://diamondapi.labzona.net/`.
  That host was retired 2026-06-15 and 403s from everywhere; it should read
  `https://diamond.seazonaapi.net/`. Anyone setting up from that file today gets
  a dead API.
- ~~`LAB_SERVICE_CODES` has zero importers~~ — replaced by
  `catalog-map/lab-services.js`, which seed and re-resolve both use.
- `tailwind.config.js`'s new colour tokens hardcode alpha instead of using
  `<alpha-value>`, so `text-secondary/50`-style modifiers silently do nothing.
  Inert today — no call site uses one.
- `contrast.test.js`'s first test is arithmetic over hardcoded alphas; it does
  not read `tailwind.config.js`, so editing a token there could break contrast
  with a green suite.
- `ROUTES.DOCTOR_NEW_CASE` is now referenced by nothing after the wizard
  retirement.

## 8. The Seazona claim predicate is duplicated across two routes

`POST /admin/rx-cases/:id/push` and `POST /admin/rx-cases/:id/mark-manual` each
build the same conditional-update claim by hand:

```js
ne(rxCases.status, "pushed"),
or(isNull(rxCases.seazonaPushStatus), ne(rxCases.seazonaPushStatus, "pushing")),
```

This is the guard that stops one case becoming two Seazona orders, and Seazona
has no idempotency key — a duplicate is a real order someone has to find and
delete. Editing one site and not the other reopens the race.

Not urgent: the paired static-source tests in `admin-rx-cases.test.js` assert
both sites, so a one-sided edit fails the suite today. **Fix when a real
Fastify-inject harness lands** (follow-up 5) — at that point the static tests
get replaced anyway, and the shared helper should land with them rather than
being refactored in isolation now.

## 9. `practiceName` on a case is the doctor's name, not the practice

`POST /rx/form-submissions` stores `practiceName: request.user.name`, and the
arrival email uses the same value, so the queue and the email agree. But the
column means *practice*, and the real practice name is `accounts.name` — a
doctor belongs to an account through a membership.

Getting it right needs a memberships join in the submit path, which is why it
was not done inline. Worth doing when someone is next in that route: the lab
reads this column to know whose case they are looking at, and "Dr Alvarez"
where they expect "Alvarez Family Dental" is a small daily papercut.

Note `POST /rx/cases` (the other submit route) takes `practiceName` straight
from its payload, so the two routes populate this column from different
sources. Unify them at the same time.
