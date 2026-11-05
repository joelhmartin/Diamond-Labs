import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Everything under modules/ is meant to be liftable into another app, so it
// must not speak this app's domain. Add domain code under services/, not here.
const BANNED = /\b(lab|doctor|patient|dental|rx)\b/i;
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const ROOTS = [path.join(repo, "apps/api/src/modules"), path.join(repo, "apps/web/src/modules")];
// The two guard tests necessarily spell out their own word lists.
const GUARDS = [fileURLToPath(import.meta.url), path.join(here, "reports/no-domain-words.test.js")];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

test("modules contain no domain vocabulary", () => {
  const hits = [];
  for (const f of ROOTS.flatMap(walk)) {
    if (GUARDS.includes(f)) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (BANNED.test(line)) hits.push(`${path.relative(repo, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(hits).toEqual([]);
});
