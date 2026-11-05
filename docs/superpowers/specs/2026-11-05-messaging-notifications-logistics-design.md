# Piece 8: Messaging, notifications and logistics (design)

_2026-11-05 · roadmap: `2026-11-05-lab-parity-roadmap.md` (binding) · merges
after pieces 7 and 6, before 10 and 9 · user ruling 2026-11-05: in-app
messaging with email notifications_

## Intent

The lab talks to practices about cases, gets text alerts when work arrives,
and runs a daily van: picking up impressions and dropping off finished cases.
Today none of that is in Diamond Labs. This piece adds three generic modules
(`messaging`, `notifications`, `sms`) and the lab glue that turns them into
case threads, lab alerts, pickups and a local-delivery route sheet.

## Goals

- Two-way messages between lab staff and a practice, on a case or as a general
  thread, with attachments, unread counts and a "Completed" folder.
- One `notify()` that every piece calls. It routes an event to in-app, email
  and SMS according to each user's preferences.
- Lab text alerts for new orders, pickup requests and new messages, sent to a
  configurable list of numbers once Twilio credentials exist.
- Practices request pickups in the portal; the lab schedules, assigns and
  completes them.
- A local-delivery route list for orders going out by the lab's own van,
  grouped by day and printable.

## Non-goals

- No real-time push (websockets or SSE). The bell and the inbox poll every
  60 s.
