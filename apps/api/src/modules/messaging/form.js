import { MESSAGE_FILES_MAX, MESSAGE_FILE_MAX_BYTES } from "@my-app/shared";

/** The multipart field that carries attachments; any other file part is drained and ignored. */
export const FILES_FIELD = "files";
const MB = 1024 * 1024;

/**
 * A create/post request's input: `{ fields, files }` from multipart (text
 * fields plus `files` parts read into buffers), or `{ fields: request.body,
 * files: [] }` for JSON. A limit problem is `{ error }` (the caller answers
 * 400); the loop always runs to the end so every part's stream is consumed
 * and the parser never stalls. File names are never logged.
 */
export async function readMessageInput(request, { filesMax = MESSAGE_FILES_MAX, fileMaxBytes = MESSAGE_FILE_MAX_BYTES } = {}) {
  if (typeof request.isMultipart !== "function" || !request.isMultipart()) {
    return { fields: request.body, files: [] };
  }
  const fields = {};
  const files = [];
  let error = null;
  try {
    for await (const part of request.parts({ limits: { fileSize: fileMaxBytes } })) {
      if (part.type !== "file") {
        fields[part.fieldname] = part.value;
        continue;
      }
      if (part.fieldname !== FILES_FIELD || error || files.length >= filesMax) {
        if (part.fieldname === FILES_FIELD && !error) error = `A message carries at most ${filesMax} files.`;
        await part.toBuffer().catch(() => {});
        continue;
      }
      try {
        const buffer = await part.toBuffer();
        files.push({ buffer, originalName: part.filename || "file", contentType: part.mimetype || null });
      } catch (err) {
        if (err?.code !== "FST_REQ_FILE_TOO_LARGE") throw err;
        error = `Each file is at most ${fileMaxBytes / MB} MB.`;
      }
    }
  } catch (err) {
    if (err?.code !== "FST_FILES_LIMIT" && err?.code !== "FST_PARTS_LIMIT") throw err;
    error = "Too many parts in this upload.";
  }
  return error ? { error } : { fields, files };
}
