import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_QUEUE_STATUSES,
  summariseLines,
  canPush,
  overrideRowFor,
  normalizeSeazonaCode,
  CASE_STATUSES,
  canTransition,
  isFrozen,
  manualResolution,
} from "../admin-rx-cases.routes.js";

test("the queue defaults to everything needing attention", () => {
  assert.deepEqual(
    [...DEFAULT_QUEUE_STATUSES].sort(),
    ["awaiting_doctor", "failed", "in_review", "new"]
  );
  assert.ok(!DEFAULT_QUEUE_STATUSES.includes("pushed"));
  assert.ok(!DEFAULT_QUEUE_STATUSES.includes("cancelled"));
});

test("a noteOnly line is not counted as unmapped — it does not block a push", () => {
  const s = summariseLines([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: true },
  ]);
  assert.equal(s.lineCount, 2);
  assert.equal(s.unmappedCount, 0);
});

test("an open line that is not noteOnly counts as unmapped", () => {
  const s = summariseLines([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: false },
  ]);
  assert.equal(s.unmappedCount, 1);
});

test("a case with an unresolved line cannot be pushed", () => {
  assert.equal(canPush([{ status: "open", noteOnly: false }]).ok, false);
});

test("a case whose only open line is noteOnly can be pushed", () => {
  assert.equal(canPush([
    { status: "confirmed", noteOnly: false, seazonaCode: "2608" },
    { status: "open", noteOnly: true },
  ]).ok, true);
});

test("a case with no lines at all cannot be pushed", () => {
  const r = canPush([]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no lines/i);
});

test("a case whose only line is note-only has nothing to send", () => {
  // Guards the difference between "no lines" and "no SENDABLE lines" — an
  // implementation checking lines.length instead of emitting.length passes
  // every other test here and still lets this through.
  const r = canPush([{ status: "open", noteOnly: true }]);
  assert.equal(r.ok, false);
});

test("a line claiming to be confirmed with no code is refused, not trusted", () => {
  // canPush must not take a line's own claim about itself at face value.
  // Nothing upstream produces this shape today (statusForLine guards the
  // write path, the resolver routes codeless rows to unmapped) — but the
  // gate is the last check before a real order reaches the lab, and it must
  // hold even if a future producer gets it wrong.
  const r = canPush([{ seazonaCode: null, noteOnly: false, status: "confirmed", mapKey: "mod:x" }]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /product code/i);
  assert.deepEqual(r.blocking, ["mod:x"]);
});

test("an 'always' code assignment becomes an override row", () => {
  const row = overrideRowFor({
    mapKey: "mod:anterior-pad",
    seazonaCode: "2181",
    seazonaName: "Acrylic Palatal Pads",
    noteOnly: false,
    confirmedBy: "u1",
  });
  assert.equal(row.mapKey, "mod:anterior-pad");
  assert.equal(row.seazonaCode, "2181");
  assert.equal(row.noteOnly, false);
});

test("an 'always' note-only ruling is recorded without inventing a code", () => {
  const row = overrideRowFor({
    mapKey: "mod:wrap-distal",
    seazonaCode: null,
    noteOnly: true,
    confirmedBy: "u1",
  });
  assert.equal(row.seazonaCode, null);
  assert.match(row.note, /note only/i);
  // The ruling must be a real, queryable column — not only readable back out
  // of the human-language `note` text — because the resolver has to branch
  // on it later without parsing prose.
  assert.equal(row.noteOnly, true);
});

test("an override cannot be written without a mapKey to key it on", () => {
  assert.throws(() => overrideRowFor({ mapKey: null, seazonaCode: "2181" }), /mapKey/);
});

test("overrideRowFor clears a code paired with noteOnly — note-only wins", () => {
  // A partial update can send noteOnly: true while a real seazonaCode still
  // sits on the row from a previous edit. Both downstream readers (canPush,
  // itemFromOverride) key off noteOnly and would silently drop the code, so
  // the persisted row must not lie about what will actually happen.
  const row = overrideRowFor({
    mapKey: "x",
    seazonaCode: "1234",
    noteOnly: true,
  });
  assert.equal(row.seazonaCode, null);
  assert.equal(row.noteOnly, true);
});

