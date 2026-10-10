import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handlerSource as sharedHandlerSource } from "./_source.js";
import {
  DEFAULT_QUEUE_STATUSES,
  summariseLines,
  canRelease,
  overrideRowFor,
  normalizeSeazonaCode,
  CASE_STATUSES,
  canTransition,
  isFrozen,
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
  assert.equal(canRelease([{ status: "open", noteOnly: false }]).ok, false);
});

test("a case whose only open line is noteOnly can be pushed", () => {
  assert.equal(canRelease([
    { status: "confirmed", noteOnly: false, seazonaCode: "2608" },
    { status: "open", noteOnly: true },
  ]).ok, true);
});

test("a case with no lines at all cannot be pushed", () => {
  const r = canRelease([]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no lines/i);
});

test("a case whose only line is note-only has nothing to send", () => {
  // Guards the difference between "no lines" and "no SENDABLE lines" — an
  // implementation checking lines.length instead of emitting.length passes
  // every other test here and still lets this through.
  const r = canRelease([{ status: "open", noteOnly: true }]);
  assert.equal(r.ok, false);
});

test("a line claiming to be confirmed with no code is refused, not trusted", () => {
  // canRelease must not take a line's own claim about itself at face value.
  // Nothing upstream produces this shape today (statusForLine guards the
  // write path, the resolver routes codeless rows to unmapped) — but the
  // gate is the last check before a real order reaches the lab, and it must
  // hold even if a future producer gets it wrong.
  const r = canRelease([{ seazonaCode: null, noteOnly: false, status: "confirmed", mapKey: "mod:x" }]);
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
  // sits on the row from a previous edit. Both downstream readers (canRelease,
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

test("the seven agreed states exist and nothing else", () => {
  assert.deepEqual([...CASE_STATUSES].sort(), [
    "awaiting_doctor", "cancelled", "failed", "in_review", "new", "pushed", "released",
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

const handlerSource = (marker) => sharedHandlerSource(routesSource, marker);

test("POST /admin/rx-cases/:id/lines is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.post("/admin/rx-cases/:id/lines",');
  assert.match(body, /refuseFrozenCase\(|isFrozen\(/);
});

test("PUT /admin/rx-cases/:id/lines/:lineId is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.put("/admin/rx-cases/:id/lines/:lineId",');
  assert.match(body, /refuseFrozenCase\(|isFrozen\(/);
});

test("DELETE /admin/rx-cases/:id/lines/:lineId is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.delete("/admin/rx-cases/:id/lines/:lineId",');
  assert.match(body, /refuseFrozenCase\(|isFrozen\(/);
});

test("POST /admin/rx-cases/:id/re-resolve is wired to the pushed-case guard", () => {
  const body = handlerSource('fastify.post("/admin/rx-cases/:id/re-resolve",');
  assert.match(body, /refuseFrozenCase\(|isFrozen\(/);
});

test("PUT /admin/rx-cases/:id/status is NOT double-gated by the new guard — canTransition already handles it, and the 409 shape must not change", () => {
  const body = handlerSource('fastify.put("/admin/rx-cases/:id/status",');
  assert.doesNotMatch(body, /refuseFrozenCase\(/);
});

test("phi-crypto.js's TEXT_FIELDS still includes manualNote — legacy rows hold encrypted operator notes and must decrypt on every read path", async () => {
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

test("GET /admin/rx-cases/:id/files/:fileId is staff-gated (admin or lab), not doctor-gated", () => {
  const body = handlerSource(FILE_ACCESS_ROUTE_MARKER);
  assert.match(body, /preHandler:\s*\[authenticate,\s*requireRole\(\.\.\.STAFF_ROLES\)\]/);
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

import { parseStatusFilter } from "../admin-rx-cases.routes.js";

test("the queue reads comma-separated status filters (Resolved = released + legacy pushed)", () => {
  assert.deepEqual(parseStatusFilter("released,pushed"), ["released", "pushed"]);
  assert.deepEqual(parseStatusFilter(["new", "failed,new"]), ["new", "failed"]);
  assert.deepEqual(parseStatusFilter(undefined), DEFAULT_QUEUE_STATUSES);
});

test("a released case's lines refuse edits with their own code", () => {
  const start = routesSource.indexOf("function frozenCaseRefusal(status) {");
  assert.ok(start >= 0);
  const body = routesSource.slice(start, routesSource.indexOf("\n}\n", start));
  assert.match(body, /CASE_RELEASED/);
  assert.match(body, /CASE_ALREADY_PUSHED/);
});

test("the Seazona push, mark-manual and clear-lock routes are gone", () => {
  // Pieced together so this file does not itself trip seazona-order-retired.
  const base = "/admin/rx-cases/:id/";
  for (const r of [`${base}push"`, `${base}mark-` + `manual`, `${base}clear-push-` + `lock`]) {
    assert.ok(!routesSource.includes(r), r);
  }
});

test("every remaining mutation on a case is staff-guarded; the destructive ones are admin-only", () => {
  // mark-manual (the riskiest legacy mutation) no longer exists; what is left
  // must not have quietly loosened.
  const adminOnly = [
    'fastify.put("/admin/rx-cases/:id/lines/:lineId",',
    'fastify.post("/admin/rx-cases/:id/lines",',
    'fastify.delete("/admin/rx-cases/:id/lines/:lineId",',
    'fastify.put("/admin/rx-cases/:id/status",',
    'fastify.post("/admin/rx-cases/:id/re-resolve",',
  ];
  for (const m of adminOnly) assert.match(handlerSource(m), /requireAdmin/, m);
});