- No per-user SMS. Users have no verified mobile number. SMS goes only to the
  configured static list (the lab's numbers).
- No message editing or deleting, and no read receipts shown to the other side.
- No route optimisation or maps. Stops are listed in practice-name order and
  staff reorder them on paper.
- No inbound or return carrier labels for pickups (out of scope in the shipping
  spec). A pickup is the lab's own driver.
- No outbox or retry job for email and SMS. Cloud Scheduler stays paused, so a
  sweeper could not be relied on (see Rulings).
- No behind-schedule alerts. Piece 7 ruled them out.

## What exists today (survey 2026-11-05, file:line evidence)

- **Email:** `services/email.service.js` has one private `deliver()`
  (`:37`). It is the only code that talks to Mailgun, it applies the staging
  rewrite, and it never throws. Each email is its own exported sender. There is
  no generic "notice with a link" sender. `sendShippedNotice` is at `:610`; its
  only caller is `lab-shipping.service.js:194` `notifyShipped`, after the
  shipment is claimed.
- **New Rx case email:** `rx.routes.js:542` calls `sendRxSubmissionReceived`
  to `ADMIN_NOTIFICATION_EMAIL`, after the case commits.
- **Practice visibility:** `services/billing/invoice-rules.js:299`
  `canActOnInvoice`. A practice is a shared non-null `users.seazonaClientId`;
  a null value on either side matches the owner only. There is no practice
  entity.
- **Staff:** `packages/shared/src/constants/user-roles.js` `STAFF_ROLES =
  ["admin","lab"]`, `isStaffRole()`.
- **Encryption:** `lib/crypto.js:119` `fieldSealer(fields)` (enc:v1), used by
  `services/lab/lab-order-crypto.js`.
- **File storage:** `services/storage.service.js:34` `uploadCaseFile` is
  hard-wired to the `rx-cases/` prefix. `getSignedReadUrl` (`:101`) and
  `deleteStoredFile` (`:143`) are generic. `rx.routes.js:685` serves a file by
  checking access, then issuing a short-lived signed URL.
- **Adapter pattern:** `services/shipping/carrier-registry.js` +
  `carrier-config.js` `missingConfigReason` (a missing credential disables the
  adapter and names the env variable, never its value).
- **Staging:** `config/app-env.js:70` `stagingRewrite` redirects mail to
  `STAGING_EMAIL_TO`, or suppresses it.
- **Jobs:** `jobs/registry.js`. The interval trigger is dev-only
  (`jobs/triggers/interval.js:15`). Production uses Cloud Scheduler, which is
  paused.
- **Numbering:** `services/sequence.service.js:13`
  `allocateSequenceNumber(tx, { lockId, table, column, start })`. Lock ids in
  use: 7300421 (orders), 7300422 (invoices).
- **Lab order field edits:** `lab-order-rules.js:184` `FIELDS` (assign,
  department, due, notes), applied through `changeField`.
- **Delivery:** `lab_orders` has **no delivery-method column**. The only
  delivery data is `doctor_profiles.deliveryMethod` (free text, varchar 100)
  and `deliveryNotes`. `lab-shipping-queries.js:62` shows them as a hint.
- **Tables:** `components/ui/data-table` (`DataTable`, `BulkBar`,
  `FilterControl`) and `hooks/useDataTable.js`. There is **no row grouping**.
- **Scrub:** `db/scrub/plan.test.js` fails unless every column of every schema
  table is classified in `db/scrub/plan.js` and `COLUMNS.md`.
- **Layout:** `Topbar.jsx` (staff/admin shell) and `DoctorShell.jsx` have no
  bell.

## Module boundaries

```
apps/api/src/modules/
  sms/            generic: provider registry, twilio + log adapters, config, phone utils
  notifications/  generic: event registry, notify(), preferences, in-app store, channels, routes factory
  messaging/      generic: threads, messages, attachments, read state, routes factory
apps/api/src/services/
  notify.js       the seam every piece imports (repointed to modules/notifications here)
  practice.js     practiceKeyFor / partyKeysFor (the canActOnInvoice rule as keys)
  lab/lab-notifications.js   lab event registry + audience resolver (glue)
  lab/lab-messaging.js       record resolvers (rx_case, lab_order, pickup), message → notify (glue)
  lab/pickups.service.js, lab/pickup-rules.js       pickups (glue)
  lab/deliveries.service.js                         route list (glue)
  app-modules.js  boot wiring: configures the three modules from env + glue
apps/web/src/modules/
  notifications/  Bell, AlertCenter, PreferencesPanel, RecipientsPanel, api.js, useUnreadPoll
  messaging/      InboxTable, ThreadView, Composer, RecordThreads, api.js
packages/shared/src/
  notifications/  channel list, zod schemas
  messaging/      zod schemas, limits
  lab/logistics.js  pickup statuses + transitions, delivery methods (lab vocabulary)
```

The generic modules contain no lab, doctor, case, practice or dental words.
They speak of **host** (the organisation running the app; here, lab staff) and
**party** (an outside organisation; here, a practice), **records**
(`recordType` + `recordId`, opaque) and **audience kinds** (strings the app
defines; here `staff` and `client`). Their tables live in each module's
`schema.js` and are re-exported from `db/schema/index.js` so drizzle-kit sees
them.

Each module is built by a factory that takes its collaborators, so another app
wires it with different glue:

- `createSmsRegistry({ config, fetchImpl })` / `smsRegistry()`
- `createNotifier({ db, events, resolveAudience, channels, appUrl, log })`
- `createMessaging({ db, sealer, storage, records, isHost, partyKeysFor, onMessage, limits })`
- `notificationRoutes(fastify, { notifier, authenticate, requireHostAdmin })`
- `messagingRoutes(fastify, { messaging, authenticate })`

## Shared interfaces this piece publishes

### `notify` (roadmap name, exact)

```js
// apps/api/src/services/notify.js  — import from here, never from the module
notify(db, { event, recordType, recordId, audience, data })
  → Promise<{ inApp: number, sent: number, skipped: number, failed: number }>
```

- `event`: a registered key (registry below). An unknown key logs
  `[NOTIFY][UNKNOWN_EVENT] event=<key>` and returns zeros. It never throws.
- `recordType`, `recordId`: strings or null. Used for the in-app link,
  collapsing and the deliveries log.
- `audience`: `{ userIds?: string[], kinds?: string[], party?: string,
  addresses?: { email?: string[] }, excludeUserIds?: string[] }`.
  - `kinds: ["staff"]` means every active staff user.
  - `party` is a party key (`practice:<id>` or `user:<id>`) and means every
    active, approved user of that practice.
  - `addresses.email` is for recipients with no login (a guest shop order).
  - The actor is usually passed in `excludeUserIds`.
  - The event's static recipients (the lab's SMS list) are added automatically.
- `data`: a flat object of strings, numbers, booleans, null, or arrays of
  those. Validated, max 2 KB serialised. **Never free text, never a patient
  name.** Titles, emails and texts are built only from it.
- **Call it after your transaction commits, with the root `db`.** In-app rows
  are written through `db`; email and SMS are sent before it returns. Calling
  it inside a transaction could send for a change that then rolls back.

**Seam for pieces 6 and 7 (they merge before 8).** Each creates this file
byte-for-byte if it is absent, so the merge is trivial. Piece 8 replaces the
body.

```js
// apps/api/src/services/notify.js
// The one place app code emits notifications (roadmap piece 8). Until piece 8
// merges this is a no-op; piece 8 points it at modules/notifications.
export async function notify(_db, _args) {
  return { inApp: 0, sent: 0, skipped: 0, failed: 0 };
}
```

