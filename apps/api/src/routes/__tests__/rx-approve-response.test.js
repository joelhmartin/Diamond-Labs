import { test } from "vitest";
import assert from "node:assert/strict";

// env.js validates required vars at import time; postgres-js connects lazily, so
// providing throwaway values lets us import the route module without a DB
// (same pattern as auth-security.test.js).
process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { buildIncompleteApprovalResponse } = await import("../rx.routes.js");
const { buildSeazonaOrderPayload } = await import("../../services/rx/build-order-payload.js");

// Regression for a review finding: /rx/cases/:id/approve merges an
// extraWarnings entry ("Seazona products unavailable…", added when
// listProducts() returns [] because Seazona is unreachable) with
// build-order-payload's own warnings BEFORE checking `ok`. An earlier
// version of the 422 handler used only the build-order-payload warnings,
// silently dropping the one message that explains the failure is an outage
// rather than a mapping gap — staff would chase a mapping bug that doesn't
// exist. This proves the merged list (mirroring exactly what the route
// computes at rx.routes.js) survives into the 422 `details`.
test("an unreachable-Seazona outage warning survives into the 422 details", () => {
  const extraWarnings = [
    "Seazona products unavailable — payload built without catalog code→id mapping.",
  ];
  // codeToId is empty, exactly as it is in the route when listProducts() returns [].
  const { warnings: buildWarnings, ok } = buildSeazonaOrderPayload(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" }, seazonaClientId: "c1" },
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false); // no catalog id resolves with an empty codeToId

  const warnings = [...extraWarnings, ...buildWarnings];
  const body = buildIncompleteApprovalResponse(warnings);

  assert.equal(body.error.code, "RX_PAYLOAD_INCOMPLETE");
  assert.ok(
    body.error.details.some((w) => w.includes("Seazona products unavailable")),
    "expected the outage warning to survive into details"
  );
});

test("buildIncompleteApprovalResponse passes the given warnings through verbatim as details", () => {
  const body = buildIncompleteApprovalResponse(["a", "b"]);
  assert.deepEqual(body.error.details, ["a", "b"]);
  assert.equal(body.error.status, 422);
});
