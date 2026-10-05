# Rx mapping — known follow-ups

Carried out of the whole-branch review of the Rx consolidation + catalog-map
work (merged as `b056102`). Each was deliberately parked with a ruling rather
than fixed, so none is a surprise. Ordered by what I'd do first.

## 1. `DDSO design` reaches the lab through no channel at all

**The one worth fixing first.** `DDSO_OPTIONS.design` ("Anterior contact" /
"Posterior full-arch") is a **required** field, but it is not a line item, not
an `unmapped` flag, and not even a note — `deviceOptionLines()` in
`build-order-payload.js` is an explicit allowlist that omits it. The same is
true of guard `thickness`.

This is active data loss on a required field. It predates this work rather than
being introduced by it.

**Fix:** add both to the `deviceOptionLines()` allowlist so they travel as
notes. No product code needs guessing, so nothing is blocked on the lab.

## 2. Nightguard picker selections hold every such order

By design — refusing beats sending an appliance-less order — but it needs
saying out loud before `RX_LIVE_PUSH` is ever switched on. Three keys are
waiting on a lab decision:

- `guard:dual-arch-flatplane:no-material`
- `guard:dual-arch-slider`
- `guard:single-arch-nightguard`

They are questions 3–5 in the lab sign-off form
(`docs/rx-forms/create-lab-signoff-form.gs`). Answering them, or seeding
`rx_code_overrides` rows for them, clears the hold.

## 3. `Dual Arch - FLATPLANE` lists as Confirmed but is unreachable

Codes 2162 / 2163 / 2531 appear under **Confirmed** in
`docs/rx-forms/mapping-status.md`, but no doctor-facing input can currently
produce them — the row is a `nightguardDevice` picker option, not one of the
seven `standardGuards` matrix rows. Confirming them is unnecessary rather than
harmful, so the lab document is not wrong, just over-inclusive.

**Fix:** mark unreachable rows in the generated document, and restore an
independent reachability check. The current test iterates
`Object.keys(GUARD_MATRIX)` — the same source `GUARD_ROWS` derives from — so it
can no longer catch this class.

## 4. Guard de-duplication is exact-label only

`resolveGuard`'s `handled` set compares row labels literally, so it cannot see
that the picker's `"Single Arch - NIGHTGUARD"` and the matrix's
`"Nightguard - Full Occlusion"` are the same appliance (likewise
`"Dual Arch - SLIDER"` vs `"Occlusal Guard - Slider Type"`).

Not triggerable today — both picker rows are `open`, so neither emits. **The
moment the lab maps them (follow-up 2), a doctor who ticks both the picker and
the matrix row gets two lines for one appliance.** Revisit before acting on
those answers.

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
- `LAB_SERVICE_CODES` has zero importers, and its `articulate` entry lost the
  "(Per Arch)" suffix the retired map carried. Delete it or restore the suffix.
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
