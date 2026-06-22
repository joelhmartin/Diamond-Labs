import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseFiles } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { eq, desc, and } from "drizzle-orm";
import { ERROR_CODES, rxCaseSubmitSchema, rxFormSubmitSchema } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";
import { buildSeazonaOrderPayload } from "../services/rx/build-order-payload.js";
import { uploadCaseFile, deleteStoredFile } from "../services/storage.service.js";

// ─── Upload guards ────────────────────────────────────────────────────────────
// 75 MB per file — intraoral STL / 3D-scan files are large.
const MAX_FILE_SIZE_BYTES = 75 * 1024 * 1024;
// Sane total-file cap to prevent abuse; individual file-kind names gate further.
const MAX_FILES = 12;
// Cumulative cap across all files in a single submission, scaled to the per-file
// limit so it never undercuts a single large STL upload.
const MAX_TOTAL_BYTES = MAX_FILES * MAX_FILE_SIZE_BYTES;

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
    let totalBytes = 0;
    // Flag-based early exit: setting this and breaking lets the async iterator
    // close cleanly (calls iterator.return()), draining remaining parts and
    // preventing client connection resets instead of an in-loop early return.
    let limitError = null;

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
          // Drain the oversized part's buffer before breaking so the stream is
          // in a clean state when the iterator is closed.
          await part.toBuffer().catch(() => {});
          limitError = `Too many files — maximum ${MAX_FILES} allowed per submission.`;
          break;
        }

        let buffer;
        try {
          buffer = await part.toBuffer();
        } catch {
          // @fastify/multipart throws when the file exceeds the configured limit.
          // The current part's stream was consumed up to the limit; break so the
          // iterator closes the remaining parts cleanly.
          limitError = `File "${part.filename || part.fieldname}" exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit.`;
          break;
        }

        totalBytes += buffer.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          limitError = `Total upload size exceeds the ${MAX_TOTAL_BYTES / (1024 * 1024)} MB limit.`;
          break;
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

    if (limitError) {
      return reply.code(413).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: limitError,
        },
      });
    }

    // ── Pre-process JSON-encoded fields ──────────────────────────────────────
    // The wizard serialises these as JSON.stringify() strings in the form body.
    // A malformed value is a client error — return 422 rather than silently
    // substituting {} / dropping the field, which would discard doctor data.
    if (typeof fields.deviceOptions === "string") {
      try { fields.deviceOptions = JSON.parse(fields.deviceOptions); }
      catch {
        return reply.code(422).send({
          error: { ...ERROR_CODES.VALIDATION_ERROR, message: "deviceOptions is not valid JSON." },
        });
      }
    }
    if (typeof fields.shipTo === "string") {
      try { fields.shipTo = JSON.parse(fields.shipTo); }
      catch {
        return reply.code(422).send({
          error: { ...ERROR_CODES.VALIDATION_ERROR, message: "shipTo is not valid JSON." },
        });
      }
    }
    // Multipart form data is always strings; coerce rush to boolean.
    if (typeof fields.rush === "string") {
      fields.rush = fields.rush === "true" || fields.rush === "1";
    }

    // ── Validate ─────────────────────────────────────────────────────────────
    // Belt-and-suspenders: strip identity fields that MUST come from request.user,
    // never from the submitted form body (enforced again at line 129 below).
    delete fields.seazonaClientId;
    delete fields.seazonaAccountNumber;

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

    // ── Upload files + persist ───────────────────────────────────────────────
    // The upload loop and the DB transaction share ONE try block: if any upload
    // throws, already-uploaded files are cleaned up in the catch just as they
    // would be for a transaction failure, preventing GCS orphans either way.
    const uploadedFiles = [];
    try {
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
          practiceName: data.practiceName || null,
          signatureUrl: data.signatureUrl || null,
          generalComments: data.generalComments || null,
          // status defaults to 'pending_approval' at the schema level
        });
        if (uploadedFiles.length > 0) {
          await tx.insert(rxCaseFiles).values(uploadedFiles);
        }
      });
    } catch (err) {
      // Best-effort cleanup of any files already uploaded before the failure.
      await Promise.allSettled(uploadedFiles.map((f) => deleteStoredFile(f.gcsUrl)));
      request.log.error(
        { caseId, fileCount: uploadedFiles.length, err: err.message },
        "rx case upload/transaction failed; orphan cleanup attempted"
      );
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to save case. Please try again." },
      });
    }

    request.log.info(
      { caseId, caseNumber, userId, fileCount: uploadedFiles.length },
      "rx case submitted"
    );
    return reply.code(201).send({ data: { id: caseId, caseNumber, status: "pending_approval" } });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /rx/form-submissions — generic intake for the faithful 1:1 forms
  // (digital | ortho | olmos). Multipart/form-data, mirroring /rx/cases for
  // auth, file limits, upload, and atomic insert.
  //
  // Frontend (buildSubmitFormData in apps/web/src/data/forms/form-logic.js)
  // emits these parts:
  //   text   formType         — one of digital | ortho | olmos
  //   text   patientFirst     — extracted from the patient fullname field
  //   text   patientLast
  //   text   formData         — JSON string of ALL non-file answers
  //   file   file             — fileUpload files + artboard PNG blobs (0..n)
  //   file   signature        — the signature pad PNG blob (data-URL → Blob)
  //
  // The `signature` part may instead arrive as a text field (a PNG data-URL
  // string) depending on the caller; both shapes are accepted and resolved to
  // `signatureUrl`. dueDate is read from the top-level field or formData.dueDate.
  //
  // INTAKE-ONLY: this endpoint NEVER calls Seazona and NEVER touches device
  // mapping. It writes one rx_cases row with formType/formData and null device
  // columns, plus rx_case_files rows for uploaded `file` parts.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post("/rx/form-submissions", {
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
    const pendingFiles = []; // collected file descriptors before upload (kind "upload")
    let signaturePending = null; // a `signature` file part, if sent as a blob
    let fileCount = 0;
    let totalBytes = 0;
    let limitError = null;

    // ── Parse parts ──────────────────────────────────────────────────────────
    for await (const part of request.parts({
      limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES },
    })) {
      if (part.type === "file") {
        // Only `file` (uploads/artboards) and `signature` parts are recognised;
        // any other file stream is drained so the multipart parser doesn't stall.
        const isUpload = part.fieldname === "file";
        const isSignature = part.fieldname === "signature";
        if (!isUpload && !isSignature) {
          await part.toBuffer().catch(() => {});
          continue;
        }

        fileCount++;
        if (fileCount > MAX_FILES) {
          await part.toBuffer().catch(() => {});
          limitError = `Too many files — maximum ${MAX_FILES} allowed per submission.`;
          break;
        }

        let buffer;
        try {
          buffer = await part.toBuffer();
        } catch {
          limitError = `File "${part.filename || part.fieldname}" exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit.`;
          break;
        }

        totalBytes += buffer.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          limitError = `Total upload size exceeds the ${MAX_TOTAL_BYTES / (1024 * 1024)} MB limit.`;
          break;
        }

        const descriptor = {
          buffer,
          originalName: part.filename || `${part.fieldname}-${Date.now()}`,
          contentType: part.mimetype || null,
        };
        if (isSignature) {
          signaturePending = descriptor;
        } else {
          pendingFiles.push({ kind: "upload", ...descriptor });
        }
      } else {
        // Text field
        fields[part.fieldname] = part.value;
      }
    }

    if (limitError) {
      return reply.code(413).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: limitError },
      });
    }

    // ── Parse the JSON-encoded formData blob ──────────────────────────────────
    let formData = {};
    if (typeof fields.formData === "string" && fields.formData.length > 0) {
      try {
        formData = JSON.parse(fields.formData);
      } catch {
        return reply.code(422).send({
          error: { ...ERROR_CODES.VALIDATION_ERROR, message: "formData is not valid JSON." },
        });
      }
    } else if (fields.formData && typeof fields.formData === "object") {
      formData = fields.formData;
    }

    // Assemble the object to validate. signatureUrl comes from the text field
    // when present (data URL); a signature blob is resolved to a URL after upload.
    // dueDate falls back to formData.dueDate.
    const assembled = {
      formType: fields.formType,
      patientFirst: fields.patientFirst,
      patientLast: fields.patientLast,
      formData,
      dueDate: fields.dueDate || (formData && formData.dueDate) || undefined,
    };
    if (typeof fields.signature === "string" && fields.signature.length > 0) {
      assembled.signatureUrl = fields.signature;
    }

    const parsed = rxFormSubmitSchema.safeParse(assembled);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "Validation failed.",
          issues: parsed.error.issues,
        },
      });
    }
    const data = parsed.data;

    // ── Identity — from the authenticated doctor, never the form body ─────────
    const { id: userId, seazonaClientId, seazonaAccountNumber } = request.user;

    const caseId = createId();
    const caseNumber = `RX-${createId().slice(0, 12).toUpperCase()}`;

    // ── Upload files + persist (shared try block → orphan-safe cleanup) ───────
    const uploadedFiles = [];
    let signatureUrl = data.signatureUrl || null;
    try {
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

      // Signature blob (if any) → upload and use its URL as signatureUrl.
      if (signaturePending) {
        const { gcsUrl } = await uploadCaseFile({
          caseId,
          kind: "signature",
          buffer: signaturePending.buffer,
          originalName: signaturePending.originalName,
          contentType: signaturePending.contentType,
        });
        // Track for cleanup on a later failure, even though it's not a
        // rx_case_files row (it maps to the signatureUrl column).
        uploadedFiles.push({ gcsUrl, _signatureOnly: true });
        signatureUrl = gcsUrl;
      }

      await db.transaction(async (tx) => {
        await tx.insert(rxCases).values({
          id: caseId,
          caseNumber,
          userId,
          seazonaClientId: seazonaClientId || null,
          seazonaAccountNumber: seazonaAccountNumber || null,
          patientFirst: data.patientFirst,
          patientLast: data.patientLast,
          formType: data.formType,
          formData: data.formData ?? {},
          deviceKey: null,
          deviceCategory: null,
          deviceOptions: {},
          dueDate: data.dueDate || null,
          signatureUrl,
          status: "pending_approval",
        });
        const fileRows = uploadedFiles.filter((f) => !f._signatureOnly);
        if (fileRows.length > 0) {
          await tx.insert(rxCaseFiles).values(fileRows);
        }
      });
    } catch (err) {
      await Promise.allSettled(uploadedFiles.map((f) => deleteStoredFile(f.gcsUrl)));
      request.log.error(
        { caseId, fileCount: uploadedFiles.length, err: err.message },
        "rx form submission upload/transaction failed; orphan cleanup attempted"
      );
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to save submission. Please try again." },
      });
    }

    request.log.info(
      { caseId, caseNumber, userId, formType: data.formType, fileCount: pendingFiles.length },
      "rx form submission saved"
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
  // Returns 404 for both missing cases and cases owned by another doctor
  // (conservative: don't reveal that a case id exists for a different doctor).
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
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
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
    // 404 (not 403) for another doctor's case — don't reveal that the id exists.
    if (caseRow.userId !== request.user.id) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
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

    // ── Persist approval (ATOMIC) ─────────────────────────────────────────────
    // Fold the status predicate into the WHERE so two concurrent approves can't
    // both pass the earlier app-level check and double-process (TOCTOU). Only the
    // request that actually flips pending_approval → approved proceeds; a loser
    // gets 409. Critical once the RX_LIVE_PUSH branch calls createOrder.
    const updated = await db
      .update(rxCases)
      .set({
        status: "approved",
        payloadSnapshot: payload,
        seazonaPushStatus,
        seazonaOrderId,
        updatedAt: new Date(),
      })
      .where(and(eq(rxCases.id, caseRow.id), eq(rxCases.status, "pending_approval")))
      .returning({ id: rxCases.id });

    if (updated.length === 0) {
      return reply.code(409).send({
        error: {
          code: "CASE_NOT_PENDING",
          status: 409,
          message: "Case is no longer pending approval (already approved or being approved).",
        },
      });
    }

    request.log.info(
      { caseId: caseRow.id, seazonaPushStatus, warningCount: warnings.length },
      "rx case approved"
    );
    return { data: { payload, warnings, status: "approved", seazonaPushStatus } };
  });
}
