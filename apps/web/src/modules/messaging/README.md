# messaging (web module)

The screens for the API's generic messaging module (`apps/api/src/modules/messaging`).
It knows only hosts, parties, records and threads; the host app supplies copy,
paths and which record types exist.

| Export | What it is |
|---|---|
| `InboxTable` | server-paged thread list: folder switch, Unread filter, optional record-type select, bulk read/unread/complete/reopen/archive/unarchive (one POST per thread, `{ ok, failed }` toast) |
| `ThreadView` | one conversation (oldest first, own side on the right) with the folder action and a `Composer` |
| `Composer` | message box, `onSend({ body })`, 5,000-character limit with a counter near it |
| `NewThreadModal` | starts a thread, on a `record` or to a `pickParty` party (host only) |
| `RecordThreads` | a record's threads plus a "New message" button |
| `MessagesBadge` | nav unread pill (polls `/messages/unread-count`, refreshes on `messaging:changed`) |

Props that vary by app: `threadPath(id)`, `folders`, `bulk`, `recordTypes`,
`timeZone`, `side` (`"host"` or `"party"`). Files are not supported yet; the
composer's object argument leaves room for them.
