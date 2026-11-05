# messaging (generic module)

## Purpose

Conversations between the **host** (the organisation running the app: its
staff) and one outside **party** (an organisation or person the host app
names with a party key). A thread can be about a **record**
(`recordType` + `recordId`, opaque strings the host app resolves) or about
nothing in particular. Subjects and bodies are sealed at rest; each user has
their own read state; host staff share one "completed" flag per thread, and
party users file threads into their own "archived" folder.

It knows nothing about the host app's domain. Everything domain-shaped (who
is host staff, which party keys a user holds, what a record is called and
where it lives) comes in through collaborators.

## Files

| File | What it owns |
|---|---|
| `schema.js` | the three tables (re-exported from `db/schema/index.js`) |
| `rules.js` | pure rules: `canRead`, `sideOf`, `isUnreadFor`, `folderWhere`, `afterPost`, `MessagingError` |
| `queries.js` | the same rules in SQL (visibility, unread, folders, search match) |
| `store.js` | the drizzle data access |
| `fake-store.js` | the same surface in memory, for tests |
| `views.js` | response shapes: opened text, record/party labels, author names, attachment metadata |
| `attachments.js` | the optional `files` collaborator: validation, attach-then-commit ordering, cleanup |
| `form.js` | reads a create/post request as JSON or multipart (fields plus `files` parts) |
| `messaging.service.js` | `createMessaging({...})`: access checks, sealing, transactions, the hook |
| `routes.js` | `messagingRoutes(fastify, {...})`: the HTTP surface |
| `index.js` | the public surface |

Request schemas and limits (`MESSAGE_BODY_MAX` 5,000, `MESSAGE_SUBJECT_MAX`
200, `MESSAGE_FOLDERS`, `MESSAGE_FILES_MAX` 5, `MESSAGE_FILE_MAX_BYTES` 20 MB) live in `@my-app/shared`
(`packages/shared/src/messaging/schemas.js`) so the web app can use them.

## Public interface

### Service

```js
const messaging = createMessaging({
  db,                                   // root drizzle db; transactions run on it
  isHost: (user) => bool,               // host staff?
  partyKeysFor: (user) => ["user:<id>", "org:<id>"],   // keys a party user may see
  defaultPartyKey: (user) => "org:<id>",              // a party user's own general threads
  records: {                            // optional; one entry per record type
    widget: {
      resolve: async (db, id, user) => ({ label, partyKey, hostPath, partyPath }) | null,  // null = not visible to this user
      labels: async (db, ids, user) => Map<id, label>,   // optional batch for the list
    },
  },
  describeParty: async (db, partyKeys) => Map<key, label>,   // optional
  describeUsers: async (db, userIds) => Map<id, name>,       // optional (author names)
  search: async (db, q, user) => ({ partyKeys, records: [{ recordType, recordId }] }),  // optional
  onMessage: async (evt) => {},          // optional, after every post commits
  files: {                               // optional attachment storage; see "Files" below
    attach: async (db, { recordId, files, byUserId }) => rows,     // recordId = the new message's id
    listFor: async (db, messageIds) => Map<messageId, rows>,
    find: async (db, fileId) => ({ id, messageId }) | null,         // null: unknown, or not a message file
    signedUrl: async (db, fileId) => url,                            // short-lived read link
    remove: async (db, fileIds) => {},                               // undo for a failed post
  },
  store,                                 // default: drizzle (store.js); tests pass createFakeStore()
  sealer,                                // default: fieldSealer(["subject", "body"])
  limits: { bodyMax: 5000, subjectMax: 200, filesMax: 5, fileMaxBytes: 20 MB },
});
```

| Method | Returns | Notes |
|---|---|---|
| `listThreads(user, { folder, unread, recordType, recordId, party, q, limit, offset })` | `{ rows, total }` | rows: `{ id, recordType, recordId, recordLabel, partyKey, partyLabel, subject, lastMessageAt, lastMessageSide, messageCount, unread, completedAt, archivedAt }`, newest activity first. `limit` ≤ 100 |
| `unreadCount(user)` | number | across every folder the user can see |
| `createThread(user, { recordType?, recordId?, party?, subject?, body, files? })` | thread row | the first message (and its files) is posted with it |
| `getThread(user, id)` | `{ thread, messages }` | marks it read; `thread.recordPath` is the host or party path; messages oldest first: `{ id, authorUserId, authorName, authorSide, body, createdAt, attachments: [{ id, fileName, contentType, sizeBytes }] }` |
| `post(user, threadId, { body, files? })` | message | `files`: `[{ buffer, originalName, contentType }]`, at most 5, each ≤ 20 MB |
| `attachmentUrl(user, fileId)` | `{ url, fileId, threadId }` | file → message → thread → read check, then sign; anything else `NOT_FOUND` |
| `setRead(user, id, read)` | | per user |
| `complete(user, id)` / `reopen(user, id)` | | host only |
| `archive(user, id, on)` | | per user |

Errors are `MessagingError` with `code` `NOT_FOUND`, `FORBIDDEN` or
`INVALID`. A party user asking for a thread outside their keys always gets
`NOT_FOUND`, the same as a missing id.

### Rules

- **Sides:** a user is `host` when `isHost(user)`, otherwise `party`.
- **Visibility:** host users see every thread; party users see threads whose
  `party_key` is in `partyKeysFor(user)`. A `party` list filter narrows that,
  never widens it.
- **Where a new thread goes:** with a record, the resolver's `partyKey` (and
  the resolver must return non-null for this user, else `NOT_FOUND`); without
  one, a host user must name `party`, and a party user's thread uses
  `defaultPartyKey(user)` (a `party` in the body is ignored).
- **Unread:** the other side posted last and after the user's `last_read_at`.
  Your own side's posts never make a thread unread for you.
