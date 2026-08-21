import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseLines, rxCaseFiles, rxCodeOverrides } from "../db/schema/index.js";
import { decryptRxPhi } from "../services/rx/phi-crypto.js";
import { reResolveLines } from "../services/rx/case-lines.service.js";
import { loadOverrides } from "../services/rx/code-overrides.service.js";
import { pushCaseToSeazona, shouldReleasePushLock } from "../services/rx/push-case.service.js";
import { getSignedReadUrl } from "../services/storage.service.js";
import * as seazonaService from "../services/seazona.service.js";
import * as auditService from "../services/audit.service.js";
import { createId } from "../lib/id.js";
import { encryptJson, encryptField } from "../lib/crypto.js";
import { env } from "../config/env.js";
import { ERROR_CODES } from "@my-app/shared";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  CASE_STATUSES,
  DEFAULT_QUEUE_STATUSES,
  canPush,
  canTransition,
  isFrozen,
  manualResolution,
  normalizeSeazonaCode,
  overrideRowFor,
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
  canPush,
  canTransition,
  isFrozen,
  manualResolution,
  normalizeSeazonaCode,
  overrideRowFor,
  statusForLine,
  summariseLines,
} from "../services/rx/case-gates.js";

/**
 * The 409 body every pushed-case refusal sends. Pulled out on its own so
 * the re-resolve route (which already has the case row loaded, status and
 * all, before this runs) can reuse the exact same shape without a second
 * DB round trip through refusePushedCase below.
 */
function pushedCaseRefusal() {
  return {
    error: {
      code: "CASE_ALREADY_PUSHED",
      status: 409,
      message: "This case has already been sent to Seazona. Correct it in Seazona, not here.",
    },
  };
}

/**
 * The 409 body for B2: a push is currently running for this case. Distinct
 * from pushedCaseRefusal (CASE_ALREADY_PUSHED) on purpose — "wait or clear
 * the lock" is a different next action for staff than "this is done,
 * correct it in Seazona", and collapsing the two would send an operator
 * hunting for the wrong fix.
 */
function pushInFlightRefusal() {
  return {
    error: {
      code: "CASE_PUSH_IN_FLIGHT",
      status: 409,
      message: "A push to Seazona is currently running for this case. Wait for it to finish, or use clear-push-lock if it looks stuck — do not edit the lines it was built from.",
    },
  };
}

/**
 * Shared write guard for the routes that mutate a case's order lines: add a
 * line, edit a line, delete a line, re-resolve. None of those routes already
 * has the case's status in hand (they load a line row, or only `id`), so
 * this does the one lookup and, if frozen or mid-push, sends the refusal and
 * returns true so the caller can stop immediately.
 *
 * Checks two things, in order:
 *   1. isFrozen(status) — the case is terminally `pushed`. Same rule as
 *      before (Task 9).
 *   2. seazonaPushStatus === "pushing" — a push is CURRENTLY in flight (B2).
 *      The order that lands was built from the pre-claim snapshot of these
 *      lines; letting staff add/edit/delete a line while that request is
 *      still running means the case can freeze as `pushed` showing lines
 *      that were never actually sent, or a staffer's attempt to stop a bad
 *      push by deleting a line does nothing to the request already in
 *      flight. Uses a distinct code (CASE_PUSH_IN_FLIGHT, not
 *      CASE_ALREADY_PUSHED) — the correct next step ("wait or clear the
 *      lock") is not "correct it in Seazona".
 *
 * Returns false — and sends nothing — both when the case is editable AND
 * when it doesn't exist at all. A missing case is each route's own 404 to
 * report (via its existing lookup), not this guard's; conflating the two
 * would blur "refused because pushed/in flight" with "doesn't exist" behind
 * the same signal.
 *
 * Deliberately NOT applied to: the push route itself and clear-push-lock
 * (Task 10 — they SET `pushed` / recover a case whose push was
 * interrupted), mark-manual (Task 10b — also lands on `pushed`, and claims
 * the same "pushing" sentinel itself), PUT .../status (already gated by
 * canTransition; do not double-gate or change its 409 shape), or either GET
 * route (a pushed case must stay fully readable — this is a write guard
 * only).
 */