### Event-name registry

Names are `<domain>.<past_tense>`. They are registered in
`services/lab/lab-notifications.js` with
`defineNotificationEvent({ key, label, kinds, defaults, title, link, email?, sms? })`.
Another piece adds its own events there: append one `defineNotificationEvent`
call.

| Event key | Emitted by | Audience | Defaults (in_app / email / sms list) | Title (from `data`) |
|---|---|---|---|---|
| `message.received` | lab-messaging (after a post) | the other side of the thread | staff: on / off / on · client: on / on / — | "New message about {recordLabel}" or "New message from {senderOrg}" |
| `lab.order_received` | `rx.routes.js` after submit; `createShopLabOrder` caller after commit | `kinds:["staff"]` | staff: on / off / on | "New case {caseNumber}" / "New shop order #{orderNumber}" |
| `lab.pickup_requested` | pickups.service `requestPickup` | `kinds:["staff"]` | staff: on / off / on | "Pickup #{pickupNumber} requested" |
| `lab.pickup_scheduled` | pickups.service `schedulePickup` | `party` | client: on / on / — | "Pickup #{pickupNumber} scheduled for {date}" |
| `lab.pickup_cancelled` | pickups.service `cancelPickup` | the other side | staff: on / off / off · client: on / on / — | "Pickup #{pickupNumber} cancelled" |
| `lab.order_shipped` | lab-shipping.service, only for the caller that claimed the shipment | the client doctor (`userIds`) or the guest's address | client: on / on / — | "Order #{orderNumbers} shipped" |

`lab.order_shipped`'s email channel is `email.send = sendShippedNotice`, the
existing email, unchanged. Its in-app row is new.

Reserved for later pieces (registered by them, listed here so the names don't
collide): `lab.order_entered` (piece 6, if it alerts on staff entry),
`billing.*` (piece 10). Piece 7 emits none.

### Party keys

`services/practice.js`:

- `practiceKeyFor(user)` returns `practice:<seazonaClientId>`, or
  `user:<id>` when that is null.
- `partyKeysFor(user)` returns `["user:<id>", "practice:<seazonaClientId>"?]`.

Both restate `canActOnInvoice` as keys. The test asserts they agree with
`canActOnInvoice` on the four null and non-null cases. When piece 5b or later
adds a real practice entity, only this file changes.

## Data model

All ids are `createId()` varchar(128). There are no DB foreign keys (repo
convention), all times are timestamptz, and free text is sealed with
`fieldSealer`.

### notifications module

- **`notifications`** (in-app): `id, user_id, event, record_type,
  record_id, title varchar(160), link varchar(300), collapse_key
  varchar(200), count int default 1, read_at, created_at, updated_at`.
  - Index `(user_id, read_at, updated_at desc)`.
  - Unique `(user_id, collapse_key) where read_at is null`.
  - `title` is plain text built only from `data`, so it holds no PHI.
- **`notification_preferences`**: `user_id, event, channel
  ('in_app'|'email'), enabled bool, updated_at`. PK
  `(user_id, event, channel)`. A missing row means the event default for the
  user's kind.
- **`notification_recipients`** (static list): `id, event, channel ('sms'|'email'),
  address varchar(320), label varchar(80), active bool, created_at,
  created_by_user_id`. Unique `(event, channel, address)`. The address is
  E.164 for SMS.
- **`notification_deliveries`** (log, for "did the lab get the text"): `id,
  event, channel, user_id null, target_masked varchar(40), status
  ('sent'|'failed'|'skipped'|'suppressed'), reason varchar(200), record_type,
  record_id, created_at`. Index `(created_at desc)`. It is pruned to 90 days by
  the module's `pruneDeliveries(db, days)`, called on each write with 1 %
  probability. That needs no scheduler.

**Collapsing:** `collapse_key = event:recordType:recordId`. While the user has
an unread in-app row with that key, a new notify bumps `count` and
`updated_at` and **skips email for that user**. One email per unread burst; the
SMS list is not collapsed.

### messaging module

- **`message_threads`**: `id, record_type null, record_id null, party_key
  varchar(160) not null, subject text (sealed, null), created_by_user_id,
  last_message_at, last_message_side ('host'|'party'), message_count int,
  completed_at null, completed_by_user_id null, created_at, updated_at`.
  - Index `(party_key, last_message_at desc)`, index `(record_type,
    record_id)`, index `(completed_at, last_message_at desc)`.
