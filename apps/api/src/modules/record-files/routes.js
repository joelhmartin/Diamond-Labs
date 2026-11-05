import { MAX_FILE_SIZE_BYTES, RECORD_FILES_MAX_COUNT, recordFileKindSchema } from "@my-app/shared";
import * as defaultService from "./service.js";
import { FileError } from "./service.js";

const STATUS = { NOT_FOUND: 404, INVALID: 422, TOO_LARGE: 413 };
const MB = 1024 * 1024;

/** FileError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function fileErrorReply(err) {
  if (!(err instanceof FileError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

const asArray = (g) => (Array.isArray(g) ? g : [g]);
const notFound = (reply, message = "Not found.") =>
  reply.code(404).send({ error: { code: "NOT_FOUND", status: 404, message } });

/**
 * Reads the multipart body into buffers, enforcing the shared limits. A part's
 * field name is its kind. Returns { files } or { error: FileError }.
 */
async function readUploads(request) {
  const files = [];
  const tooLarge = (name) => new FileError("TOO_LARGE", `File "${name}" exceeds the ${MAX_FILE_SIZE_BYTES / MB} MB size limit.`);
  // The multipart parser throws FST_REQ_FILE_TOO_LARGE / FST_FILES_LIMIT; anything else is a real failure and propagates.
  try {
    for await (const part of request.parts({ limits: { fileSize: MAX_FILE_SIZE_BYTES, files: RECORD_FILES_MAX_COUNT } })) {
      if (part.type !== "file") continue;
      const kind = recordFileKindSchema.safeParse(part.fieldname);
      if (!kind.success) {
        await part.toBuffer().catch(() => {});
        return { error: new FileError("INVALID", "Invalid file kind.") };
      }
      let buffer;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        if (err?.code === "FST_REQ_FILE_TOO_LARGE") return { error: tooLarge(part.filename || part.fieldname) };
        throw err;
      }
      files.push({ kind: kind.data, buffer, originalName: part.filename || `upload-${Date.now()}`, contentType: part.mimetype || null });
    }
  } catch (err) {
    if (err?.code === "FST_FILES_LIMIT") {
      return { error: new FileError("TOO_LARGE", `Too many files, maximum ${RECORD_FILES_MAX_COUNT} per upload.`) };
    }
    if (err?.code === "FST_REQ_FILE_TOO_LARGE") return { error: tooLarge("upload") };
    throw err;
  }
  if (!files.length) return { error: new FileError("INVALID", "Attach at least one file.") };
  return { files };
}

/**
 * Mounts upload, list, signed-link and delete for files on every configured record type.
 *
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} opts
 * @param {Record<string, { exists: (ids: string[]) => Promise<Set<string>> }>} opts.recordTypes
 * @param {Function|Function[]} opts.staffGuard preHandler(s) for every route
 * @param {(request, file) => void} [opts.onRead] called when a signed link is issued (the app audit-logs it; ids only)
 * @param {(request, file) => void} [opts.onChange] called after an upload or delete (ids only)
 * @param {object} [opts.service] defaults to ./service.js (tests pass a stub)
 */
export async function recordFileRoutes(fastify, { recordTypes, staffGuard, onRead, onChange, service = defaultService }) {
  const staff = asArray(staffGuard);

  // An unknown :recordType is a 404 before anything else runs; so is a record that does not exist.
  const knownRecord = async (request, reply) => {
    const { recordType, recordId } = request.params;
    if (!Object.hasOwn(recordTypes, recordType)) return notFound(reply, "Unknown record type.");
    const found = await recordTypes[recordType].exists([recordId]);
    if (!found.has(recordId)) return notFound(reply, "Record not found.");
  };

  const run = async (reply, fn, status = 200) => {
    try {
      return reply.code(status).send({ data: await fn() });
    } catch (err) {
      const r = fileErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  };

  // The file must belong to the record in the URL, or it is a 404 (no probing by file id).
  const ownFile = async (request) => {
    const { recordType, recordId, fileId } = request.params;
    const file = await service.getFile(fileId);
    if (file.recordType !== recordType || file.recordId !== recordId) throw new FileError("NOT_FOUND", "File not found.");
    return file;
  };

  fastify.get("/files/:recordType/:recordId", { preHandler: [...staff, knownRecord] }, (request, reply) =>
    run(reply, async () => {
      const { recordType, recordId } = request.params;
      return (await service.filesFor(recordType, [recordId])).get(recordId) ?? [];
    }));

  fastify.post("/files/:recordType/:recordId", { preHandler: [...staff, knownRecord] }, async (request, reply) => {
    const { recordType, recordId } = request.params;
    const { files, error } = await readUploads(request);
    if (error) {
      const r = fileErrorReply(error);
      return reply.code(r.status).send(r.body);
    }
    return run(reply, async () => {
      const rows = await service.attachFiles({ recordType, recordId, files, byUserId: request.user?.id });
      onChange?.(request, { action: "added", recordType, recordId, fileIds: rows.map((r) => r.id) });
      return rows;
    }, 201);
  });

  fastify.get("/files/:recordType/:recordId/:fileId/url", { preHandler: [...staff, knownRecord] }, (request, reply) =>
    run(reply, async () => {
      await ownFile(request);
      const { url, file } = await service.signedUrlFor(request.params.fileId);
      onRead?.(request, file);
      return { url, file };
    }));

  fastify.delete("/files/:recordType/:recordId/:fileId", { preHandler: [...staff, knownRecord] }, (request, reply) =>
    run(reply, async () => {
      const file = await ownFile(request);
      await service.removeFile(file.id);
      onChange?.(request, { action: "removed", recordType: file.recordType, recordId: file.recordId, fileIds: [file.id] });
      return { id: file.id };
    }));
}
