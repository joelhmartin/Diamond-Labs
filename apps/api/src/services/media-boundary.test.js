import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Everything written through media.service.js is served PUBLICLY by
 * GET /api/v1/media/:name. It must only ever hold admin-uploaded product /
 * catalog images — never anything patient-related (Rx case files, scans,
 * photos), which belong in the private Rx bucket via storage.service.js and
 * are read through short-lived signed URLs.
 *
 * So the only code allowed to import media.service.js is the admin media
 * route. A new importer fails this test and forces that decision to be made
 * on purpose.
 */
const SRC = fileURLToPath(new URL("../", import.meta.url));
const ALLOWED = new Set(["routes/media.routes.js", "services/media.service.js"]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* files(p);
    else if (/\.m?js$/.test(name) && !/\.test\.m?js$/.test(name)) yield p;
  }
}

test("only the admin media route writes to the publicly served media store", () => {
  const importers = [];
  for (const f of files(SRC)) {
    const rel = relative(SRC, f);
    if (ALLOWED.has(rel)) continue;
    if (/media\.service(\.js)?["']/.test(readFileSync(f, "utf8"))) importers.push(rel);
  }
  assert.deepEqual(importers, [], `Unexpected importers of media.service.js (served publicly): ${importers.join(", ")}`);
});

test("Rx file storage never points at the media bucket", () => {
  const rx = readFileSync(join(SRC, "services/storage.service.js"), "utf8");
  assert.doesNotMatch(rx, /MEDIA_GCS_BUCKET|media\.service/);
});
