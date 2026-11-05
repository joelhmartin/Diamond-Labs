# messaging (web module)

## Purpose

The screens for the API's generic messaging module (`apps/api/src/modules/messaging`).
It knows only hosts, parties, records and threads; the host app supplies copy,
paths and which record types exist.

## Public interface

| Export | What it is |
|---|---|
| `InboxTable` | server-paged thread list: folder switch, Unread filter, optional record-type select, bulk read/unread/complete/reopen/archive/unarchive (one POST per thread, `{ ok, failed }` toast) |
| `ThreadView` | one conversation (oldest first, own side on the right) with the folder action and a `Composer` |
| `Composer` | message box, `onSend({ body })`, 5,000-character limit with a counter near it |
| `NewThreadModal` | starts a thread, on a `record` or to a `pickParty` party (host only) |
| `RecordThreads` | a record's threads plus a "New message" button |
| `MessagesBadge` | nav unread pill (polls `/messages/unread-count`, refreshes on `messaging:changed`) |

## Configuration

Props that vary by app: `threadPath(id)`, `folders`, `bulk`, `recordTypes`,
`timeZone`, `side` (`"host"` or `"party"`). Files are not supported yet; the
composer's object argument leaves room for them.

## Data model

None in the browser. Threads, participants and messages live in the server's
`message_threads`, `message_participants` and `messages` tables and are read
through the routes in `api.js`. The module fires a `messaging:changed` window
event after a write so badges refresh.

## Wiring it into another app

1. Wire the server module first (see "Wiring it into another app" in
   `apps/api/src/modules/messaging/README.md`).
2. Copy this directory. It depends on the app's `config/api.js` client, the
   shared `DataTable` + `useDataTable` (and `lib/data-table`), `Modal`, `SegmentedControl`, `ConfirmButton`, `useDebouncedValue`, `lib/requests.js` and the toast.
3. Put `MessagesBadge` next to the inbox link in the nav. This repo does it in
   `components/layout/Sidebar.jsx` (staff) and
   `components/layout/DoctorShell.jsx` (outside users).
4. Add an inbox page (`InboxTable` with `threadPath`, `folders`, `side`) and a
   thread page (`ThreadView`), and drop `RecordThreads` on any record's detail
   page; `pages/app/AdminRxCaseDetailPage.jsx` is the worked example.
