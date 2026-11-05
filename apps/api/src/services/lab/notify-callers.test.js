import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const { clearEvents, listEvents } = await import("../../modules/notifications/index.js");
const { registerLabNotificationEvents } = await import("./lab-notifications.js");

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) yield full;
  }
}

// Emitters: files that call notify( and pass an `event: "<dotted.key>"` literal
// (inline, or in a helper that builds the notify() arguments). The seam and the
// notifications module itself are not emitters.
function emittedKeys() {
  const keys = new Map();
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split(sep).join("/");
    if (rel === "services/notify-seam.js" || rel.startsWith("modules/notifications/")) continue;
    const text = readFileSync(file, "utf8");
    if (!/\bnotify\s*\(/.test(text)) continue;
    for (const m of text.matchAll(/\bevent\s*:\s*["']([a-z0-9_]+(?:\.[a-z0-9_]+)+)["']/g)) {
      if (!keys.has(m[1])) keys.set(m[1], []);
      keys.get(m[1]).push(rel);
    }
  }
  return keys;
}

test("every event key passed to notify() in apps/api/src is registered", () => {
  clearEvents();
  registerLabNotificationEvents();
  const registered = new Set(listEvents().map((e) => e.key));
  const keys = emittedKeys();
  assert.ok(keys.size >= 5, "the scan found the known emitters");
  const missing = [...keys].filter(([k]) => !registered.has(k)).map(([k, files]) => `${k} (${files.join(", ")})`);
  assert.deepEqual(missing, [], `notify() emits events registerLabNotificationEvents() does not register: ${missing.join("; ")}`);
});
