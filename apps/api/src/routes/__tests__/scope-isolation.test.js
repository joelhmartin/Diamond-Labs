import { test } from "vitest";
import assert from "node:assert/strict";

/**
 * Review Focus 1 (piece 11): a practice's staff member opening a SIBLING
 * practice's invoice, case, pickup, thread or statement, by id or
 * `?account=`, gets 404 NOT_FOUND every time (never 403, so ids can't be
 * probed). One row per client-facing route that takes an id or an account.
 *
 * Each row is a `test.todo` until the task that moves the route onto
 * services/client-scope.js flips it to a `test` (handler-source checks as in
 * rx-doctor-view.test.js, plus service-level fakes: practice A's member, a
 * record of sibling practice B, expect NOT_FOUND). The owner task is in each
 * name; when every row is a test, delete the todo loop.
 */
const SIBLING_ROUTES = [
  { route: "GET /invoices/:id", owner: "Task 5" },
  { route: "GET /invoices/:id/pdf", owner: "Task 5" },
  { route: "POST /payments/charge-saved", owner: "Task 5" },
  { route: "GET /invoices/statement.pdf?account=", owner: "Task 7" },
  { route: "GET /rx/cases/:id", owner: "Task 6" },
  { route: "GET /rx/cases/:id/files/:fileId", owner: "Task 6" },
  { route: "GET /pickups/:id", owner: "Task 6" },
  { route: "messaging thread open", owner: "Task 6" },
];

for (const { route, owner } of SIBLING_ROUTES) {
  test.todo(`${owner}: sibling ids read as not found: ${route}`);
}

test("the table covers every route Review Focus 1 names, each owned by a task", () => {
  const want = [
    "GET /invoices/:id", "GET /invoices/:id/pdf", "GET /invoices/statement.pdf?account=",
    "GET /rx/cases/:id", "GET /rx/cases/:id/files/:fileId", "GET /pickups/:id",
    "messaging thread open", "POST /payments/charge-saved",
  ];
  assert.deepEqual(SIBLING_ROUTES.map((r) => r.route).sort(), [...want].sort());
  for (const r of SIBLING_ROUTES) assert.match(r.owner, /^Task [567]$/, r.route);
});