- **`message_participants`** (per-user read state): `thread_id, user_id,
  side, last_read_at, archived_at, joined_at`. PK `(thread_id, user_id)`.
  Anyone who posts or opens a thread gets a row.
- **`messages`**: `id, thread_id, author_user_id, author_side, body text
  (sealed), created_at`. Index `(thread_id, created_at)`.
- **`message_attachments`**: `id, message_id, thread_id, storage_url text,
  file_name text (sealed, since a file name can name a patient),
  content_type, size_bytes int, created_at`.

**Visibility:** a host user sees every thread; a party user sees threads whose
`party_key` is in `partyKeysFor(user)`.

**Unread:** a thread is unread for a user when the other side posted last
(`last_message_side`) and `last_message_at > coalesce(last_read_at, -∞)`.

**Folders:**
- Host: `inbox` (not completed), `completed`.
- Party: `inbox` (not archived by me), `archived`.

A party post clears `completed_at`, so the thread reopens for the lab.

### lab glue

- **`pickups`**: `id, pickup_number int unique, client_user_id, party_key,
  requested_by_user_id, earliest_date date, latest_date date,
  time_preference ('am'|'pm'|'any'), box_count int, notes text (sealed),
  address jsonb (practice address snapshot, same shape as `shipTo`), status
  ('requested'|'scheduled'|'completed'|'cancelled'), scheduled_date date,
  assignee_user_id, completed_at, completed_by_user_id, cancelled_at,
  cancel_reason text (sealed), source ('portal'|'staff'), version int,
  created_at, updated_at`.
  - Index `(status, scheduled_date)`, index `(party_key, created_at desc)`.
  - The number comes from `allocateSequenceNumber` with lock id **7300480**
    and start 1.
- **`lab_orders.delivery_method`** varchar(20) null: `local | carrier |
  collect` (`packages/shared/src/lab/logistics.js` `DELIVERY_METHODS`).

Every new table and column is classified in `scrub/plan.js` and
`COLUMNS.md`:
- Sealed text is `phi("NULL")`.
- `notification_recipients.address` is `pii` (a fixed `+15005550006`).
- `notification_deliveries.target_masked` is `pii("NULL")`.
- Pickup `address` is kept, like `shipments.ship_to`'s practice address.
- `message_attachments` is `delete` mode (its rows point at PHI files).
- `messages.body` is `phi("'[scrubbed]'")` (not null).
- `notifications.title` is kept.

## Behaviour

### notify()

1. Look up the event (unknown: log and return). Validate `data`.
2. Resolve the audience to user rows `{ id, email, kind }` through the glue's
   `resolveAudience(db, audience)`. Drop `excludeUserIds`, then de-duplicate.
3. For each user:
   - **in_app:** if the preference is on, upsert by `collapse_key`.
   - **email:** if the preference is on, the event allows email for the kind,
     and the row did not collapse, send. Use `event.email.send(user, data)`
     when the event has one; otherwise `sendNotificationEmail` (a new sender in
     `email.service.js`, through `deliver()`) with the subject
     `event.email.subject(data)`, the heading and line from `title(data)`, and
     a button to `appUrl + link(data, kind)`. No body text from the record.
4. `addresses.email` go through the same email path, with no in-app row.
5. Each active static recipient of the event: send SMS through the sms
   registry's enabled provider. The body is `event.sms(data)` or
   `"<org>: <title> <appUrl+link>"`, capped at 160 characters.
6. Log one delivery row per email or SMS attempt. Each failure logs
   `[NOTIFY][SEND_FAILED] event= channel= reason=` (an alertable line) with
   masked targets only. Nothing throws out of `notify`.

### SMS

- Env:
  - `SMS_PROVIDER`: `twilio | log | off`, default `off`.
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
  - `TWILIO_FROM` (E.164) **or** `TWILIO_MESSAGING_SERVICE_SID`.
  - `STAGING_SMS_TO`.
- The Twilio adapter is reported disabled, with
  `missingConfigReason`-style text naming the unset variables, until the
  credentials exist.
- `log` writes `[SMS] to=<masked> len=<n>` (dev).
- Staging: every SMS goes to `STAGING_SMS_TO` with a `[STAGING → <masked>]`
  prefix, or is suppressed when that is unset. This is the same rule as
  email, and it lives in the registry's `send`, so no caller can skip it.
