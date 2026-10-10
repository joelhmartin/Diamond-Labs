import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression for a review finding: the RX_LIVE_PUSH auto-push block in
// rx.routes.js used to write its outcome with an unconditional
// `.where(eq(rxCases.id, caseId))` and never claimed the row first. Seazona
// has no idempotency key, so a race between auto-push and an admin clicking
// Push in the queue could call createOrder() twice for the same case — a
// real duplicate manufacturing order a human has to go find and delete.
//
// The fix is to mirror admin-rx-cases.routes.js's push-route claim
// predicate EXACTLY rather than hand-writing a second copy — two
// independently-written duplicate-order guards is how they drift apart.
// There is no DB-backed test harness in this suite (every route test here
// imports pure functions rather than booting Fastify against a real
// database — see push-case.service.test.js's own "no circular import"
// source-inspection test for the established precedent), so this pins the
// invariant at the source level: both files must contain the identical
// claim predicate.

const rxRoutesPath = fileURLToPath(new URL("../rx.routes.js", import.meta.url));
const adminRoutesPath = fileURLToPath(new URL("../admin-rx-cases.routes.js", import.meta.url));
const rxRoutesSource = readFileSync(rxRoutesPath, "utf8");
const adminRoutesSource = readFileSync(adminRoutesPath, "utf8");

// The exact claim predicate from admin-rx-cases.routes.js's
// POST /admin/rx-cases/:id/push (the "pushing" sentinel claim). Matched with
// free-form whitespace between the two conditions since the two call sites
// sit at different nesting depths (a top-level route handler vs. a block
// nested inside auto-push's try/if chain) — indentation legitimately
// differs; the predicate itself must not.
const CLAIM_PREDICATE_RE =
  /ne\(rxCases\.status, "pushed"\),\s*\n\s*or\(isNull\(rxCases\.seazonaPushStatus\), ne\(rxCases\.seazonaPushStatus, "pushing"\)\),/;

test("admin push route's claim predicate is present verbatim (sanity check on the pattern below)", () => {
  assert.match(
    adminRoutesSource,
    CLAIM_PREDICATE_RE,
    "admin-rx-cases.routes.js's push route claim predicate has changed shape — update CLAIM_PREDICATE_RE in this test to match, then re-verify rx.routes.js still mirrors it"
  );
});

test("rx.routes.js's auto-push claim uses the SAME predicate as the admin push route, not a hand-written copy", () => {
  assert.match(
    rxRoutesSource,
    CLAIM_PREDICATE_RE,
    "rx.routes.js's auto-push block must claim the row with the exact same " +
      "(status != 'pushed') AND (seazonaPushStatus is null OR != 'pushing') " +
      "predicate admin-rx-cases.routes.js's push route uses — a second, " +
      "independently-written guard is how the two drift apart"
  );
});

test("both push claims refuse released cases (a released case must never be pushed or overwritten)", () => {
  const REFUSE = /ne\(rxCases\.status, "released"\),\s*\n\s*ne\(rxCases\.status, "pushed"\),\s*\n\s*or\(isNull\(rxCases\.seazonaPushStatus\), ne\(rxCases\.seazonaPushStatus, "pushing"\)\),/;
  assert.match(adminRoutesSource, REFUSE, "admin push claim must exclude released");
  assert.match(rxRoutesSource, REFUSE, "auto-push claim must exclude released");
});

test("rx.routes.js sets seazonaPushStatus to the 'pushing' sentinel before calling pushCaseToSeazona", () => {
  assert.match(
    rxRoutesSource,
    /\.set\(\{ seazonaPushStatus: "pushing", updatedAt: new Date\(\) \}\)/,
    "expected the auto-push block to claim the case with the same 'pushing' sentinel the admin push route uses"
  );
});

test("rx.routes.js's final auto-push outcome write is conditioned on still holding the 'pushing' claim", () => {
  assert.match(
    rxRoutesSource,
    /\.where\(and\(eq\(rxCases\.id, caseId\), eq\(rxCases\.seazonaPushStatus, "pushing"\)\)\)/,
    "the outcome write after pushCaseToSeazona resolves must be conditioned on " +
      "eq(rxCases.id, caseId) AND eq(rxCases.seazonaPushStatus, 'pushing') so a " +
      "lost claim can never overwrite a concurrently-recorded outcome"
  );
});

test("the legacy unconditional auto-push write is gone", () => {
  assert.doesNotMatch(
    rxRoutesSource,
    /\.set\(updateValues\)\.where\(eq\(rxCases\.id, caseId\)\);/,
    "found the old unconditional `.where(eq(rxCases.id, caseId))` outcome write — " +
      "this must be conditioned on the 'pushing' claim (see the test above)"
  );
});

// ─────────────────────────────────────────────────────────────────────────
// B1's fix mirrored here too: this auto-push path is an independent write
// site for the exact same outcome shape (status/contactedSeazona) the admin
// push route interprets — if only the admin route deferred to
// shouldReleasePushLock, this path would keep the original bug (a failed-
// but-contacted outcome silently releasing the lock) even after B1 shipped.
// See push-case.service.test.js's shouldReleasePushLock tests for the
// decision logic itself.
// ─────────────────────────────────────────────────────────────────────────

test("rx.routes.js imports shouldReleasePushLock from push-case.service.js", () => {
  assert.match(
    rxRoutesSource,
    /import\s*\{[^}]*shouldReleasePushLock[^}]*\}\s*from\s*["']\.\.\/services\/rx\/push-case\.service\.js["']/
  );
});

test("rx.routes.js's auto-push outcome write decides seazonaPushStatus via shouldReleasePushLock, not outcome.status directly", () => {
  assert.match(rxRoutesSource, /shouldReleasePushLock\(outcome\)/);
  assert.doesNotMatch(
    rxRoutesSource,
    /seazonaPushStatus:\s*outcome\.status/,
    "seazonaPushStatus must not be set unconditionally to outcome.status — a contacted-but-ambiguous failure must keep the lock held"
  );
});
