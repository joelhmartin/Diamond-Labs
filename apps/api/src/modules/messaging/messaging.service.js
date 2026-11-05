import { createId } from "@paralleldrive/cuid2";
import { MESSAGE_BODY_MAX, MESSAGE_SUBJECT_MAX } from "@my-app/shared";
import { fieldSealer } from "../../lib/crypto.js";
import { createDrizzleStore } from "./store.js";
import { MessagingError, canRead, folderWhere, afterPost, SIDES } from "./rules.js";
import { createViews } from "./views.js";

/** Free text the service seals at rest: a thread's subject and a message's body. */
export const SEALED_FIELDS = ["subject", "body"];
const LIST_DEFAULT = 50;
const LIST_MAX = 100;

const invalid = (message) => new MessagingError("INVALID", message);
const notFound = () => new MessagingError("NOT_FOUND", "Thread not found.");

/**
 * Build the messaging service. Collaborators (all injected, so another app
 * wires its own; see README.md):
 * - db: the root drizzle db (transactions run on it)
 * - isHost(user) → bool, partyKeysFor(user) → string[], defaultPartyKey(user) → string
 * - records: { [recordType]: { resolve(db, id, user) → { label, partyKey, hostPath, partyPath } | null,
 *     labels?(db, ids, user) → Map<id, label> } }
 * - describeParty(db, partyKeys) → Map<key, label>; describeUsers(db, userIds) → Map<id, name>
 * - search(db, q, user) → { partyKeys?, records?: [{ recordType, recordId }] } (no search: q matches nothing)
 * - onMessage(evt): after each post commits; a throw is logged, never surfaced
 * - store (default drizzle; tests pass fake-store.js), sealer (default fieldSealer)
 */
export function createMessaging({
  db: rootDb,
  store = createDrizzleStore(),
  sealer = fieldSealer(SEALED_FIELDS),
  records = {},
  isHost,
  partyKeysFor,
  defaultPartyKey,
  describeParty = async () => new Map(),
  describeUsers = async () => new Map(),
  search = null,
  onMessage = null,
  limits = {},
  log = console,
  now = () => new Date(),
  newId = createId,
} = {}) {
  if (!rootDb || !isHost || !partyKeysFor || !defaultPartyKey) {
    throw new Error("createMessaging needs db, isHost, partyKeysFor and defaultPartyKey");
  }
  const lim = { bodyMax: MESSAGE_BODY_MAX, subjectMax: MESSAGE_SUBJECT_MAX, ...limits };
  const views = createViews({ records, sealer, describeParty, describeUsers, log });
  const hook = { onMessage, log, views };

  const who = (user) => {
    const host = Boolean(isHost(user));
    return { host, side: host ? SIDES.HOST : SIDES.PARTY, partyKeys: host ? null : (partyKeysFor(user) ?? []) };
  };

  // The one access check: a missing thread and someone else's thread look the
  // same (NOT_FOUND), so a party user cannot probe for ids.
  async function loadVisible(user, id) {
    const c = who(user);
    const thread = typeof id === "string" && id ? await store.getThread(rootDb, id) : null;
    if (!canRead(user, thread, { isHost: c.host, partyKeys: c.partyKeys })) throw notFound();
    return { thread, ...c };
  }

  async function participantPatch(user, id, patch) {
    const { thread, side } = await loadVisible(user, id);
    await store.touchParticipant(rootDb, { threadId: thread.id, userId: user.id, side }, patch);
  }

  async function setCompleted(user, id, on) {
    if (!isHost(user)) throw new MessagingError("FORBIDDEN", "Only the host completes threads.");
    const { thread } = await loadVisible(user, id);
    const at = now();
    await store.updateThread(rootDb, thread.id, on
      ? { completedAt: at, completedByUserId: user.id, updatedAt: at }
      : { completedAt: null, completedByUserId: null, updatedAt: at });
  }

  return {
    db: rootDb,
    isHost: (user) => Boolean(isHost(user)),

    /** → { rows, total } for the caller's folder (inbox by default). */
    async listThreads(user, q = {}) {
      const c = who(user);
      const folder = folderWhere(q.folder || "inbox", c.side);
      if (!folder) throw invalid(`The ${q.folder} folder is not available here.`);
      const text = typeof q.q === "string" ? q.q.trim() : "";
      const match = text ? normalizeMatch(search ? await search(rootDb, text, user) : null) : null;
      const { rows, total } = await store.listThreads(rootDb, {
        userId: user.id, side: c.side, partyKeys: c.partyKeys, folder,
        unreadOnly: q.unread === true || q.unread === "true",
        recordType: q.recordType || undefined, recordId: q.recordId || undefined, party: q.party || undefined,
        match, limit: clampInt(q.limit, 1, LIST_MAX, LIST_DEFAULT), offset: clampInt(q.offset, 0, 1e6, 0),
      });
      return { rows: await views.listRows(rootDb, rows, user), total };
    },

    async unreadCount(user) {
      const c = who(user);
      return store.unreadCount(rootDb, { userId: user.id, side: c.side, partyKeys: c.partyKeys });
    },

    /** Start a thread with its first message. → the thread, as a list row. */
    async createThread(user, input = {}) {
      const c = who(user);
      const body = cleanBody(input.body, lim);
      const subject = cleanSubject(input.subject, lim);
      const { recordType, recordId, partyKey, resolved } = await placeThread({ db: rootDb, records, defaultPartyKey }, user, c, input);
      const at = now();
      const thread = {
        id: newId(), recordType, recordId, partyKey, ...sealer.seal({ subject }), createdByUserId: user.id,
        lastMessageAt: at, lastMessageSide: c.side, messageCount: 1, completedAt: null, completedByUserId: null,
        createdAt: at, updatedAt: at,
      };
      const message = { id: newId(), threadId: thread.id, authorUserId: user.id, authorSide: c.side, ...sealer.seal({ body }), createdAt: at };
      await rootDb.transaction(async (tx) => {
        await store.insertThread(tx, thread);
        await store.insertMessage(tx, message);
        await store.touchParticipant(tx, { threadId: thread.id, userId: user.id, side: c.side }, { lastReadAt: at });
      });
      await fireOnMessage(hook, thread, message, resolved?.label);
      return views.threadRow(rootDb, thread, { recordLabel: resolved?.label ?? null, unread: false, archivedAt: null });
    },

    /** Open a thread: messages oldest first, bodies opened. Marks it read for the caller. */
    async getThread(user, id) {
      const { thread, side } = await loadVisible(user, id);
      const [rows, mine, resolved] = await Promise.all([
        store.listMessages(rootDb, thread.id),
        store.getParticipant(rootDb, thread.id, user.id),
        views.resolveRecord(rootDb, thread, user),
      ]);
      await store.touchParticipant(rootDb, { threadId: thread.id, userId: user.id, side }, { lastReadAt: now() });
      const row = await views.threadRow(rootDb, thread, { recordLabel: resolved?.label ?? null, unread: false, archivedAt: mine?.archivedAt ?? null });
      const recordPath = resolved ? (side === SIDES.HOST ? resolved.hostPath : resolved.partyPath) ?? null : null;
      return { thread: { ...row, recordPath }, messages: await views.messageList(rootDb, rows) };
    },

    /** Add a message. → the message, opened. */
    async post(user, threadId, input = {}) {
      const { thread, side } = await loadVisible(user, threadId);
      const body = cleanBody(input.body, lim);
      const at = now();
      const message = { id: newId(), threadId: thread.id, authorUserId: user.id, authorSide: side, ...sealer.seal({ body }), createdAt: at };
      const patch = afterPost(thread, side, at);
      await rootDb.transaction(async (tx) => {
        await store.insertMessage(tx, message);
        await store.recordPost(tx, thread.id, patch);
        await store.touchParticipant(tx, { threadId: thread.id, userId: user.id, side }, { lastReadAt: at });
      });
      const resolved = await views.resolveRecord(rootDb, thread, user);
      await fireOnMessage(hook, { ...thread, ...patch, messageCount: thread.messageCount + 1 }, message, resolved?.label);
      const [view] = await views.messageList(rootDb, [message]);
      return view;
    },

    async setRead(user, id, read) {
      await participantPatch(user, id, { lastReadAt: read ? now() : null });
    },
    async archive(user, id, on) {
      await participantPatch(user, id, { archivedAt: on ? now() : null });
    },
    async complete(user, id) {
      await setCompleted(user, id, true);
    },
    async reopen(user, id) {
      await setCompleted(user, id, false);
    },
  };
}