- Adapter contract:
  `{ id, label, configured() → { ok, reason? }, send({ to, body }) → { ok, providerId?, error? } }`.
  It is implemented by `twilio.adapter.js` and `log.adapter.js`, and pinned by
  `adapter-contract.test.js`.
- Twilio call: `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`,
  Basic auth, form fields `To`, `From` | `MessagingServiceSid`, `Body`. A 2xx
  JSON response has `sid`; an error has `code` and `message`. Fixtures live in
  `modules/sms/fixtures/`.
- Smoke: `pnpm --filter @my-app/api sms:smoke -- --to +1… [--live]` sends one
  "test" text. It refuses without `--live` unless the account SID is a Twilio
  **test** credential (the magic From `+15005550006`). It never prints
  credentials.

### Messaging

- **Create a thread:** `{ recordType?, recordId?, party?, subject?, body,
  files[] }`.
  - With a record, the glue resolver
    `records[recordType].resolve(db, recordId, user) → { label, partyKey,
    hostPath, partyPath } | null` must return non-null for this user;
    otherwise 404. The thread's `party_key` comes from the resolver.
  - Without a record, a host user must name `party` (staff pick a client in
    the UI). A party user's general thread uses `practiceKeyFor(user)`.
- **Post:** body 1–5,000 characters and up to 5 files per message (≤ 20 MB
  each; that is the global multipart cap). Files are stored with
  `storage.uploadFile({ prefix: "messages/<threadId>", … })`. The new generic
  upload in `storage.service.js` takes over `uploadCaseFile`'s body, and
  `uploadCaseFile` becomes a one-line call to it.
- **Open a thread:** returns the messages, oldest first, with bodies opened,
  and marks the thread read for the user.
- **Attachment download:** checks read access, then redirects 302 to
  `getSignedReadUrl(url, 300)`. This is the same pattern as `rx.routes.js:685`.
- **onMessage hook (glue):** after the post commits, it calls
  `notify(db, { event: "message.received", recordType, recordId, audience:
  { ...(side === "host" ? { party } : { kinds: ["staff"] }), excludeUserIds:
  [authorId] }, data: { threadId, recordLabel, senderOrg } })`. A thread with
  no record uses `recordType = "message_thread"`, `recordId = threadId`, so
  collapsing works per thread.
- **Search:** only the record label and the party's practice/doctor name
  (resolved by the glue at list time). Bodies are encrypted and not
  searchable, the same rule as patient names.

### Lab record resolvers (glue)

| recordType | Label | Who may open it as party | Host path | Party path |
|---|---|---|---|---|
| `rx_case` | "Case {caseNumber}" | `partyKeysFor(user)` includes `practiceKeyFor(case owner)` | `/admin/rx-cases/:id` | `/doctor/cases?case=:id` |
| `lab_order` | "Case #{orderNumber}" | the same, through `clientUserId`; a guest shop order has no party (404 for party, and staff can't open a thread on it) | `/lab/orders/:id` | none (doctors don't see lab orders directly) |
| `pickup` | "Pickup #{pickupNumber}" | same, through `party_key` | `/lab/pickups?pickup=:id` | `/doctor/pickups?pickup=:id` |

On a lab order whose `source = rx_case`, the order page's Messages panel shows
the `rx_case` threads. Doctors message from "My cases", which lists Rx cases,
so both sides land in the same thread.

### Pickups (glue)

