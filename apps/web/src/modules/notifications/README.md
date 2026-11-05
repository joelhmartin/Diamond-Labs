# notifications (web module)

## Purpose

The browser side of `apps/api/src/modules/notifications`. It knows nothing about
the host app's domain: the host supplies the page chrome, copy, routes and time zone.

## Public interface

| Export | What it is |
|---|---|
| `NotificationBell` | Bell with unread badge (99+ cap) and a popover of the latest 8. Props: `to` ("See all" path), `timeZone?`, `intervalMs?` |
| `AlertCenter` | Server-paged `DataTable` of the user's alerts: Unread-only filter, bulk Mark read, Dismiss (two clicks), row click opens the link and marks read. Props: `timeZone?`, `onChanged?` |
| `PreferencesPanel` | Grid of switches, one row per event offered to the user, In-app and Email columns |
| `RecipientsPanel` | Admin: per-event text recipients (add with local phone check, pause, Send test, remove) plus a provider-off banner. Props: `events: [{ key, label }]` (offer only events that send texts) |
| `DeliveriesTable` | Admin: email and text attempts, filter by channel and status. Props: `timeZone?`, `eventLabels?` |
| `fetchEvents()` | Admin: every registered event `[{ key, label, sms }]` |
| `useUnreadPoll(fetchCount, { intervalMs })` | `{ count, refresh, setCount }`. Pauses while the tab is hidden, refreshes when it becomes visible. Reusable for any badge count |

`api.js` wraps the routes; `phone.js` mirrors the server's phone rule so a bad
number is rejected before a request is made. Tests mock `config/api.js`.

## Configuration

None of its own. Everything that varies comes in as props (`to`, `timeZone`,
`intervalMs`, `events`, `eventLabels`). The text provider and email settings
live on the server (`apps/api/src/modules/sms`, the notifications module).

## Data model

None in the browser. It reads and writes the server's `notifications`,
`notification_preferences`, `notification_recipients` and
`notification_deliveries` tables through the routes in `api.js`; the only
client state is the polled unread count.

## Wiring it into another app

Worked example: the layout and page files named below.

1. Wire the server module first (see "Wiring it into another app" in
   `apps/api/src/modules/notifications/README.md`). The browser client calls
   it under the app's API base path (`/api/v1`, set in `config/api.js`).
2. Copy this directory. It depends on the app's `config/api.js` client, the
   shared `DataTable` and `useDataTable` (and `lib/data-table`),
   `ConfirmButton`, `lib/requests.js` and the toast.
3. Mount `NotificationBell` in the page chrome with `to` set to the alerts
   page. Here: `components/layout/Topbar.jsx` (staff) and
   `components/layout/DoctorShell.jsx` (outside users).
4. Mount `AlertCenter` and `PreferencesPanel` on one page (here
   `pages/app/NotificationsPage.jsx`) and the admin pieces
   (`RecipientsPanel`, `DeliveriesTable`, `fetchEvents`) on an admin page.
   Offer `RecipientsPanel` only the events whose `sms` flag is true.
5. Pass the app's `timeZone` to every component that shows a time.
