import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseFiles, rxCaseLines } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { eq, desc, and, ne, or, isNull, asc } from "drizzle-orm";
import { ERROR_CODES, rxCaseSubmitSchema, rxFormSubmitSchema, buildDigitalDevices } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";
import { seedLines } from "../services/rx/case-lines.service.js";
import { loadOverrides } from "../services/rx/code-overrides.service.js";
import { canPush, summariseLines } from "../services/rx/case-gates.js";
import { pushCaseToSeazona } from "../services/rx/push-case.service.js";
import { uploadCaseFile, deleteStoredFile, getSignedReadUrl } from "../services/storage.service.js";
import { encryptRxPhi, decryptRxPhi } from "../services/rx/phi-crypto.js";
import { encryptJson } from "../lib/crypto.js";
import * as auditService from "../services/audit.service.js";
import { sendRxSubmissionReceived } from "../services/email.service.js";

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

// The status a freshly-submitted case is written with. Exported so a test can
// pin it against admin-rx-cases.routes.js's DEFAULT_QUEUE_STATUSES — those two
// have to agree, or the admin queue silently shows nothing (the exact defect
// this constant exists to catch: rx_cases.status used to default to
// 'pending_approval' at the schema level while nothing ever queried for that
// value, so the queue could never return a row).
export const SUBMISSION_STATUS = "new";

/**
 * Whether a freshly-submitted case should attempt its own Seazona push.
 * Exact-match on "true" only — a truthy-but-wrong string ("1", "TRUE", any
 * other value) must never enable it, and a missing/unparseable env var must
 * always resolve to `false`. Seazona has no idempotency key, so an
 * accidental auto-push is a real manufacturing order a human has to go find
 * and delete — the off state is the one this ships in, and it must stay the
 * default no matter how the env var is malformed.
 */
