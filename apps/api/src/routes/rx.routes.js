import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseFiles } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { eq, desc } from "drizzle-orm";
import { ERROR_CODES, rxCaseSubmitSchema } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";
import { buildSeazonaOrderPayload } from "../services/rx/build-order-payload.js";
import { uploadCaseFile } from "../services/storage.service.js";

// ─── Upload guards ────────────────────────────────────────────────────────────
// 20 MB per file — consistent with storage.service.js local-disk path.
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
// Sane total-file cap to prevent abuse; individual file-kind names gate further.
const MAX_FILES = 20;

// The five allowed file field names, each mapping directly to the rx_case_files.kind column.
const FILE_FIELD_KINDS = new Set(["scan", "photo", "prescription", "sleep_study", "artboard"]);

export default async function rxRoutes(fastify) {
  // ─────────────────────────────────────────────────────────────────────────
  // POST /rx/cases — submit a new Digital Rx case (multipart/form-data).
  //
  // Text fields mirror rxCaseSubmitSchema. Two fields arrive as JSON strings
  // and are parsed before schema validation: deviceOptions, shipTo.
  // File parts must use one of the five recognised field names
  // (scan | photo | prescription | sleep_study | artboard) — unrecognised
  // parts are silently drained and ignored.
  //
  // seazonaClientId and seazonaAccountNumber come from the authenticated
  // doctor's account row and are NEVER accepted from the request body.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post("/rx/cases", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "Content-Type must be multipart/form-data.",
        },
      });
    }

    const fields = {};
    const pendingFiles = []; // collected file descriptors before upload
    let fileCount = 0;

    // ── Parse parts ──────────────────────────────────────────────────────────
    for await (const part of request.parts({
      limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES },
    })) {
      if (part.type === "file") {
        const kind = FILE_FIELD_KINDS.has(part.fieldname) ? part.fieldname : null;
        if (!kind) {
          // Drain unrecognised file streams — the multipart parser stalls if
          // file streams are not consumed.
          await part.toBuffer().catch(() => {});
          continue;
        }
        fileCount++;
        if (fileCount > MAX_FILES) {
          // Drain the current part before responding so the stream is closed cleanly.
          await part.toBuffer().catch(() => {});
          return reply.code(413).send({
            error: {
              ...ERROR_CODES.VALIDATION_ERROR,
              message: `Too many files — maximum ${MAX_FILES} allowed per submission.`,
            },
          });
        }
        let buffer;
        try {
          buffer = await part.toBuffer();
        } catch {
          // @fastify/multipart throws when the file exceeds the configured limit.
          return reply.code(413).send({
            error: {
              ...ERROR_CODES.VALIDATION_ERROR,
              message: `File "${part.filename || part.fieldname}" exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit.`,
            },
          });
        }
        pendingFiles.push({
          kind,
          buffer,
          originalName: part.filename || `upload-${Date.now()}`,
          contentType: part.mimetype || null,
        });
      } else {
        // Text field
        fields[part.fieldname] = part.value;
      }
    }

    // ── Pre-process JSON-encoded fields ──────────────────────────────────────
    // The wizard serialises these as JSON.stringify() strings in the form body.
    if (typeof fields.deviceOptions === "string") {
      try { fields.deviceOptions = JSON.parse(fields.deviceOptions); }
      catch { fields.deviceOptions = {}; }
    }
    if (typeof fields.shipTo === "string") {
      try { fields.shipTo = JSON.parse(fields.shipTo); }
      catch { delete fields.shipTo; }
    }
    // Multipart form data is always strings; coerce rush to boolean.
    if (typeof fields.rush === "string") {
      fields.rush = fields.rush === "true" || fields.rush === "1";
    }

    // ── Validate ─────────────────────────────────────────────────────────────
    const parsed = rxCaseSubmitSchema.safeParse(fields);
    if (!parsed.success) {
      const messages = Object.values(parsed.error.flatten().fieldErrors)
        .flat()
        .join("; ");
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: messages || "Validation failed.",
        },
      });
    }
    const data = parsed.data;

    // ── Identity — from the authenticated doctor, never the form body ─────────
    const { id: userId, seazonaClientId, seazonaAccountNumber } = request.user;

    // Generate caseId BEFORE uploads so the GCS path is keyed by it.
    const caseId = createId();
    const caseNumber = `RX-${createId().slice(0, 12).toUpperCase()}`;

    // ── Upload files ──────────────────────────────────────────────────────────
    const uploadedFiles = [];
    for (const pf of pendingFiles) {
      const { gcsUrl, size } = await uploadCaseFile({
        caseId,
        kind: pf.kind,
        buffer: pf.buffer,
        originalName: pf.originalName,
        contentType: pf.contentType,
      });
      uploadedFiles.push({
        id: createId(),
        caseId,
        kind: pf.kind,
        originalName: pf.originalName,
        gcsUrl,
        contentType: pf.contentType || null,
        size: String(size),
      });
    }

    // ── Persist in a single transaction ──────────────────────────────────────
    await db.transaction(async (tx) => {
      await tx.insert(rxCases).values({
        id: caseId,
        caseNumber,
        userId,
        seazonaClientId: seazonaClientId || null,
        seazonaAccountNumber: seazonaAccountNumber || null,
        patientFirst: data.patientFirst,
        patientLast: data.patientLast,
        dob: data.dob || null,
        gender: data.gender || null,
        firstDevice: data.firstDevice || null,
        contactPhone: data.contactPhone || null,
        shipTo: data.shipTo || null,
        recordsMethod: data.recordsMethod || null,
        physicalBite: data.physicalBite || null,
        deviceKey: data.deviceKey,
        deviceCategory: data.deviceCategory,
        deviceOptions: data.deviceOptions ?? {},
        dueDate: data.dueDate || null,
        rush: data.rush ?? false,
        rushTier: data.rushTier || null,
        signatureUrl: data.signatureUrl || null,
        generalComments: data.generalComments || null,
        // status defaults to 'pending_approval' at the schema level
      });
      if (uploadedFiles.length > 0) {
        await tx.insert(rxCaseFiles).values(uploadedFiles);
      }
    });

    request.log.info(
      { caseId, caseNumber, userId, fileCount: uploadedFiles.length },
      "rx case submitted"
    );
    return reply.code(201).send({ data: { id: caseId, caseNumber, status: "pending_approval" } });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /rx/cases — list all cases belonging to the current doctor, newest first.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get("/rx/cases", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const cases = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.userId, request.user.id))
      .orderBy(desc(rxCases.createdAt));
    return { data: cases };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /rx/cases/:id — single case + its files.
  // Returns 404 if not found, 403 if the case belongs to a different doctor.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get("/rx/cases/:id", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const [caseRow] = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.id, request.params.id));

    if (!caseRow) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }
    if (caseRow.userId !== request.user.id) {
      return reply.code(403).send({ error: ERROR_CODES.FORBIDDEN });
    }

    const files = await db
      .select()
      .from(rxCaseFiles)
      .where(eq(rxCaseFiles.caseId, caseRow.id));

    return { data: { ...caseRow, files } };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /rx/cases/:id/approve — build the Seazona order payload and,
  // when RX_LIVE_PUSH=true, push it; otherwise run dry.
  //
  // Status gate: only `pending_approval` cases can be approved (409 otherwise).
  // Ownership gate: the requesting doctor must own the case.
  //
  // DRY-RUN behaviour (default — RX_LIVE_PUSH unset or not "true"):
  //   Sets seazonaPushStatus = "push_skipped_dryrun". Never calls createOrder.
  //   The payload is saved as payloadSnapshot so the admin can inspect it.
  //
  // LIVE_PUSH behaviour (RX_LIVE_PUSH=true — set only in production, explicitly):
  //   TODO: call seazonaService.createOrder(payload) here. The branch is
  //   clearly marked below. The RX_LIVE_PUSH gate ensures this path is dark
  //   until the lab confirms the staff userId and we've validated the payload
  //   shape end-to-end. Mirrors the gated pattern used by /payments/checkout.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post("/rx/cases/:id/approve", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const [caseRow] = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.id, request.params.id));

    if (!caseRow) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }
    if (caseRow.userId !== request.user.id) {
      return reply.code(403).send({ error: ERROR_CODES.FORBIDDEN });
    }
    if (caseRow.status !== "pending_approval") {
      return reply.code(409).send({
        error: {
          code: "CASE_NOT_PENDING",
          status: 409,
          message: `Case is already in '${caseRow.status}' status and cannot be approved again.`,
        },
      });
    }

    // ── Build codeToId from live Seazona product list ─────────────────────────
    // listProducts() returns [] if Seazona is unreachable (soft-fail).
    const products = await seazonaService.listProducts();
    const extraWarnings = [];
    let codeToId = {};
    if (products.length === 0) {
      extraWarnings.push(
        "Seazona products unavailable — payload built without catalog code→id mapping."
      );
    } else {
      for (const p of products) {
        if (p.code) codeToId[p.code] = String(p.id);
      }
    }

    // ── Build payload ─────────────────────────────────────────────────────────
    const { payload, warnings: buildWarnings } = buildSeazonaOrderPayload(caseRow, {
      codeToId,
      userId: env.SEAZONA_ORDER_USER_ID,
    });
    const warnings = [...extraWarnings, ...buildWarnings];

    // ── DRY-RUN gate ──────────────────────────────────────────────────────────
    let seazonaPushStatus;
    let seazonaOrderId = null;

    if (env.RX_LIVE_PUSH !== "true") {
      // DRY-RUN: persist the payload snapshot but do NOT push to Seazona.
      seazonaPushStatus = "push_skipped_dryrun";
    } else {
      // TODO [RX_LIVE_PUSH]: call Seazona createOrder when gate is opened.
      // This branch is unreachable until RX_LIVE_PUSH is explicitly set to "true".
      //
      //   const res = await seazonaService.createOrder(payload);
      //   seazonaOrderId = res?.orderId ? String(res.orderId) : null;
      //   seazonaPushStatus = seazonaOrderId ? "pushed" : "push_failed";
      //   if (!seazonaOrderId) {
      //     request.log.error({ caseId: caseRow.id, payload },
      //       "[Seazona][RX_ORDER_FAILED] createOrder returned no orderId — manual entry required");
      //   }
      //
      // For now: treat as dry-run so flipping the env var doesn't silently call Seazona
      // before the TODO implementation is in place.
      seazonaPushStatus = "push_skipped_dryrun";
    }

    // ── Persist approval ──────────────────────────────────────────────────────
    await db
      .update(rxCases)
      .set({
        status: "approved",
        payloadSnapshot: payload,
        seazonaPushStatus,
        seazonaOrderId,
        updatedAt: new Date(),
      })
      .where(eq(rxCases.id, caseRow.id));

    request.log.info(
      { caseId: caseRow.id, seazonaPushStatus, warningCount: warnings.length },
      "rx case approved"
    );
    return { data: { payload, warnings, status: "approved", seazonaPushStatus } };
  });
}
