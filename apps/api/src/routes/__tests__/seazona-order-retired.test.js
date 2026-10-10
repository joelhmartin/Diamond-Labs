import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// own-the-lab piece 2 retired Seazona as the system of record for orders:
// nothing may send an order to Seazona, and the UI may not offer to. This
// scans source (code AND comments — a stale comment telling a reader to "use
// clear-push-lock" is its own bug) so a revert or a copy-paste from main
// can't quietly bring the path back. Seazona reads (getOrders/getOrder) stay
// in seazona.service.js for piece 5's import.

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = join(here, "../../../../../");
const ROOTS = ["apps/api/src", "apps/api/scripts", "apps/web/src", "scripts"].map((p) => join(repo, p));
const SELF = fileURLToPath(import.meta.url);

const FORBIDDEN = [
  /createOrder\(/, /pushCaseToSeazona/, /payloadFromLines/, /buildSeazonaOrderPayload/, /pushOrderToSeazona/,
  /resolveOrderPushStatus/, /shouldReleasePushLock/, /shouldAutoPush/, /\/mark-manual/, /\/clear-push-lock/,
  /\/rx-mapping\/send-test/, /RX_LIVE_PUSH/, /SEAZONA_ORDER_USER_ID/, /seazonaService\.getOrders?\(/,
  /Push to Seazona/, /MarkManualModal/, /build-order-payload/, /order-diff/, /manualResolution/,
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|jsx|mjs)$/.test(name) && p !== SELF) yield p;
  }
}

test("no code path sends an order to Seazona or offers to", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${relative(repo, file)}: ${re}`);
    }
  }
  assert.deepEqual(hits, []);
});
