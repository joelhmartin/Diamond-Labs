import * as seazonaService from "../seazona.service.js";
import { canRelease } from "./case-gates.js";
import { devicesForCase } from "./case-devices.js";
import { compileNotesMulti } from "./build-order-payload.js";

/**
 * Build a Seazona order payload from the case's STORED lines.
 *
 * Deliberately does not call resolveLineItems: by this point staff may have
 * corrected the lines, and re-resolving would discard those corrections at the
 * one moment they matter.
 *
 * The notes DO read the case's devices: design intent with no product code
 * (occlusal contact, design preference, guard clearance, device comments)
 * has no other way onto the order. Line items are never derived from them.
 */
export function payloadFromLines(caseRow, lines = [], { codeToId = {}, userId } = {}) {
  const items = [];
  const warnings = [];
  const noteLines = [];

  for (const l of lines) {
    if (l.noteOnly) {
      // Same three-way fallback the codeless-line branch just below already
      // uses (sourceLabel, then name, then mapKey) — a note-only line with
      // neither a source label nor a display name can still carry the
      // resolver's mapKey (e.g. an unmapped line seeded with `name: null,
      // sourceLabel: mapKey`). If ALL THREE are empty there is truly nothing
      // to name the instruction with — that must surface as a warning, not
      // vanish silently: a build instruction the lab ruled on is something a
      // human has to see, not something the push quietly drops.
      const label = l.sourceLabel || l.name || l.mapKey;
      if (label) {
        noteLines.push(label);
      } else {
        warnings.push("a note-only line has no name, source label, or map key to record — refusing to drop it silently");
      }
      continue;
    }
    if (!l.seazonaCode) {
      warnings.push(`line has no product code (${l.mapKey || l.sourceLabel || "unknown"})`);
      continue;
    }
    const id = codeToId[l.seazonaCode];
    if (!id) {
      warnings.push(`no catalog id for code ${l.seazonaCode} (${l.name || ""})`);
      continue;
    }
    items.push({ id, arch: normalizeArch(l.arch) });
  }

  const deviceNotes = compileNotesMulti(caseRow, devicesForCase(caseRow));
  // Seazona caps notes at 2000 characters. Lab-ruled build instructions go
  // first so a long free-text comment can never truncate them away.
  const instructions = noteLines.join(" | ");
  if (instructions.length > 2000) warnings.push("note-only instructions exceed Seazona's 2000-character notes limit");
  const notes = [instructions, deviceNotes, caseRow.generalComments].filter(Boolean).join(" | ").slice(0, 2000);
  const ok = warnings.length === 0 && items.length > 0;

  return {
    ok,
    warnings,
    payload: {
      clientId: caseRow.seazonaClientId,
      patientName: `${caseRow.patientFirst ?? ""} ${caseRow.patientLast ?? ""}`.trim(),
      due: caseRow.dueDate || null,
      items,
      notes,
      userId,
    },
  };
}

/** "Upper" -> 1, "Lower" -> 2, anything else -> null. Mirrors build-order-payload.js. */
function normalizeArch(arch) {
  if (arch === 1 || arch === 2) return arch;
  if (typeof arch === "string") {
    const a = arch.toLowerCase();
    if (a === "upper") return 1;
    if (a === "lower") return 2;
  }
  return null;
}

