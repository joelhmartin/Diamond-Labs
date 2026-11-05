import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Generic modules (apps/api/src/modules, apps/web/src/modules) are written to
// be lifted into another app, so they must not speak this app's domain. Glue
// that knows the domain lives under services/ and pages/, never here.
const BANNED = /\b(lab|doctor|patient|dental|rx)\b/i;
const SELF = fileURLToPath(import.meta.url);
const API_MODULES = fileURLToPath(new URL(".", import.meta.url));
const WEB_MODULES = fileURLToPath(new URL("../../../web/src/modules/", import.meta.url));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p !== SELF) out.push(p);
  }
  return out;
}

test("generic modules contain no domain words", () => {
  const files = [...walk(API_MODULES), ...walk(WEB_MODULES)];
  assert.ok(files.length > 0, "module discovery looks broken");
  const hits = [];
  for (const file of files) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const m = line.match(BANNED);
      if (m) hits.push(`${file}:${i + 1}: "${m[0]}"`);
    });
  }
  assert.deepEqual(hits, [], `domain words in generic modules:\n${hits.join("\n")}`);
});
