import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseLines, rxCaseFiles, rxCodeOverrides } from "../db/schema/index.js";
import { decryptRxPhi } from "../services/rx/phi-crypto.js";
import { reResolveLines } from "../services/rx/case-lines.service.js";
import { loadOverrides } from "../services/rx/code-overrides.service.js";
import * as auditService from "../services/audit.service.js";
import { createId } from "../lib/id.js";
import { ERROR_CODES } from "@my-app/shared";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

/**
 * Statuses the queue shows when the caller does not ask for specific ones —
 * everything that still needs lab attention. Deliberately excludes `pushed`
 * (already sent to Seazona) and `cancelled` (dead).
 */
export const DEFAULT_QUEUE_STATUSES = ["new", "in_review", "awaiting_doctor", "failed"];

/**
 * The six states a case can be in. This is the third status vocabulary in
 * this codebase, alongside SUBMISSION_STATUS (rx.routes.js — what a
 * freshly-submitted case is written as) and DEFAULT_QUEUE_STATUSES above
 * (what the admin queue shows by default). Vocabulary drift between the
 * first two already produced this plan's worst defect — the admin queue
 * silently returned zero rows forever because the status the submit route
 * wrote was not one the queue selected. rx-status-vocabulary.test.js pins
 * all three together; if you add or rename a status here, that test is
 * where a drift will surface.
 */
export const CASE_STATUSES = [
  "new", "in_review", "awaiting_doctor", "pushed", "failed", "cancelled",
];

/**
 * Whether a case may move from `from` to `to`.
 *
 * `pushed` is terminal — the Seazona order already exists, so moving the
 * case back would make the portal disagree with the lab's own system about
 * what was ordered. A mistake after a push is corrected in Seazona, not
 * here. (A later "marked manually added" resolution also lands on `pushed`
 * for the same reason: it too commits the case to an order the lab
 * considers placed.)
 *
 * Both `from` and `to` are validated against CASE_STATUSES. A `from` outside
 * the known vocabulary is not a state anything should transition out of —
 * checking only `to` would let an unknown or `undefined` origin (e.g. a
 * caller that forgot to load the current status, or a status a future
 * producer misspells) through as `true`.
 */
export function canTransition(from, to) {
  if (!CASE_STATUSES.includes(from)) return false;
  if (!CASE_STATUSES.includes(to)) return false;
  if (from === "pushed") return false;
  return true;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Count a case's order lines and, separately, the ones blocking a push.
 *
 * A `noteOnly` line is deliberately NOT unmapped: the lab has ruled it is a
 * build instruction rather than a charged product, so it travels in the order
 * notes and does not block the push. Counting it here would make a case with
 * a noteOnly selection permanently unsendable (unmappedCount > 0 gates the
 * push).
 *
 * Pure — no DB, no I/O — so it is testable on its own.
 * @param {Array<{status: string, noteOnly?: boolean}>} lines
 * @returns {{ lineCount: number, unmappedCount: number }}
 */
export function summariseLines(lines = []) {
  return {
    lineCount: lines.length,
    unmappedCount: lines.filter((l) => l.status === "open" && !l.noteOnly).length,
  };
}

/**
 * Whether a case may be pushed. Exported and pure so the gate is testable
 * without a database or a live Seazona client.
 *
 * The invariant this protects: never send Seazona a partial order.
 *
 * - A `noteOnly` line never blocks — it's a doctor selection the lab has
 *   ruled is a build instruction rather than a charged product; it travels
 *   in the order notes, not as a line. Counting it as blocking would make
 *   such a case permanently unsendable.
 * - A case with no sendable (non-noteOnly) lines is refused too — an order
 *   with no lines is not a lesser order, it is a wrong one.
 * - A sendable line blocks if it has no `seazonaCode`, regardless of what
 *   its own `status` claims. This gate is the last check before a real
 *   order reaches the lab, so it does not trust a line's self-reported
 *   status — it independently confirms the one thing that actually makes a
 *   line sendable: a product code is present. Nothing upstream produces a
 *   codeless "confirmed" line today (statusForLine guards the write path,
 *   the resolver routes codeless rows to unmapped), but this gate must hold
 *   even if a future producer gets that wrong.
 *
 * @param {Array<{status: string, noteOnly?: boolean, seazonaCode?: string|null, mapKey?: string, sourceLabel?: string}>} lines
 * @returns {{ ok: boolean, reason?: string, blocking?: Array<string|undefined> }}
 */
export function canPush(lines = []) {
  const emitting = lines.filter((l) => !l.noteOnly);
  if (emitting.length === 0) {
    return { ok: false, reason: "This case has no lines to send." };
  }
  const blocking = emitting.filter((l) => l.status === "open" || !l.seazonaCode);
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `${blocking.length} selection(s) still need a product code.`,
      blocking: blocking.map((l) => l.mapKey || l.sourceLabel),
    };
  }
  return { ok: true };
}

/**
 * The single source of truth for the noteOnly ⇄ seazonaCode invariant: a
 * note-only ruling wins and the code is cleared. `noteOnly: true` is an
 * explicit statement that the line is a build instruction, not a charged
 * product — and both downstream readers already behave that way (canPush
 * filters noteOnly lines out of the sendable set; itemFromOverride checks
 * noteOnly first and emits `code: null`). Storing a code alongside
 * noteOnly: true would just be a value neither reader will ever honour, so
 * normalising here keeps the persisted row honest about what will actually
 * happen. Exported and pure so both write paths (the PUT/POST line handlers
 * and overrideRowFor below) can share and test it directly.
 */
export function normalizeSeazonaCode({ seazonaCode, noteOnly }) {
  return noteOnly ? null : (seazonaCode ?? null);
}

/**
 * Build the rx_code_overrides row for an "always" resolution.
 *
 * mapKey is the override table's unique key — an unmapped line carries the same
 * mapKey the resolver would have used, which is what makes this possible. A
 * line with no mapKey cannot be resolved permanently, only for this order.
 *
 * It never invents a code when none is given — and, as a second line of
 * defence against the noteOnly ⇄ seazonaCode invariant above, it never
 * leaks one through either: a noteOnly ruling clears whatever seazonaCode
 * was passed in, regardless of what the caller already normalised.
 */
export function overrideRowFor({ mapKey, seazonaCode, seazonaName, noteOnly, confirmedBy }) {
  if (!mapKey) throw new Error("cannot write an override without a mapKey");
  return {
    mapKey,
    seazonaCode: normalizeSeazonaCode({ seazonaCode, noteOnly }),
    seazonaName: seazonaName ?? null,
    // A real, queryable column — not just implied by `note`'s prose — so
    // catalog-map/index.js can branch on it later without parsing text.
    noteOnly: !!noteOnly,
    note: noteOnly ? "note only — instruction, not a charged product" : null,
    confirmedBy: confirmedBy ?? null,
  };
}

/**
 * A line is "confirmed" once it has a real code or the lab has ruled it's a
 * note-only instruction — either way staff resolved it. Otherwise it's still
 * "open" and blocks a push (see canPush).
 */
function statusForLine({ seazonaCode, noteOnly }) {
  return noteOnly || seazonaCode ? "confirmed" : "open";
}

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
}
