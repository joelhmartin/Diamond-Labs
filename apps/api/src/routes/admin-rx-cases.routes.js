import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin, requireRole } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseLines, rxCaseFiles, rxCodeOverrides } from "../db/schema/index.js";
import { decryptRxPhi } from "../services/rx/phi-crypto.js";
import { reResolveLines, devicesForCase } from "../services/rx/case-lines.service.js";
import { loadOverrides } from "../services/rx/code-overrides.service.js";
import { getSignedReadUrl } from "../services/storage.service.js";
import * as auditService from "../services/audit.service.js";
import { createId } from "../lib/id.js";
import { validate } from "../middleware/validate.js";
import { ERROR_CODES, STAFF_ROLES, rxReleaseSchema, currentLabOrder } from "@my-app/shared";
import { releaseRxCase, labOrdersForCases } from "../services/lab/lab-orders.service.js";
import { labErrorReply } from "../services/lab/lab-errors.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  CASE_STATUSES,
  DEFAULT_QUEUE_STATUSES,
  canRelease,
  canTransition,
  isFrozen,
  normalizeSeazonaCode,
  overrideRowFor,
  releaseRefusal,
  statusForLine,
  summariseLines,
} from "../services/rx/case-gates.js";

// Pure domain rules (status vocabulary, transition/push gates, the noteOnly
// <-> seazonaCode invariant) now live in case-gates.js so services can reach
// them without importing this route module — see Task 10 fix 1. Re-exported
// here so every existing importer of this file keeps working unchanged.
export {
  CASE_STATUSES,
  DEFAULT_QUEUE_STATUSES,
  canRelease,
  canTransition,
  isFrozen,
  normalizeSeazonaCode,
  overrideRowFor,
  releaseRefusal,
  statusForLine,
  summariseLines,
} from "../services/rx/case-gates.js";

/** The 409 every write to a frozen case's lines sends. */
function frozenCaseRefusal(status) {
  return status === "released"
    ? { error: { code: "CASE_RELEASED", status: 409, message: "This case is on the production board. Change the lab order instead." } }
    : { error: { code: "CASE_ALREADY_PUSHED", status: 409, message: "This case was sent to Seazona before the lab moved to the portal. Correct it in Seazona." } };
}

/**
 * Write guard for the routes that change a case's lines (add, edit, delete,
 * re-resolve): a released or legacy-pushed case is frozen (isFrozen). Sends
 * the refusal and returns true when the caller must stop; returns false —
 * sending nothing — for an editable case AND for a missing one (each route
 * reports its own 404). No push can be in flight any more (piece 2 retired
 * the Seazona push), so there is no in-flight check.
 */
async function refuseFrozenCase(caseId, reply) {
  const [caseRow] = await db.select({ status: rxCases.status }).from(rxCases).where(eq(rxCases.id, caseId));
  if (!caseRow) return false;
  if (isFrozen(caseRow.status)) {
    reply.code(409).send(frozenCaseRefusal(caseRow.status));
    return true;
  }
  return false;
}

