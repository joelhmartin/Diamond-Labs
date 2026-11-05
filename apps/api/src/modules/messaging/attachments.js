import { MessagingError } from "./rules.js";

/**
 * Attachments through the optional `files` collaborator (README "Files").
 * The module never stores bytes itself: the host app's collaborator does, and
 * this file only validates, orders and cleans up. Without a collaborator a
 * post that carries files is refused and every message lists `attachments: []`.
 *
 * Ordering (the one rule that matters): files are attached BEFORE the message
 * transaction, under the new message's id. If the transaction then fails, the
 * attached files are removed again, so a failed post leaves no objects. Until
 * the message commits, its files are unreachable (a download resolves file →
 * message → thread, and the message does not exist yet).
 */
export function createAttachments({ files = null, lim, log = console }) {
  const invalid = (message) => new MessagingError("INVALID", message);

  /** The validated upload list ([] when none). Never touches storage. */
  function clean(list) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw invalid("Files must be a list.");
    if (!list.length) return [];
    if (!files) throw invalid("Attachments are not available here.");
    if (list.length > lim.filesMax) throw invalid(`A message carries at most ${lim.filesMax} files.`);
    for (const f of list) {
      if (!f || !Buffer.isBuffer(f.buffer)) throw invalid("Each file needs its content.");
      if (f.buffer.length > lim.fileMaxBytes) throw invalid(`Each file is at most ${Math.round(lim.fileMaxBytes / (1024 * 1024))} MB.`);
    }
    return list.map((f) => ({ buffer: f.buffer, originalName: String(f.originalName || "file"), contentType: f.contentType || null }));
  }

  /**
   * Attach `uploads` to `messageId`, then run `commit()` (the message
   * transaction). A failed commit removes what was attached and rethrows.
   */
  async function attachThenCommit(db, { messageId, uploads, byUserId }, commit) {
    const attached = uploads.length ? await files.attach(db, { recordId: messageId, files: uploads, byUserId }) : [];
    try {
      await commit();
    } catch (err) {
      await discard(db, messageId, attached);
      throw err;
    }
    return attached;
  }

  // Best-effort: a failed removal is logged by message id and count, never by file name.
  async function discard(db, messageId, attached) {
    if (!attached.length) return;
    try {
      await files.remove(db, attached.map((a) => a.id));
    } catch (err) {
      log.error?.(`[messaging] could not remove ${attached.length} attachment(s) of failed message ${messageId}: ${err?.name ?? "Error"}`);
    }
  }

  /** Map<messageId, [{ id, fileName, contentType, sizeBytes }]>; empty without a collaborator. */
  async function listFor(db, messageIds) {
    if (!files || !messageIds.length) return new Map();
    const found = await files.listFor(db, messageIds);
    const out = new Map();
    for (const [id, rows] of found ?? []) out.set(id, rows.map(attachmentView));
    return out;
  }

  /** The file row behind an attachment id, or null (unknown, or not a message attachment). */
  async function find(db, fileId) {
    if (!files || typeof fileId !== "string" || !fileId) return null;
    return (await files.find(db, fileId)) ?? null;
  }

  return { enabled: Boolean(files), clean, attachThenCommit, listFor, find, signedUrl: (db, id) => files.signedUrl(db, id) };
}

/** The only attachment fields that leave the module: never a storage location. */
export const attachmentView = (r) => ({ id: r.id, fileName: r.fileName ?? null, contentType: r.contentType ?? null, sizeBytes: r.sizeBytes ?? null });
