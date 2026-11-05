# notifications (generic module)

Tells people that something happened: an in-app alert (the bell), an email,
and a text to a fixed per-event list of numbers. It knows nothing about the
host app's domain. It speaks of **events** (registered keys), **records**
(`recordType` + `recordId`, opaque strings), **audience kinds** (strings the
host app defines, such as `staff` and `client`) and **parties** (an outside
organisation key the host app resolves).

App code never imports this module to emit. It calls the seam:

```js
import { notify } from "../services/notify-seam.js";
await notify(db, { event: "thing.happened", recordType: "widget", recordId: id, audience: "staff", data: { number: 42 } });
```

Call it **after** the transaction commits, with the root `db`. It never throws,
and callers must not depend on the counts it returns.

## Files

| File | What it owns |
|---|---|
| `schema.js` | the four tables (re-exported from `db/schema/index.js`) |
| `registry.js` | `defineNotificationEvent`, `getEvent`, `listEvents`, `clearEvents` |
| `data-guard.js` | `assertSafeData`, `NotificationDataError`, `maskAddress` |
| `preferences.js` | `effectivePreference(rows, event, kind, channel)`, `isOffered` |
| `notifier.js` | `createNotifier(...)`, `NotificationInputError` |
| `store.js` | the drizzle data access, `pruneDeliveries(db, days)` |
| `fake-store.js` | the same surface in memory, for tests |
| `index.js` | the public surface, `configureNotifications`, `currentNotifier` |

`CHANNELS` (`["in_app", "email", "sms"]`), `PREFERENCE_CHANNELS`,
`RECIPIENT_CHANNELS` and `DELIVERY_STATUSES` live in `@my-app/shared`
(`packages/shared/src/notifications/channels.js`) so the web app can use them.

## Public interface

### Events

```js
defineNotificationEvent({
  key,                                   // "<domain>.<past_tense>", unique
  label,                                 // shown in the preferences panel
  kinds: ["staff", "client"],            // audience kinds the event reaches
  defaults: { staff: { in_app: true, email: false }, client: { in_app: true, email: true } },
  sms: true,                             // text the event's static SMS list
  title: (data) => `Thing ${data.number} happened`,       // max 160 chars
  link: (data, kind) => `/things/${data.number}`,          // app-relative, or null
  email: { subject: (data) => "...", send: async (recipient, data) => true },  // both optional
  smsText: (data) => "...",              // optional; default "<org>: <title> <url>"
});
getEvent(key)              // → event | null
listEvents({ kind }?)      // → events reaching that kind
clearEvents()              // tests only
```

A channel is offered to a kind only when `defaults[kind]` names it. A saved
preference row overrides the default; a missing row means the default.

### notify(db, { event, recordType, recordId, audience, data })

Resolves to `{ inApp, sent, skipped, failed }`.

- An unknown `event` logs `[NOTIFY][UNKNOWN_EVENT] event=<key>` and returns zeros.
- `data` must pass `assertSafeData`: a flat object of strings, numbers,
  booleans, null or arrays of those; no string over 200 characters; at most
  2 KB serialised. Otherwise it logs `[NOTIFY][BAD_DATA]` and returns zeros.
  Titles, emails and texts are built only from `data`, so it never carries free
  text or a personal name.
- `audience` is `{ userIds?, kinds?, party?, addresses?: { email? }, excludeUserIds? }`,
  or a kind string (`"staff"` means `{ kinds: ["staff"] }`). Users come from
  the host app's `resolveAudience`; `excludeUserIds` are dropped, then
  duplicates.
- Per user: an in-app row when the in-app preference is on, collapsed on
  `collapse_key = event:recordType:recordId`. While the user has an unread row
  with that key, a new notify bumps `count` and **skips email** (one email per
  unread burst). Otherwise an email when the email preference is on.
- `addresses.email` get the email path with no in-app row.
- The event's active static recipients: email recipients get the email path;
  SMS recipients get one text (when the event has `sms: true`), capped at 160
  characters. Static recipients get the link of the event's first kind.
- Every email or SMS attempt writes a `notification_deliveries` row. Each
  failure logs `[NOTIFY][SEND_FAILED] event= channel= reason= target=` with the
  target masked (`•••1234`, `j•••@domain`); provider error text is masked too.
- About one write in a hundred prunes deliveries older than 90 days.

### The rest of the notifier

```js
listForUser(db, userId, { unread?, limit?, offset? })
unreadCount(db, userId)
markRead(db, userId, { ids } | { all: true })
markUnread(db, userId, id)     // false when another unread row holds the same key
dismiss(db, userId, id)
getPreferences(db, { id, kind })   // → [{ event, label, channels: { in_app?, email? } }]
setPreference(db, { id, kind }, { event, channel, enabled })   // throws NotificationInputError
recipients.list(db, { event? })
recipients.add(db, { event, channel: "sms"|"email", address, label?, createdByUserId? })   // E.164 for sms
recipients.setActive(db, id, active)
recipients.remove(db, id)
recipients.sendTest(db, id)    // → { ok, error? }
deliveries.list(db, { event?, limit?, offset? })
```

## Configuration

```js
import { createNotifier, configureNotifications } from "../modules/notifications/index.js";

configureNotifications(createNotifier({
  db,                       // fallback db when a method is passed none
  resolveAudience,          // async (db, audience) → [{ id, email, kind }]
  channels: {
    email: { send },        // async ({ to, subject, heading, line, actionUrl, actionLabel }) → boolean
    sms: { send },          // async ({ to, body }) → { ok, error? }
  },
  appUrl,                   // prefixed to every link
  orgName,                  // "<org>: " in texts and the email line
  log,                      // default console
  store,                    // default createDrizzleStore(); tests pass createFakeStore()
  events,                   // default the module registry
  random,                   // default Math.random (the prune roll)
}));
```

With no notifier configured, the seam resolves to zeros. A missing channel
records a `skipped` delivery (`no_email_channel`, `no_sms_channel`).

## Data model

- `notifications`: `id, user_id, event, record_type, record_id, title(160),
  link(300), collapse_key(200), count, read_at, created_at, updated_at`.
  Index `(user_id, read_at, updated_at desc)`; unique
  `(user_id, collapse_key) where read_at is null`.
- `notification_preferences`: `user_id, event, channel, enabled, updated_at`,
  primary key `(user_id, event, channel)`.
- `notification_recipients`: `id, event, channel, address(320), label(80),
  active, created_at, created_by_user_id`; unique `(event, channel, address)`.
- `notification_deliveries`: `id, event, channel, user_id, target_masked(40),
  status (sent|failed|skipped|suppressed), reason(200), record_type, record_id,
  created_at`; index `(created_at desc)`.

No DB foreign keys. Staging scrub: `db/scrub/plan.js` and `COLUMNS.md`.

## Wiring it into another app

To be written with the boot wiring (task 11).
