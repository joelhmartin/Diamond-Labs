import { test } from "vitest";
import assert from "node:assert/strict";
import { releaseBlockedReason } from "./AdminRxCaseDetailPage.jsx";
import { caseStatusLabel } from "../../lib/rx-case-labels.js";

test("the release button explains why it is disabled, rather than just being grey", () => {
  const reason = releaseBlockedReason([{ status: "open", noteOnly: false, sourceLabel: "Anterior Pad" }]);
  assert.match(reason, /Anterior Pad/);
});

test("nothing blocking means no reason", () => {
  assert.equal(releaseBlockedReason([{ status: "confirmed", noteOnly: false, seazonaCode: "2608" }]), null);
});

// The server's canRelease deliberately does not trust a line's own `status` — it
// blocks any sendable line with no seazonaCode, whatever the status claims.
// This helper mirrors that whole rule, not half of it: checking only `status`
// would light Release up for a case the server then refuses with a 422, which is
// exactly the dead end the helper exists to prevent.
test("a line claiming 'confirmed' with no product code still blocks", () => {
  assert.match(
    releaseBlockedReason([{ status: "confirmed", noteOnly: false, sourceLabel: "Anterior Pad" }]),
    /Anterior Pad/,
  );
});

test("a note-only line never blocks the release, even while still 'open'", () => {
  assert.equal(
    releaseBlockedReason([
      { status: "confirmed", noteOnly: false, seazonaCode: "2608" },
      { status: "open", noteOnly: true },
    ]),
    null,
  );
});

test("a case with nothing to send is blocked too, same as the server's canRelease gate", () => {
  assert.match(releaseBlockedReason([]), /no lines to release/);
  assert.match(releaseBlockedReason([{ status: "open", noteOnly: true }]), /no lines to release/);
});

test("every case status has a human label", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "released", "pushed", "failed", "cancelled"]) {
    assert.ok(caseStatusLabel(s), `no label for ${s}`);
  }
});
