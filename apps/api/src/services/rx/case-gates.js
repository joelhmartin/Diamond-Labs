// Pure domain rules for a dental Rx case: status vocabulary, transition and
// push gates, and the noteOnly <-> seazonaCode invariant. Deliberately
// imports NOTHING from routes/ or the DB — services (lab-orders.service.js)
// and their tests need these without pulling in Fastify, drizzle, or
// config/database.js. admin-rx-cases.routes.js re-exports everything below
// so every existing importer keeps working unchanged. The one import is the
// pure catalog-map line classifier (no DB, no routes).

import { isDeviceLine } from "./catalog-map/index.js";

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
 *
 * `released` = on the production board (own-the-lab piece 2); `pushed` is
 * legacy (sent to Seazona before the cutover) and no new case enters it.
 */
export const CASE_STATUSES = [
  "new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled",
];

/**
 * Whether a case may move from `from` to `to`.
 *
 * `pushed` is terminal — the Seazona order already exists, so moving the
 * case back would make the portal disagree with the lab's own system about
 * what was ordered. A mistake after a push is corrected in Seazona, not
 * here.
 *
 * Both `from` and `to` are validated against CASE_STATUSES. A `from` outside
 * the known vocabulary is not a state anything should transition out of —
 * checking only `to` would let an unknown or `undefined` origin (e.g. a
 * caller that forgot to load the current status, or a status a future
 * producer misspells) through as `true`.
 *
 * `released` is entered only through POST /admin/rx-cases/:id/release, which
 * also creates the lab order; `pushed` is legacy-only.
 */
export function canTransition(from, to) {
  if (!CASE_STATUSES.includes(from)) return false;
  if (!CASE_STATUSES.includes(to)) return false;
  if (isFrozen(from)) return false;
  if (to === "released" || to === "pushed") return false;
  return true;
}

/**
 * Whether a case's ORDER LINES are frozen against further edits. Same rule
 * canTransition already applies to the case's status label (see its
 * docstring for the reasoning: once pushed, the Seazona order already
 * exists, so a change here would make the portal disagree with the lab's
 * own system about what was ordered) — this is that rule applied to the
 * case's contents, which is the half that actually matters. Deliberately
 * checks `status === "pushed"` only; `cancelled` is NOT frozen by this
 * rule — widening that is a separate question nobody has ruled on.
 *
 * Pure and exported so it's directly testable without a database.
 */
export function isFrozen(status) {
  return status === "pushed" || status === "released";
}

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
 * Whether a case may be released to the lab. Exported and pure so the gate
 * is testable without a database.
 *
 * The invariant this protects: never release a partial job.
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
export function canRelease(lines = []) {
  const emitting = lines.filter((l) => !l.noteOnly);
  if (emitting.length === 0) {
    return { ok: false, reason: "This case has no lines to release." };
  }
  const blocking = emitting.filter((l) => l.status === "open" || !l.seazonaCode);
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `${blocking.length} selection(s) still need a product code.`,
      blocking: blocking.map((l) => l.mapKey || l.sourceLabel),
    };
  }
  // Model and lab-service lines are added per case, not per device, and
  // modifications, attributes and ortho bands/add-ons ride on an appliance.
  // A case whose sendable lines are only those has lost its appliance (an
  // empty device list, staff deleted the device line, an ortho Rx with only a
  // transfer tray) — never send that. A staff-added line with no mapKey
  // counts as an appliance: staff chose it by hand.
  if (!emitting.some((l) => !l.mapKey || isDeviceLine(l.mapKey))) {
    return { ok: false, reason: "This case has no appliance line — only services, add-ons or modifications." };
  }
  return { ok: true };
}

/**
 * The single source of truth for the noteOnly ⇄ seazonaCode invariant: a
 * note-only ruling wins and the code is cleared. `noteOnly: true` is an
 * explicit statement that the line is a build instruction, not a charged
 * product — and both downstream readers already behave that way (canRelease
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
 * "open" and blocks a push (see canRelease).
 */
export function statusForLine({ seazonaCode, noteOnly }) {
  return noteOnly || seazonaCode ? "confirmed" : "open";
}

/**
 * Why a case can't be released right now, or null. Runs BEFORE the line gate
 * (canRelease) — these refusals don't depend on the lines.
 *
 * A case left at seazonaPushStatus "pushing" had a Seazona push start and
 * never confirm: the order may exist there. clear-push-lock is gone (piece
 * 2), so the human check it forced moves here — release is refused until the
 * request says staff checked Seazona (confirmNotInSeazona: true).
 *
 * @returns {null | { status: 409, error: { code: string, status: 409, message: string } }}
 */
export function releaseRefusal(caseRow, { confirmNotInSeazona = false } = {}) {
  const refuse = (code, message) => ({ status: 409, error: { code, status: 409, message } });
  if (caseRow.status === "released") {
    return refuse("CASE_ALREADY_RELEASED", "This case is already on the production board.");
  }
  if (caseRow.status === "pushed") {
    return refuse("CASE_ALREADY_PUSHED", "This case was sent to Seazona before the lab moved to the portal. It is tracked there.");
  }
  if (caseRow.status === "cancelled") {
    return refuse("CASE_CANCELLED", "This case is cancelled. Move it back to In review before releasing it.");
  }
  if (caseRow.seazonaPushStatus === "pushing" && !confirmNotInSeazona) {
    return refuse(
      "LEGACY_PUSH_UNCONFIRMED",
      "A Seazona push for this case started and was never confirmed. Check Seazona for an order first; if there is none, release again and confirm.",
    );
  }
  return null;
}
