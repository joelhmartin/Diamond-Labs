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
 * practiceUserIds, openInvoicesForClient, doctorStatementUserIds), so a caller can't hide behind them.
 *
 * Excluded: the import pipeline and db scripts (identity matching), auth.service.js
 * (the Seazona link at registration is identity, not authorization), tests, and the
 * display-only files of the spec's table ("Every place that assumes one practice
 * per login"), which only show the legacy column.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["routes", "services", "middleware", "lib", "jobs"];
const EXCLUDED_DIRS = ["import", "db", "__tests__"];
// Identity, not authorization: the Seazona link at registration.
const EXCLUDED_FILES = new Set(["services/auth.service.js"]);
// Display-only files (spec table: routes/admin-payment.routes.js, routes/admin.routes.js,
// lib/refund-plan.js) are scanned like any other: a plain select of the column, or a
// truthiness check for a "linked" count, is not a comparison, so they pass on their own
// and a future comparison in them is caught.

/**
 * Known offenders, each removed by the task that moved it onto the scope. This
 * list only shrinks: a file here that no longer offends fails the test, so the
 * entry must be deleted in the same commit. Task 7 (statements) emptied it;
 * it must stay empty.
 */
const ALLOWED = new Map();

const MENTION = /seazona_?client_?id/i;
// JS comparisons and query/collection membership tests. Whitespace before "(" is allowed.
const COMPARISON = /===|!==|[^=!<>]==[^=]|!=[^=]|\b(eq|ne|inArray|notInArray)\s*\(|\.(includes|has|indexOf)\s*\(|\bObject\.is\s*\(/;
// Raw SQL: the column (or an interpolated field) followed by =, <>, !=, IN or ANY.
const RAW_SQL = /seazona_?client_?id["\w.]*\)?\s*(=(?!=)|<>|!=|\bin\b|=\s*any\b)/i;
const LEGACY_RULES = /\b(canActOnInvoiceLegacy|practiceUserIds|openInvoicesForClient|doctorStatementUserIds)\b/;

/** Does one statement (see statements()) authorize by the Seazona id? */
function offends(statement) {
  if (LEGACY_RULES.test(statement)) return true;
  return MENTION.test(statement) && (COMPARISON.test(statement) || RAW_SQL.test(statement));
}

/**
 * A source file → its statements with their first line number. Comments are
 * blanked (length kept, so offsets map to lines); `${x}` becomes `(x)` so a
 * template's interpolations stay inside one statement; then the text splits
 * on ; { } and on commas outside ( and [ . A multi-line call
 * (`.where(eq(\n users.seazonaClientId,\n x))`) is therefore one statement,
 * while each property of an object literal (a selected column, a count) is its own.
 */
function statements(source) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)))
    .replace(/\$\{([^{}]*)\}/g, (_m, inner) => ` (${inner})`);
  const out = [];
  let begin = 0;
  let depth = 0; // ( and [ nesting since the last boundary: a comma splits only outside them
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if ((ch === ")" || ch === "]") && depth > 0) depth -= 1;
    const boundary = i === text.length || ch === ";" || ch === "{" || ch === "}" || (ch === "," && depth === 0);
    if (boundary) {
      if (ch !== ",") depth = 0;
      const chunk = text.slice(begin, i);
      if (chunk.trim()) {
        const lead = chunk.length - chunk.trimStart().length;
        out.push({ line: text.slice(0, begin + lead).split("\n").length, text: chunk.trim().replace(/\s+/g, " ") });
      }
      begin = i + 1;
    }
  }
  return out;
}

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
      const hits = statements(readFileSync(file, "utf8")).filter((st) => offends(st.text));
      if (hits.length) out.set(rel, hits.map((h) => `${rel}:${h.line}: ${h.text.slice(0, 160)}`));
    }
  }
  return out;
}

test("no route, service, middleware, lib or job compares seazonaClientId for authorization (beyond the shrinking allow-list)", () => {
  const found = offenders();
  const fresh = [...found].filter(([file]) => !ALLOWED.has(file)).flatMap(([, lines]) => lines);
  assert.deepEqual(fresh, [], "authorize through services/client-scope.js, not seazonaClientId");
});

test("every allow-listed file still offends (delete its entry when its task moves it onto the scope)", () => {
  const found = offenders();
  const stale = [...ALLOWED].filter(([file]) => !found.has(file)).map(([file, task]) => `${file} (${task})`);
  assert.deepEqual(stale, []);
});

const caught = (src) => statements(src).some((st) => offends(st.text));

test("the guard catches every comparison form, across lines", () => {
  for (const src of [
    "if (String(user.seazonaClientId) === String(owner)) { x(); }",
    "if (a.seazonaClientId !== b) return;",
    "if (a.seazonaClientId != b) return;",
    "const ok = a.seazonaClientId == b;",
    ".where(eq(users.seazonaClientId, x));",
    ".where(eq (users.seazonaClientId, x));",
    "const rows = await db.select().from(users)\n  .where(eq(\n    users.seazonaClientId,\n    owner,\n  ));",
    "conds.push(inArray(users.seazonaClientId, practices));",
    "conds.push(ne(users.seazonaClientId, x));",
    "const ok = ids.includes(user.seazonaClientId);",
    "const ok = allowed.has(user.seazonaClientId);",
    "const ok = Object.is(user.seazonaClientId, o);",
    "const q = sql`${users.seazonaClientId} = ${x}`;",
    "await db.execute(sql`select id from users where seazona_client_id = ${x}`);",
    "const q = 'select id from users where seazona_client_id = $1';",
    "const q = `where u.seazona_client_id in (${ids})`;",
    "const q = 'where seazona_client_id <> $1';",
    "canActOnInvoiceLegacy(user, inv, inv.ownerSeazonaClientId);",
    "const ids = await practiceUserIds(user);",
  ]) assert.ok(caught(src), src);
});

test("display uses of the column are not offenders", () => {
  for (const src of [
    "db.select({ id: users.id, seazonaClientId: users.seazonaClientId }).from(users).where(eq(users.id, id));",
    "const linked = rows.filter((u) => u.seazonaClientId).length;",
    "const { id, seazonaClientId } = request.user;",
    "// if (a.seazonaClientId === b) a comment is not code",
    "/* eq(users.seazonaClientId, x) */ const y = 1;",
    "const row = { seazonaClientId: seazonaClientId || null, name };",
    "return { admins: rows.filter((u) => u.role === \"admin\").length, linked: rows.filter((u) => u.seazonaClientId).length };",
  ]) assert.ok(!caught(src), src);
});

test("the allow-list is empty: every client read and write goes through the scope", () => {
  assert.equal(ALLOWED.size, 0);
});