test("overrideRowFor still passes a code through when noteOnly is false", () => {
  // Pins the normal path so the noteOnly-wins fix cannot over-reach.
  const row = overrideRowFor({
    mapKey: "x",
    seazonaCode: "1234",
    noteOnly: false,
  });
  assert.equal(row.seazonaCode, "1234");
});

test("normalizeSeazonaCode clears the code when noteOnly is true", () => {
  assert.equal(normalizeSeazonaCode({ seazonaCode: "1234", noteOnly: true }), null);
});

test("normalizeSeazonaCode keeps the code when noteOnly is false", () => {
  assert.equal(normalizeSeazonaCode({ seazonaCode: "1234", noteOnly: false }), "1234");
});

test("normalizeSeazonaCode is null-safe when there's no code and no ruling", () => {
  assert.equal(normalizeSeazonaCode({ seazonaCode: null, noteOnly: false }), null);
});

test("the six agreed states exist and nothing else", () => {
  assert.deepEqual([...CASE_STATUSES].sort(), [
    "awaiting_doctor", "cancelled", "failed", "in_review", "new", "pushed",
  ]);
});

test("a pushed case cannot be moved back — the Seazona order already exists", () => {
  assert.equal(canTransition("pushed", "in_review"), false);
  assert.equal(canTransition("pushed", "cancelled"), false);
});

test("a failed push can be retried or cancelled", () => {
  assert.equal(canTransition("failed", "in_review"), true);
  assert.equal(canTransition("failed", "cancelled"), true);
});

test("canTransition rejects a 'from' status the system does not recognise", () => {
  // A status canTransition doesn't recognise isn't a state anything should be
  // able to transition out of — the brief's version only checked `to` and the
  // pushed-is-terminal rule, so an unknown or undefined origin fell through to
  // `true`. That's the gap this pins closed.
  assert.equal(canTransition("bogus_status", "in_review"), false);
  assert.equal(canTransition(undefined, "in_review"), false);
  assert.equal(canTransition(null, "cancelled"), false);
});

test("canTransition still rejects an unrecognised 'to' status", () => {
  assert.equal(canTransition("new", "bogus_status"), false);
});

// ─────────────────────────────────────────────────────────────────────────
// isFrozen — the write guard for a pushed case's LINES (Task 9 fix 1).
//
// canTransition already makes `pushed` terminal for the case's status.
// isFrozen is the same rule applied to the case's CONTENTS: once pushed, the
// Seazona order already exists, so the four line-mutating routes (add/edit/
// delete a line, re-resolve) must refuse rather than silently drift from
// what the lab actually received.
// ─────────────────────────────────────────────────────────────────────────

test("a pushed case is frozen", () => {
  assert.equal(isFrozen("pushed"), true);
});

