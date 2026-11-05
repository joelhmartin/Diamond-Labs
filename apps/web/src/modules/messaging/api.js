import api from "../../config/api.js";

// Thin wrappers over the messaging routes (/messages/*). Every call unwraps the { data } envelope.
const data = (res) => res.data.data;
const id = encodeURIComponent;

/** Fired on window after anything that changes unread counts, so nav badges refresh at once. */
export const MESSAGES_CHANGED = "messaging:changed";
const changed = (value) => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MESSAGES_CHANGED));
  return value;
};

/**
 * A create/post body: JSON, or multipart FormData (text fields plus one
 * `files` part per file) when `files` is non-empty.
 */
export function messageRequest({ files, ...fields }) {
  if (!files?.length) return [fields];
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) form.append(k, v);
  files.forEach((f) => form.append("files", f));
  return [form, { headers: { "Content-Type": "multipart/form-data" } }];
}

/** `params`: { folder, unread: "true", recordType, recordId, party, q, limit, offset } → { rows, total } */
export const fetchThreads = async (params) => data(await api.get("/messages/threads", { params }));
export const fetchUnreadCount = async () => data(await api.get("/messages/unread-count")).count;
/** Opening a thread marks it read. → { thread, messages } */
export const fetchThread = async (threadId) => changed(data(await api.get(`/messages/threads/${id(threadId)}`)));
/** `body`: { recordType?, recordId?, party?, subject?, body, files? } → the new thread */
export const createThread = async (body) => changed(data(await api.post("/messages/threads", ...messageRequest(body))));
/** `message`: { body, files? } */
export const postMessage = async (threadId, message) => changed(data(await api.post(`/messages/threads/${id(threadId)}/messages`, ...messageRequest(message))));
/** Where an attachment downloads from (a 302 to a short-lived signed link). */
export const attachmentPath = (fileId) => `/messages/attachments/${id(fileId)}`;
/** The signed link itself, fetched with the session's token (a plain link cannot carry it). */
export const fetchAttachmentUrl = async (fileId) => data(await api.get(attachmentPath(fileId), { params: { as: "json" } })).url;
export const fetchParties = async (q) => data(await api.get("/messages/parties", { params: q ? { q } : {} })); // [{ key, label }]

/** Per-thread actions the inboxes and thread page offer. */
export const THREAD_ACTIONS = ["read", "unread", "complete", "reopen", "archive", "unarchive"];
export const setThreadFlag = async (threadId, action) => {
  if (!THREAD_ACTIONS.includes(action)) throw new Error(`Unknown thread action: ${action}`);
  return changed(data(await api.post(`/messages/threads/${id(threadId)}/${action}`)));
};

/** Folders a record's panel looks in for each side (every thread about the record, whatever its state). */
export const RECORD_FOLDERS = { host: ["inbox", "completed"], party: ["inbox", "archived"] };

/** Every thread about one record, newest activity first. */
export async function fetchRecordThreads({ recordType, recordId, side }) {
  const pages = await Promise.all(
    (RECORD_FOLDERS[side] ?? RECORD_FOLDERS.party).map((folder) => fetchThreads({ folder, recordType, recordId, limit: 50 })),
  );
  return pages.flatMap((p) => p.rows).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
}