export function shouldAutoPush(flag) {
  return flag === "true";
}

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
        // Encrypt PHI columns at rest (patientFirst/Last, dob, contactPhone,
        // generalComments, and the shipTo/deviceOptions JSON blobs).
        await tx.insert(rxCases).values(encryptRxPhi({
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
          status: SUBMISSION_STATUS,
        }));
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
    auditService.logSafe({
      userId: request.user.id,
      action: "rx.create",
      targetType: "rx_case",
      targetId: caseId,
      metadata: { caseNumber, fileCount: uploadedFiles.length },
      ipAddress: request.ip,
    });
    return reply.code(201).send({ data: { id: caseId, caseNumber, status: SUBMISSION_STATUS } });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /rx/form-submissions — generic intake for the faithful 1:1 form.
  // There is ONE form now: ortho folded into the digital Rx as a gated device
  // rather than a separate formType, so the schema is z.enum(["digital"]).
  // Multipart/form-data, mirroring /rx/cases for auth, file limits, upload,
  // and atomic insert.
  //
  // Frontend (buildSubmitFormData in apps/web/src/data/forms/form-logic.js)
  // emits these parts:
  //   text   formType         — "digital" (the only accepted value)
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
    // Hoisted out of the try block below so it's still in scope afterward,
    // for the auto-push + arrival-email steps.
    let devices = [];
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

      // Resolve the doctor's selections into devices so the case is reviewable.
      // rx_cases carries one deviceKey for display; the full list lives in
      // deviceOptions.devices so a multi-device prescription loses nothing.
      devices = buildDigitalDevices(data.formData ?? {});

      // Load admin-confirmed code overrides once, before the transaction opens
      // (not per-device) — same loader admin-rx-mapping.routes.js uses.
      const overrides = await loadOverrides();

      await db.transaction(async (tx) => {
        // Encrypt PHI columns at rest (patientFirst/Last + the formData blob).
        await tx.insert(rxCases).values(encryptRxPhi({
          id: caseId,
          caseNumber,
          userId,
          seazonaClientId: seazonaClientId || null,
          seazonaAccountNumber: seazonaAccountNumber || null,
          // Same source the arrival email uses, so the queue row and the
          // email about it never disagree. This route's payload carries no
          // practice name of its own, and the submitting doctor is the best
          // "who sent this" available without a memberships join in the
          // submit path — see follow-up 9 for using accounts.name properly.
          practiceName: request.user.name || null,
          patientFirst: data.patientFirst,
          patientLast: data.patientLast,
          formType: data.formType,
          formData: data.formData ?? {},
          deviceKey: devices[0]?.deviceKey ?? null,
          deviceCategory: null,
          deviceOptions: { devices },
          dueDate: data.dueDate || null,
          signatureUrl,
          status: SUBMISSION_STATUS,
        }));
        const fileRows = uploadedFiles.filter((f) => !f._signatureOnly);
        if (fileRows.length > 0) {
          await tx.insert(rxCaseFiles).values(fileRows);
        }

        // Materialise the order now so the queue can show "4 lines · 1 unmapped"
        // without recomputing, and so staff have something to edit.
        await seedLines(caseId, devices, { overrides, tx });
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
    auditService.logSafe({
      userId: request.user.id,
      action: "rx.create",
      targetType: "rx_case",
      targetId: caseId,
      metadata: { caseNumber, formType: data.formType, fileCount: pendingFiles.length },
      ipAddress: request.ip,
    });

    // The case is fully persisted at this point (row + files + seeded
    // lines) regardless of anything below — auto-push and the arrival email
    // are additions on top of a submission that has already succeeded, and
    // neither may fail the doctor's response.
    const lines = await db
      .select()
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(asc(rxCaseLines.position));

    // ── Auto-push under RX_LIVE_PUSH ───────────────────────────────────────
    // Off by default (shouldAutoPush requires an exact "true"). Seazona has
    // no idempotency key, so an accidental push here is a real order a human
    // has to go find and delete — reuses pushCaseToSeazona, the SAME send
    // path the admin queue's manual push button uses, rather than a second
    // implementation of the send. Every branch below leaves the case
    // visible: an unresolved line leaves it "new" for the queue (canPush
    // gate — see push-case.service.js), and any push failure leaves it
    // "failed" for the queue — it must never vanish or stay silently "new"
    // with no explanation.
    //
    // Claim: the SAME conditional-update predicate
    // POST /admin/rx-cases/:id/push uses (status != 'pushed' AND
    // (seazonaPushStatus is null OR != 'pushing')), mirrored exactly rather
    // than reimplemented — two hand-written copies of a duplicate-order
    // guard is how they drift apart. Without this, a submission that
    // auto-pushes races the admin queue: an admin can click Push while this
    // request is still mid-flight, see seazonaPushStatus still null, win
    // their own claim, and createOrder runs twice — a real duplicate
    // manufacturing order with no idempotency key to catch it. If the claim
    // is lost, this is not a failure — a human (or another request) already
    // owns this case's push, so skip and leave the case exactly as it is for
    // the queue; do not error the doctor's submission over it.
    let finalStatus = SUBMISSION_STATUS;
    if (shouldAutoPush(env.RX_LIVE_PUSH)) {
      if (!env.SEAZONA_ORDER_USER_ID) {
        // Same hard precondition the admin push route 503s on. No status
        // written — the case just stays "new", waiting for a human to push
        // it once the config is fixed, same as any other unresolved case.
        request.log.error(
          { caseId },
          "[Seazona][RX_AUTO_PUSH_SKIPPED] RX_LIVE_PUSH is on but SEAZONA_ORDER_USER_ID is not configured"
        );
      } else {
        const gate = canPush(lines);
        if (!gate.ok) {
          // status stays "new" — it is waiting for a person, not broken.
          request.log.info(
            { caseId, reason: gate.reason },
            "rx auto-push skipped: case has unresolved lines"
          );
        } else {
          try {
            // Take the claim BEFORE calling Seazona — same "pushing"
            // sentinel and predicate as admin-rx-cases.routes.js's push
            // route, mirrored exactly.
            const claimed = await db.update(rxCases)
              .set({ seazonaPushStatus: "pushing", updatedAt: new Date() })
              .where(and(
                eq(rxCases.id, caseId),
                ne(rxCases.status, "pushed"),
                or(isNull(rxCases.seazonaPushStatus), ne(rxCases.seazonaPushStatus, "pushing")),
              ))
              .returning({ id: rxCases.id });

            if (claimed.length === 0) {
              // Lost the race — something else already claimed or resolved
              // this case in the moments since the transaction committed.
              // Leave it untouched; whichever push already owns it will
              // record the outcome.
              request.log.info(
                { caseId },
                "rx auto-push skipped: case already claimed or resolved"
              );
            } else {
              // codeToId from the live Seazona catalog — listProducts() never
              // throws (returns [] if Seazona is unreachable), which then
              // surfaces as "no catalog id for code …" warnings inside
              // pushCaseToSeazona and resolves to a "failed" outcome, same as
              // the admin push route.
              const products = await seazonaService.listProducts();
              const codeToId = {};
              for (const p of products) {
                if (p.code) codeToId[p.code] = String(p.id);
              }
              const caseForPush = {
                id: caseId,
                seazonaClientId: seazonaClientId || null,
                patientFirst: data.patientFirst,
                patientLast: data.patientLast,
                dueDate: data.dueDate || null,
                generalComments: null,
              };
              const outcome = await pushCaseToSeazona(caseForPush, lines, {
                codeToId,
                userId: env.SEAZONA_ORDER_USER_ID,
              });

              const updateValues = {
                status: outcome.status,
                seazonaPushStatus: outcome.status,
                seazonaOrderId: outcome.seazonaOrderId,
                seazonaPushError: outcome.seazonaPushError,
                updatedAt: new Date(),
              };
              if (outcome.status === "pushed") {
                // PHI (embeds patientName) — encrypt at rest, same as the
                // admin push route's snapshot.
                updateValues.payloadSnapshot = encryptJson(outcome.payload);
              }
              // Final write is conditioned on still holding the "pushing"
              // claim taken above — belt-and-suspenders against anything
              // that could otherwise overwrite a concurrently-recorded
              // outcome (e.g. clear-push-lock recovering a stuck case while
              // this request was still mid-flight).
              const [written] = await db.update(rxCases)
                .set(updateValues)
                .where(and(eq(rxCases.id, caseId), eq(rxCases.seazonaPushStatus, "pushing")))
                .returning({ id: rxCases.id });

              if (written) {
                finalStatus = outcome.status;
              } else {
                request.log.error(
                  { caseId, outcome: outcome.status, contactedSeazona: outcome.contactedSeazona },
                  "[Seazona][RX_AUTO_PUSH_LOCK_LOST] auto-push claim was lost before the outcome could be recorded"
                );
              }

              if (outcome.status === "failed") {
                request.log.error(
                  { caseId, error: outcome.seazonaPushError },
                  "[Seazona][RX_AUTO_PUSH_FAILED] auto-push failed on submission"
                );
              }
              auditService.logSafe({
                userId: request.user.id,
                action: "rx_case.auto_pushed",
                targetType: "rx_case",
                targetId: caseId,
                metadata: {
                  outcome: outcome.status,
                  seazonaOrderId: outcome.seazonaOrderId,
                  error: outcome.seazonaPushError,
                },
                ipAddress: request.ip,
              });
            }
          } catch (err) {
            // Defence in depth: pushCaseToSeazona itself never throws, but a
            // DB write failure here must not let the case vanish either —
            // mark it failed so a human finds it in the queue instead of
            // wrongly assuming it's still "new" and unattempted. Still
            // conditioned on the "pushing" claim so this can't stomp a
            // status some other actor already wrote.
            request.log.error(
              { caseId, err: err.message },
              "[Seazona][RX_AUTO_PUSH_ERROR] auto-push threw unexpectedly"
            );
            try {
              const [written] = await db.update(rxCases).set({
                status: "failed",
                seazonaPushStatus: "failed",
                seazonaPushError: err.message || "Auto-push failed unexpectedly.",
                updatedAt: new Date(),
              })
                .where(and(eq(rxCases.id, caseId), eq(rxCases.seazonaPushStatus, "pushing")))
                .returning({ id: rxCases.id });
              if (written) finalStatus = "failed";
            } catch (err2) {
              request.log.error(
                { caseId, err: err2.message },
                "[Seazona][RX_AUTO_PUSH_ERROR] failed to persist failed status after auto-push error"
              );
            }
          }
        }
      }
    }

    // ── Notify the lab a case arrived ──────────────────────────────────────
    // Fires for EVERY successful submission, not just under RX_LIVE_PUSH — a
    // case that auto-pushed above just left the admin queue entirely
    // (DEFAULT_QUEUE_STATUSES excludes "pushed"), so this email may be the
    // only signal staff get that it ever existed. Same non-critical-send
    // pattern as sendAdminApprovalRequest et al.: send() inside
    // email.service.js already catches its own errors and resolves to
    // false rather than throwing, so this can't fail the doctor's response.
    await sendRxSubmissionReceived({
      caseNumber,
      practiceName: request.user.name || null,
      deviceSummary: devices.map((d) => d.label || d.deviceKey).join(", ") || "—",
      unmappedCount: summariseLines(lines).unmappedCount,
      caseUrl: `${env.APP_URL}/admin/rx-cases/${caseId}`,
    });

    return reply.code(201).send({ data: { id: caseId, caseNumber, status: finalStatus } });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /rx/cases — list all cases belonging to the current doctor, newest first.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get("/rx/cases", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const rows = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.userId, request.user.id))
      .orderBy(desc(rxCases.createdAt));
    // Decrypt PHI columns before returning to the owning doctor. Decrypt each
    // row in isolation: a single corrupt / wrong-key row must NOT 500 the whole
    // list and lock the doctor out of every case. A failed row is replaced with
    // a redacted placeholder (PHI nulled, decryptError flag set) so the rest of
    // the list still returns.
    const cases = rows.map((row) => {
      try {
        return decryptRxPhi(row);
      } catch (err) {
        request.log.error({ caseId: row.id, err: err.message }, "rx PHI decrypt failed");
        return {
          ...row,
          patientFirst: null,
          patientLast: null,
          dob: null,
          contactPhone: null,
          generalComments: null,
          shipTo: null,
          formData: null,
          deviceOptions: null,
          payloadSnapshot: null,
          decryptError: true,
        };
      }
    });
    auditService.logSafe({
      userId: request.user.id,
      action: "rx.list",
      targetType: "rx_case",
      targetId: null,
      metadata: { count: cases.length },
      ipAddress: request.ip,
    });
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

    auditService.logSafe({
      userId: request.user.id,
      action: "rx.read",
      targetType: "rx_case",
      targetId: caseRow.id,
      ipAddress: request.ip,
    });
    // Decrypt PHI columns before returning to the owning doctor. On a decrypt
    // failure (corrupt / wrong-key), return a generic 500 — never leak the raw
    // error or any partial PHI.
    let decrypted;
    try {
      decrypted = decryptRxPhi(caseRow);
    } catch (err) {
      request.log.error({ caseId: caseRow.id, err: err.message }, "rx PHI decrypt failed");
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." },
      });
    }
    return { data: { ...decrypted, files } };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /rx/cases/:id/files/:fileId — issue a short-lived signed URL for a
  // stored case file. Same ownership gate as GET /rx/cases/:id (404 for missing
  // OR another doctor's case). The file must belong to the case. HIPAA: files
  // are served via time-limited signed URLs, never a public/long-lived link.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get("/rx/cases/:id/files/:fileId", {
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

    // Load the file row, verifying it belongs to THIS case (prevents fetching
    // another case's file by guessing a fileId).
    const [fileRow] = await db
      .select()
      .from(rxCaseFiles)
      .where(and(eq(rxCaseFiles.id, request.params.fileId), eq(rxCaseFiles.caseId, caseRow.id)));

    if (!fileRow) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    let url;
    try {
      url = await getSignedReadUrl(fileRow.gcsUrl);
    } catch (err) {
      request.log.error(
        { caseId: caseRow.id, fileId: fileRow.id, err: err.message },
        "failed to sign rx case file URL"
      );
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to generate file link." },
      });
    }

    auditService.logSafe({
      userId: request.user.id,
      action: "rx.file_access",
      targetType: "rx_case",
      targetId: caseRow.id,
      metadata: { fileId: fileRow.id, kind: fileRow.kind },
      ipAddress: request.ip,
    });
    return { data: { url } };
  });
}
