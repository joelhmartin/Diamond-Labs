process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";

const { sealInvoice, openInvoice, sealLine, openLine } = await import("./invoice-crypto.js");

test("a legacy invoice's patient is sealed at rest and opened on read", () => {
  const sealed = sealInvoice({ id: "i1", legacyPatient: "Test Patient", notes: null });
  assert.match(sealed.legacyPatient, /^enc:v1:/);
  assert.equal(sealed.notes, null);
  assert.equal(openInvoice(sealed).legacyPatient, "Test Patient");
});

test("a legacy line's Seazona text is sealed; a normal line has none", () => {
  const sealed = sealLine({ id: "l1", description: "Carried over from Seazona", legacyDescription: "DDSO for Test Patient" });
  assert.match(sealed.legacyDescription, /^enc:v1:/);
  assert.equal(sealed.description, "Carried over from Seazona");
  assert.equal(openLine(sealed).legacyDescription, "DDSO for Test Patient");
  assert.equal(openLine({ id: "l2", description: "x" }).legacyDescription, undefined);
});