function cleanBody(body, lim) {
  const s = typeof body === "string" ? body.trim() : "";
  if (!s) throw invalid("Write a message.");
  if (s.length > lim.bodyMax) throw invalid(`A message is at most ${lim.bodyMax} characters.`);
  return s;
}

function cleanSubject(subject, lim) {
  if (subject == null) return null;
  if (typeof subject !== "string") throw invalid("Subject must be text.");
  const s = subject.trim();
  if (s.length > lim.subjectMax) throw invalid(`A subject is at most ${lim.subjectMax} characters.`);
  return s || null;
}

// Where a new thread belongs: the record's party, the host's chosen party, or
// the party user's own default. Never a party the caller cannot see.
async function placeThread({ db, records, defaultPartyKey }, user, c, input) {
  const recordType = input.recordType || null;
  const recordId = input.recordId || null;
  if (Boolean(recordType) !== Boolean(recordId)) throw invalid("recordType and recordId go together.");
  let partyKey;
  let resolved = null;
  if (recordType) {
    const rec = records[recordType];
    if (!rec) throw invalid(`Unknown record type "${recordType}".`);
    resolved = await rec.resolve(db, recordId, user);
    if (!resolved?.partyKey) throw notFound();
    partyKey = resolved.partyKey;
  } else if (c.host) {
    partyKey = typeof input.party === "string" ? input.party.trim() : "";
    if (!partyKey) throw invalid("Choose who the message is for.");
  } else {
    partyKey = defaultPartyKey(user);
  }
  if (!canRead(user, { partyKey }, { isHost: c.host, partyKeys: c.partyKeys })) throw notFound();
  return { recordType, recordId, partyKey, resolved };
}

// After commit. Free text never leaves: the hook sees ids, sides and labels.
async function fireOnMessage({ onMessage, log, views }, thread, message, recordLabel) {
  if (!onMessage) return;
  try {
    await onMessage({
      thread: views.hookThread(thread),
      message: { id: message.id, threadId: message.threadId, authorUserId: message.authorUserId, authorSide: message.authorSide, createdAt: message.createdAt },
      authorSide: message.authorSide,
      authorUserId: message.authorUserId,
      recordLabel: recordLabel ?? null,
    });
  } catch (err) {
    log.error?.(`[messaging] onMessage failed for thread ${thread.id}: ${err?.message ?? err}`);
  }
}

function normalizeMatch(hit) {
  const partyKeys = Array.isArray(hit?.partyKeys) ? hit.partyKeys.filter((k) => typeof k === "string").slice(0, 500) : [];
  const recs = Array.isArray(hit?.records) ? hit.records : [];
  const records = recs.filter((r) => r?.recordType && r?.recordId).slice(0, 200)
    .map((r) => ({ recordType: String(r.recordType), recordId: String(r.recordId) }));
  return { partyKeys, records };
}

function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