- **Folders:** host `inbox` (not completed) and `completed`; party `inbox`
  (not archived by me) and `archived`. Asking for another side's folder is
  `INVALID`. A party post clears `completed_at`, so the thread comes back to
  the host's inbox. Any post clears `archived_at` for the other side's
  participants, so a reply un-archives the thread for them.
- **Read marks:** opening a thread marks it read up to the newest message it
  returned (not "now"), so a post that lands mid-open stays unread.
- **Search:** `q` matches only what `search()` returns (party keys and
  records). Bodies and subjects are sealed and never searched. Without a
  `search` collaborator, `q` matches nothing.
- **Files:** with a `files` collaborator a message carries up to
  `filesMax` files of at most `fileMaxBytes` each (more, or bigger, is
  `INVALID`); without one, any file is `INVALID` and every message lists
  `attachments: []`. Files are attached first, under the new message's id,
  then the message transaction runs; if it fails, `remove` takes the files
  back out, so a failed post leaves nothing stored. A download resolves the
  file to its message and thread and applies the thread's read check before
  `signedUrl` runs. Only `{ id, fileName, contentType, sizeBytes }` ever
  leaves the module (never a storage location), and file names are never
  logged or handed to `onMessage`.
- **onMessage:** `{ thread, message, authorSide, authorUserId, recordLabel }`,
  called after the transaction commits, for the first message of a thread too.
  `thread` and `message` carry ids, sides, counts and dates only, never the
  subject or body. A throw is logged and the post still succeeds.

### Routes

`messagingRoutes(fastify, { messaging, authenticate, guard?, listParties?, db?, onAttachmentRead? })`,
registered under the app's API prefix. Every route runs `authenticate`, then
`guard` when given (a preHandler or a list). Bodies are JSON; create and post
also take multipart (the same text fields plus up to 5 `files` parts; any
other file part is drained and ignored; a 6th file or an oversize file is
400 `INVALID`). Validation failures are 422 `VALIDATION_ERROR`;
`MessagingError` maps to 404/403/400. `onAttachmentRead(request, { fileId,
threadId })` runs after each download link is issued (the app audits it).

| Method | Path | Notes |
|---|---|---|
| GET | `/messages/threads` | `?folder&unread=true&recordType&recordId&party&q&limit&offset` → `{ rows, total }` |
| GET | `/messages/unread-count` | `{ count }` |
| POST | `/messages/threads` | `{ recordType?, recordId?, party?, subject?, body }` (+ `files`) → 201 |
| GET | `/messages/threads/:id` | marks it read |
| POST | `/messages/threads/:id/messages` | `{ body }` (+ `files`) → 201 |
| GET | `/messages/attachments/:id` | 302 to a signed link (5 min); `?as=json` → `{ url }` for a browser app whose token is a header; no access → 404 |
| POST | `/messages/threads/:id/read` · `/unread` | per user |
| POST | `/messages/threads/:id/complete` · `/reopen` | host only |
| POST | `/messages/threads/:id/archive` · `/unarchive` | per user |
| GET | `/messages/parties?q=` | host only; registered only when `listParties(db, q) → [{ key, label }]` is given |

Every response is `{ data }`; errors are `{ error: { code, status, message } }`.

## Configuration

None of its own. `PHI_ENCRYPTION_KEY` must be set for the default sealer
(`lib/crypto.js`). Attachments are on only when the host app passes a `files`
collaborator to `createMessaging`; storage, bucket and link lifetime are the
collaborator's business.

## Data model

- **`message_threads`**: `id, record_type, record_id, party_key, subject
  (sealed), created_by_user_id, last_message_at, last_message_side,
  message_count, completed_at, completed_by_user_id, created_at, updated_at`.
  Indexes `(party_key, last_message_at desc)`, `(record_type, record_id)`,
  `(completed_at, last_message_at desc)`.
- **`message_participants`**: `thread_id, user_id, side, last_read_at,
  archived_at, joined_at`. PK `(thread_id, user_id)`. Anyone who posts or
  opens a thread gets a row.
- **`messages`**: `id, thread_id, author_user_id, author_side, body (sealed),
  created_at`. Index `(thread_id, created_at)`.

No foreign keys (repo convention). Unread is computed in SQL from
`last_message_side` / `last_message_at` against the caller's
`last_read_at`; `total` comes from `count(*) over()`, so a page past the end
reports `total: 0`.

**Attachments** have no table here: the `files` collaborator stores them
(in this repo, `record_files` rows with `record_type = "message"`,
`record_id = <message id>`, kind `attachment`, through
`modules/record-files`).

## Wiring it into another app

The host app builds the service once at boot with its own collaborators
(party keys, record resolvers, labels, search, an `onMessage` that emits its
alert) and registers `messagingRoutes` with its `authenticate`, a `guard` and
`listParties`. In this repo that wiring lives in `services/app-modules.js`,
with the collaborators in its glue file next to the other notification glue
(`services/app-modules.js` imports it, so its import list is the map).
The browser side is `apps/web/src/modules/messaging`; see its README.

Steps for a new host:

1. Re-export `messageThreads`, `messageParticipants` and `messages` from
   `modules/messaging/schema.js` in the app's Drizzle schema index and
   generate a migration.
2. Build the service with `createMessaging({ db, ...collaborators })`
   (party keys for a user, record resolvers and labels, search, `onMessage`,
   and `files` if messages carry attachments; this repo's glue file builds
   one over `modules/record-files`).
3. Register `messagingRoutes` under the API prefix with `authenticate`, a
   `guard`, `listParties` and (optionally) `onAttachmentRead`.
4. Mount the web screens (`InboxTable`, `ThreadView`, `RecordThreads`,
   `MessagesBadge`) on pages the host owns.