async function refusePushedCase(caseId, reply) {
  const [caseRow] = await db
    .select({ status: rxCases.status, seazonaPushStatus: rxCases.seazonaPushStatus })
    .from(rxCases)
    .where(eq(rxCases.id, caseId));

  if (!caseRow) return false;

  if (isFrozen(caseRow.status)) {
    reply.code(409).send(pushedCaseRefusal());
    return true;
  }

  if (caseRow.seazonaPushStatus === "pushing") {
    reply.code(409).send(pushInFlightRefusal());
    return true;
  }

  return false;
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
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const q = request.query || {};
    const statuses = q.status
      ? (Array.isArray(q.status) ? q.status : [q.status])
      : DEFAULT_QUEUE_STATUSES;

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
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const [caseRow] = await db
      .select()
      .from(rxCases)
      .where(eq(rxCases.id, request.params.id));

    if (!caseRow) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const [lines, files] = await Promise.all([
      db
        .select()
        .from(rxCaseLines)
        .where(eq(rxCaseLines.caseId, caseRow.id))
        .orderBy(asc(rxCaseLines.position)),
      db
        .select()
        .from(rxCaseFiles)
        .where(eq(rxCaseFiles.caseId, caseRow.id)),
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

    return {
      data: {
        case: decrypted,
        lines,
        files,
        prescription: decrypted.formData,
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
  // ownership; here the admin role gate (requireAdmin) replaces that check,
  // since an admin legitimately has no ownership constraint. Precisely
  // because that access is broad, the audit entry below is not optional —
  // it's what makes it accountable.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-cases/:id/files/:fileId", {
    preHandler: [authenticate, requireAdmin],
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

    if (await refusePushedCase(caseId, reply)) return;

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

    if (await refusePushedCase(caseId, reply)) return;

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
  // produced a line that shouldn't exist. Hard delete; canPush/summariseLines
  // simply see one fewer line on the next read.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.delete("/admin/rx-cases/:id/lines/:lineId", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { id: caseId, lineId } = request.params;

    if (await refusePushedCase(caseId, reply)) return;

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

    // Already have the row (status and seazonaPushStatus and all) from the
    // select above — no need for a second refusePushedCase lookup, just the
    // same two checks + bodies (B2: pushed is terminal, mid-push is also
    // refused so a re-resolve can't touch lines a push is currently reading).
    if (isFrozen(caseRowRaw.status)) {
      return reply.code(409).send(pushedCaseRefusal());
    }
    if (caseRowRaw.seazonaPushStatus === "pushing") {
      return reply.code(409).send(pushInFlightRefusal());
    }

    let caseRow;
    try {
      caseRow = decryptRxPhi(caseRowRaw);
    } catch (err) {
      request.log.error({ caseId, err: err.message }, "rx PHI decrypt failed");
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." },
      });
    }

    const devices = caseRow.deviceOptions?.devices || [];
    const overrides = await loadOverrides();
    const { replaced, kept } = await reResolveLines(caseId, devices, { overrides });

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
  // POST /admin/rx-cases/:id/push
  // Send a reviewed case to Seazona as a real order. HIGHEST-RISK route in this
  // module: Seazona has no idempotency key, so a duplicate push is a real
  // order a human has to go find and delete.
  //
  // The payload is built from the case's STORED lines (push-case.service.js's
  // payloadFromLines), never re-resolved from the raw device selections —
  // re-resolving here would silently discard every staff correction at the
  // exact moment those corrections matter. canPush (also in push-case.service.js
  // via pushCaseToSeazona) independently re-verifies a real product code exists
  // on every sendable line; it does not trust a line's own `status`.
  //
  // Double-push guard: a conditional DB update claims the row by flipping
  // seazonaPushStatus to "pushing" in the SAME statement that checks it isn't
  // already pushed or already mid-push (guard at the database, not the button).
  // The claim is taken on seazonaPushStatus, NOT on `status` — `status` must
  // only ever hold one of CASE_STATUSES, so a crash between claim and outcome
  // can never strand a case in a value the queue and UI don't understand.
  // Deliberately not gated by refusePushedCase/isFrozen (see that guard's
  // docstring) — this route performs its own, stricter claim and is the one
  // place allowed to move a case TO `pushed`.
  //
  // Two preflight checks run BEFORE the claim, in this order: (1) the
  // SEAZONA_ORDER_USER_ID precondition, and (2) the canPush gate. Both are
  // pure refusals — no claim taken, no status/seazonaPushStatus/
  // seazonaPushError written, the case stays exactly where it was. A refusal
  // is not an attempt: "we refused to send" needs a different next action
  // from staff than "we sent it and it failed" (fix the missing config /
  // unmapped line, vs. check Seazona and maybe retry) — conflating them by
  // writing `failed` sends staff hunting for orders that were never
  // attempted. canPush is called again inside pushCaseToSeazona as defence in
  // depth for any future caller of that function.
  //
  // All Seazona-facing decision logic (the canPush gate, payload build, and
  // interpreting Seazona's response) lives in pushCaseToSeazona so it stays
  // unit-testable without a Fastify harness; this route is a thin caller that
  // only does the preflight checks, the DB claim, the final write, and audit
  // logging.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-cases/:id/push", {
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

    // Precondition 1: without a configured lab-staff Seazona user id, the
    // order can't be attributed. Mirrors payment.routes.js's
    // resolveOrderPushStatus, which refuses the sibling Seazona order path
    // ("skipped_no_user") rather than send an order with no user or let
    // Seazona reject it with an error nobody will recognise. No claim taken,
    // no status written — Seazona is never called.
    if (!env.SEAZONA_ORDER_USER_ID) {
      return reply.code(503).send({
        error: {
          code: "SEAZONA_ORDER_USER_NOT_CONFIGURED",
          status: 503,
          message: "Seazona order user is not configured, so this order cannot be attributed. Set SEAZONA_ORDER_USER_ID before pushing.",
        },
      });
    }

    // Precondition 2: the canPush gate, run against the case's STORED lines
    // — loaded here, before the claim, so a refusal never takes and releases
    // a lock for a send that was never going to happen.
    const lines = await db
      .select()
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(asc(rxCaseLines.position));

    const gate = canPush(lines);
    if (!gate.ok) {
      return reply.code(422).send({
        error: {
          code: "RX_PUSH_BLOCKED",
          status: 422,
          message: gate.reason,
          blocking: gate.blocking,
        },
      });
    }

    const claimed = await db.update(rxCases)
      .set({ seazonaPushStatus: "pushing", updatedAt: new Date() })
      .where(and(
        eq(rxCases.id, caseId),
        ne(rxCases.status, "pushed"),
        or(isNull(rxCases.seazonaPushStatus), ne(rxCases.seazonaPushStatus, "pushing")),
      ))
      .returning({ id: rxCases.id });

    if (claimed.length === 0) {
      return reply.code(409).send({
        error: {
          code: "PUSH_IN_FLIGHT_OR_DONE",
          status: 409,
          message: "This case has already been sent, or a push is already running.",
        },
      });
    }

    // From here on the row is claimed: seazonaPushStatus="pushing" until this
    // handler writes a final outcome below. If the process dies before that
    // write lands, the case is left stuck at "pushing" — recovered via
    // PUT /admin/rx-cases/:id/clear-push-lock, not automatically.
    let caseRow;
    try {
      caseRow = decryptRxPhi(caseRowRaw);
    } catch (err) {
      request.log.error({ caseId, err: err.message }, "rx PHI decrypt failed");
      await db.update(rxCases)
        .set({
          status: "failed",
          seazonaPushStatus: "failed",
          seazonaPushError: "Failed to decrypt case PHI before push.",
          updatedAt: new Date(),
        })
        .where(eq(rxCases.id, caseId));
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", status: 500, message: "Failed to load case." },
      });
    }

    // `lines` was already loaded above (before the claim) for the canPush
    // preflight — reused here rather than re-queried, same as
    // payloadFromLines' own reasoning: the stored lines at whatever moment
    // they're read are the source of truth, not a fresh re-resolve.

    // codeToId from the live Seazona catalog — listProducts() returns [] if
    // Seazona is unreachable (soft-fail), which then surfaces as "no catalog
    // id for code …" warnings on every line and a failed push, same pattern
    // the now-deleted /rx/cases/:id/approve route used before this route
    // replaced it (see round A's commit message).
    const products = await seazonaService.listProducts();
    const codeToId = {};
    for (const p of products) {
      if (p.code) codeToId[p.code] = String(p.id);
    }

    const outcome = await pushCaseToSeazona(caseRow, lines, {
      codeToId,
      userId: env.SEAZONA_ORDER_USER_ID,
    });

    // B1 fix: a failed push does NOT always release the claim/lock —
    // shouldReleasePushLock (push-case.service.js) makes that call from
    // outcome.contactedSeazona, exactly the distinction it was added for.
    // When Seazona was actually contacted and the result was ambiguous, the
    // lock stays HELD (seazonaPushStatus stays "pushing") so a human must
    // run clear-push-lock — checking Seazona — before any retry, rather than
    // the queue's Push button silently re-enabling on a possible duplicate.
    // `status` still becomes outcome.status either way, so the case stays
    // visible and actionable in the queue — only the LOCK differs.
    const releaseLock = shouldReleasePushLock(outcome);

    const updateValues = {
      status: outcome.status,
      seazonaPushStatus: releaseLock ? outcome.status : "pushing",
      seazonaOrderId: outcome.seazonaOrderId,
      seazonaPushError: outcome.seazonaPushError,
      updatedAt: new Date(),
    };
    if (outcome.status === "pushed") {
      // PHI (embeds patientName) — encrypt at rest, same treatment the
      // now-deleted /rx/cases/:id/approve route gave its dry-run snapshot.
      updateValues.payloadSnapshot = encryptJson(outcome.payload);
    }

    const [updated] = await db
      .update(rxCases)
      .set(updateValues)
      .where(eq(rxCases.id, caseId))
      .returning({
        id: rxCases.id,
        status: rxCases.status,
        seazonaPushStatus: rxCases.seazonaPushStatus,
        seazonaOrderId: rxCases.seazonaOrderId,
        seazonaPushError: rxCases.seazonaPushError,
        updatedAt: rxCases.updatedAt,
      });

    if (outcome.status === "failed") {
      request.log.error(
        { caseId, error: outcome.seazonaPushError },
        "[Seazona][RX_PUSH_FAILED] case push failed"
      );
    }

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.pushed",
      targetType: "rx_case",
      targetId: caseId,
      metadata: {
        outcome: outcome.status,
        seazonaOrderId: outcome.seazonaOrderId,
        error: outcome.seazonaPushError,
      },
      ipAddress: request.ip,
    });

    if (outcome.status === "failed") {
      return reply.code(422).send({
        error: {
          code: "RX_PUSH_FAILED",
          status: 422,
          message: outcome.seazonaPushError || "Failed to push this case to Seazona.",
        },
        data: updated,
      });
    }

    return { data: updated };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-cases/:id/mark-manual
  // "Staff typed this order into Seazona by hand." Without this, a case
  // staff resolved outside the portal sits in the queue forever until
  // someone eventually pushes a duplicate — Seazona has no idempotency key,
  // so that duplicate is a real order a human has to go find and delete.
  //
  // Resolves the case exactly as a successful push does (manualResolution
  // writes status: "pushed") so it leaves the queue and cannot be pushed or
  // marked manual again, but tags seazonaPushStatus: "manual" so "we sent
  // this" and "someone typed it in" stay distinguishable forever.
  //
  // Deliberately bypasses canPush — a human already created the order in
  // Seazona, so an unresolved line here cannot stop them recording that.
  // This is the one sanctioned way past the send gate. Precisely because it
  // bypasses that gate, manualResolution captures which lines were still
  // unresolved at this moment into unresolvedAtManual, which this route
  // writes into audit metadata alongside the Seazona order number — no PHI,
  // only mapKeys. Otherwise this button quietly becomes how mapping gaps
  // disappear, and those gaps are the lab's open questions.
  //
  // B4: the operator's free-text `note` is PHI-shaped (a natural note like
  // "confirmed with Dr Lee re: Jane Doe's retainer" names the patient) and
  // is persisted encrypted on rx_cases.manualNote (phi-crypto.js), NOT in
  // audit metadata — audit_log.metadata is plaintext jsonb. The audit row
  // records only notePresent: true/false, never the note text itself.
  //
  // Claim: the SAME full predicate the push route uses — status != 'pushed'
  // AND (seazonaPushStatus is null OR != 'pushing') — not just the narrower
  // status check the brief describes. The push route claims a case by
  // setting seazonaPushStatus = "pushing" while leaving `status` alone, so a
  // narrower predicate here would let mark-manual succeed while a push is
  // genuinely in flight: whichever write lands second wins, either erasing
  // a push that reached Seazona or getting overwritten by one that did —
  // either way, two orders in Seazona for one case and a record showing
  // one. Deliberately NOT gated by refusePushedCase/isFrozen (see that
  // guard's docstring) — like push, this route performs its own claim and
  // is allowed to move a case TO `pushed`.
  //
  // A claim that finds nothing is refused with 409 pointing at
  // clear-push-lock rather than just saying no: if the case is stuck at
  // "pushing" because a push was interrupted, papering over that with
  // mark-manual would skip the deliberate "check Seazona before you act"
  // step clear-push-lock exists to force.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-cases/:id/mark-manual", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const caseId = request.params.id;
    const { seazonaOrderId, note } = request.body || {};

    // Claims with the SAME "pushing" sentinel the push route uses — not the
    // final "manual" value — so the lock is shared between the two routes.
    // If this set the final value directly, a concurrent claim (by either
    // route) would see seazonaPushStatus != "pushing" and slip through
    // between this claim and the finalize write below, which is exactly the
    // double-claim this predicate exists to prevent.
    const claimed = await db.update(rxCases)
      .set({ seazonaPushStatus: "pushing", updatedAt: new Date() })
      .where(and(
        eq(rxCases.id, caseId),
        ne(rxCases.status, "pushed"),
        or(isNull(rxCases.seazonaPushStatus), ne(rxCases.seazonaPushStatus, "pushing")),
      ))
      .returning({ id: rxCases.id });

    if (claimed.length === 0) {
      const [existing] = await db
        .select({ id: rxCases.id })
        .from(rxCases)
        .where(eq(rxCases.id, caseId));
      if (!existing) {
        return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
      }
      return reply.code(409).send({
        error: {
          code: "MARK_MANUAL_BLOCKED",
          status: 409,
          message: "This case has already been resolved, or a push is currently running. If a push looks stuck, check Seazona for an order before using clear-push-lock — do not mark this manual instead.",
        },
      });
    }

    // From here the row is claimed. Load the stored lines to know what was
    // still unresolved at the moment staff recorded this — same "stored
    // lines are the source of truth" reasoning the push route uses, not a
    // fresh re-resolve.
    const lines = await db
      .select()
      .from(rxCaseLines)
      .where(eq(rxCaseLines.caseId, caseId))
      .orderBy(asc(rxCaseLines.position));

    const resolution = manualResolution(lines, { seazonaOrderId });

    const [updated] = await db
      .update(rxCases)
      .set({
        status: resolution.status,
        seazonaPushStatus: resolution.seazonaPushStatus,
        seazonaOrderId: resolution.seazonaOrderId,
        // B4: encrypted at rest (phi-crypto.js's TEXT_FIELDS includes
        // manualNote) — this route encrypts the single column directly
        // rather than routing through encryptRxPhi, same convention the
        // push route above already uses for payloadSnapshot.
        manualNote: note ? encryptField(note) : null,
        updatedAt: new Date(),
      })
      .where(eq(rxCases.id, caseId))
      .returning({
        id: rxCases.id,
        status: rxCases.status,
        seazonaPushStatus: rxCases.seazonaPushStatus,
        seazonaOrderId: rxCases.seazonaOrderId,
        updatedAt: rxCases.updatedAt,
      });

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.marked_manual",
      targetType: "rx_case",
      targetId: caseId,
      // No PHI: mapKeys and the order number only. The operator's actual
      // note text lives encrypted on rx_cases.manualNote (B4) — audit
      // metadata (plaintext jsonb) records only whether one was given.
      metadata: {
        unresolvedAtManual: resolution.unresolvedAtManual,
        seazonaOrderId: resolution.seazonaOrderId,
        notePresent: !!note,
      },
      ipAddress: request.ip,
    });

    return { data: updated };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PUT /admin/rx-cases/:id/clear-push-lock
  // Recover a case whose push was interrupted — the process died between the
  // claim above and its outcome write, leaving seazonaPushStatus stuck at
  // "pushing" (which blocks every future push attempt via the claim's WHERE).
  // Resets seazonaPushStatus to null so the case can be retried.
  //
  // Deliberately NOT automatic / on a timer: an interrupted push may well have
  // reached Seazona even though this process never recorded the outcome — a
  // human must check Seazona before a second attempt, or risk a real duplicate
  // order. This route only clears the lock; it does not touch `status`,
  // seazonaOrderId, or the case's lines.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.put("/admin/rx-cases/:id/clear-push-lock", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const caseId = request.params.id;

    const [existing] = await db
      .select({ id: rxCases.id, seazonaPushStatus: rxCases.seazonaPushStatus })
      .from(rxCases)
      .where(eq(rxCases.id, caseId));

    if (!existing) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const [updated] = await db
      .update(rxCases)
      .set({ seazonaPushStatus: null, updatedAt: new Date() })
      .where(eq(rxCases.id, caseId))
      .returning({
        id: rxCases.id,
        status: rxCases.status,
        seazonaPushStatus: rxCases.seazonaPushStatus,
        updatedAt: rxCases.updatedAt,
      });

    auditService.logSafe({
      userId: request.user.id,
      action: "rx_case.push_lock_cleared",
      targetType: "rx_case",
      targetId: caseId,
      metadata: { previousSeazonaPushStatus: existing.seazonaPushStatus },
      ipAddress: request.ip,
    });

    return { data: updated };
  });
}
