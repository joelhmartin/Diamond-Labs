# Messaging, Notifications and Logistics (Piece 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab↔practice message threads, one `notify()` routing events to in-app / email / SMS with per-user preferences and a bell, an SMS adapter (Twilio, off until credentials exist), portal pickups, and a printable local-delivery route list.

**Architecture:** Three generic modules (`apps/api/src/modules/{sms,notifications,messaging}`) are built by factories that take their collaborators. Lab glue in `apps/api/src/services/` wires them: `notify.js` (the seam), `practice.js`, and in `lab/` the notification events, record resolvers, pickups and deliveries. `app-modules.js` configures everything at boot. The web modules live in `apps/web/src/modules/{notifications,messaging}`, and every list is a `DataTable`.

**Tech Stack:** Fastify v5, Drizzle (postgres.js), zod (`@my-app/shared`), vitest + node:assert on the API; React 18, Tailwind, lucide-react, vitest + jsdom + @testing-library/react on the web. Mailgun goes through `email.service.js` `deliver()`. Twilio uses the REST API over `fetch`, with no SDK.

**Spec:** `docs/superpowers/specs/2026-11-05-messaging-notifications-logistics-design.md` (read it; event registry, data model and rulings are there). Roadmap: `docs/superpowers/specs/2026-11-05-lab-parity-roadmap.md`.

## Global Constraints

- The generic modules (`modules/sms`, `modules/notifications`, `modules/messaging`, and `apps/web/src/modules/*`) contain no lab, doctor, case, practice, patient or dental words: not in identifiers, not in copy, not in comments. Task 1 adds a test that greps for them.
- Every list is `DataTable` + `useDataTable`. Bulk actions are `BulkAction` config. Bulk moves loop the existing single-item endpoint and report `{ ok, failed }`.
- Never use `alert()`, `confirm()` or `prompt()`. Destructive steps use `ConfirmButton`; messages use `useToast()`.
- Files stay under 1,000 lines and functions under 150 (components with markup: 300).
- No PHI or free text in logs, email bodies, SMS, notification titles or `data`. Message bodies, subjects, attachment file names, pickup notes and cancel reasons are sealed with `fieldSealer` (`lib/crypto.js`).
- No Seazona calls. No DB foreign keys.
- Every new table and column is classified in `apps/api/src/db/scrub/plan.js` **and** `COLUMNS.md` (`plan.test.js` enforces it).
- Module tables live in `modules/<name>/schema.js` and are re-exported from `apps/api/src/db/schema/index.js`.
- Migrations come from `cd apps/api && pnpm db:generate`. They are never hand-written. At rebase they are dropped and regenerated (roadmap merge order 7 → 6 → 8).
- Times shown to staff are in `LAB_TIMEZONE` (`America/Chicago`). Use `isoDateIn()` for "today".
- `notify()` is imported only from `apps/api/src/services/notify.js`. Call it after commit, with the root `db`. It never throws.
- Tests:
  - api: `pnpm --filter @my-app/api test -- <pattern>`
  - web: `pnpm --filter @my-app/web test -- <pattern>`
  - each web task ends with `pnpm --filter @my-app/web build` passing.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only with `git push origin <branch>`.

## Review Focus

