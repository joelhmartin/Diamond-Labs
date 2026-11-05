import { INTAKE_SPLITS, MAX_FILE_SIZE_BYTES, RECORD_FILES_MAX_COUNT, intakeListQuerySchema, intakeDiscardSchema } from "@my-app/shared";
import { validate, validateQuery } from "../../middleware/validate.js";
import * as defaultService from "./service.js";
import { IntakeError } from "./rules.js";

const STATUS = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 422, TOO_LARGE: 413 };
const MB = 1024 * 1024;

/** IntakeError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function intakeErrorReply(err) {
  if (!(err instanceof IntakeError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

const asArray = (g) => (Array.isArray(g) ? g : [g]);

/** Reads the multipart body: every file part (any field name) and the `split` field. */
async function readDrop(request) {
  const files = [];
  let split = "one";
  try {
    for await (const part of request.parts({ limits: { fileSize: MAX_FILE_SIZE_BYTES, files: RECORD_FILES_MAX_COUNT } })) {
      if (part.type !== "file") {
        if (part.fieldname === "split") split = String(part.value);
        continue;
      }
      let buffer;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        if (err?.code === "FST_REQ_FILE_TOO_LARGE") return { error: new IntakeError("TOO_LARGE", `File "${part.filename}" exceeds the ${MAX_FILE_SIZE_BYTES / MB} MB size limit.`) };
        throw err;
      }
      files.push({ kind: "scan", buffer, originalName: part.filename || `upload-${Date.now()}`, contentType: part.mimetype || null });
    }
  } catch (err) {
    if (err?.code === "FST_FILES_LIMIT") return { error: new IntakeError("TOO_LARGE", `Too many files, maximum ${RECORD_FILES_MAX_COUNT} per drop.`) };
    if (err?.code === "FST_REQ_FILE_TOO_LARGE") return { error: new IntakeError("TOO_LARGE", `A file exceeds the ${MAX_FILE_SIZE_BYTES / MB} MB size limit.`) };
    throw err;
  }
  if (!INTAKE_SPLITS.includes(split)) return { error: new IntakeError("INVALID", "Unknown split.") };
  if (!files.length) return { error: new IntakeError("INVALID", "Attach at least one file.") };
  return { files, split };
}

/**
 * Mounts the drop, the queue and discard.
 *
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} opts
 * @param {Function|Function[]} opts.staffGuard preHandler(s) for every route
 * @param {string} [opts.path] defaults to "/intake"
 * @param {(request, intakes: object[]) => void|Promise<void>} [opts.onCreated] called after a drop made intakes (ids only; the app notifies)
 * @param {(request, id: string) => void} [opts.onDiscarded] called after a discard (the app audit-logs it)
 * @param {(rows: object[]) => Promise<object[]>} [opts.enrich] decorates listed rows (e.g. adds who dropped them)
 * @param {object} [opts.service] defaults to ./service.js (tests pass a stub)
 */
export async function intakeRoutes(fastify, { staffGuard, path = "/intake", onCreated, onDiscarded, enrich, service = defaultService }) {
  const staff = asArray(staffGuard);

  const run = async (reply, fn, status = 200) => {
    try {
      return reply.code(status).send({ data: await fn() });
    } catch (err) {
      const r = intakeErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  };

  fastify.post(path, { preHandler: staff }, async (request, reply) => {
    const { files, split, error } = await readDrop(request);
    if (error) {
      const r = intakeErrorReply(error);
      return reply.code(r.status).send(r.body);
    }
    return run(reply, async () => {
      const out = await service.createIntakes({ files, split, channel: "upload", byUserId: request.user?.id });
      // The drop already succeeded: a failing hook (notification, audit) must not turn it into a 500.
      if (out.intakes.length) {
        try {
          await onCreated?.(request, out.intakes);
        } catch (err) {
          console.error("[upload-intake] onCreated hook failed", { intakeIds: out.intakes.map((i) => i.id), message: err?.message });
        }
      }
      return out;
    }, 201);
  });

  fastify.get(path, { preHandler: [...staff, validateQuery(intakeListQuerySchema)] }, (request, reply) =>
    run(reply, async () => {
      const { status, limit, offset } = request.query;
      const out = await service.listIntakes({ status, limit, offset });
      return { rows: enrich ? await enrich(out.rows) : out.rows, total: out.total };
    }));

  fastify.post(`${path}/:id/discard`, { preHandler: [...staff, validate(intakeDiscardSchema)] }, (request, reply) =>
    run(reply, async () => {
      const out = await service.discardIntake(request.params.id, { reason: request.body?.reason, byUserId: request.user?.id });
      onDiscarded?.(request, request.params.id);
      return out;
    }));
}
