import { MESSAGE_FILES_MAX, MESSAGE_FILE_MAX_BYTES } from "@my-app/shared";

/** The multipart field that carries attachments; any other file part is drained and ignored. */
export const FILES_FIELD = "files";
const MB = 1024 * 1024;

/**
 * A create/post request's input: `{ fields, files }` from multipart (text
 * fields plus `files` parts read into buffers), or `{ fields: request.body,
 * files: [] }` for JSON. A limit problem is `{ error }` (the caller answers
 * 400). The parser enforces the size and count limits itself (one file past
 * the maximum is let through so it can be reported as such); every part we
 * don't keep is drained with `file.resume()` (never buffered), so the parser
 * never stalls. File names are never logged.
 */
export async function readMessageInput(request, { filesMax = MESSAGE_FILES_MAX, fileMaxBytes = MESSAGE_FILE_MAX_BYTES } = {}) {
  if (typeof request.isMultipart !== "function" || !request.isMultipart()) {
    return { fields: request.body, files: [] };
  }
  const tooMany = `A message carries at most ${filesMax} files.`;
  const tooLarge = `Each file is at most ${fileMaxBytes / MB} MB.`;
  const fields = {};
  const files = [];
  let error = null;
  try {
    for await (const part of request.parts({ limits: { fileSize: fileMaxBytes, files: filesMax + 1 } })) {
      if (part.type !== "file") {
        fields[part.fieldname] = part.value;
        continue;
      }
      if (part.fieldname !== FILES_FIELD || error || files.length >= filesMax) {
        if (part.fieldname === FILES_FIELD && !error) error = tooMany;
        part.file.resume();
        continue;
      }
      try {
        const buffer = await part.toBuffer();
        files.push({ buffer, originalName: part.filename || "file", contentType: part.mimetype || null });
      } catch (err) {
        if (err?.code !== "FST_REQ_FILE_TOO_LARGE") throw err;
        error = tooLarge;
      }
    }
  } catch (err) {
    // The parser's own limits surface from the iterator (a drained part can trip the size limit too).
    if (err?.code === "FST_FILES_LIMIT") error ??= tooMany;
    else if (err?.code === "FST_REQ_FILE_TOO_LARGE") error ??= tooLarge;
    else if (err?.code === "FST_PARTS_LIMIT") error ??= "Too many parts in this upload.";
    else throw err;
  }
  return error ? { error } : { fields, files };
}