test("a non-pushed case is not frozen, including cancelled — that scope widening is a separate, unruled-on question", () => {
  for (const status of ["new", "in_review", "awaiting_doctor", "failed", "cancelled"]) {
    assert.equal(isFrozen(status), false, `${status} must not be frozen`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Wiring check: does each of the four line-mutating routes actually call
// the guard?
//
// This module has no Fastify-inject harness (every other test in this file
// exercises an exported pure function, never a running route — see the
// imports above), so the route handlers can't be invoked to prove the guard
// runs. The nearest available check that would still fail if the guard were
// deleted from one specific route is a static one: isolate that route's
// handler body by its registration line and confirm the guard call
// (refusePushedCase or an inline isFrozen check, for re-resolve which
// already has the row loaded) appears inside it. This proves the call site
// exists in the right place in the source; it does NOT prove the guard runs
// before the mutation or short-circuits the handler at runtime — that would
// need a real HTTP harness this module doesn't have.
// ─────────────────────────────────────────────────────────────────────────

const routesFilePath = join(dirname(fileURLToPath(import.meta.url)), "../admin-rx-cases.routes.js");
const routesSource = readFileSync(routesFilePath, "utf8");

function handlerSource(registrationMarker) {
  const start = routesSource.indexOf(registrationMarker);
  assert.ok(start >= 0, `route registration not found in source: ${registrationMarker}`);
  const next = routesSource.indexOf("\n  fastify.", start + registrationMarker.length);
  return routesSource.slice(start, next === -1 ? routesSource.length : next);
}

test("POST /admin/rx-cases/:id/lines is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.post("/admin/rx-cases/:id/lines",');
  assert.match(body, /refusePushedCase\(|isFrozen\(/);
});

test("PUT /admin/rx-cases/:id/lines/:lineId is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.put("/admin/rx-cases/:id/lines/:lineId",');
  assert.match(body, /refusePushedCase\(|isFrozen\(/);
});

test("DELETE /admin/rx-cases/:id/lines/:lineId is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.delete("/admin/rx-cases/:id/lines/:lineId",');
  assert.match(body, /refusePushedCase\(|isFrozen\(/);
});

test("POST /admin/rx-cases/:id/re-resolve is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.post("/admin/rx-cases/:id/re-resolve",');
  assert.match(body, /refusePushedCase\(|isFrozen\(/);
});

test("PUT /admin/rx-cases/:id/status is NOT double-gated by the new guard — canTransition already handles it, and the 409 shape must not change", () => {
  const body = handlerSource('fastify.put("/admin/rx-cases/:id/status",');
  assert.doesNotMatch(body, /refusePushedCase\(/);
});

// ─────────────────────────────────────────────────────────────────────────
// B2 — the four line-mutating routes must also refuse while a push is
// currently in flight (seazonaPushStatus === "pushing"), not just once the
// case is terminally `pushed`. refusePushedCase (and re-resolve's inline
// check, which reuses the same row it already loaded) now check both.
// ─────────────────────────────────────────────────────────────────────────

test("refusePushedCase checks seazonaPushStatus === 'pushing' in addition to isFrozen(status), and sends a distinct CASE_PUSH_IN_FLIGHT 409", () => {
  const start = routesSource.indexOf("async function refusePushedCase(caseId, reply) {");
  assert.ok(start >= 0, "refusePushedCase not found in source");
  const end = routesSource.indexOf("\n}\n", start);
  const body = routesSource.slice(start, end);
  assert.match(body, /seazonaPushStatus:\s*rxCases\.seazonaPushStatus/, "must select seazonaPushStatus, not just status");
  assert.match(body, /seazonaPushStatus\s*===\s*"pushing"/);
  assert.match(body, /pushInFlightRefusal\(\)/);
});

test("CASE_PUSH_IN_FLIGHT is a distinct code from CASE_ALREADY_PUSHED, not collapsed into it", () => {
  const start = routesSource.indexOf("function pushInFlightRefusal() {");
  assert.ok(start >= 0, "pushInFlightRefusal not found in source");
  const end = routesSource.indexOf("\n}\n", start);
  const body = routesSource.slice(start, end);
  assert.match(body, /CASE_PUSH_IN_FLIGHT/);
  assert.match(body, /409/);
  assert.doesNotMatch(body, /CASE_ALREADY_PUSHED/);
});

test("POST /admin/rx-cases/:id/lines is wired to the in-flight guard", () => {
  const body = handlerSource('fastify.post("/admin/rx-cases/:id/lines",');
  assert.match(body, /refusePushedCase\(/);
});

test("PUT /admin/rx-cases/:id/lines/:lineId is wired to the in-flight guard", () => {
  const body = handlerSource('fastify.put("/admin/rx-cases/:id/lines/:lineId",');
  assert.match(body, /refusePushedCase\(/);
});

test("DELETE /admin/rx-cases/:id/lines/:lineId is wired to the in-flight guard", () => {
  const body = handlerSource('fastify.delete("/admin/rx-cases/:id/lines/:lineId",');
  assert.match(body, /refusePushedCase\(/);
});

test("POST /admin/rx-cases/:id/re-resolve checks seazonaPushStatus === 'pushing' inline and sends pushInFlightRefusal", () => {
  const body = handlerSource('fastify.post("/admin/rx-cases/:id/re-resolve",');
  assert.match(body, /caseRowRaw\.seazonaPushStatus\s*===\s*"pushing"/);
  assert.match(body, /pushInFlightRefusal\(\)/);
});

test("the in-flight guard is NOT wired into the push route, mark-manual, or clear-push-lock — they own their own claim", () => {
  for (const marker of [
    PUSH_ROUTE_MARKER,
    'fastify.post("/admin/rx-cases/:id/mark-manual",',
    'fastify.put("/admin/rx-cases/:id/clear-push-lock",',
  ]) {
    const body = handlerSource(marker);
    assert.doesNotMatch(body, /refusePushedCase\(/, `${marker} must not call refusePushedCase`);
    assert.doesNotMatch(body, /pushInFlightRefusal\(/, `${marker} must not call pushInFlightRefusal`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/rx-cases/:id/push — Task 10 fix round 1, findings 2 and 3.
//
// Same limitation as the wiring checks above: no Fastify-inject harness
// exists in this repo, so these are static source checks on the push
// handler's registration body. They prove the refusal codes and the
// before-the-claim ordering exist at the right place in source — they do
// NOT prove the handler actually returns early at runtime without ever
// reaching the DB claim. That would need a real HTTP harness this module
// doesn't have.
// ─────────────────────────────────────────────────────────────────────────

const PUSH_ROUTE_MARKER = 'fastify.post("/admin/rx-cases/:id/push",';

test("POST /admin/rx-cases/:id/push refuses with 503 SEAZONA_ORDER_USER_NOT_CONFIGURED before claiming the case (fix 3)", () => {
  const body = handlerSource(PUSH_ROUTE_MARKER);
  const userCheckIdx = body.indexOf("env.SEAZONA_ORDER_USER_ID");
  const claimIdx = body.indexOf('seazonaPushStatus: "pushing"');
  assert.ok(userCheckIdx >= 0, "push route should check env.SEAZONA_ORDER_USER_ID");
  assert.ok(claimIdx >= 0, "push route should still claim the case once preflight passes");
  assert.ok(
    userCheckIdx < claimIdx,
    "the SEAZONA_ORDER_USER_ID check must run before the DB claim — refusing must not take and release a lock"
  );
  assert.match(body, /SEAZONA_ORDER_USER_NOT_CONFIGURED/);
  assert.match(body, /reply\.code\(503\)/);
});

test("POST /admin/rx-cases/:id/push gates on canPush before claiming the case, and refuses with 422 RX_PUSH_BLOCKED (fix 2)", () => {
  const body = handlerSource(PUSH_ROUTE_MARKER);
  const gateIdx = body.indexOf("canPush(lines)");
  const claimIdx = body.indexOf('seazonaPushStatus: "pushing"');
  assert.ok(gateIdx >= 0, "push route should call canPush(lines) as a route-level preflight");
  assert.ok(
    gateIdx < claimIdx,
    "the canPush gate must run before the DB claim — a refusal must not be recorded as a push failure"
  );
  assert.match(body, /RX_PUSH_BLOCKED/);
  assert.match(body, /reply\.code\(422\)/);
});

test("POST /admin/rx-cases/:id/push still calls pushCaseToSeazona, which re-runs canPush as defence in depth", () => {
  const body = handlerSource(PUSH_ROUTE_MARKER);
  assert.match(body, /pushCaseToSeazona\(/);
});

// ─── B1: a failed push must not always release the claim/lock ─────────────
//
// See push-case.service.test.js's shouldReleasePushLock tests for the actual
// decision logic (unit-tested there without a route). These are wiring
// checks proving the route defers to that function rather than writing
// outcome.status straight onto seazonaPushStatus (the bug: it released the
// lock on every failure, including one where Seazona was actually contacted
// and the result was ambiguous).

test("POST /admin/rx-cases/:id/push decides seazonaPushStatus via shouldReleasePushLock, not outcome.status directly", () => {
  const body = handlerSource(PUSH_ROUTE_MARKER);
  assert.match(body, /shouldReleasePushLock\(outcome\)/);
  assert.doesNotMatch(
    body,
    /seazonaPushStatus:\s*outcome\.status/,
    "seazonaPushStatus must not be set unconditionally to outcome.status — a contacted-but-ambiguous failure must keep the lock held"
  );
});

// ─────────────────────────────────────────────────────────────────────────
// manualResolution — Task 10b. "Staff typed this order into Seazona by hand"
// resolves the case exactly like a push (terminal, leaves the queue) but
// tags HOW it got there and preserves whatever was still unmapped at that
// moment, rather than letting the gate's bypass quietly erase it.
// ─────────────────────────────────────────────────────────────────────────

test("a manual resolution ends the case and tags how it got there", () => {
  const r = manualResolution([{ seazonaCode: "2608", noteOnly: false, status: "confirmed" }], { seazonaOrderId: "SZ-4471" });
  assert.equal(r.status, "pushed");
  assert.equal(r.seazonaPushStatus, "manual");
  assert.equal(r.seazonaOrderId, "SZ-4471");
});

test("the Seazona order number is optional", () => {
  const r = manualResolution([{ seazonaCode: "2608", noteOnly: false, status: "confirmed" }], {});
  assert.equal(r.status, "pushed");
  assert.equal(r.seazonaOrderId, null);
});

test("marking manual records what was still unmapped, rather than erasing it", () => {
  const r = manualResolution([
    { seazonaCode: "2608", noteOnly: false, status: "confirmed" },
    { seazonaCode: null, noteOnly: false, status: "open", mapKey: "mod:anterior-pad" },
  ], {});
  assert.equal(r.status, "pushed");
  assert.deepEqual(r.unresolvedAtManual, ["mod:anterior-pad"]);
});

test("a case with unmapped lines can still be marked manual — the gate does not apply", () => {
  const lines = [{ seazonaCode: null, noteOnly: false, status: "open", mapKey: "mod:anterior-pad" }];
  assert.equal(canPush(lines).ok, false, "precondition: this case cannot be pushed");
  assert.equal(manualResolution(lines, {}).status, "pushed", "but it can be recorded as done by hand");
});

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/rx-cases/:id/mark-manual — static source checks, same
// limitation as the push-route checks above (no Fastify-inject harness in
// this module): these prove the claim predicate, the gate bypass, and the
// audit shape exist at the right place in source. They do not prove the
// handler behaves this way at runtime.
// ─────────────────────────────────────────────────────────────────────────

const MARK_MANUAL_ROUTE_MARKER = 'fastify.post("/admin/rx-cases/:id/mark-manual",';

test("POST /admin/rx-cases/:id/mark-manual claims with the SAME full predicate as push — status AND the seazonaPushStatus pushing guard", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.match(body, /ne\(rxCases\.status, "pushed"\)/, "must not claim an already-pushed case");
  assert.match(
    body,
    /or\(isNull\(rxCases\.seazonaPushStatus\), ne\(rxCases\.seazonaPushStatus, "pushing"\)\)/,
    "must not claim a case whose push is genuinely in flight — a push in progress could still land in Seazona"
  );
});

test("POST /admin/rx-cases/:id/mark-manual refuses 409 when the claim finds nothing, and points staff at clear-push-lock", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.match(body, /reply\.code\(409\)/);
  assert.match(body, /clear-push-lock/, "the 409 message should point the operator at checking Seazona first, not just say no");
});

test("POST /admin/rx-cases/:id/mark-manual does NOT call canPush — a human already created the order", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.doesNotMatch(body, /canPush\(/);
});

test("POST /admin/rx-cases/:id/mark-manual is NOT gated by refusePushedCase/isFrozen — it does its own claim, like push", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.doesNotMatch(body, /refusePushedCase\(/);
  assert.doesNotMatch(body, /isFrozen\(/);
});

test("POST /admin/rx-cases/:id/mark-manual audits with rx_case.marked_manual and calls manualResolution", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.match(body, /manualResolution\(/);
  assert.match(body, /action:\s*"rx_case\.marked_manual"/);
});

// ─────────────────────────────────────────────────────────────────────────
// B4 — the mark-manual operator note is PHI-shaped (can name a patient) and
// must be encrypted at rest on rx_cases.manualNote, never written verbatim
// into audit_log.metadata (plaintext jsonb).
// ─────────────────────────────────────────────────────────────────────────

test("POST /admin/rx-cases/:id/mark-manual encrypts the note onto manualNote before persisting", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.match(body, /manualNote:\s*note\s*\?\s*encryptField\(note\)\s*:\s*null/);
});

test("POST /admin/rx-cases/:id/mark-manual audit metadata records only notePresent, never the note text", () => {
  const body = handlerSource(MARK_MANUAL_ROUTE_MARKER);
  assert.match(body, /notePresent:\s*!!note/);
  assert.doesNotMatch(
    body,
    /metadata:\s*\{[^}]*\bnote\s*:/s,
    "audit metadata must not carry the raw note — only notePresent"
  );
});

test("phi-crypto.js's TEXT_FIELDS includes manualNote — it is decrypted on every read path like every other free-text field", async () => {
  const phiCryptoPath = join(dirname(fileURLToPath(import.meta.url)), "../../services/rx/phi-crypto.js");
  const source = readFileSync(phiCryptoPath, "utf8");
  assert.match(source, /TEXT_FIELDS\s*=\s*\[[^\]]*"manualNote"[^\]]*\]/);
});

// ─────────────────────────────────────────────────────────────────────────
// C1 — admin file access must mirror the doctor-facing signed-URL route
// (rx.routes.js GET /rx/cases/:id/files/:fileId), not the raw stored
// pointer. Same reasoning as the guard tests above: this module has no
// fastify.inject harness, so these are static checks that the right calls
// exist in the right handler — not proof of runtime behaviour.
// ─────────────────────────────────────────────────────────────────────────

const FILE_ACCESS_ROUTE_MARKER = 'fastify.get("/admin/rx-cases/:id/files/:fileId",';

test("GET /admin/rx-cases/:id/files/:fileId is admin-gated, not doctor-gated", () => {
  const body = handlerSource(FILE_ACCESS_ROUTE_MARKER);
  assert.match(body, /preHandler:\s*\[authenticate,\s*requireAdmin\]/);
});

test("GET /admin/rx-cases/:id/files/:fileId signs the stored URL rather than returning it raw", () => {
  const body = handlerSource(FILE_ACCESS_ROUTE_MARKER);
  assert.match(body, /getSignedReadUrl\(fileRow\.gcsUrl\)/);
  assert.doesNotMatch(body, /data:\s*\{\s*url:\s*fileRow\.gcsUrl/, "must not hand back the raw stored pointer");
});

test("GET /admin/rx-cases/:id/files/:fileId verifies the file belongs to the requested case", () => {
  const body = handlerSource(FILE_ACCESS_ROUTE_MARKER);
  assert.match(body, /eq\(rxCaseFiles\.id,\s*request\.params\.fileId\)/);
  assert.match(body, /eq\(rxCaseFiles\.caseId,\s*caseRow\.id\)/);
});

test("GET /admin/rx-cases/:id/files/:fileId audits every access — broad admin access is not optional to log", () => {
  const body = handlerSource(FILE_ACCESS_ROUTE_MARKER);
  assert.match(body, /action:\s*"rx_case\.file_access"/);
  assert.match(body, /fileId:\s*fileRow\.id/);
});
