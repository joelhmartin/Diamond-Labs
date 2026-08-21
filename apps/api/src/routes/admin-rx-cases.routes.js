import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCases, rxCaseLines } from "../db/schema/index.js";
import { decryptRxPhi } from "../services/rx/phi-crypto.js";
import { desc, inArray } from "drizzle-orm";

/**
 * Statuses the queue shows when the caller does not ask for specific ones —
 * everything that still needs lab attention. Deliberately excludes `pushed`
 * (already sent to Seazona) and `cancelled` (dead).
 */
export const DEFAULT_QUEUE_STATUSES = ["new", "in_review", "awaiting_doctor", "failed"];

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

      const decrypted = all.map((row) => decryptRxPhi(row));
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
      pageRows = rows.map((row) => decryptRxPhi(row));
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

    return { data, meta: { total } };
  });
}
