import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Seazona blocks the WHOLE integration — production included — when its
 * 60 requests/minute limit is exceeded. seazona.service.js is the only place
 * that limit is enforced, so it must be the only code that reads the Seazona
 * credentials or talks to the Seazona host. Anything else is a bypass.
 * (Happened 2026-10-05: raw-fetch scripts got the integration blocked.)
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SCAN = ["apps", "packages", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage"]);
const ALLOWED = new Set([
  "apps/api/src/services/seazona.service.js",
  "apps/api/src/config/env.js",
]);
const DIRECT_ACCESS = /process\.env(\.|\[["'])SEAZONA_|seazonaapi\.net|labzona\.net/;

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = lstatSync(p); // lstat: never follow (possibly broken) symlinks
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* sourceFiles(p);
    else if (/\.(m|c)?[jt]sx?$/.test(name) && !/\.test\.[jt]sx?$/.test(name)) yield p;
  }
}

test("only seazona.service.js reads the Seazona credentials or calls the Seazona host", () => {
  const offenders = [];
  for (const top of SCAN) {
    for (const file of sourceFiles(join(ROOT, top))) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      if (DIRECT_ACCESS.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These files bypass seazona.service.js (and its 60/min rate limit): ${offenders.join(", ")}. Import the service instead.`
  );
});