1. **A doctor of one practice opening another practice's thread, attachment or pickup by id** gets a 404, never the data. This includes a doctor with a null `seazonaClientId`, who sees only `user:<own id>`. Tests: Task 5 `party user cannot read a thread outside their party keys`, `attachment download checks thread access before signing`; Task 8 `doctor cannot cancel another practice's pickup`.
2. **Five quick messages** produce five in-app bumps on one row (count 5), one email, and five SMS to the lab list. Test: Task 1 `an unread collapse_key bumps count and skips email`.
3. **Staging** must never text or mail a real number or address. SMS goes to `STAGING_SMS_TO` or is suppressed. Test: Task 2 `staging redirects to STAGING_SMS_TO and suppresses when unset`.
4. **A send failure** (Mailgun 500, Twilio 4xx, network throw) never fails the post, request or ship that triggered it. It logs `[NOTIFY][SEND_FAILED]` and writes a `failed` delivery row. Tests: Task 1 `a throwing channel is logged and notify resolves`; Task 6 `a failing notify does not fail the post`.
5. **Mark delivered on a stop with a mix of ready and not-ready orders** moves only the `ready_to_ship` ones and names the rest as failures. A stale version is a named failure, not a crash. Test: Task 10 `planMarkDelivered moves ready orders and reports the rest`.

---

### Task 1: notifications module core + README

**Files:**
- Create:
  - `apps/api/src/modules/notifications/schema.js`
  - `registry.js`
  - `notifier.js`
  - `preferences.js`
  - `data-guard.js`
  - `index.js`
  - `README.md`
- Create: `apps/api/src/modules/module-words.test.js` (the banned-words test for all of `apps/api/src/modules/**` and `apps/web/src/modules/**`)
- Create: `apps/api/src/services/notify.js` (seam, as published in the spec; it delegates to the configured notifier)
- Modify: `apps/api/src/db/schema/index.js` (re-export)
- Modify: `apps/api/src/services/email.service.js` (add `sendNotificationEmail`)
- Modify: `apps/api/src/db/scrub/plan.js`, `COLUMNS.md`
- Create: the generated migration under `apps/api/src/db/migrations/`
- Test:
  - `apps/api/src/modules/notifications/notifier.test.js`
  - `registry.test.js`
  - `data-guard.test.js`
  - `apps/api/src/services/email-notification.test.js`

**Interfaces:**
- Produces:
  - **Tables:** `notifications`, `notificationPreferences`, `notificationRecipients`, `notificationDeliveries` (columns as in the spec's data model).
  - **Event registry:**
    - `defineNotificationEvent({ key, label, kinds: string[], defaults: { [kind]: { in_app: bool, email: bool } }, sms?: bool, title(data) → string, link(data, kind) → string|null, email?: { subject(data) → string, send?(recipient:{id,email,kind}, data) → Promise<boolean> }, smsText?(data) → string })`
    - `getEvent(key)`, `listEvents({ kind }?)`, `clearEvents()` (test only).
  - `CHANNELS = ["in_app", "email", "sms"]` (in `packages/shared/src/notifications/channels.js`, exported from the shared index).
  - **Notifier:** `createNotifier({ db, resolveAudience(db, audience) → Promise<[{ id, email, kind }]>, channels: { email: { send({ to, subject, heading, line, actionUrl, actionLabel }) → Promise<boolean> }, sms: { send({ to, body }) → Promise<{ ok, error? }> } }, appUrl, orgName, log }) → { notify(db, args), listForUser(db, userId, q), unreadCount(db, userId), markRead(db, userId, { ids|all }), markUnread(db, userId, id), dismiss(db, userId, id), getPreferences(db, user), setPreference(db, user, { event, channel, enabled }), recipients: { list, add, setActive, remove, sendTest }, deliveries: { list } }`
  - `configureNotifications(notifier)` and `currentNotifier()` in `index.js`. `services/notify.js` calls `currentNotifier()?.notify(...)` and returns zeros when none is configured.
  - **Data guard:** `assertSafeData(data) → data`. It throws `NotificationDataError` for nested objects, values longer than 200 characters, or more than 2 KB serialised.
  - **Masking:** `maskAddress(addr) → string` (`•••1234` for a phone, `j•••@domain` for an email).
  - **Email sender:** `sendNotificationEmail({ to, subject, heading, line, actionUrl, actionLabel = "Open" }) → Promise<boolean>` in email.service.js. Every value is escaped, it goes through `deliver()`, and there is no other body text.

- [ ] **Step 1: Write failing tests.** Use an in-memory fake db, or the repo's `test/fake-tx.js` pattern if it fits; otherwise inject a tiny repository object into `createNotifier` (`store` option) and test the logic against a fake store.
  - `notifier.test.js`:
    - `unknown event logs [NOTIFY][UNKNOWN_EVENT] and returns zeros`
    - `in_app row is written per resolved user with title(data) and link(data, kind)`
    - `excludeUserIds and duplicates are dropped`
    - `preference row false suppresses that channel; missing row uses defaults[kind]`
    - `an unread collapse_key bumps count and skips email` (two notifies → one row with count 2, email sent once)
    - `after markRead the next notify creates a fresh row and emails again`
    - `addresses.email are emailed without an in-app row`
    - `active static sms recipients receive one text per notify; inactive do not`
    - `sms body is capped at 160 chars`
    - `a throwing channel is logged and notify resolves` (logs contain `[NOTIFY][SEND_FAILED]`; delivery row status `failed`; the target is masked)
    - `event.email.send overrides the generic sender`
  - `registry.test.js`:
    - `duplicate key throws`
    - `listEvents({kind}) returns only events whose kinds include it`
  - `data-guard.test.js`:
    - `accepts flat primitives and primitive arrays`
    - `rejects nested objects, >200-char strings and >2KB payloads`
  - `email-notification.test.js`:
    - `sendNotificationEmail escapes heading/line and links actionUrl`
    - `it goes through deliver (staging rewrite applies)`
    - Mirror `email-shipping.test.js`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- notifications email-notification`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the schema (spec data model, indexes including the partial unique `(user_id, collapse_key) where read_at is null`), `registry.js`, `data-guard.js`, `preferences.js` (`effectivePreference(rows, event, kind, channel)`), `notifier.js` and `index.js`. Collapse uses `insert … on conflict (user_id, collapse_key) where read_at is null do update set count = count + 1, updated_at = now()` returning `(xmax = 0) as inserted`, and email is sent only when inserted. `pruneDeliveries(db, 90)` runs with `Math.random() < 0.01` (injectable `random`).
- [ ] **Step 4:** Add `sendNotificationEmail` to email.service.js. Add `services/notify.js` with exactly the spec's export signature.
- [ ] **Step 5:** Re-export the schema, classify the columns in scrub `plan.js` and `COLUMNS.md`:
  - `notifications.*`: keep.
  - `notification_recipients.address`: `pii("'+15005550006'")`; label: `pii("NULL")`.
  - `notification_deliveries.target_masked` and `reason`: `pii("NULL")`.
  - Run `cd apps/api && pnpm db:generate`.
- [ ] **Step 6:** Write `modules/notifications/README.md`: purpose, public interface (the signatures above), configuration (`createNotifier` options), data model, and a stub "Wiring it into another app" heading (Task 11 fills it in). Write `module-words.test.js`: it walks both module trees (excluding itself) and fails on `/\b(lab|doctor|dental|patient|practice|case|rx)\b/i` outside a `// words-ok:` line.
- [ ] **Step 7:** Run `pnpm --filter @my-app/api test`. Expected: PASS (including `scrub/plan.test.js`).
- [ ] **Step 8:** Commit `feat(notifications): generic notify module with in-app store, preferences and collapse`.

### Task 2: sms module (Twilio adapter, off by default)

**Files:**
- Create:
  - `apps/api/src/modules/sms/sms-config.js`
  - `sms-registry.js`
  - `phone.js`
  - `adapters/twilio.adapter.js`
  - `adapters/log.adapter.js`
  - `adapters/adapter-contract.test.js`
  - `fixtures/twilio-sent.json`, `fixtures/twilio-error-21211.json`
  - `README.md`
- Create: `apps/api/scripts/sms-smoke.js`
- Modify: `apps/api/package.json` (script `"sms:smoke": "node --env-file=.env scripts/sms-smoke.js"`)
- Modify: `apps/api/src/config/env.js` (all optional: `SMS_PROVIDER: z.enum(["twilio","log","off"]).default("off")`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_MESSAGING_SERVICE_SID`, `STAGING_SMS_TO`)
- Test:
  - `apps/api/src/modules/sms/sms-registry.test.js`
  - `phone.test.js`
  - `adapters/twilio.adapter.test.js`

**Interfaces:**
- Produces:
  - **Config:** `smsConfig(env) → { provider, staging: bool, stagingTo, twilio: { accountSid, authToken, from, messagingServiceSid } }`. The value holds credentials: never log or return it.
  - **Registry:** `createSmsRegistry({ config, fetchImpl }) → { status() → { provider, ok, reason? }, send({ to, body }) → Promise<{ ok, providerId?, error?, suppressed? }> }`. The shared instance is `smsRegistry()`.
  - **Adapter contract:** `{ id, label, configured() → { ok, reason? }, send({ to, body }) → Promise<{ ok, providerId?, error? }> }`.
  - **Phone utils:** `normalizePhone(input, defaultCountry = "1") → "+1XXXXXXXXXX" | null`, `maskPhone(e164) → "•••1234"`.

- [ ] **Step 1: Write failing tests.**
  - `phone.test.js`:
    - `normalizes (555) 123-4567, 555.123.4567, +1 555 123 4567 to +15551234567`
    - `rejects short, long and letter input`
  - `twilio.adapter.test.js` (fake `fetchImpl` returning the fixtures):
    - `posts form To/From/Body to /2010-04-01/Accounts/{sid}/Messages.json with Basic auth`
    - `uses MessagingServiceSid when set instead of From`
    - `2xx → { ok: true, providerId: sid }`
    - `4xx → { ok: false, error: "21211 <message>" } and never includes the token`
    - `configured() names unset TWILIO_* variables, never values`
  - `adapter-contract.test.js`: every adapter has id, label, configured and send, and `send` resolves to `{ ok }`.
  - `sms-registry.test.js`:
    - `provider off → send returns { ok:false, suppressed:true }`
    - `staging redirects to STAGING_SMS_TO and suppresses when unset` (the body is prefixed `[STAGING → •••1234]`)
    - `a throwing adapter resolves { ok:false, error }`
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- modules/sms`. Expected: FAIL.
- [ ] **Step 3:** Implement, mirroring `services/shipping/carrier-registry.js` and `carrier-config.js` (`missingConfigReason` style). Use `fetch` with `application/x-www-form-urlencoded`, `AbortSignal.timeout(10_000)`, and no SDK.
- [ ] **Step 4:** Write `scripts/sms-smoke.js --to <number> [--live]`. It prints `status()`. Without `--live` it refuses unless `TWILIO_FROM === "+15005550006"` (Twilio test credentials). It prints only `ok`, the masked target and `providerId`.
- [ ] **Step 5:** Write `modules/sms/README.md`: the adapter contract, how to add a provider (one adapter plus one line in `FACTORIES`), env, staging rule and smoke command.
- [ ] **Step 6:** Run `pnpm --filter @my-app/api test`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(sms): provider registry with Twilio adapter, switched off until configured`.

### Task 3: notification routes, lab events and boot wiring

**Files:**
- Create:
  - `apps/api/src/modules/notifications/routes.js` (`notificationRoutes`)
  - `packages/shared/src/notifications/schemas.js`
  - `apps/api/src/services/practice.js`
  - `apps/api/src/services/lab/lab-notifications.js`
  - `apps/api/src/services/app-modules.js`
- Modify:
  - `apps/api/src/index.js` (call `configureAppModules()` before routes; register `notificationRoutes` at `/api/v1`)
  - `packages/shared/src/index.js`
  - `apps/api/src/routes/rx.routes.js:542` (after `sendRxSubmissionReceived`, `await notify(db, { event: "lab.order_received", recordType: "rx_case", recordId: caseId, audience: { kinds: ["staff"] }, data: { caseNumber } })`)
  - the shop checkout caller of `createShopLabOrder` (after its commit; find it with `grep -rn createShopLabOrder apps/api/src/routes`) with `data: { orderNumber }`
  - `apps/api/src/services/lab/lab-shipping.service.js:194` (`notifyShipped` → `notify(... "lab.order_shipped" ...)`; claimant-only logic unchanged)
- Test:
  - `apps/api/src/modules/notifications/routes.test.js`
  - `apps/api/src/services/practice.test.js`
  - `apps/api/src/services/lab/lab-notifications.test.js`
  - update `apps/api/src/services/lab/lab-shipping.service.test.js` and `email-shipping.test.js` if they assert the direct `sendShippedNotice` call

**Interfaces:**
- Consumes: Task 1 `createNotifier`, `defineNotificationEvent`, `configureNotifications`; Task 2 `smsRegistry()`.
- Produces:
  - **Practice keys:** `practiceKeyFor(user) → string`, `partyKeysFor(user) → string[]`.
  - **Lab audience resolver:** `resolveLabAudience(db, audience) → [{ id, email, kind: "staff"|"client" }]`.
    - `kinds: ["staff"]` means active users with role in `STAFF_ROLES`.
    - `party: "practice:X"` means active approved doctors with that `seazonaClientId`.
    - `party: "user:Y"` means that user.
    - `userIds` means those users, each with its kind (staff if `isStaffRole`, else client).
  - **Lab events:** `registerLabNotificationEvents()` registers the six events in the spec table with those defaults and titles. `lab.order_shipped` has `email.send` calling `sendShippedNotice`.
  - **Boot:** `configureAppModules({ env, db, log })` in `app-modules.js`. It builds the notifier with `channels.email = { send: sendNotificationEmail }`, `channels.sms = smsRegistry()`, `appUrl = env.APP_URL` and `orgName = labIdentity(env).name`. Task 6 adds messaging here.
  - **Routes:** `notificationRoutes(fastify, { notifier, authenticate, requireAdmin, kindOf(user) })` with the routes in the spec's Notifications table. `kindOf` comes from the glue: `isStaffRole(role) ? "staff" : "client"`.
  - **Shared schemas:** `notificationListQuerySchema`, `notificationReadSchema` (`{ ids: string[1..200] } | { all: true }`), `notificationPreferenceSchema`, `notificationRecipientCreateSchema` (event is a registered key, checked server-side; channel `sms|email`; address 3–320 characters; label ≤ 80).

- [ ] **Step 1: Write failing tests.**
  - `practice.test.js`:
    - `practiceKeyFor uses seazonaClientId else user id`
    - `partyKeysFor agrees with canActOnInvoice` (table over the four null/non-null cases: for owner U and requester R, `canActOnInvoice(R, {clientUserId: U.id}, U.seazonaClientId)` ⇔ `partyKeysFor(R).includes(practiceKeyFor(U))`)
  - `lab-notifications.test.js`:
    - `registers exactly the six spec events`
    - `titles contain only numbers/dates from data`
    - `resolveLabAudience: staff kind returns admin+lab active users only; practice party returns approved doctors of that practice only`
    - `order_shipped email.send calls sendShippedNotice with orderNumbers and tracking`
  - `routes.test.js` (source-inspection style via `routes/__tests__/_source.js` `handlerSource`, plus unit tests of the handlers with a fake notifier):
    - `every route is behind authenticate`
    - `admin recipient routes require admin`
    - `recipient create normalizes the phone and rejects an invalid one with 400`
    - `preferences PUT refuses an event not visible to the user's kind`
  - Shipping: `markShipmentShipped emits lab.order_shipped once for the claimant only` (adapt the existing test that asserted the email).
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- practice lab-notifications notifications lab-shipping`. Expected: FAIL.
- [ ] **Step 3:** Implement. The rx and shop emits are awaited after commit; they are already post-commit at those call sites. The shipping emit stays inside the existing `afterCommit` wrapper.
- [ ] **Step 4:** Run `pnpm --filter @my-app/api test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(notifications): lab events, audience resolver, routes and boot wiring`.

### Task 4: notifications web (bell, alert center, preferences, lab alerts admin)

**Files:**
- Create:
  - `apps/web/src/modules/notifications/api.js`
  - `useUnreadPoll.js`
  - `NotificationBell.jsx`
  - `AlertCenter.jsx`
  - `PreferencesPanel.jsx`
  - `RecipientsPanel.jsx`
  - `DeliveriesTable.jsx`
  - `index.js`
  - `README.md`
- Create: `apps/web/src/pages/app/NotificationsPage.jsx` (AlertCenter + PreferencesPanel tabs; used for both shells), `apps/web/src/pages/app/AdminLabAlertsPage.jsx`
- Modify:
  - `apps/web/src/components/layout/Topbar.jsx`, `DoctorShell.jsx` (bell)
  - `apps/web/src/components/layout/Sidebar.jsx` (adminItems: "Lab alerts" → `ROUTES.ADMIN_LAB_ALERTS`, icon `BellRing`)
  - `apps/web/src/config/routes.js` (`NOTIFICATIONS: "/notifications"`, `DOCTOR_NOTIFICATIONS: "/doctor/notifications"`, `ADMIN_LAB_ALERTS: "/admin/notifications"`)
  - `apps/web/src/App.jsx`
- Test:
  - `apps/web/src/modules/notifications/__tests__/NotificationBell.test.jsx`
  - `AlertCenter.test.jsx`
  - `useUnreadPoll.test.jsx`
  - `RecipientsPanel.test.jsx`
  - (all with `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: Task 3 routes.
- Produces:
  - `useUnreadPoll(fetchCount, { intervalMs = 60_000 }) → { count, refresh }`. It pauses while `document.visibilityState === "hidden"` and refreshes on `visibilitychange` to visible. Task 7 reuses it for the messages badge.
  - **Components:**
    - `<NotificationBell to />`: `to` is the "See all" path for the shell.
    - `<AlertCenter />` is a server-mode DataTable.
    - `<PreferencesPanel />`.
    - `<RecipientsPanel events />`.
    - `<DeliveriesTable />`.

- [ ] **Step 1: Write failing tests.**
  - `useUnreadPoll`:
    - `polls every interval while visible`
    - `does not poll while hidden and refreshes on becoming visible`
  - `NotificationBell`:
    - `shows the unread badge (99+ cap)`
    - `opening lists the latest 8`
    - `Mark all read posts { all: true } and zeroes the badge`
  - `AlertCenter`:
    - `row click navigates to link and marks read`
    - `bulk Mark read posts the selected ids`
    - `Dismiss is a ConfirmButton (two clicks)`
    - `Unread filter sends unread=true`
  - `RecipientsPanel`:
    - `shows the SMS provider-off reason`
    - `add rejects an invalid phone inline (no network call)`
    - `Send test calls the test endpoint and toasts`
    - `numbers render masked except last 4`
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- modules/notifications`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use DataTable config only: no hand-rolled tables, no `<table>` in these files except through DataTable. `PreferencesPanel` is a simple grid of toggles (events × In-app/Email); it is not a list, so no DataTable.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS and build OK.
- [ ] **Step 5:** Commit `feat(web): notification bell, alert center, preferences and lab alerts admin`.

### Task 5: messaging module API core + README

**Files:**
- Create:
  - `apps/api/src/modules/messaging/schema.js`
  - `rules.js`
  - `messaging.service.js`
  - `queries.js`
  - `routes.js`
  - `index.js`
  - `README.md`
- Create: `packages/shared/src/messaging/schemas.js` (+ export from the shared index)
- Modify: `apps/api/src/services/storage.service.js` (add `uploadFile({ prefix, buffer, originalName, contentType })`; `uploadCaseFile` becomes a call to it with `prefix: "rx-cases/<caseId>/<kind>"` and its validation kept)
- Modify: `apps/api/src/db/schema/index.js`, scrub `plan.js` + `COLUMNS.md`, a generated migration
- Test:
  - `apps/api/src/modules/messaging/rules.test.js`
  - `messaging.service.test.js`
  - `routes.test.js`
  - `apps/api/src/services/storage.service.test.js` (extend)

**Interfaces:**
- Produces:
  - **Tables:** `messageThreads`, `messageParticipants`, `messages`, `messageAttachments` (spec data model).
  - **Service:** `createMessaging({ db, sealer = fieldSealer, storage: { uploadFile, getSignedReadUrl }, records: { [recordType]: { resolve(db, recordId, user) → Promise<{ label, partyKey, hostPath, partyPath }|null> } }, isHost(user) → bool, partyKeysFor(user) → string[], defaultPartyKey(user) → string, describeParty?(db, partyKeys[]) → Promise<Map<key, label>>, onMessage?(evt) → Promise<void>, limits = { bodyMax: 5000, filesPerMessage: 5 } })` returns:
    - `listThreads(user, { folder, unread, recordType, recordId, party, q, limit, offset }) → { rows, total }`, each row `{ id, recordType, recordId, recordLabel, partyKey, partyLabel, subject, lastMessageAt, lastMessageSide, messageCount, unread, completedAt, archivedAt }`
    - `unreadCount(user) → number`
    - `createThread(user, { recordType?, recordId?, party?, subject?, body, files[] }) → thread`
    - `getThread(user, id) → { thread, messages: [{ id, authorUserId, authorName, authorSide, body, createdAt, attachments: [{ id, fileName, contentType, sizeBytes }] }] }` (marks read)
    - `post(user, threadId, { body, files[] }) → message`
    - `setRead(user, id, read: bool)`
    - `complete(user, id)`, `reopen(user, id)` (host only)
    - `archive(user, id, on: bool)` (per user)
    - `attachmentUrl(user, attachmentId) → signedUrl`
  - **Errors:** `MessagingError(code: "NOT_FOUND"|"FORBIDDEN"|"INVALID")`, mapped to 404/403/400 by the routes.
  - `onMessage` evt: `{ thread, message, authorSide, authorUserId, recordLabel }`, called after commit and wrapped so it never fails the post.
  - **Pure rules** (`rules.js`):
    - `canRead(user, thread, { isHost, partyKeys })`
    - `sideOf(user, isHost)`
    - `isUnreadFor(thread, participant, side)`
    - `folderWhere(folder, side)`
    - `afterPost(thread, side, now) → patch` (a party post clears `completedAt`)
  - **Routes:** `messagingRoutes(fastify, { messaging, authenticate, listParties?(db, q) })` with the spec's Messaging table. Multipart parsing caps files at `limits.filesPerMessage` and size at the global 20 MB, draining unknown parts (as rx.routes.js does).
  - **Storage:** `uploadFile({ prefix, buffer, originalName, contentType }) → { url, size }`, using the same sanitisation, bucket and local fallback as before.

- [ ] **Step 1: Write failing tests.**
  - `rules.test.js`:
    - `host reads every thread; party reads only its party keys`
    - `unread when the other side posted after last_read_at`
    - `own last post is never unread`
    - `party post clears completedAt; host post does not`
    - `inbox/completed for host, inbox/archived for party`
  - `messaging.service.test.js` (fake db/store + fake storage):
    - `createThread with a record uses the resolver's partyKey; resolver null → NOT_FOUND`
    - `host general thread requires party; party general thread uses defaultPartyKey`
    - `body and subject are stored sealed (enc:v1) and returned opened`
    - `attachment file names are sealed`
    - `body over 5000 chars and more than 5 files → INVALID`
    - `party user cannot read a thread outside their party keys` (→ NOT_FOUND, not FORBIDDEN)
    - `getThread marks read; unreadCount drops`
    - `attachment download checks thread access before signing`
    - `onMessage runs after the post and a throwing onMessage does not fail the post`
    - `complete/reopen refuse a party user`
  - `routes.test.js`: `every route uses authenticate`; `multipart post drains unknown parts and rejects a 6th file`.
  - `storage.service.test.js`: `uploadFile writes under prefix with sanitized name`; `uploadCaseFile still writes under rx-cases/<id>/<kind>/`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- modules/messaging storage.service`. Expected: FAIL.
- [ ] **Step 3:** Implement the schema (spec indexes), rules, queries (unread computed in SQL from `last_message_side`/`last_message_at` vs the participant's `last_read_at`; `total` via `count(*) over()`), service, routes and README (purpose, interface, config, data model, stub wiring heading).
- [ ] **Step 4:** Classify the columns in scrub:
  - `message_threads.subject`: `phi("NULL")`.
  - `messages.body` (not null): `phi("'[scrubbed]'")`.
  - `message_attachments` is `delete` mode (it points at PHI files); say so in COLUMNS.md.
  - `message_participants`: keep.
  - Then run `pnpm db:generate`.
- [ ] **Step 5:** Run `pnpm --filter @my-app/api test`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(messaging): generic threads, encrypted messages, attachments and read state`.

### Task 6: messaging lab glue (record resolvers, alerts, mounting)

**Files:**
- Create: `apps/api/src/services/lab/lab-messaging.js`
- Modify: `apps/api/src/services/app-modules.js` (build and export `messaging`), `apps/api/src/index.js` (register `messagingRoutes`)
- Test: `apps/api/src/services/lab/lab-messaging.test.js`

**Interfaces:**
- Consumes:
  - Task 5 `createMessaging`, `messagingRoutes`.
  - Task 3 `notify` (via `services/notify.js`), `practiceKeyFor`, `partyKeysFor`.
  - `services/storage.service.js` `uploadFile`, `getSignedReadUrl`.
- Produces:
  - `labRecordResolvers` with `rx_case`, `lab_order` and `pickup` (the pickup resolver reads the `pickups` table from Task 8; until then it returns null, and Task 8 fills it in), labels and paths per the spec table.
  - `labMessageAlert(evt)`, the `onMessage` hook that emits `message.received` as specified, with `data: { threadId, recordLabel, senderOrg }`, where `senderOrg` is the lab name for host posts or the practice `companyName` for party posts.
  - `describeLabParties(db, keys) → Map` (practice key → companyName, or the doctor name).
  - `listLabParties(db, q)`: approved doctors grouped by `practiceKeyFor`, at most 20, for the staff "New message" picker.

- [ ] **Step 1: Write failing tests** (`lab-messaging.test.js`, with fake db rows):
  - `rx_case resolves for a doctor of the same practice and not for another practice`
  - `rx_case resolves for a doctor with null seazonaClientId only when owner`
  - `lab_order for a guest shop order has no party → null for staff thread creation`
  - `lab_order label is "Case #<orderNumber>"`
  - `host post alerts the party; party post alerts staff (excluding author) with recordType/recordId of the record or message_thread`
  - `alert data has no body text`
  - `a failing notify does not fail the post`
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- lab-messaging`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire it in `app-modules.js` (`isHost = (u) => isStaffRole(u.role)`, `defaultPartyKey = practiceKeyFor`). A doctor must be approved to use messaging, so the routes' preHandler adds `requireApprovedDoctor` for the doctor role (pass a `guard` option into `messagingRoutes`).
- [ ] **Step 4:** Run `pnpm --filter @my-app/api test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(lab): case message threads and message alerts`.

### Task 7: messaging web (inboxes, thread view, record panel)

**Files:**
- Create:
  - `apps/web/src/modules/messaging/api.js`
  - `InboxTable.jsx`
  - `ThreadView.jsx`
  - `Composer.jsx`
  - `RecordThreads.jsx`
  - `NewThreadModal.jsx`
  - `index.js`
  - `README.md`
- Create:
  - `apps/web/src/pages/lab/LabMessagesPage.jsx`
  - `apps/web/src/pages/lab/LabThreadPage.jsx`
  - `apps/web/src/pages/doctor/MessagesPage.jsx`
  - `apps/web/src/pages/doctor/ThreadPage.jsx`
- Modify:
  - `apps/web/src/pages/lab/LabOrderDetailPage.jsx` (RecordThreads; `recordType = source === "rx_case" ? "rx_case" : "lab_order"`, `recordId = source === "rx_case" ? sourceId : id`)
  - `apps/web/src/pages/app/AdminRxCaseDetailPage.jsx` (RecordThreads)
  - `apps/web/src/pages/doctor/MyCasesPage.jsx` (row action "Message the lab")
  - `Sidebar.jsx` (staffItems "Messages" with an unread badge)
  - `DoctorShell.jsx` (nav "Messages" with a badge)
  - `config/routes.js` (`LAB_MESSAGES: "/lab/messages"`, `LAB_THREAD: "/lab/messages/:id"`, `DOCTOR_MESSAGES: "/doctor/messages"`, `DOCTOR_THREAD: "/doctor/messages/:id"`, `labThreadPath(id)`, `doctorThreadPath(id)`)
  - `App.jsx`
- Test:
  - `apps/web/src/modules/messaging/__tests__/InboxTable.test.jsx`
  - `ThreadView.test.jsx`
  - `Composer.test.jsx`
  - `RecordThreads.test.jsx`

**Interfaces:**
- Consumes: Task 5/6 routes; Task 4 `useUnreadPoll`.
- Produces:
  - **InboxTable** `<InboxTable side="host"|"party" threadPath={(id)=>string} folders={[{value,label}]} bulk={["read","unread","complete","reopen","archive","unarchive"]} />`. A server-mode DataTable.
    - Columns: unread dot, Record (label), Party (host only), Subject, Last activity, Messages.
    - Filters: Unread toggle, Record type select (host).
  - `<ThreadView threadId />`, `<Composer onSend({ body, files }) />`, `<RecordThreads recordType recordId newThreadLabel />`.

- [ ] **Step 1: Write failing tests.**
  - `InboxTable`:
    - `folder switch refetches with folder param and resets page`
    - `unread rows render bold with a dot`
    - `bulk Complete loops POST /complete per selected thread and toasts failures`
    - `row click navigates to threadPath`
  - `ThreadView`:
    - `renders messages oldest first with side alignment`
    - `attachment chip links to /messages/attachments/:id`
  - `Composer`:
    - `disables Send for empty body`
    - `rejects a 6th file inline`
    - `shows the 5000-char counter near the limit`
    - `clears after a successful send`
  - `RecordThreads`:
    - `lists the record's threads and "New message" creates one on the record`
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- modules/messaging`. Expected: FAIL.
- [ ] **Step 3:** Implement. Send attachments with `FormData` through `config/api.js`. Badges use `useUnreadPoll(() => api.get("/messages/unread-count"))`.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): lab and practice inboxes, thread view and case message panels`.

### Task 8: pickups API (glue)

**Files:**
- Create:
  - `packages/shared/src/lab/logistics.js`: `PICKUP_STATUSES`, `PICKUP_MOVES`, `canMovePickup(from, to)`, `TIME_PREFERENCES = ["am","pm","any"]`, labels, `DELIVERY_METHODS = ["local","carrier","collect"]`, `DELIVERY_METHOD_LABELS = { local: "Local delivery", carrier: "Carrier (UPS/FedEx)", collect: "Collected at lab" }`
  - `packages/shared/src/schemas/logistics.schema.js`
- Create:
  - `apps/api/src/db/schema/pickups.js`
  - `apps/api/src/services/lab/pickup-rules.js`
  - `apps/api/src/services/lab/pickups.service.js`
  - `apps/api/src/routes/pickups.routes.js`
- Modify:
  - `apps/api/src/db/schema/index.js`, scrub `plan.js` + `COLUMNS.md`, a generated migration
  - `apps/api/src/index.js` (register)
  - `services/lab/lab-messaging.js` (fill in the `pickup` resolver)
- Test:
  - `packages/shared/src/lab/logistics.test.js`
  - `apps/api/src/services/lab/pickup-rules.test.js`
  - `pickups.service.test.js`
  - `apps/api/src/routes/__tests__/pickups-routes.test.js`

**Interfaces:**
- Consumes: `allocateSequenceNumber(tx, { lockId: 7300480, table: "pickups", column: "pickup_number", start: 1 })`; `notify`; `partyKeysFor`, `practiceKeyFor`; `listAssignableStaff()`; `isoDateIn(LAB_TIMEZONE)`; `fieldSealer(["notes","cancelReason"])`.
- Produces:
  - **Rules:**
    - `planRequest({ earliestDate, latestDate, timePreference, boxCount, notes }, todayIso) → values`. It throws `PickupError("INVALID", msg)` with the spec's limits (earliest ≥ today; latest ≥ earliest and ≤ earliest + 14 d; boxes 1–20; notes ≤ 500).
    - `planSchedule(pickup, { scheduledDate, assigneeUserId }) → patch` (date ≥ earliestDate).
    - `planComplete(pickup, byUserId, now)`.
    - `planCancel(pickup, { reason, byStaff }, now)` (reason required for staff).
    - Every plan checks `canMovePickup` and the expected `version` (`PickupError("STALE")` → 409).
  - **Service:**
    - `requestPickup(user, input, { onBehalfOfClientUserId? })`
    - `listPickups(user|staff, filters) → { rows, total }`
    - `schedulePickup`, `completePickup`, `cancelPickup`
    - `scheduledPickupsBetween(db, from, to)` (used by Task 10)
  - Routes per the spec's Pickups table. Doctor routes use `requireApprovedDoctor`; lab routes use STAFF (as `lab.routes.js` does). Audit through `lab-route-helpers.js` `audit(request, action, id, meta, "pickup")`, ids only.
  - Notifications: `lab.pickup_requested` (staff), `lab.pickup_scheduled` (party), `lab.pickup_cancelled` (the other side), each with `data: { pickupNumber, date? }`.

- [ ] **Step 1: Write failing tests.**
  - `logistics.test.js`:
    - `requested → scheduled|cancelled; scheduled → scheduled|completed|cancelled; terminal → none`
  - `pickup-rules.test.js`:
    - `earliest before today (CT) is refused`
    - `window over 14 days is refused`
    - `box count 0 and 21 refused`
    - `schedule before earliestDate refused`
    - `staff cancel needs a reason; doctor cancel does not`
    - `stale version → STALE`
  - `pickups.service.test.js`:
    - `request snapshots the practice address and seals notes`
    - `pickup numbers increase under the lock`
    - `doctor lists practice-wide pickups (same seazonaClientId) and not another practice's`
    - `doctor cannot cancel another practice's pickup` (NOT_FOUND)
    - `request notifies staff with pickupNumber only`
    - `schedule notifies the party`
    - `staff on-behalf request records source "staff"`
  - `pickups-routes.test.js`: `doctor routes require approved doctor; lab routes require staff`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- pickup logistics`. Expected: FAIL.
- [ ] **Step 3:** Implement. Notify after the transaction commits.
- [ ] **Step 4:** Classify `pickups` in scrub:
  - `notes` and `cancel_reason`: `phi("NULL")`.
  - `address`: keep (practice).
  - Then run `pnpm db:generate`.
- [ ] **Step 5:** Run `pnpm --filter @my-app/api test`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(lab): pickup requests, scheduling and alerts`.

### Task 9: pickups web

**Files:**
- Create:
  - `apps/web/src/pages/doctor/PickupsPage.jsx`
  - `apps/web/src/components/lab/PickupRequestModal.jsx` (shared by the doctor and staff "New pickup"; staff mode adds a client picker)
  - `apps/web/src/pages/lab/LabPickupsPage.jsx`
  - `apps/web/src/components/lab/ScheduleModal.jsx`
- Modify:
  - `config/routes.js` (`DOCTOR_PICKUPS: "/doctor/pickups"`, `LAB_PICKUPS: "/lab/pickups"`)
  - `App.jsx`
  - `Sidebar.jsx` (staffItems "Pickups", icon `PackageOpen`)
  - `DoctorShell.jsx` (nav "Pickups")
- Test:
  - `apps/web/src/pages/doctor/__tests__/PickupsPage.test.jsx`
  - `apps/web/src/pages/lab/__tests__/LabPickupsPage.test.jsx`
  - `apps/web/src/components/lab/__tests__/PickupRequestModal.test.jsx`

**Interfaces:**
- Consumes: Task 8 routes and `packages/shared` logistics vocabulary.
- Produces: `<PickupRequestModal open onClose onCreated staff? />`.

- [ ] **Step 1: Write failing tests.**
  - `PickupRequestModal`:
    - `earliest defaults to today (CT) and latest to +2 days`
    - `client-side validation mirrors the rules (window > 14 days shows an inline error)`
    - `submit posts the body and closes`
  - `PickupsPage`:
    - `lists practice pickups in a DataTable`
    - `Cancel is a ConfirmButton and only on requested/scheduled rows`
  - `LabPickupsPage`:
    - `default filter is open (requested+scheduled)`
    - `bulk Schedule opens ScheduleModal and loops /schedule with each expectedVersion, toasting STALE failures`
    - `bulk Complete loops /complete`
    - `deep link ?pickup=<id> opens that row`
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- Pickup`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): pickup request and lab pickup desk`.

### Task 10: deliveries (delivery method, DataTable groupBy, route list, print)

**Files:**
- Modify:
  - `apps/api/src/db/schema/lab-orders.js` (`deliveryMethod: varchar("delivery_method", { length: 20 })`)
  - scrub `plan.js` + `COLUMNS.md` (keep), a generated migration
- Modify:
  - `apps/api/src/services/lab/lab-order-rules.js:184` (`FIELDS.delivery = { column: "deliveryMethod", event: "delivery" }`, validated against `DELIVERY_METHODS` or null)
  - `packages/shared/src/schemas/lab.schema.js` (field enum gains `delivery`)
  - the `lab_order_events` type comment
- Modify:
  - `apps/api/src/services/lab/lab-orders.service.js` (`releaseRxCase` sets `deliveryMethod` to the client's latest non-null; `createShopLabOrder` sets `"carrier"`)
  - `getLabOrderDetail` returns it
- Create:
  - `apps/api/src/services/lab/deliveries.service.js`
  - route `GET /lab/deliveries` in `apps/api/src/routes/pickups.routes.js` (rename the file to `logistics.routes.js` in this task if it reads better; update index.js)
- Modify:
  - `apps/web/src/components/ui/data-table/DataTable.jsx` + `apps/web/src/hooks/useDataTable.js` (option `groupBy`)
  - `apps/web/src/lib/data-table/table-state.js` (`groupRows`)
- Create:
  - `apps/web/src/pages/lab/DeliveriesPage.jsx`
  - `apps/web/src/pages/lab/DeliveryRoutePrintPage.jsx`
- Modify:
  - `LabOrderDetailPage.jsx` (Delivery select)
  - `config/routes.js` (`LAB_DELIVERIES: "/lab/deliveries"`, `LAB_DELIVERIES_PRINT: "/lab/deliveries/print"`)
  - `App.jsx` (the print route sits outside AppShell, like the shipment print)
  - `Sidebar.jsx` (staffItems "Deliveries", icon `Route`)
- Test:
  - `apps/api/src/services/lab/deliveries.service.test.js`
  - `lab-order-rules.test.js` (extend)
  - `lab-orders.service.test.js` (extend)
  - `apps/web/src/lib/data-table/__tests__/table-state.test.js` (extend)
  - `apps/web/src/components/ui/data-table/DataTable.test.jsx` (extend)
  - `apps/web/src/pages/lab/__tests__/DeliveriesPage.test.jsx`

**Interfaces:**
- Consumes: Task 8 `scheduledPickupsBetween`; `practiceKeyFor`; the existing `POST /lab/orders/:id/status` and `POST /lab/pickups/:id/complete`.
- Produces:
  - **API:** `listStops(db, { from, to, todayIso }) → [{ id: "<day>:<partyKey>", day, late, practice, address, phone, deliveryNotes, orders: [{ id, orderNumber, status, version }], pickups: [{ id, pickupNumber, boxCount, version }] }]`, sorted by day then practice. Piece 9 may wrap it as a report.
  - **DataTable:** `groupBy?: { key(row) → string, header(key, rows) → node }` (client mode).
    - Rows are grouped in their current sort order.
    - Each group gets a header `<tr>` spanning all columns, with a checkbox that selects that group's selectable rows on the page.
    - Paging counts data rows only.
  - **Table state:** `groupRows(rows, keyFn) → [{ key, rows }]`, order-preserving.

- [ ] **Step 1: Write failing API tests.**
  - `lab-order-rules`:
    - `delivery field accepts local|carrier|collect|null and refuses others`
    - `emits a delivery event`
  - `lab-orders.service`:
    - `releaseRxCase carries forward the client's latest delivery method`
    - `null when none`
    - `shop lab order defaults to carrier`
  - `deliveries.service`:
    - `groups local orders by dueDate and practice into one stop`
    - `open order due before from appears on from with late=true`
    - `cancelled and non-local orders are excluded`
    - `shipped orders only within range`
    - `scheduled pickups join the same stop`
    - `output contains no patient fields` (assert the keys of a stop and an order exactly)
    - `planMarkDelivered moves ready orders and reports the rest`: this one is the web bulk handler's pure helper `planMarkDelivered(stops) → { moves: [{id, version}], skipped: [{ orderNumber, reason }] }`, placed in `apps/web/src/lib/deliveries.js` with its test there.
- [ ] **Step 2: Write failing web tests.**
  - `table-state`: `groupRows preserves order and groups consecutive keys`.
  - `DataTable`:
    - `groupBy renders one header row per group with colSpan = column count`
    - `group checkbox selects that group's rows only`
  - `DeliveriesPage`:
    - `date-range filter defaults today..+6 (CT)`
    - `bulk Mark delivered loops /status to shipped for ready orders and toasts skipped ones`
    - `Pickups collected loops /complete`
    - `Print route opens the print path with from/to`
- [ ] **Step 3:** Run `pnpm --filter @my-app/api test -- deliveries lab-order-rules lab-orders.service && pnpm --filter @my-app/web test -- data-table Deliveries deliveries`. Expected: FAIL.
- [ ] **Step 4:** Implement. The print page is a plain printable layout (not a DataTable: it is a document, not a list UI). It has a "Print" button that calls `window.print()`, one section per day with numbered stops, blank Time/Signed columns, and order numbers only.
- [ ] **Step 5:** Run both suites and `pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(lab): delivery method, grouped local-delivery route list and print sheet`.

### Task 11: wiring docs, runbook re-entry, operations, merged-piece events

**Files:**
- Modify:
  - `apps/api/src/modules/notifications/README.md`, `modules/messaging/README.md`, `modules/sms/README.md`
  - `apps/web/src/modules/notifications/README.md`, `apps/web/src/modules/messaging/README.md`
  - Each gets the full "Wiring it into another app" section.
- Modify: `docs/cutover-runbook.md` (new sub-step under "## 7. Unfreeze", before "The lab works in the new system": "Re-enter what Seazona never exposed")
- Create: `docs/notifications-operations.md` (env, Twilio + A2P 10DLC go-live checklist, the smoke command, the `[NOTIFY][SEND_FAILED]` log alert, adding a lab alert number, how to add an event)
- Modify: `services/lab/lab-notifications.js` if pieces 6/7 merged code that calls `notify(` with an event not yet registered
- Test: `apps/api/src/services/lab/notify-callers.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `notify-callers.test.js`. It greps `apps/api/src` for `notify(db, { event: "<key>"` (and `event:` literals passed to `notify`) and asserts every key is registered by `registerLabNotificationEvents()`. This keeps later pieces honest.

- [ ] **Step 1: Write the failing test** `every event key passed to notify() in apps/api/src is registered`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- notify-callers`. It is expected to fail only if a merged piece emits an unregistered key; otherwise it passes now and guards later pieces. Register any missing keys (kinds/defaults chosen to match the event's audience; titles from numbers only).
- [ ] **Step 3:** Write each README's wiring section:
  - API modules:
    - re-export the schema from your `db/schema/index.js` and generate migrations;
    - supply the glue functions (`resolveAudience`, `records`, `isHost`, `partyKeysFor`, `defaultPartyKey`, `onMessage`);
    - call the factory in a boot file and register the routes factory;
    - register your events with `defineNotificationEvent`;
    - classify the tables in your scrub/redaction plan.
  - Web modules: the API base path, `threadPath`, and mounting the bell in your shell.
  - Name this repo's glue files as the worked example.
- [ ] **Step 4:** Add the runbook steps verbatim from the spec's "Cutover and import impact" (open pickups via "New pickup", open message threads with a one-line summary by case number, the lab alert numbers, delivery method on open van orders), with a check box each. Add no PHI and no practice names.
- [ ] **Step 5:** Write `docs/notifications-operations.md`. It states that enabling Twilio (A2P 10DLC fees, monthly) is a recurring commitment that needs the user's yes, and that Cloud Scheduler is not used by this piece.
- [ ] **Step 6:** Run `pnpm --filter @my-app/api test && pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: all PASS.
- [ ] **Step 7:** Commit `docs: module wiring guides, cutover re-entry and notifications operations`.
