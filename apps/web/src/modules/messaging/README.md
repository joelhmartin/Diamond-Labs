# messaging (web module)

## Purpose

The screens for the API's generic messaging module (`apps/api/src/modules/messaging`).
It knows only hosts, parties, records and threads; the host app supplies copy,
paths and which record types exist.

## Public interface

| Export | What it is |
|---|---|
| `InboxTable` | server-paged thread list: folder switch, Unread filter, optional record-type select, bulk read/unread/complete/reopen/archive/unarchive (one POST per thread, `{ ok, failed }` toast) |
| `ThreadView` | one conversation (oldest first, own side on the right) with the folder action, attachment chips and a `Composer` |
| `Composer` | message box, `onSend({ body, files? })`, 5,000-character limit with a counter near it; file chips (pick or drop, remove), up to 5 files of 20 MB each, refused inline before any request |
| `NewThreadModal` | starts a thread (first message may carry files), on a `record` or to a `pickParty` party (host only) |
| `RecordThreads` | a record's threads plus a "New message" button |
| `MessagesBadge` | nav unread pill (polls `/messages/unread-count`, refreshes on `messaging:changed`) |

## Configuration

Props that vary by app: `threadPath(id)`, `folders`, `bulk`, `recordTypes`,
`timeZone`, `side` (`"host"` or `"party"`). Attachment limits come from
`MESSAGE_FILES_MAX` / `MESSAGE_FILE_MAX_BYTES` in `@my-app/shared`. A post
with files goes as multipart `FormData` (`api.js` `messageRequest`); without
files it stays JSON. An attachment chip links to
`/api/v1/messages/attachments/:id`; a click fetches the signed link with
`?as=json` (the session token rides in a header a plain link cannot carry)
and opens it in a new tab. The server only accepts files when its messaging
service has a `files` collaborator.

## Data model

None in the browser. Threads, participants and messages live in the server's
`message_threads`, `message_participants` and `messages` tables and are read
through the routes in `api.js`. The module fires a `messaging:changed` window
event after a write so badges refresh.

## Wiring it into another app

Worked example: the layout and page files named below.

1. Wire the server module first (see "Wiring it into another app" in
   `apps/api/src/modules/messaging/README.md`). The browser client calls it
   under the app's API base path (`/api/v1`, set in `config/api.js`), and
   attachments need the server's `files` collaborator (here built over
   `record-files`).
2. Copy this directory. It depends on the app's `config/api.js` client, the
   shared `DataTable` and `useDataTable` (and `lib/data-table`), `Modal`,
   `SegmentedControl`, `ConfirmButton`, `useDebouncedValue`, `lib/requests.js`,
   the toast, and the `record-files` web module (`FileDrop`, `checkFiles`,
   `fileSizeLabel`).
3. Mount `MessagesBadge` next to the inbox link in the nav. Here:
   `components/layout/Sidebar.jsx` (staff) and `components/layout/DoctorShell.jsx`
   (outside users).
4. Add an inbox page (`InboxTable` with `threadPath`, `folders`, `side`) and a
   thread page (`ThreadView`). `threadPath(id)` returns the route of the
   thread page (a notification's link should point at the same route).
5. Drop `RecordThreads` on any record's detail page;
   `pages/app/AdminRxCaseDetailPage.jsx` is the worked example.