/** ?status=a,b or ?status=a&status=b → statuses; none → the open queue. */
export function parseStatusFilter(raw) {
  if (raw == null || raw === "") return DEFAULT_QUEUE_STATUSES;
  return [...new Set([].concat(raw).flatMap((s) => String(s).split(",")).map((s) => s.trim()).filter(Boolean))];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Decrypt a case row for a LIST context. A single corrupt / wrong-key row
 * must not break the whole queue — replace it with a redacted placeholder
 * (PHI nulled, `decryptError` flagged) and log the failure, rather than
 * letting the exception 500 the whole page. Mirrors rx.routes.js's
 * `GET /rx/cases` list route.
 */
function safeDecryptForList(row, request) {
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
}

/**
 * Case-insensitive "does this case match the search text" check, run against
 * the DECRYPTED row. patientFirst/patientLast/practiceName/caseNumber are the
 * fields staff search by. Patient name is PHI (encrypted at rest), so this
 * match can only happen after decryption — there is no way to push it down
 * into SQL.
 */
function matchesQuery(row, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const patientName = `${row.patientFirst || ""} ${row.patientLast || ""}`.trim();
  const haystacks = [row.caseNumber, row.practiceName, patientName];
  return haystacks.some((h) => String(h || "").toLowerCase().includes(needle));
}

export default async function adminRxCasesRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rx-cases
  // The lab's review queue — submitted prescriptions awaiting action. Defaults
  // to everything needing attention (DEFAULT_QUEUE_STATUSES); `status` narrows
  // it, `q` searches case number / patient name / practice name.
  //
  // `q` requires decrypting patientFirst/patientLast (PHI, encrypted at rest —
  // there's no server-side LIKE over ciphertext), so a `q` search decrypts
  // every case matching the status filter to test the match, then paginates
  // the filtered result in memory. Without `q`, pagination happens in SQL.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-cases", {
    preHandler: [authenticate, requireRole(...STAFF_ROLES)],
  }, async (request) => {
    const q = request.query || {};
    const statuses = parseStatusFilter(q.status);

    const limit = Math.min(Number(q.limit) > 0 ? Number(q.limit) : DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Number(q.offset) > 0 ? Number(q.offset) : 0;
    const search = typeof q.q === "string" ? q.q : null;

    const whereClause = statuses.length ? inArray(rxCases.status, statuses) : undefined;

    let pageRows;
    let total;

    if (search) {
      // Search touches PHI — pull every case in the status filter, decrypt,
      // filter, THEN paginate. Fine at today's case volumes; would need a
      // different approach (e.g. a searchable hash index) if this ever gets
      // slow.
      const all = await db
        .select()
        .from(rxCases)
        .where(whereClause)
        .orderBy(desc(rxCases.createdAt));

      const decrypted = all.map((row) => safeDecryptForList(row, request));
      const matched = decrypted.filter((row) => matchesQuery(row, search));
      total = matched.length;
      pageRows = matched.slice(offset, offset + limit);
    } else {
      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(rxCases)
          .where(whereClause)
          .orderBy(desc(rxCases.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ id: rxCases.id }).from(rxCases).where(whereClause),
      ]);
      total = countRows.length;
      pageRows = rows.map((row) => safeDecryptForList(row, request));
    }

    const caseIds = pageRows.map((row) => row.id);
    const lines = caseIds.length
      ? await db
          .select({ caseId: rxCaseLines.caseId, status: rxCaseLines.status, noteOnly: rxCaseLines.noteOnly })
          .from(rxCaseLines)
          .where(inArray(rxCaseLines.caseId, caseIds))
      : [];

    const linesByCase = new Map();
    for (const line of lines) {
      if (!linesByCase.has(line.caseId)) linesByCase.set(line.caseId, []);
      linesByCase.get(line.caseId).push(line);
    }

    const data = pageRows.map((row) => {
      const { lineCount, unmappedCount } = summariseLines(linesByCase.get(row.id) || []);
      return {
        id: row.id,
        caseNumber: row.caseNumber,
        patientName: `${row.patientFirst || ""} ${row.patientLast || ""}`.trim() || null,
        practiceName: row.practiceName || null,
        deviceKey: row.deviceKey || null,
        status: row.status,
        // How a resolved case got resolved: "pushed" (we sent it) vs "manual"
        // (staff entered it in Seazona by hand). `status` collapses both to
        // "pushed", so without this the queue cannot tell them apart when
        // filtered to resolved work via ?status=pushed — and "added manually"
        // is meant to be a visible tag, not a detail-page-only footnote.
        seazonaPushStatus: row.seazonaPushStatus || null,
        lineCount,
        unmappedCount,
        createdAt: row.createdAt,
      };
    });

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.list",
      targetType: "rx_case",
      targetId: null,
      metadata: { count: data.length, total },
      ipAddress: request.ip,
    });

    return { data, meta: { total } };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rx-cases/:id
  // One case in full: the decrypted case row, its order lines (ordered by
  // position), its uploaded files (scans/photos/artboards), and the
  // decrypted prescription form data staff need to review the submission
  // against the derived lines.
  //
  // Never log the decrypted row — patient name is PHI.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-cases/:id", {
    preHandler: [authenticate, requireRole(...STAFF_ROLES)],
  }, async (request, reply) => {
    const [caseRow] = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.id, request.params.id));

    if (!caseRow) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const [lines, files, labOrdersByCase] = await Promise.all([
      db
        .select()
        .from(rxCaseLines)
        .where(eq(rxCaseLines.caseId, caseRow.id))
        .orderBy(asc(rxCaseLines.position)),
      db
        .select()
        .from(rxCaseFiles)
        .where(eq(rxCaseFiles.caseId, caseRow.id)),
      labOrdersForCases([caseRow.id]),
    ]);

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.read",
      targetType: "rx_case",
      targetId: caseRow.id,
      ipAddress: request.ip,
    });

    // Decrypt PHI columns before returning to staff. On a decrypt failure
    // (corrupt / wrong-key), return a generic 500 — never leak the raw error
    // or any partial PHI. Mirrors rx.routes.js's GET /rx/cases/:id.
    let decrypted;
    try {
      decrypted = decryptRxPhi(caseRow);
    } catch (err) {
      request.log.error({ caseId: caseRow.id, err: err.message }, "rx PHI decrypt failed");
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." },
      });
    }

    const lo = currentLabOrder(labOrdersByCase.get(caseRow.id) ?? []);
    return {
      data: {
        case: decrypted,
        lines,
        files,
        prescription: decrypted.formData,
        labOrder: lo ? { id: lo.id, orderNumber: lo.orderNumber, status: lo.status } : null,
      },
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rx-cases/:id/files/:fileId — issue a short-lived signed URL for
  // a stored case file. Mirrors GET /rx/cases/:id/files/:fileId in
  // rx.routes.js: same getSignedReadUrl() mechanism, same "the file must
  // belong to the case" check, same never-serve-the-raw-pointer discipline
  // (HIPAA: PHI files are never served via a public or long-lived link). The
  // one difference is the access gate — the doctor route also checks case
  // ownership; here the staff role gate (admin or lab) replaces that check,
  // since staff legitimately have no ownership constraint. Precisely
  // because that access is broad, the audit entry below is not optional —
  // it's what makes it accountable.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-cases/:id/files/:fileId", {
    preHandler: [authenticate, requireRole(...STAFF_ROLES)],
  }, async (request, reply) => {
    const [caseRow] = await db
      .select({ id: rxCases.id })
      .from(rxCases)
      .where(eq(rxCases.id, request.params.id));

    if (!caseRow) {
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
        "failed to sign admin rx case file URL"
      );
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to generate file link." },
      });
    }

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.file_access",
      targetType: "rx_case",
      targetId: caseRow.id,
      metadata: { fileId: fileRow.id, kind: fileRow.kind },
      ipAddress: request.ip,
    });
    return { data: { url } };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PUT /admin/rx-cases/:id/lines/:lineId
  // Correct one order line. Body: { seazonaCode, name, arch, noteOnly, scope }
  // — scope is "once" (this order only) or "always" (also confirm the
  // mapping permanently via rx_code_overrides).
  //
  // Any edit here sets origin: "manual" — re-resolving a case recomputes only
  // "auto" lines (see case-lines.service.js's reResolveLines), so this is what
  // makes a staff correction survive an unrelated mapping answer elsewhere.
  //
  // scope: "always" needs a mapKey to key the override on. A line with none
  // (e.g. one staff added by hand) can only be resolved "once" — overrideRowFor
  // throws in that case and this route turns it into a 422, not a 500.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.put("/admin/rx-cases/:id/lines/:lineId", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { id: caseId, lineId } = request.params;
    const body = request.body || {};
    const scope = body.scope === "always" ? "always" : "once";

    if (await refuseFrozenCase(caseId, reply)) return;

    const [existing] = await db
      .select()
      .from(rxCaseLines)
      .where(and(eq(rxCaseLines.id, lineId), eq(rxCaseLines.caseId, caseId)));

    if (!existing) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const name = body.name !== undefined ? (body.name || null) : existing.name;
    const arch = body.arch !== undefined ? (body.arch || null) : existing.arch;
    const noteOnly = body.noteOnly !== undefined ? !!body.noteOnly : existing.noteOnly;
    // seazonaCode and noteOnly are merged independently above (each falls
    // back to the existing row when the body omits it), so a partial update
    // that only flips one of them can produce the noteOnly + code pair — the
    // Critical defect this normalisation exists to close. Normalise BEFORE
    // this reaches statusForLine, overrideRowFor, or the DB .set() below.
    const rawSeazonaCode = body.seazonaCode !== undefined ? (body.seazonaCode || null) : existing.seazonaCode;
    const seazonaCode = normalizeSeazonaCode({ seazonaCode: rawSeazonaCode, noteOnly });
    const status = statusForLine({ seazonaCode, noteOnly });

    let overrideRow = null;
    if (scope === "always") {
      try {
        overrideRow = overrideRowFor({
          mapKey: existing.mapKey,
          seazonaCode,
          seazonaName: name,
          noteOnly,
          confirmedBy: request.user.id,
        });
      } catch {
        return reply.code(422).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: 'This line has no mapKey, so it can only be resolved for this order (scope: "once").',
          },
        });
      }
    }

    const [updated] = await db
      .update(rxCaseLines)
      .set({
        seazonaCode,
        name,
        arch,
        noteOnly,
        origin: "manual",
        status,
        updatedAt: new Date(),
      })
      .where(eq(rxCaseLines.id, lineId))
      .returning();

    if (overrideRow) {
      await db
        .insert(rxCodeOverrides)
        .values({ id: createId(), ...overrideRow })
        .onConflictDoUpdate({
          target: rxCodeOverrides.mapKey,
          set: {
            seazonaCode: overrideRow.seazonaCode,
            seazonaName: overrideRow.seazonaName,
            note: overrideRow.note,
            noteOnly: overrideRow.noteOnly,
            confirmedBy: overrideRow.confirmedBy,
            updatedAt: new Date(),
          },
        });
    }

    // Metadata carries only product codes, never the patient's name or any
    // other decrypted field — rx_case_lines has no PHI, but this route sits
    // right next to routes that decrypt PHI, so the boundary is deliberate.
    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case_line.updated",
      targetType: "rx_case",
      targetId: caseId,
      metadata: {
        lineId,
        scope,
        before: { seazonaCode: existing.seazonaCode },
        after: { seazonaCode },
      },
      ipAddress: request.ip,
    });

    return { data: updated };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-cases/:id/lines
  // Add a line the resolver never produced — e.g. a build instruction the
  // prescription didn't cleanly map to a device/modification/attribute row.
  // Always origin: "manual" (see the PUT handler above for why).
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-cases/:id/lines", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const caseId = request.params.id;
    const body = request.body || {};

    if (await refuseFrozenCase(caseId, reply)) return;

    const [caseRow] = await db.select({ id: rxCases.id }).from(rxCases).where(eq(rxCases.id, caseId));
    if (!caseRow) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "name is required." },
      });
    }

    const arch = body.arch || null;
    const mapKey = body.mapKey || null;
    const noteOnly = !!body.noteOnly;
    // Same noteOnly ⇄ seazonaCode invariant as the PUT handler above — a
    // hand-added line can arrive with both set, and note-only must win.
    const seazonaCode = normalizeSeazonaCode({ seazonaCode: body.seazonaCode || null, noteOnly });
    const sourceLabel = body.sourceLabel || null;
    const status = statusForLine({ seazonaCode, noteOnly });

    const [lastLine] = await db
      .select({ position: rxCaseLines.position })
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(desc(rxCaseLines.position))
      .limit(1);
    const position = (lastLine?.position ?? -1) + 1;

    const [created] = await db
      .insert(rxCaseLines)
      .values({
        id: createId(),
        caseId,
        position,
        seazonaCode,
        seazonaProductId: null,
        name,
        arch,
        mapKey,
        status,
        origin: "manual",
        noteOnly,
        sourceLabel,
      })
      .returning();

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case_line.updated",
      targetType: "rx_case",
      targetId: caseId,
      metadata: { lineId: created.id, op: "create", before: null, after: { seazonaCode } },
      ipAddress: request.ip,
    });

    return reply.code(201).send({ data: created });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE /admin/rx-cases/:id/lines/:lineId
  // Remove a line entirely — e.g. staff added one by mistake, or the resolver
  // produced a line that shouldn't exist. Hard delete; canRelease/summariseLines
  // simply see one fewer line on the next read.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.delete("/admin/rx-cases/:id/lines/:lineId", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { id: caseId, lineId } = request.params;

    if (await refuseFrozenCase(caseId, reply)) return;

    const [existing] = await db
      .select()
      .from(rxCaseLines)
      .where(and(eq(rxCaseLines.id, lineId), eq(rxCaseLines.caseId, caseId)));

    if (!existing) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    await db.delete(rxCaseLines).where(eq(rxCaseLines.id, lineId));

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case_line.updated",
      targetType: "rx_case",
      targetId: caseId,
      metadata: {
        lineId,
        op: "delete",
        before: { seazonaCode: existing.seazonaCode },
        after: null,
      },
      ipAddress: request.ip,
    });

    return { data: { ok: true } };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PUT /admin/rx-cases/:id/status
  // Move a case to a new status. Body: { status }.
  //
  // canTransition gates the move (see its docstring for the `pushed`-is-
  // terminal rule). Audit metadata carries only status values and IDs — never
  // any decrypted PHI — which is also why this doesn't decrypt the row at all.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.put("/admin/rx-cases/:id/status", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const caseId = request.params.id;
    const body = request.body || {};
    const toStatus = body.status;

    if (typeof toStatus !== "string" || !CASE_STATUSES.includes(toStatus)) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: `status must be one of: ${CASE_STATUSES.join(", ")}.`,
        },
      });
    }

    const [existing] = await db
      .select({ id: rxCases.id, status: rxCases.status })
      .from(rxCases)
      .where(eq(rxCases.id, caseId));

    if (!existing) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    if (!canTransition(existing.status, toStatus)) {
      return reply.code(409).send({
        error: {
          code: "INVALID_STATUS_TRANSITION",
          status: 409,
          message: `Cannot move a case from '${existing.status}' to '${toStatus}'.`,
        },
      });
    }

    const [updated] = await db
      .update(rxCases)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(eq(rxCases.id, caseId))
      .returning({ id: rxCases.id, status: rxCases.status, updatedAt: rxCases.updatedAt });

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.status_changed",
      targetType: "rx_case",
      targetId: caseId,
      metadata: { from: existing.status, to: toStatus },
      ipAddress: request.ip,
    });

    return { data: updated };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-cases/:id/re-resolve
  // Explicitly recompute the case's "auto" lines from its device selections,
  // leaving any staff-corrected "manual" lines untouched — see
  // case-lines.service.js's reResolveLines for the keep/renumber/append
  // logic this route calls, not reimplements.
  //
  // deviceOptions is a PHI JSON blob (encrypted at rest), so the row must be
  // decrypted to read deviceOptions.devices — but the response and audit
  // metadata below only ever carry line/status data, never the decrypted PHI
  // fields also sitting on this row.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-cases/:id/re-resolve", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const caseId = request.params.id;

    const [caseRowRaw] = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.id, caseId));

    if (!caseRowRaw) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    // Already have the row from the select above — no second guard lookup.
    if (isFrozen(caseRowRaw.status)) return reply.code(409).send(frozenCaseRefusal(caseRowRaw.status));

    let caseRow;
    try {
      caseRow = decryptRxPhi(caseRowRaw);
    } catch (err) {
      request.log.error({ caseId, err: err.message }, "rx PHI decrypt failed");
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." },
      });
    }

    const devices = devicesForCase(caseRow);
    const overrides = await loadOverrides();
    const { replaced, kept } = await reResolveLines(caseId, devices, { overrides, formData: caseRow.formData });

    const lines = await db
      .select()
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(asc(rxCaseLines.position));

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.re_resolved",
      targetType: "rx_case",
      targetId: caseId,
      metadata: { replaced, kept },
      ipAddress: request.ip,
    });

    return { data: { lines, replaced, kept } };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-cases/:id/release
  // Release a reviewed case to the production board. Replaces the Seazona
  // push (own-the-lab piece 2): same line gate (canRelease, formerly canPush),
  // but the "order" is our own lab order, created in the same transaction
  // that moves the case to `released`.
  //
  // Order of checks: releaseRefusal (already released / legacy pushed /
  // cancelled / an unconfirmed legacy Seazona push) -> canRelease on the
  // STORED lines -> transaction (claim case, allocate number, insert order,
  // lines and event). Lab staff may release; editing lines stays admin-only.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-cases/:id/release", {
    preHandler: [authenticate, requireRole(...STAFF_ROLES), validate(rxReleaseSchema)],
  }, async (request, reply) => {
    const caseId = request.params.id;
    const [caseRowRaw] = await db.select().from(rxCases).where(eq(rxCases.id, caseId));
    if (!caseRowRaw) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });

    const refusal = releaseRefusal(caseRowRaw, { confirmNotInSeazona: request.body.confirmNotInSeazona === true });
    if (refusal) return reply.code(refusal.status).send({ error: refusal.error });

    const lines = await db
      .select()
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(asc(rxCaseLines.position));
    const gate = canRelease(lines);
    if (!gate.ok) {
      return reply.code(422).send({
        error: { code: "RX_RELEASE_BLOCKED", status: 422, message: gate.reason, blocking: gate.blocking },
      });
    }

    let caseRow;
    try {
      caseRow = decryptRxPhi(caseRowRaw);
    } catch (err) {
      request.log.error({ caseId, err: err.message }, "rx PHI decrypt failed");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." } });
    }

    let result;
    try {
      result = await db.transaction((tx) => releaseRxCase(tx, { caseRow, lines, byUserId: request.user.id }));
    } catch (err) {
      const r = labErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }

    // No PHI: ids, the order number and lab codes only.
    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.released",
      targetType: "rx_case",
      targetId: caseId,
      metadata: {
        labOrderId: result.labOrder.id,
        orderNumber: result.labOrder.orderNumber,
        unknownCodes: result.unknownCodes,
        confirmedNotInSeazona: request.body.confirmNotInSeazona === true,
      },
      ipAddress: request.ip,
    });

    return reply.code(201).send({
      data: { caseId, status: "released", labOrder: result.labOrder, unknownCodes: result.unknownCodes },
    });
  });
}
