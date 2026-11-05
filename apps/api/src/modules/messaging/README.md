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
| `views.js` | response shapes: opened text, record/party labels, author names |
| `messaging.service.js` | `createMessaging({...})`: access checks, sealing, transactions, the hook |
| `routes.js` | `messagingRoutes(fastify, {...})`: the HTTP surface |
| `index.js` | the public surface |

Request schemas and limits (`MESSAGE_BODY_MAX` 5,000, `MESSAGE_SUBJECT_MAX`
200, `MESSAGE_FOLDERS`) live in `@my-app/shared`
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
  store,                                 // default: drizzle (store.js); tests pass createFakeStore()
  sealer,                                // default: fieldSealer(["subject", "body"])
  limits: { bodyMax: 5000, subjectMax: 200 },
});
```

| Method | Returns | Notes |
|---|---|---|
| `listThreads(user, { folder, unread, recordType, recordId, party, q, limit, offset })` | `{ rows, total }` | rows: `{ id, recordType, recordId, recordLabel, partyKey, partyLabel, subject, lastMessageAt, lastMessageSide, messageCount, unread, completedAt, archivedAt }`, newest activity first. `limit` ≤ 100 |
| `unreadCount(user)` | number | across every folder the user can see |
| `createThread(user, { recordType?, recordId?, party?, subject?, body })` | thread row | the first message is posted with it |
| `getThread(user, id)` | `{ thread, messages }` | marks it read; `thread.recordPath` is the host or party path; messages oldest first: `{ id, authorUserId, authorName, authorSide, body, createdAt, attachments: [] }` |
| `post(user, threadId, { body })` | message | |
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
- **onMessage:** `{ thread, message, authorSide, authorUserId, recordLabel }`,
  called after the transaction commits, for the first message of a thread too.
  `thread` and `message` carry ids, sides, counts and dates only, never the
  subject or body. A throw is logged and the post still succeeds.

### Routes

`messagingRoutes(fastify, { messaging, authenticate, guard?, listParties?, db? })`,
registered under the app's API prefix. Every route runs `authenticate`, then
`guard` when given (a preHandler or a list). Bodies are JSON. Validation
failures are 422 `VALIDATION_ERROR`; `MessagingError` maps to 404/403/400.

| Method | Path | Notes |
|---|---|---|
| GET | `/messages/threads` | `?folder&unread=true&recordType&recordId&party&q&limit&offset` → `{ rows, total }` |
| GET | `/messages/unread-count` | `{ count }` |
| POST | `/messages/threads` | `{ recordType?, recordId?, party?, subject?, body }` → 201 |
| GET | `/messages/threads/:id` | marks it read |
| POST | `/messages/threads/:id/messages` | `{ body }` → 201 |
| POST | `/messages/threads/:id/read` · `/unread` | per user |
| POST | `/messages/threads/:id/complete` · `/reopen` | host only |
| POST | `/messages/threads/:id/archive` · `/unarchive` | per user |
| GET | `/messages/parties?q=` | host only; registered only when `listParties(db, q) → [{ key, label }]` is given |

Every response is `{ data }`; errors are `{ error: { code, status, message } }`.

## Configuration

None of its own. `PHI_ENCRYPTION_KEY` must be set for the default sealer
(`lib/crypto.js`).

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

**Attachments** are not part of this module yet. Messages carry
`attachments: []` so the response shape is stable; a later files
collaborator fills it in `views.js` (`messageList`) and takes files on
`createThread` / `post`.

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
   (party keys for a user, record resolvers and labels, search, `onMessage`).
3. Register `messagingRoutes` under the API prefix with `authenticate`, a
   `guard` and `listParties`.
4. Mount the web screens (`InboxTable`, `ThreadView`, `RecordThreads`,
   `MessagesBadge`) on pages the host owns.
