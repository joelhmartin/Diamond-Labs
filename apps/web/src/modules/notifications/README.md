# notifications (web module)

The browser side of `apps/api/src/modules/notifications`. It knows nothing about
the host app's domain: the host supplies the page chrome, copy, routes and time zone.

| Export | What it is |
|---|---|
| `NotificationBell` | Bell with unread badge (99+ cap) and a popover of the latest 8. Props: `to` ("See all" path), `timeZone?`, `intervalMs?` |
| `AlertCenter` | Server-paged `DataTable` of the user's alerts: Unread-only filter, bulk Mark read, Dismiss (two clicks), row click opens the link and marks read. Props: `timeZone?`, `onChanged?` |
| `PreferencesPanel` | Grid of switches, one row per event offered to the user, In-app and Email columns |
| `RecipientsPanel` | Admin: per-event text recipients (add with local phone check, pause, Send test, remove) plus a provider-off banner. Props: `events: [{ key, label }]` |
| `DeliveriesTable` | Admin: email and text attempts, filter by channel and status. Props: `timeZone?`, `eventLabels?` |
| `useUnreadPoll(fetchCount, { intervalMs })` | `{ count, refresh, setCount }`. Pauses while the tab is hidden, refreshes when it becomes visible. Reusable for any badge count |

`api.js` wraps the routes; `phone.js` mirrors the server's phone rule so a bad
number is rejected before a request is made. Tests mock `config/api.js`.
