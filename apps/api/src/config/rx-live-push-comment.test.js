import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// B5 — env.js's RX_LIVE_PUSH comment is the one an operator reads before
// flipping a production flag that creates real lab orders. Two reviewers
// flagged the OLD comment as actively dangerous: it described a since-
// deleted route (/rx/cases/:id/approve) that dry-ran regardless of the
// flag, and claimed RX_LIVE_PUSH "does NOT call seazonaService.createOrder"
// — false of the auto-push this branch actually shipped (rx.routes.js,
// POST /rx/form-submissions), which really does create live Seazona orders
// when the flag is "true". This is a static-source pin so the comment can't
// silently regress back to that false claim.

const envPath = join(dirname(fileURLToPath(import.meta.url)), "env.js");
const source = readFileSync(envPath, "utf8");

function commentBlockFor(marker) {
  const idx = source.indexOf(marker);
  assert.ok(idx >= 0, `${marker} not found in env.js`);
  // The RX_LIVE_PUSH comment block sits directly above the field declaration.
  const start = source.lastIndexOf("// Digital Rx live Seazona push gate.", idx);
  assert.ok(start >= 0, "RX_LIVE_PUSH comment header not found");
  return source.slice(start, idx);
}

test("the RX_LIVE_PUSH comment no longer claims the flag is inert / a dry-run stub", () => {
  const block = commentBlockFor("RX_LIVE_PUSH: z.string().optional(),");
  // The old comment's dangerous, currently-false claim — the exact thing
  // that would mislead an operator into thinking the flag is safe to flip.
  assert.doesNotMatch(block, /does NOT call seazonaService\.createOrder/);
  assert.doesNotMatch(block, /currently a stub/);
  assert.doesNotMatch(block, /still dry-runs/);
  // It may reference the deleted route as HISTORY (why the old claim was
  // wrong), but must say plainly that IT (the flag, today) is live.
  assert.match(block, /is LIVE/);
});

test("the RX_LIVE_PUSH comment names its real, current consumer and states it creates live orders", () => {
  const block = commentBlockFor("RX_LIVE_PUSH: z.string().optional(),");
  assert.match(block, /\/rx\/form-submissions/);
  assert.match(block, /SEAZONA_ORDER_USER_ID/);
  assert.match(block, /createOrder/);
});
