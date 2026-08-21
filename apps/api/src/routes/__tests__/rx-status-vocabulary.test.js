import { test } from "vitest";
import assert from "node:assert/strict";

// env.js validates required vars at import time; postgres-js connects lazily, so
// providing throwaway values lets us import the route modules without a DB
// (same pattern as rx-approve-response.test.js).
process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { SUBMISSION_STATUS } = await import("../rx.routes.js");
const { DEFAULT_QUEUE_STATUSES } = await import("../admin-rx-cases.routes.js");
const { rxCases } = await import("../../db/schema/index.js");

// Regression for a real plan defect: the spec promised rx_cases.status would
// migrate off 'pending_approval' onto the new six-state vocabulary, but no
// task ever changed what the submit routes write. The admin queue's default
// filter (DEFAULT_QUEUE_STATUSES) and the status the submit routes actually
// write (SUBMISSION_STATUS) drifted apart with nothing to catch it — the
// queue silently returned zero rows forever. This pins the two together so a
// future rename on one side without the other fails loudly instead of
// quietly emptying the queue again.
test("a freshly-submitted case's status is one the admin queue shows by default", () => {
  assert.ok(
    DEFAULT_QUEUE_STATUSES.includes(SUBMISSION_STATUS),
    `SUBMISSION_STATUS ("${SUBMISSION_STATUS}") must be a member of DEFAULT_QUEUE_STATUSES ` +
      `(${JSON.stringify(DEFAULT_QUEUE_STATUSES)}) or newly-submitted cases never appear in the queue.`
  );
});

// The same defect, one layer down: the schema's declared column default is
// what a future insert path gets if it omits `status` entirely (both current
// insert paths now set it explicitly, but nothing stops a new one from
// forgetting to). Drizzle exposes the raw default value directly on the
// column config as `.default` (confirmed by inspecting `rxCases.status` —
// `{ default: "new", hasDefault: true, ... }`), so this reads the real
// configured default rather than assuming it matches SUBMISSION_STATUS.
test("the schema default is a status the queue actually looks for", () => {
  // A default nothing queries is how cases become invisible — the exact defect
  // SUBMISSION_STATUS exists to prevent. Pin the schema, not just the routes.
  const dflt = rxCases.status.default;
  assert.ok(
    DEFAULT_QUEUE_STATUSES.includes(dflt),
    `rx_cases.status defaults to ${JSON.stringify(dflt)}, which the queue never selects`
  );
});
