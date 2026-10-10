import { describe, it, expect, beforeAll } from "vitest";
import assert from "node:assert/strict";

// Set a deterministic key before importing the crypto-backed module (the key is
// read at import time inside lib/crypto.js).
beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY =
    process.env.PHI_ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const phi = await import("./phi-crypto.js");
const { encryptRxPhi, decryptRxPhi } = phi;
const { isEncrypted } = await import("../../lib/crypto.js");
const { compileNotes } = await import("./case-notes.js");

const plaintextRow = {
  id: "case-1",
  caseNumber: "RX-ABC",
  userId: "user-1",
  seazonaClientId: "client-1",
  patientFirst: "Jane",
  patientLast: "Doe",
  dob: "1990-01-01",
  contactPhone: "555-123-4567",
  generalComments: "cover 1st molar to 1st molar",
  manualNote: "confirmed with Dr Lee re: Jane Doe's retainer, entered as Seazona order #4521",
  shipTo: { name: "Dr. Smith", address1: "1 Main St", city: "Austin" },
  formData: { q1: "yes", q2: ["a", "b"] },
  deviceOptions: { baseMaterial: "Nylon", occlusalContact: "Posterior" },
  dueDate: "2026-07-01",
  deviceKey: "ddso",
  // A non-PHI field should be untouched.
  gender: "F",
};

describe("rx phi-crypto helpers", () => {
  it("encryptRxPhi encrypts exactly the PHI fields and leaves others alone", () => {
    const enc = encryptRxPhi(plaintextRow);
    // PHI text fields
    for (const f of ["patientFirst", "patientLast", "dob", "contactPhone", "generalComments", "manualNote"]) {
      expect(isEncrypted(enc[f])).toBe(true);
    }
    // PHI JSON blobs → encrypted strings
    for (const f of ["shipTo", "formData", "deviceOptions"]) {
      expect(typeof enc[f]).toBe("string");
      expect(isEncrypted(enc[f])).toBe(true);
    }
    // Non-PHI untouched
    expect(enc.gender).toBe("F");
    expect(enc.caseNumber).toBe("RX-ABC");
    // Source object not mutated
    expect(plaintextRow.patientFirst).toBe("Jane");
  });

  it("decryptRxPhi round-trips back to the original plaintext values", () => {
    const enc = encryptRxPhi(plaintextRow);
    const dec = decryptRxPhi(enc);
    expect(dec.patientFirst).toBe("Jane");
    expect(dec.patientLast).toBe("Doe");
    expect(dec.dob).toBe("1990-01-01");
    expect(dec.contactPhone).toBe("555-123-4567");
    expect(dec.generalComments).toBe("cover 1st molar to 1st molar");
    expect(dec.manualNote).toBe("confirmed with Dr Lee re: Jane Doe's retainer, entered as Seazona order #4521");
    expect(dec.shipTo).toEqual({ name: "Dr. Smith", address1: "1 Main St", city: "Austin" });
    expect(dec.formData).toEqual({ q1: "yes", q2: ["a", "b"] });
    expect(dec.deviceOptions).toEqual({ baseMaterial: "Nylon", occlusalContact: "Posterior" });
  });

  it("passes through null PHI fields", () => {
    const enc = encryptRxPhi({ patientFirst: "A", patientLast: "B", dob: null, shipTo: null, deviceOptions: null });
    expect(enc.dob).toBe(null);
    expect(enc.shipTo).toBe(null);
    expect(enc.deviceOptions).toBe(null);
    const dec = decryptRxPhi(enc);
    expect(dec.dob).toBe(null);
    expect(dec.shipTo).toBe(null);
    expect(dec.deviceOptions).toBe(null);
  });

  it("case notes receive PLAINTEXT after decrypting an encrypted row", () => {
    const decrypted = decryptRxPhi(encryptRxPhi(plaintextRow));
    const notes = compileNotes(decrypted);
    assert.match(notes, /Occlusal Contact: Posterior/); // plaintext deviceOptions
    assert.match(notes, /cover 1st molar to 1st molar/); // plaintext generalComments
  });
});