- **Status moves** (`packages/shared/src/lab/logistics.js` `PICKUP_MOVES`):
  - `requested → scheduled | cancelled`
  - `scheduled → scheduled (reschedule) | completed | cancelled`
  - `completed` and `cancelled` are terminal.
  - `version` gives optimistic concurrency (409 "This pickup changed —
    reload").
- **Request** (doctor, or staff on behalf of a client):
  - `earliestDate` ≥ today in CT (`LAB_TIMEZONE`).
  - `latestDate` is ≥ `earliestDate` and ≤ `earliestDate` + 14 days.
  - `boxCount` is 1–20, `timePreference` is required, and notes are ≤ 500
    characters.
  - The address is snapshotted from the client's `doctor_profiles`.
  - Then notify `lab.pickup_requested`.
- **Schedule:** `scheduledDate` must fall inside the window or after it (staff
  may push it later), and the assignee is optional (`listAssignableStaff`).
  Then notify `lab.pickup_scheduled`.
- **Complete** (staff only).
- **Cancel:** a doctor may cancel while `requested` or `scheduled`; staff may
  cancel with a reason. The other side is notified.
- **Practice visibility:** a doctor sees and cancels the pickups of
  `partyKeysFor(user)`. That is the canActOnInvoice rule.

### Deliveries (glue)

- `GET /lab/deliveries?from&to` (default from = today in CT, to = from + 6) returns
  **stops**: one per (day, client practice). Day = the order's `dueDate`.
  - An open local order with `dueDate < from` is listed on `from` with
    `late: true`.
  - A stop holds `{ id: "<day>:<partyKey>", day, practice, address, phone,
    deliveryNotes, orders: [{ id, orderNumber, status, version }], pickups:
    [{ id, pickupNumber, boxCount }], late }`.
  - Orders: `delivery_method = 'local'`, not cancelled, and either not shipped
    or shipped within the range.
  - Scheduled pickups with `scheduled_date` in the range join the stop for
    their practice and day (the driver does both).
- **Mark delivered** (bulk) moves each `ready_to_ship` order in the selected
  stops to `shipped` through the existing `POST /lab/orders/:id/status`, one
  at a time, the DataTable bulk convention. Orders not ready come back as named
  failures. Completing the stop's pickups is a separate bulk action, "Pickups
  collected".
- **Delivery method:**
  - Set on the order page through `changeField(id, { field: "delivery" })`
    (`FIELDS.delivery = { column: "deliveryMethod", event: "delivery" }`).
  - At release, `releaseRxCase` defaults it to the client's most recent
    non-null value (carry-forward).
  - `createShopLabOrder` defaults to `carrier`.
  - Legacy imports stay null.
- **Print:** `/lab/deliveries/print?from&to` (outside the shell, like
  `ShipmentLabelPrintPage`). One section per day, stops numbered, then the
  practice, address, phone, delivery notes, order numbers, pickup box counts,
  and blank "Time / Signed" columns. **Order numbers only, no patient names.**

## API routes (all under `/api/v1`)

**Notifications** (`notificationRoutes`; every authenticated user):

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | `?unread=true&event=&limit&offset` → `{ rows, total }` |
| GET | `/notifications/unread-count` | `{ count }` (bell poll) |
| POST | `/notifications/read` | `{ ids: string[] }` or `{ all: true }` |
| POST | `/notifications/:id/unread` | |
| DELETE | `/notifications/:id` | dismiss |
| GET | `/notifications/preferences` | the events visible to the user's kind × channels, effective values |
| PUT | `/notifications/preferences` | `{ event, channel, enabled }` |
| GET | `/admin/notifications/recipients` | admin |
| POST | `/admin/notifications/recipients` | `{ event, channel, address, label }`; the phone is normalised to E.164 |
| PATCH | `/admin/notifications/recipients/:id` | `{ active }` |
| DELETE | `/admin/notifications/recipients/:id` | |
| POST | `/admin/notifications/recipients/:id/test` | sends "Test alert from <org>" |
| GET | `/admin/notifications/deliveries` | `?channel&status&limit&offset` |
| GET | `/admin/notifications/channels` | sms provider status (`configured`, reason), email configured |

**Messaging** (`messagingRoutes`):

| Method | Path | Notes |
|---|---|---|
| GET | `/messages/threads` | `?folder=inbox\|completed\|archived&unread=true&recordType&recordId&party&q&limit&offset` |
| GET | `/messages/unread-count` | `{ count }` |
| POST | `/messages/threads` | multipart: fields + files |
| GET | `/messages/threads/:id` | marks it read |
| POST | `/messages/threads/:id/messages` | multipart |
| POST | `/messages/threads/:id/read` · `/unread` | per user |
| POST | `/messages/threads/:id/complete` · `/reopen` | host only |
| POST | `/messages/threads/:id/archive` · `/unarchive` | per user |
| GET | `/messages/attachments/:id` | 302 to a signed URL |
| GET | `/messages/parties?q=` | host only; glue: client practices for "New message" |

**Pickups and deliveries** (glue):

| Method | Path | Who |
|---|---|---|
| GET | `/pickups` | doctor (practice-wide) |
| POST | `/pickups` | doctor |
| POST | `/pickups/:id/cancel` | doctor |
| GET | `/lab/pickups` | staff; `?status&from&to&assigneeUserId&q&limit&offset` |
| POST | `/lab/pickups` | staff, on behalf of a client (also used for cutover re-entry) |
| POST | `/lab/pickups/:id/schedule` | staff; `{ scheduledDate, assigneeUserId?, expectedVersion }` |
| POST | `/lab/pickups/:id/complete` · `/cancel` | staff; `{ expectedVersion, reason? }` |
| GET | `/lab/deliveries` | staff; `?from&to` |

## UI screens

Every list is a `DataTable` with its filters and bulk actions as
configuration.

- **Bell** (Topbar and DoctorShell): an unread badge polled every 60 s,
  paused while the tab is hidden. The dropdown shows the latest 8 rows, "Mark
  all read" and "See all".
- **Alert center** `/notifications` (staff in AppShell, doctors at
  `/doctor/notifications`). A DataTable in server mode.
  - Filters: Unread, Event.
  - Bulk actions: Mark read, Mark unread, Dismiss (ConfirmButton).
  - Clicking a row opens its link and marks it read.
  - Preferences tab: events × (In-app, Email) toggles.
- **Admin › Lab alerts** `/admin/notifications`:
  - The SMS provider status card ("Off: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
    not set").
  - A recipients DataTable (event, channel, number masked except its last 4,
    label, active). Add form; bulk Activate, Deactivate, Remove
    (ConfirmButton); row action "Send test".
  - A deliveries DataTable (last 90 days).
- **Messages:**
  - The lab inbox `/lab/messages` (nav "Messages" with an unread badge).
    - Folder segmented control (Inbox / Completed).
    - Filters: Unread, Record type, Practice.
    - Bulk actions: Mark read, Mark unread, Complete, Reopen.
    - The "New message" button opens a party picker plus subject and body.
  - The doctor inbox `/doctor/messages` (DoctorShell nav "Messages" with a
    badge).
    - Folders Inbox / Archived; bulk actions Mark read, Archive, Unarchive.
  - Thread page `/lab/messages/:id` and `/doctor/messages/:id`: the shared
    `ThreadView` plus `Composer` with file chips. The record label links to the
    record.
  - `RecordThreads` panel on the lab order detail and on the admin Rx case
    detail. On "My cases" each row gets "Message the lab", which opens or
    creates the case thread.
- **Pickups:**
  - Doctor `/doctor/pickups`: a DataTable (number, window, boxes, status,
    scheduled date) and a "Request a pickup" modal. Bulk/row action Cancel
    (ConfirmButton).
  - Lab `/lab/pickups`.
    - Filters: Status (default open), Date range, Assignee.
    - Bulk actions: Schedule… (date + assignee modal), Complete, Cancel…
      (reason).
    - "New pickup" for a client.
- **Deliveries** `/lab/deliveries`:
  - A DataTable grouped by day (new `groupBy` option) with a date-range
    filter.
  - Bulk actions: Mark delivered, Pickups collected, Print route (opens the
    print page for the selected days).
- **Nav:**
  - Sidebar staffItems: Messages, Pickups, Deliveries.
  - adminItems: Lab alerts.
  - DoctorShell: Messages, Pickups.

## Audit rows covered

| Audit row | Labzona | Covered by |
|---|---|---|
| Messages (inbox, sent, pending requests, folders) | Message.aspx | Lab inbox with Inbox and Completed folders, unread filter, filter by client. "Sent" is the inbox filtered to the lab's last post. "Pending requests" maps to pickups. |
| New message | MessageAdd.aspx | "New message" with a party picker, or from a case |
| Order detail: Messages tab | OrderEdit.aspx | `RecordThreads` on the lab order and Rx case detail |
| Notifications | Notifications.aspx | Bell + alert center (in-app); past-due-task alerts deliberately not built (piece 7) |
| Notification settings | NotificationSettings.aspx | Per-user preferences + Admin › Lab alerts (SMS list per event) |
| Pick Ups (14 open) | Shipping.aspx → Pick Ups | Doctor request + lab pickups page |
| Deliveries | Shipping.aspx → Deliveries | `/lab/deliveries` + print |
| Reports: Pick Ups, Deliveries | PickupsReport.aspx | Piece 9 can register them over `pickups` and `deliveries.service` (`listStops`) |

## Cutover and import impact

- **Imported: nothing.** The Seazona API exposes no messages, pickups,
  notification settings or delivery method (usage evidence: "No API field for
  … messages, pickups"). `map-orders.js` maps no delivery field.
  `delivery_method` starts null on legacy orders.
- **Re-entered by staff** (runbook step, after the parity check and before
  unfreeze):
  1. **Open pickups.** For each open pickup in Labzona, staff create it with
     "New pickup" (source `staff`) and schedule it if it has a date.
  2. **Open messages.** For each unread or not-completed Labzona thread, staff
     start a thread on the case (or a general one) and paste a one-line
     summary. The history stays in Labzona.
  3. **Lab alert numbers.** Admin › Lab alerts: add the lab's text number for
     `lab.order_received`, `lab.pickup_requested` and `message.received` (it
     takes effect once Twilio is on).
  4. **Delivery method.** Set `local` on the open orders that go by van; later
     orders carry it forward.
- No PHI goes into the runbook: re-entry is by case number.

## Go-live checklist (not this piece's code; needs the user)

- Twilio account and an A2P 10DLC brand and campaign registration (US texting
  requires it; there are one-time and monthly fees, a recurring commitment that
  needs the user's yes). A BAA is only needed if texts ever carry PHI, and they
  don't.
- Set `SMS_PROVIDER=twilio` plus the credentials in Secret Manager. Run
  `sms:smoke` with test credentials, then once `--live` to the lab's number.
- Add a GCP log alert on `[NOTIFY][SEND_FAILED]`.

## Rulings

- **Ruling: external channels send inline from `notify()` after commit, with no
  outbox or retry job.** Why: Cloud Scheduler is paused and the interval
  trigger is dev-only, so a sweeper would never run. Failures are logged to
  `notification_deliveries` and to an alertable line. Cost if wrong: an alert
  is lost when Mailgun or Twilio blips. Adding an outbox later is one status
  column and a job.
- **Ruling: SMS only to static per-event lists, never to user phones.** Why:
  that is how the lab uses it today ("text alerts to one number"), and no user
  has a verified mobile. Cost if wrong: add `users.sms_number` with
  verification and an `sms` preference channel. The channel enum already
  allows it.
- **Ruling: a burst of notifications collapses to one unread in-app row and
  one email.** Why: a five-message chat must not send five emails. Cost if
  wrong: someone misses a second message's email. The in-app count still shows
  it.
- **Ruling: the "practice" is the `seazonaClientId` party key
  (`services/practice.js`), the same rule as `canActOnInvoice`.** Why: the
  brief requires matching invoice visibility, and there is no practice entity.
  Cost if wrong: one file changes when a practice entity arrives. Existing
  `party_key` values would need a one-off rewrite.
- **Ruling: doctors message on the Rx case, and the lab order page shows its
  Rx case's threads.** Why: doctors see cases, not lab orders, and a remake
  shares the case. Cost if wrong: threads on remakes mix. A `lab_order`
  record type already exists for shop and legacy orders.
- **Ruling: "Completed" is shared lab-side thread state; "Archived" is
  per-user doctor state.** Why: nine staff share one inbox, while doctors
  file their own. Cost if wrong: a per-user host folder is one more
  `message_participants` column.
- **Ruling: `lab_orders.delivery_method` is added here (not by piece 6),
  carried forward from the client's last order, and never inferred from the
  free-text profile field.** Why: the route list needs it, and guessing from
  free text was rejected (feedback: no guessed mappings). Cost if wrong: staff
  set it once per practice. Piece 6 must expect this column when it rebases
  (it merges first, so piece 8 regenerates).
- **Ruling: `lab.order_received` adds in-app and SMS, and the existing
  `sendRxSubmissionReceived` email stays as it is.** Why: that email goes to the
  review-queue mailbox with a review link, a different audience, and staff
  email for this event defaults off, so nothing is sent twice. Cost if wrong:
  two paths for one event, which can be folded later by giving the event an
  `email.send` and a static email recipient.
- **Ruling: in-app notifications for `lab.order_shipped` fire only where the
  shipped email fires today (on the claimed shipment).** Why: it keeps one
  emit point and doesn't touch `changeStatus`. Cost if wrong: a local delivery
  shows no "shipped" alert. Mark delivered could emit it later.
- **Ruling: the bell and inbox poll every 60 s.** Why: there is no
  websocket infrastructure on Cloud Run, and the volume is ~30 orders a day.
  Cost if wrong: up to a minute of latency.
- **Ruling: `DataTable` gains `groupBy` (client mode only) instead of
  deliveries rendering one table per day.** Why: roadmap rule 2 says to extend
  the shared component. Cost if wrong: small, and other pieces (reports) can
  reuse it.
- **Ruling: pickup numbers use advisory lock 7300480.** Why: it is clear of
  7300421/7300422 and of the low numbers other pieces are likely to take.
  Cost if wrong: a collision serialises two unrelated allocators. It is
  harmless, but rename it if another piece picks 7300480.
