import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// (/admin/rx-cases is staff-guarded on the API, so it is allowed.) Lab staff (role "lab") can't call admin-only routes: lab screens must use /lab, /files, /tags lookups.
const dirs = [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../../pages/lab/", import.meta.url))];

function* sources(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) yield* sources(join(dir, e.name));
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) yield join(dir, e.name);
  }
}

test("no lab component or page calls an /admin/ API path", () => {
  const offenders = [];
  for (const dir of dirs) {
    for (const file of sources(dir)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/api\.(get|post|put|patch|delete)\(\s*[`"']\/admin\/(?!rx-cases\/)/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
