import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Piece 11 guard: no route or service authorizes by the legacy Seazona client
 * id. Client access goes through services/client-scope.js. A line that names
 * seazonaClientId (any casing, any prefix such as ownerSeazonaClientId) and
 * compares (===, !==, ==, !=, eq(, ne(, inArray() is an offender, and so is
 * any call of the pre-scope rules built on it (canActOnInvoiceLegacy,
 * practiceUserIds, openInvoicesForClient), so a caller can't hide behind them.
 *
 * Excluded: the import pipeline and db scripts (identity matching), auth.service.js
 * (the Seazona link at registration is identity, not authorization), tests, and the
 * display-only files of the spec's table ("Every place that assumes one practice
 * per login"), which only show the legacy column.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["routes", "services"];
const EXCLUDED_DIRS = ["import", "db", "__tests__"];
const EXCLUDED_FILES = new Set([
  "services/auth.service.js",
  // Display only (spec table): they keep the legacy column beside accountNumber.
  "routes/admin-payment.routes.js",
  "routes/admin.routes.js",
]);

/**
 * Known offenders, each removed by the task that moves it onto the scope. This
 * list only shrinks: a file here that no longer offends fails the test, so the
 * entry must be deleted in the same commit. Task 7 leaves it empty.
 */
const ALLOWED = new Map([
  // Task 5 (billing): canActOnInvoiceLegacy, practiceUserIds, openInvoicesForClient and their callers.
  ["routes/invoice.routes.js", "Task 5"],
  ["services/billing/invoice-rules.js", "Task 5"],
  ["services/billing/ledger.service.js", "Task 5"],
  ["services/payment-recording.service.js", "Task 5"],
  ["services/autopay-runner.service.js", "Task 5"],
  ["services/billing/account-credit.service.js", "Task 5"],
  ["services/billing/invoice-actions.service.js", "Task 5"],
  // Task 6 (cases, messages, pickups, deliveries): the practice:X audience.
  ["services/lab/lab-notifications.js", "Task 6"],
  // Task 7 (statements): the per-practice statement run (practiceKey, practiceUserIds).
  ["services/billing/statement-run.service.js", "Task 7"],
]);

const MENTION = /seazona_?client_?id/i;
const COMPARISON = /===|!==|[^=!<>]==[^=]|!=[^=]|\beq\(|\bne\(|\binArray\(/;
const LEGACY_RULES = /\b(canActOnInvoiceLegacy|practiceUserIds|openInvoicesForClient)\b/;
const offends = (text) => (MENTION.test(text) && COMPARISON.test(text)) || LEGACY_RULES.test(text);

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDED_DIRS.includes(name)) yield* sourceFiles(full);
    } else if (name.endsWith(".js") && !name.endsWith(".test.js")) {
      yield full;
    }
  }
}

function offenders() {
  const out = new Map();
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(SRC, root))) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (EXCLUDED_FILES.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n")
        .map((text, i) => ({ text, line: i + 1 }))
        .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text) && offends(text));
      if (lines.length) out.set(rel, lines.map((l) => `${rel}:${l.line}: ${l.text.trim()}`));
    }
  }
  return out;
}

test("no route or service compares seazonaClientId for authorization (beyond the shrinking allow-list)", () => {
  const found = offenders();
  const fresh = [...found].filter(([file]) => !ALLOWED.has(file)).flatMap(([, lines]) => lines);
  assert.deepEqual(fresh, [], "authorize through services/client-scope.js, not seazonaClientId");
});

test("every allow-listed file still offends (delete its entry when its task moves it onto the scope)", () => {
  const found = offenders();
  const stale = [...ALLOWED].filter(([file]) => !found.has(file)).map(([file, task]) => `${file} (${task})`);
  assert.deepEqual(stale, []);
});

test("the guard sees a comparison when there is one", () => {
  // Sanity: the patterns catch the forms the old rule used.
  for (const line of [
    "if (String(user.seazonaClientId) === String(owner)) {",
    ".where(eq(users.seazonaClientId, x))",
    "conds.push(inArray(users.seazonaClientId, practices));",
    "canActOnInvoiceLegacy(user, inv, inv.ownerSeazonaClientId) && a != b",
  ]) assert.ok(offends(line), line);
  assert.ok(offends("const ids = await practiceUserIds(user);"), "a legacy rule call");
  assert.ok(!offends("seazonaClientId: users.seazonaClientId,"), "a plain select is display");
});