/**
 * Orchestrate ONE push attempt: gate on canRelease, build the payload from the
 * stored lines, call Seazona, and translate the outcome into what the route
 * should persist. This is the actual decision that creates — or refuses to
 * create — a real order in the lab's system, so it lives here (not in the
 * route) specifically so it is unit-testable without a Fastify harness.
 *
 * Never throws. Every failure mode (gate refusal, unmapped line, Seazona
 * returning null on a non-2xx or a network error) resolves to
 * `{ status: "failed", ... }`, never to a thrown exception or a silent
 * "pushed" — a caller that treated a null Seazona response as success would
 * mark a case pushed when no order was ever created, and a caller that threw
 * would risk leaving the case's seazonaPushStatus claim ("pushing") stuck
 * with no outcome recorded. Both are worse than an explicit `failed`.
 *
 * `contactedSeazona` distinguishes WHY a failure happened: `false` means the
 * push was refused before any network call (canRelease gate, or the payload
 * failed to build) — Seazona was never contacted, so nothing was created and
 * a retry is unambiguously safe. `true` means `seazonaService.createOrder`
 * was actually invoked, whatever it returned — including the ambiguous null
 * case (network error vs. an order that landed despite the failure), where a
 * blind retry risks a duplicate order. Callers use this to decide whether
 * it's safe to release a push claim/lock for a retry.
 *
 * @param {object} caseRow — DECRYPTED case row (see phi-crypto.js)
 * @param {Array}  lines   — the case's STORED rx_case_lines rows
 * @param {object} opts
 * @param {Record<string,string>} opts.codeToId — Seazona product code → catalog id
 * @param {string} [opts.userId] — lab-staff Seazona user id to attach to the order
 * @returns {Promise<{ status: "pushed"|"failed", seazonaOrderId: string|null, seazonaPushError: string|null, payload: object|null, contactedSeazona: boolean }>}
 */
export async function pushCaseToSeazona(caseRow, lines = [], { codeToId = {}, userId } = {}) {
  const gate = canRelease(lines);
  if (!gate.ok) {
    return { status: "failed", seazonaOrderId: null, seazonaPushError: gate.reason, payload: null, contactedSeazona: false };
  }

  const { payload, ok, warnings } = payloadFromLines(caseRow, lines, { codeToId, userId });
  if (!ok) {
    return {
      status: "failed",
      seazonaOrderId: null,
      seazonaPushError: warnings.join("; ") || "The order payload could not be built.",
      payload,
      contactedSeazona: false,
    };
  }

  // seazonaService.createOrder() never throws — it resolves to null on any
  // failure (network error, non-2xx, or missing credentials), already logged
  // by the wrapper's own `[Seazona] … → <status>` line. A null return here
  // must land the case in `failed`, never `pushed` — there is no way to tell
  // from a null result whether Seazona actually created the order (e.g. an
  // ambiguous timeout) or never received the request, which is exactly why a
  // failed push does NOT auto-clear the push lock (see clear-push-lock).
  const result = await seazonaService.createOrder(payload);
  const orderId = result?.orderId ? String(result.orderId) : null;

  if (!orderId) {
    return {
      status: "failed",
      seazonaOrderId: null,
      seazonaPushError: "Seazona did not return an order id for this push. Check Seazona before retrying — the order may have been created despite this failure.",
      payload,
      contactedSeazona: true,
    };
  }

  return { status: "pushed", seazonaOrderId: orderId, seazonaPushError: null, payload, contactedSeazona: true };
}

/**
 * Whether a push OUTCOME (from pushCaseToSeazona) should release the
 * claim/lock (seazonaPushStatus = "pushing") so the case can be retried.
 *
 * Round A's claim guards a case from being pushed twice by leaving
 * seazonaPushStatus = "pushing" until a final outcome is written. Round B's
 * finding: the route used to release that lock for EVERY failure, including
 * ones where Seazona was actually contacted and the result was ambiguous —
 * exactly the case a retry could duplicate a real order. This function is
 * the fix, factored out as a pure decision so it's testable without a route:
 *
 * - "pushed" always releases — there's nothing left to protect.
 * - "failed" releases ONLY when `contactedSeazona` is false: the push was
 *   refused before any network call (the canRelease gate or a payload-build
 *   failure), so nothing could have been created and a retry is
 *   unambiguously safe.
 * - "failed" with `contactedSeazona: true` means createOrder actually ran
 *   and the response was lost or unclear — the lock must stay HELD so a
 *   human is forced through clear-push-lock (checking Seazona) before any
 *   retry, rather than the queue's Push button silently re-enabling.
 *
 * @param {{ status: "pushed"|"failed", contactedSeazona: boolean }} outcome
 * @returns {boolean}
 */
export function shouldReleasePushLock(outcome) {
  return outcome.status !== "failed" || !outcome.contactedSeazona;
}
