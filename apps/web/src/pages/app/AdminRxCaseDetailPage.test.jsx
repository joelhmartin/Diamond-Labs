import { test } from "vitest";
import assert from "node:assert/strict";
import { pushBlockedReason, resolutionLabel, statusLabel } from "./AdminRxCaseDetailPage.jsx";

test("the push button explains why it is disabled, rather than just being grey", () => {
  const reason = pushBlockedReason([{ status: "open", noteOnly: false, sourceLabel: "Anterior Pad" }]);
  assert.match(reason, /Anterior Pad/);
});

test("nothing blocking means no reason", () => {
  assert.equal(pushBlockedReason([{ status: "confirmed", noteOnly: false }]), null);
});

test("a note-only line never blocks the push, even while still 'open'", () => {
  assert.equal(
    pushBlockedReason([
      { status: "confirmed", noteOnly: false },
      { status: "open", noteOnly: true },
    ]),
    null,
  );
});

test("a case with nothing to send is blocked too, same as the server's canPush gate", () => {
  assert.match(pushBlockedReason([]), /no lines to send/);
  assert.match(pushBlockedReason([{ status: "open", noteOnly: true }]), /no lines to send/);
});

test("resolution label distinguishes a real push from a manual add", () => {
  assert.equal(resolutionLabel("pushed"), "Sent to Seazona");
  assert.equal(resolutionLabel("manual"), "Added manually");
  assert.equal(resolutionLabel(null), null);
  assert.equal(resolutionLabel("pushing"), null);
});

test("every case status has a human label", () => {
  for (const s of ["new", "in_review", "awaiting_doctor", "pushed", "failed", "cancelled"]) {
    assert.ok(statusLabel(s), `no label for ${s}`);
  }
});
